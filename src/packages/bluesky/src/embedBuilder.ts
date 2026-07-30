import {
    AppBskyEmbedImages,
    AppBskyEmbedVideo,
    AppBskyEmbedExternal,
    BlobRef,
} from '@atproto/api';
import type { PostContent, Image as PostImage } from '@at-attin/types';
import { MAX_IMAGES_PER_POST } from './constants.js';
import { MediaUploader } from './mediaUploader.js';

/**
 * Union type for all embed types
 */
export type Embed =
    | AppBskyEmbedImages.Main
    | AppBskyEmbedVideo.Main
    | AppBskyEmbedExternal.Main;

/**
 * Builds embed structures for Bluesky posts based on content type.
 * Priority: Video > Images > External Card
 */
export class EmbedBuilder {
    private readonly mediaUploader: MediaUploader;

    constructor(mediaUploader: MediaUploader) {
        this.mediaUploader = mediaUploader;
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

        return undefined;
    }

    /**
     * Build a video embed
     */
    private async buildVideoEmbed(video: NonNullable<PostContent['video']>): Promise<AppBskyEmbedVideo.Main> {
        const videoBlob = await this.mediaUploader.upload(video.url, '', true);

        return {
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
}
