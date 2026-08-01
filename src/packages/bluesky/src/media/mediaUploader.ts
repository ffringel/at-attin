import { Agent, BlobRef } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import {
    MAX_RETRIES,
    BASE_RETRY_DELAY,
    MAX_RETRY_DELAY,
} from '../config/constants.js';
import { fetchMedia } from './mediaFetcher.js';
import { sleep } from '../utils/sleep.js';

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
 * the download step. The fetch and upload steps are split so each can fail and
 * be reported independently. A failed image is skipped by the caller
 * (EmbedBuilder.buildImagesEmbed uses Promise.allSettled) — there is no
 * fallback image; the post goes out with surviving images or text-only.
 */
export class MediaUploader {
    private readonly agent: Agent;

    constructor(agent: Agent) {
        this.agent = agent;
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
            // Wrap into a plain Error (not rethrown as XRPCError) so the
            // orchestrator's handlePostError — which retries on XRPCError
            // 429/5xx — doesn't double-retry what uploadBlob already retried
            // internally.
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
            return blob;
        } catch (error) {
            if (error instanceof XRPCError) {
                // Retry on rate limit or server error
                if ((error.status === 429 || error.status >= 500) && attempt < MAX_RETRIES) {
                    const delay = Math.min(
                        BASE_RETRY_DELAY * Math.pow(2, attempt - 1),
                        MAX_RETRY_DELAY
                    );
                    console.warn(`Upload failed (attempt ${attempt}), retrying in ${delay}ms...`);
                    await sleep(delay);
                    return this.uploadBlob(buffer, contentType, attempt + 1);
                }
            }
            throw error;
        }
    }
}