import type { JSON as MastodonJSON } from 'tsl-mastodon-api';
type MediaAttachment = MastodonJSON.MediaAttachment;
type ImageAttachment = MastodonJSON.ImageAttachment;
type GIFVAttachment = MastodonJSON.GIFVAttachment;
type VideoAttachment = MastodonJSON.VideoAttachment;
type AudioAttachment = MastodonJSON.AudioAttachment;
type UnknownAttachment = MastodonJSON.UnknownAttachment;

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
    return media.type === 'video';
}

/**
 * Type guard for AudioAttachment
 */
export function isAudio(media: MediaAttachment): media is AudioAttachment {
    return media.type === 'audio';
}

/**
 * Type guard for UnknownAttachment (unsupported media types)
 */
export function isUnknownMedia(media: MediaAttachment): media is UnknownAttachment {
    return media.type === 'unknown';
}

/**
 * Check if media is an image or GIFV (processable as image)
 */
export function isProcessableAsImage(
    media: MediaAttachment
): media is ImageAttachment | GIFVAttachment {
    return isImage(media) || isGIFV(media);
}

/**
 * Check if media has video content (video or gifv)
 */
export function hasVideoContent(media: MediaAttachment): boolean {
    return isVideo(media) || isGIFV(media);
}
