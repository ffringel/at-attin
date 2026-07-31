import type { JSON as MastodonJSON } from 'tsl-mastodon-api';
type MediaAttachment = MastodonJSON.MediaAttachment;
type Card = MastodonJSON.Card;
import type { Image, Video, Card as CardType } from '@at-attin/types';
import { isProcessableAsImage, isVideo } from './typeGuards.js';

/**
 * Process image media attachments with proper type safety
 */
export function processImages(attachments: MediaAttachment[]): Image[] | undefined {
    const images = attachments
        .filter(isProcessableAsImage)
        // Drop attachments with no usable URL (e.g. media still processing on
        // the Mastodon side) rather than emitting url: '' that later surfaces
        // as a bad upload target in the bluesky package.
        .filter(media => media.url || media.preview_url)
        .map(media => {
            // Both ImageAttachment and GIFVAttachment have meta.original with width/height
            const original = media.meta?.original;

            return {
                url: media.url || media.preview_url || '',
                alt: media.description || '',
                aspectRatio: original ? {
                    width: original.width,
                    height: original.height,
                } : undefined,
            };
        });

    // Match processVideo's "no media → undefined" semantics so an empty
    // result isn't allocated as `[]` (consumers guard with .length > 0 either
    // way, so this is a precision change with no behavior difference).
    return images.length ? images : undefined;
}

/**
 * Process video media attachment
 */
export function processVideo(attachments: MediaAttachment[]): Video | undefined {
    if (!attachments.length || !isVideo(attachments[0])) {
        return undefined;
    }

    const [media] = attachments;
    const original = media.meta?.original;

    if (!original) {
        return undefined;
    }

    // No usable URL (e.g. video still processing) — treat as no video rather
    // than emitting url: '' that later surfaces as a bad upload target.
    const url = media.url || media.preview_url || '';
    if (!url) {
        return undefined;
    }

    return {
        url,
        alt: media.description || '',
        metadata: {
            width: original.width,
            height: original.height,
            duration: original.duration,
            preview_url: media.preview_url,
        },
    };
}

/**
 * Process card data
 */
export function processCard(card?: Card | null): CardType | undefined {
    if (!card?.url) {
        return undefined;
    }

    // Card can be PhotoCard, VideoCard, or LinkCard - only PhotoCard and VideoCard have image
    const hasImage = 'image' in card && card.image;

    return {
        uri: card.url,
        title: card.title || '',
        description: card.description || '',
        ...(hasImage && { image: card.image }),
    };
}
