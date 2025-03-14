import * as Mastodon from 'tsl-mastodon-api';
import { bskyAccount, giveaways, mastodonApi, sourceAccountId } from '../config/config.js';
import { MAX_POSTS, REGEX } from '../constants.js';
import { Card, Image, PostContent, Video } from '../types.js'

// Use Mastodon's built-in types
type Status = Mastodon.JSON.Status;
type MediaAttachment = Mastodon.JSON.MediaAttachment;
type CardData = Mastodon.JSON.Card;

// Mastodon Client
const mastodon = new Mastodon.API({access_token: "", api_url: mastodonApi})

/**
 * Main function to fetch and process Mastodon posts.
 */
export default async function getPosts(): Promise<PostContent[]> {
    try {
        const response = await mastodon.getStatuses(sourceAccountId, {limit: MAX_POSTS});   
        return processPosts(response.json)
    } catch (error) {
        console.error('Failed to process Mastodon posts:', error)
        throw error;
    }
}

/**
 * Processes array of Mastodon posts
 */
function processPosts(response: Status[]): PostContent[] {
    return response.filter((post) => !post.reblog).map(post => {
        return {
            created_at: post.created_at,
            content: sanitizeContent(post.content),
            images: processImages(post.media_attachments),
            video: processVideo(post.media_attachments),
            card: processCard(post.card || undefined)
        }
    })
    .sort((a, b) => {
        return Date.parse(a.created_at) - Date.parse(b.created_at)
    });
}

/**
 * Sanitizes and formats post content for Bluesky compatibility.
 */
function sanitizeContent(content: string): string {

    let sanitized = content
        .replace(REGEX.TWITTER, '')
        .replace(REGEX.ACCOUNT, bskyAccount.identifier)
        .replace(REGEX.SERVER, '')
        .replace(REGEX.NBSP, '')
        .replace(REGEX.QUOTES, '"')
        .replace(REGEX.AMP, "&")
        .replace(REGEX.P_TAGS, '\n\n')
        .replace(REGEX.BR_TAGS, '\n')
        .replace(REGEX.HTML_TAGS, '');

    if (containsGiveaway(sanitized)) sanitized += '\n\n (Offer not valid on Bluesky.)';

    return sanitized
}

/**
 * Determine if post content contains giveway
 */
function containsGiveaway(content: string): boolean {
    return giveaways.some((s: string) => 
        s && content.toUpperCase().includes(s.toUpperCase())
    );
}

/**
 * Check if MediaAttachment is a video 
 */
function isVideo(media: MediaAttachment): boolean {
    return ['video', 'gifv'].includes(media.type);
}

/**
 * Check for unknown media Attachments
 */
function isUnknownMedia(media: MediaAttachment): boolean {
    return media.type === 'unknown'
}

/**
 * Proccess Image Media Attachment
 */
function processImages(attachments: MediaAttachment[]): Image[] {
    return attachments
        .filter(media => !isUnknownMedia(media))
        .flatMap(media => {
            const meta = media.meta as Mastodon.JSON.ImageAttachmentMeta
            return !isVideo(media) ? {
                url: media.url || '',
                alt: media.description || '',
                aspectRatio: {
                    width: meta.original.width,
                    height: meta.original.height,
                }
            } : []
    })
}

/**
 * Proccess Video Media Attachment
 */
function processVideo(attachments: MediaAttachment[]): Video | undefined {
    if (!attachments.length || !isVideo(attachments[0]) || isUnknownMedia(attachments[0])) return undefined
    
    const [media] = attachments;   // Only a single video is present
    const meta = media.meta.original as Mastodon.JSON.VideoAttachmentMetaOriginal

    return {
        url: media.url!,
        metadata: {
            width: meta.width,
            height: meta.height,
            duration: meta.duration,
            preview_url: media.preview_url
        }
    };
}

/**
 * Processes card data
 */
function processCard(card?: CardData): Card | undefined {
    if (!card) return

    const imageUrl = (card as Mastodon.JSON.PhotoCard)?.image || (card as Mastodon.JSON.VideoCard)?.image;
    return {
        uri: card?.url,
        title: card?.title,
        description: card?.description,
        image: imageUrl,
    };
}
