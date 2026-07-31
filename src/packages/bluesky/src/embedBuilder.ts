import {
    AppBskyEmbedImages,
    AppBskyEmbedVideo,
    AppBskyEmbedExternal,
    AppBskyEmbedRecord,
    BlobRef,
    Agent,
} from '@atproto/api';
import type { PostContent, Image as PostImage } from '@at-attin/types';
import { MAX_IMAGES_PER_POST } from './constants.js';
import { MediaUploader } from './mediaUploader.js';
import { PostMapper } from './postMapper.js';

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
    private readonly postMapper?: PostMapper;
    private readonly agent?: Agent;

    constructor(mediaUploader: MediaUploader, postMapper?: PostMapper, agent?: Agent) {
        this.mediaUploader = mediaUploader;
        this.postMapper = postMapper;
        this.agent = agent;
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
            video: videoBlob.blob as BlobRef,
            alt: video.alt || '',
            ...(video.metadata?.width && video.metadata?.height && {
                aspectRatio: {
                    width: video.metadata.width,
                    height: video.metadata.height,
                },
            }),
        };
    }

    /**
     * Build an images embed (max 4 images)
     */
    private async buildImagesEmbed(images: PostImage[]): Promise<AppBskyEmbedImages.Main> {
        const imagesToUpload = images.slice(0, MAX_IMAGES_PER_POST);

        const uploadedImages: AppBskyEmbedImages.Image[] = await Promise.all(
            imagesToUpload.map(async img => {
                const media = await this.mediaUploader.upload(img.url, img.alt || '');
                return {
                    image: media.blob as BlobRef,
                    alt: img.alt || '',
                    ...(img.aspectRatio?.width && img.aspectRatio?.height && {
                        aspectRatio: {
                            width: img.aspectRatio.width,
                            height: img.aspectRatio.height,
                        },
                    }),
                };
            })
        );

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
            // card.title is validated before this method is called
            const title = card.title || 'Link';
            const thumb = card.image
                ? await this.mediaUploader.upload(card.image, title)
                : null;

            return {
                $type: 'app.bsky.embed.external',
                external: {
                    uri: card.uri!,
                    title: title,
                    description: card.description || '',
                    ...(thumb && { thumb: thumb.blob as BlobRef }),
                },
            };
        } catch (error) {
            console.warn('Failed to create card embed, continuing without:', (error as Error).message);
            return undefined;
        }
    }

    /**
     * Build a quote post embed (app.bsky.embed.record)
     * Looks up the Bluesky AT URI for the quoted Mastodon post
     * and fetches the actual CID
     */
    private async buildQuoteEmbed(quotedStatus: NonNullable<PostContent['quotedStatus']>): Promise<AppBskyEmbedRecord.Main | undefined> {
        // Try to find the Bluesky AT URI from our post mapper
        const recordUri = this.getBlueskyUriForQuotedStatus(quotedStatus);

        // Skip quote embed if we don't have a valid AT URI
        if (!recordUri) {
            return undefined;
        }

        // Fetch the post to get the actual CID
        let cid: string | undefined;
        if (this.agent) {
            try {
                // Use getPosts to fetch the post with its CID
                const result = await this.agent.app.bsky.feed.getPosts({ uris: [recordUri] });
                if (result.data.posts && result.data.posts.length > 0) {
                    cid = result.data.posts[0].cid;
                }
            } catch (err) {
                console.warn(`Failed to fetch post for CID: ${err}`);
            }
        }

        return {
            $type: 'app.bsky.embed.record',
            record: {
                uri: recordUri,
                cid: cid || '',
            },
        };
    }

    /**
     * Get Bluesky AT URI for a quoted Mastodon status
     * Uses the PostMapper to find previously mirrored posts
     * Priority: 1) mastodonId field, 2) extract from URL
     */
    private getBlueskyUriForQuotedStatus(quotedStatus: NonNullable<PostContent['quotedStatus']>): string | undefined {
        // First check if the URI is already an AT URI (for Bluesky-to-Bluesky quotes)
        if (quotedStatus.uri?.startsWith('at://')) {
            return quotedStatus.uri;
        }

        // Try to find in our post mapper
        if (this.postMapper) {
            // Use mastodonId if available, otherwise extract from URL
            const quotedId = quotedStatus.mastodonId ||
                             quotedStatus.url?.match(/\/statuses?\/(\d+)/)?.[1] ||
                             quotedStatus.url?.match(/\/(\d+)$/)?.[1];

            if (quotedId) {
                const blueskyUri = this.postMapper.get(quotedId);
                if (blueskyUri) {
                    return blueskyUri;
                }
            }
        }

        // No valid AT URI found - quote embed not possible
        return undefined;
    }
}
