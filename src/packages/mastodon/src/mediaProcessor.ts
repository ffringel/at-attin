import type { JSON as MastodonJSON } from 'tsl-mastodon-api';
type MediaAttachment = MastodonJSON.MediaAttachment;
type Card = MastodonJSON.Card;
import type { Image, Video, Card as CardType } from '@at-attin/types';
import { isProcessableAsImage, isVideo, isUnknownMedia } from './typeGuards.js';

/**
 * Process image media attachments with proper type safety
 */
export function processImages(attachments: MediaAttachment[]): Image[] {
    return attachments
        .filter(isProcessableAsImage)
        .map(media => {
            // Both ImageAttachment and GIFVAttachment have meta.original with width/height
            const original = media.meta?.original;

            return {
                // Handle null url (can happen while media is processing)
                url: media.url || media.preview_url || '',
                alt: media.description || '',
                aspectRatio: original ? {
                    width: original.width,
                    height: original.height,
                } : undefined,
            };
        });
}

/**
 * Process video media attachment
 */
export function processVideo(attachments: MediaAttachment[]): Video | undefined {
    if (!attachments.length || !isVideo(attachments[0]) || isUnknownMedia(attachments[0])) {
        return undefined;
    }

    const [media] = attachments;
    const original = media.meta?.original;

    if (!original) {
        return undefined;
    }

    return {
        // Handle null url (can happen while video is processing)
        url: media.url || media.preview_url || '',
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
