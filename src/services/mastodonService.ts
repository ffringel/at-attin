import * as Mastodon from 'tsl-mastodon-api';
import { bskyAccount, giveaways, mastodonApi, sourceAccountId } from '../config/config.js';
import { MAX_POSTS, REGEX, VIDEO_CONFIG } from '../constants.js';
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
        const posts = processPosts(response.json)
        
        return posts
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
            videos: processVideo(post.media_attachments),
            card: processCard(post.card || undefined)
        }
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
 * Proccess Image Media Attachment
 */
function processImages(attachments: MediaAttachment[]): Image[] {
    return attachments.flatMap(media => {
        return !isVideo(media) ? {
            url: media.url || '',
            alt: media.description || ''
        } : []
    })
}

/**
 * Proccess Video Media Attachment
 */
function processVideo(attachments: MediaAttachment[]): Video[] {
    if (!attachments.length) return []
    
    const media = attachments[0];   // Only a single video is present
    const meta = media.meta.original as Mastodon.JSON.VideoAttachmentMeta
    const duration = meta?.duration || 0;
    const segmentCount = Math.ceil(duration / VIDEO_CONFIG.SEGMENT_DURATION);

    return Array.from({ length: segmentCount }, (_, i) => {
        const segmentUrl = `${media.url}#t=${i * VIDEO_CONFIG.SEGMENT_DURATION}`;
        const segmentDuration = i === segmentCount - 1 
          ? duration % VIDEO_CONFIG.SEGMENT_DURATION || VIDEO_CONFIG.SEGMENT_DURATION
          : VIDEO_CONFIG.SEGMENT_DURATION;
    
        return {
            url: segmentUrl,
            metadata: {
                width: meta.width || 0,
                height: meta.height || 0,
                duration: segmentDuration,
                preview_url: media.preview_url
            }
        };
    });
}

/**
 * Processes card data
 */
function processCard(card?: CardData): Card {  
    const imageUrl = (card as Mastodon.JSON.PhotoCard)?.image || (card as Mastodon.JSON.VideoCard)?.image || undefined;
    return {
        url: card?.url,
        title: card?.title,
        description: card?.description,
        image: imageUrl,
    };
  }
