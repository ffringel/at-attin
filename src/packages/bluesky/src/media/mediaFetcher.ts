import axios from 'axios';
import { MAX_IMAGE_SIZE, MAX_VIDEO_SIZE } from '../config/constants.js';

/**
 * Result of fetching a media URL: the raw bytes and detected content type.
 */
export interface FetchedMedia {
    buffer: Buffer;
    contentType: string;
}

/**
 * Download a media URL and validate its size and mime type.
 *
 * Pure I/O helper (no Bluesky state): fetch -> size check -> mime detection +
 * validation. Extracted from MediaUploader so download is separated from PDS
 * upload, and so the fallback path can re-fetch without re-entering `upload`.
 * @param url - URL of the media to fetch
 * @param isVideo - Whether the media is a video (selects size limit + mime rules)
 * @returns The fetched buffer and its content type
 * @throws Error if the fetch, size, or mime validation fails
 */
export async function fetchMedia(url: string, isVideo: boolean): Promise<FetchedMedia> {
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

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

    return { buffer, contentType };
}