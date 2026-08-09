import type { JSON as MastodonJSON } from 'tsl-mastodon-api';
type MediaAttachment = MastodonJSON.MediaAttachment;
type ImageAttachment = MastodonJSON.ImageAttachment;
type GIFVAttachment = MastodonJSON.GIFVAttachment;
type VideoAttachment = MastodonJSON.VideoAttachment;

/**
 * Type guard for ImageAttachment
 */
export function isImage(media: MediaAttachment): media is ImageAttachment {
    return media.type === 'image';
}

/**
 * Type guard for GIFVAttachment (animated GIFs)
 */
export function isGIFV(media: MediaAttachment): media is GIFVAttachment {
    return media.type === 'gifv';
}

/**
 * Type guard for VideoAttachment
 */
export function isVideo(media: MediaAttachment): media is VideoAttachment {
    return media.type === 'video' || media.type === 'gifv';
}

/**
 * Check if media is an image (processable as image; gifv is handled as video)
 */
export function isProcessableAsImage(
    media: MediaAttachment
): media is ImageAttachment | GIFVAttachment {
    return isImage(media);
}
