import axios from 'axios';
import { Agent, BlobRef } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import type { MediaUpload } from '@at-attin/types';
import {
    MAX_IMAGE_SIZE,
    MAX_VIDEO_SIZE,
    MAX_RETRIES,
    BASE_RETRY_DELAY,
    MAX_RETRY_DELAY,
} from './constants.js';

/**
 * Handles media uploads to Bluesky with proper mime type detection
 * and retry logic for transient failures.
 */
export class MediaUploader {
    private readonly agent: Agent;
    private readonly altCardImage?: string;

    constructor(agent: Agent, altCardImage?: string) {
        this.agent = agent;
        this.altCardImage = altCardImage;
    }

    /**
     * Upload media from a URL with mime type detection and retry logic
     * @param url - URL of the media to upload
     * @param alt - Alt text for accessibility
     * @param isVideo - Whether the media is a video
     * @returns MediaUpload with blob reference and alt text
     * @throws Error if upload fails after retries
     */
    async upload(url: string, alt: string, isVideo = false): Promise<MediaUpload> {
        try {
            const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

            // Fetch media
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                maxContentLength: maxSize,
                timeout: 30000,
            });

            const buffer = Buffer.from(response.data);

            // Validate size
            if (buffer.length > maxSize) {
                throw new Error(`Media exceeds size limit: ${buffer.length} > ${maxSize}`);
            }

            // Detect mime type from response headers
            let contentType = response.headers['content-type'];
            if (typeof contentType !== 'string') {
                contentType = isVideo ? 'video/mp4' : 'image/jpeg';
            }

            // Validate mime type
            if (isVideo && !contentType.startsWith('video/mp4')) {
                throw new Error(`Invalid video mime type: ${contentType}`);
            }
            if (!isVideo && !contentType.startsWith('image/')) {
                throw new Error(`Invalid image mime type: ${contentType}`);
            }

            // Upload with retry logic
            return await this.uploadWithRetry(buffer, alt, contentType);

        } catch (error) {
            // Fallback to alt card image for images only
            if (this.altCardImage && !isVideo) {
                console.log('Using fallback image for failed media upload');
                return this.upload(this.altCardImage, alt || 'Fallback image');
            }

            if (error instanceof XRPCError) {
                throw new Error(`Failed to upload media: ${error.status} ${error.error}`);
            }
            throw new Error(`Failed to upload media: ${(error as Error).message}`);
        }
    }

    /**
     * Internal method for uploading with exponential backoff retry
     */
    private async uploadWithRetry(
        buffer: Buffer,
        alt: string,
        contentType: string,
        attempt = 1
    ): Promise<MediaUpload> {
        try {
            const { data: { blob } } = await this.agent.uploadBlob(buffer, {
                encoding: contentType,
            });
            return { blob: blob as BlobRef, alt };
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
                    return this.uploadWithRetry(buffer, alt, contentType, attempt + 1);
                }
            }
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
