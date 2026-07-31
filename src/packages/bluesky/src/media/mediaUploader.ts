import { Agent, BlobRef } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import {
    MAX_RETRIES,
    BASE_RETRY_DELAY,
    MAX_RETRY_DELAY,
} from '../config/constants.js';
import { fetchMedia } from './mediaFetcher.js';

/**
 * Result of uploading a piece of media to Bluesky: the PDS blob reference
 * plus alt text. Bluesky-internal (the mastodon package never imports it).
 */
export interface MediaUpload {
    blob: BlobRef;
    alt: string;
}

/**
 * Uploads media to Bluesky's PDS with retry logic, using {@link fetchMedia} for
 * the download step. The fetch and upload steps are split so the fallback path
 * (image failed -> use the configured alt card image) can re-fetch + re-upload
 * without re-entering `upload`, which previously recursed unboundedly when the
 * alt card image itself failed (stack overflow).
 */
export class MediaUploader {
    private readonly agent: Agent;
    private readonly altCardImage?: string;

    constructor(agent: Agent, altCardImage?: string) {
        this.agent = agent;
        this.altCardImage = altCardImage;
    }

    /**
     * Upload media from a URL with mime type detection and retry logic.
     * @param url - URL of the media to upload
     * @param alt - Alt text for accessibility
     * @param isVideo - Whether the media is a video
     * @returns MediaUpload with blob reference and alt text
     * @throws Error if the upload fails after retries (and fallback, if any)
     */
    async upload(url: string, alt: string, isVideo = false): Promise<MediaUpload> {
        try {
            const { buffer, contentType } = await fetchMedia(url, isVideo);
            const blob = await this.uploadBlob(buffer, contentType);
            return { blob, alt };
        } catch (error) {
            // Bounded fallback to the alt card image for images only. This is a
            // one-shot inline re-fetch + re-upload — it does NOT re-enter
            // `upload`, so a failing alt card image can't recurse forever.
            if (!isVideo && this.altCardImage) {
                console.log('Using fallback image for failed media upload');
                try {
                    const { buffer, contentType } = await fetchMedia(this.altCardImage, false);
                    const blob = await this.uploadBlob(buffer, contentType);
                    return { blob, alt: alt || 'Fallback image' };
                } catch {
                    // alt card image failed too — fall through and throw the
                    // original error below (bounded: no further retry).
                }
            }

            if (error instanceof XRPCError) {
                throw new Error(`Failed to upload media: ${error.status} ${error.error}`);
            }
            throw new Error(`Failed to upload media: ${(error as Error).message}`);
        }
    }

    /**
     * Upload a buffer to Bluesky's PDS with exponential backoff retry on
     * rate-limit (429) and server (5xx) errors.
     */
    private async uploadBlob(
        buffer: Buffer,
        contentType: string,
        attempt = 1
    ): Promise<BlobRef> {
        try {
            const { data: { blob } } = await this.agent.uploadBlob(buffer, {
                encoding: contentType,
            });
            return blob as BlobRef;
        } catch (error) {
            if (error instanceof XRPCError) {
                // Retry on rate limit or server error
                if ((error.status === 429 || error.status >= 500) && attempt < MAX_RETRIES) {
                    const delay = Math.min(
                        BASE_RETRY_DELAY * Math.pow(2, attempt - 1),
                        MAX_RETRY_DELAY
                    );
                    console.warn(`Upload failed (attempt ${attempt}), retrying in ${delay}ms...`);
                    await this.sleep(delay);
                    return this.uploadBlob(buffer, contentType, attempt + 1);
                }
            }
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}