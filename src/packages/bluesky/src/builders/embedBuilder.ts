import {
    AppBskyEmbedImages,
    AppBskyEmbedVideo,
    AppBskyEmbedExternal,
    AppBskyEmbedRecord,
} from '@atproto/api';
import type { PostContent, Image as PostImage } from '@at-attin/types';
import { MAX_IMAGES_PER_POST, MAX_VIDEO_ALT_LENGTH } from '../config/constants.js';
import { MediaUploader } from '../media/mediaUploader.js';
import { QuoteResolver } from '../services/quoteResolver.js';
import { truncateToGraphemes } from '../utils/textUtils.js';

/**
 * Union type for all embed types including quote posts
 */
export type Embed =
    | AppBskyEmbedImages.Main
    | AppBskyEmbedVideo.Main
    | AppBskyEmbedExternal.Main
    | AppBskyEmbedRecord.Main;

/**
 * Builds embed structures for Bluesky posts based on content type.
 * Priority: Video > Images > External Card > Quote Post
 */
export class EmbedBuilder {
    private readonly mediaUploader: MediaUploader;
    private readonly quoteResolver: QuoteResolver;

    constructor(mediaUploader: MediaUploader, quoteResolver: QuoteResolver) {
        this.mediaUploader = mediaUploader;
        this.quoteResolver = quoteResolver;
    }

    /**
     * Build an embed structure from post content
     * @param post - The post content to build an embed for
     * @returns Embed object or undefined if no embeddable content
     */
    async build(post: PostContent): Promise<Embed | undefined> {
        // Priority 1: Video embed
        if (post.video) {
            return this.buildVideoEmbed(post.video);
        }

        // Priority 2: Images embed
        if (post.images && post.images.length > 0) {
            return this.buildImagesEmbed(post.images);
        }

        // Priority 3: External card embed
        if (post.card?.uri && post.card.title && post.card.description) {
            return this.buildExternalEmbed(post.card);
        }

        // Priority 4: Quote post embed (record embed)
        if (post.quotedStatus) {
            return this.buildQuoteEmbed(post.quotedStatus);
        }

        return undefined;
    }

    /**
     * Build a video embed
     */
    private async buildVideoEmbed(video: NonNullable<PostContent['video']>): Promise<AppBskyEmbedVideo.Main> {
        const videoBlob = await this.mediaUploader.upload(video.url, '', true);

        return {
            $type: 'app.bsky.embed.video',
            video: videoBlob.blob,
            alt: truncateToGraphemes(video.alt || '', MAX_VIDEO_ALT_LENGTH),
            ...(video.metadata?.width && video.metadata?.height && {
                aspectRatio: {
                    width: video.metadata.width,
                    height: video.metadata.height,
                },
            }),
        };
    }

    /**
     * Build an images embed (max 4 images). Degrades gracefully per-image:
     * a single image that fails to download/upload (e.g. exceeds Bluesky's
     * 2MB image limit, bad mime, network error) is skipped rather than
     * rejecting the whole embed — the post still goes out with the surviving
     * images, or text-only if every image fails. Mirrors buildExternalEmbed's
     * "continue without" pattern; prevents one oversized image from killing
     * the entire run.
     */
    private async buildImagesEmbed(images: PostImage[]): Promise<AppBskyEmbedImages.Main | undefined> {
        const imagesToUpload = images.slice(0, MAX_IMAGES_PER_POST);

        const results = await Promise.allSettled(
            imagesToUpload.map(img =>
                this.mediaUploader.upload(img.url, img.alt || '').then(media => ({
                    image: media.blob,
                    alt: img.alt || '',
                    ...(img.aspectRatio?.width && img.aspectRatio?.height && {
                        aspectRatio: {
                            width: img.aspectRatio.width,
                            height: img.aspectRatio.height,
                        },
                    }),
                }))
            )
        );

        const uploadedImages: AppBskyEmbedImages.Image[] = [];
        for (const result of results) {
            if (result.status === 'fulfilled') {
                uploadedImages.push(result.value);
            } else {
                console.warn(
                    'Skipping failed image:',
                    result.reason instanceof Error ? result.reason.message : result.reason
                );
            }
        }

        if (uploadedImages.length === 0) {
            console.warn('All images failed to upload; posting without an image embed');
            return undefined;
        }

        return {
            $type: 'app.bsky.embed.images',
            images: uploadedImages,
        };
    }

    /**
     * Build an external card embed
     */
    private async buildExternalEmbed(
        card: NonNullable<PostContent['card']>
    ): Promise<AppBskyEmbedExternal.Main | undefined> {
        try {
            // card.title/description are validated before this method is called
            const title = card.title;
            const thumb = card.image
                ? await this.mediaUploader.upload(card.image, title)
                : null;

            return {
                $type: 'app.bsky.embed.external',
                external: {
                    uri: card.uri,
                    title: title,
                    description: card.description,
                    ...(thumb && { thumb: thumb.blob }),
                },
            };
        } catch (error) {
            console.warn('Failed to create card embed, continuing without:', (error as Error).message);
            return undefined;
        }
    }

    /**
     * Build a quote post embed (app.bsky.embed.record).
     * Delegates URI + CID resolution to QuoteResolver; this method is purely
     * construction once a {uri, cid} is resolved.
     */
    private async buildQuoteEmbed(quotedStatus: NonNullable<PostContent['quotedStatus']>): Promise<AppBskyEmbedRecord.Main | undefined> {
        const resolved = await this.quoteResolver.resolve(quotedStatus);
        if (!resolved) {
            return undefined;
        }

        return {
            $type: 'app.bsky.embed.record',
            record: {
                uri: resolved.uri,
                cid: resolved.cid,
            },
        };
    }
}
