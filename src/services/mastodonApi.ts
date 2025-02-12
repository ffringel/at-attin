import * as Mastodon from 'tsl-mastodon-api';
import { bskyAccount, giveaways, mastodonAccount, mastodonApi, mastodonId } from "../config/config";

// Constants
const MAX_POSTS = 15
const MAX_VIDEO_DURATION = 60; // Maximum duration for a single video allowed on bluesky
const DELIMITER = {
    MEDIA: '!^&',
    SECTION: '@#%',
    CARD: '~~~',
};

// Precompiled Regex Patterns
const REGEX = {
    P_TAGS: /<\/p><p>/g,
    BR_TAGS: /<br>/g,
    QUOTES: /\\"/g,
    AMP: /&amp;/g,
    LOGO: /&nbsp;/g,
    TWITTER: /@twitter.com/g,
    ACCOUNT: new RegExp(mastodonAccount, "g"),
    SERVER: new RegExp("@" + mastodonAccount.split("@")[2], "g"),
    HTML_TAGS: /<[^>]+>/g,
    INVALID_LINKS: /\S*(\.com|\.ca|\.org|\.net)\S*(…|\.\.\.)/g,
};

// Mastodon Client
const mastodon = new Mastodon.API({access_token: "", api_url: mastodonApi});

/**
 * Fetches recent Mastodon posts for the specified account.
 */
async function fetchMastodonPosts(limit: number): Promise<MastodonPost[]> {
    try {
        const response = await mastodon.getStatuses(mastodonId, { limit });
        return JSON.parse(JSON.stringify(response)).json as MastodonPost[];
    } catch (error) {
        console.error("Failed to fetch Mastodon posts:", error)
        throw error
    }
}

/**
 * Sanitizes and formats post content for Bluesky compatibility.
 */
function sanitizedContent(content: string): string {
    let sanitizedContent = content
        .replace(REGEX.TWITTER, "")
        .replace(REGEX.ACCOUNT, bskyAccount.identifier)
        .replace(REGEX.SERVER, "")
        .replace(REGEX.LOGO, "")
        .replace(REGEX.QUOTES, '"')
        .replace(REGEX.AMP, "&")
        .replace(REGEX.P_TAGS, "\n\n")
        .replace(REGEX.BR_TAGS, "\n")
        .replace(REGEX.HTML_TAGS, "");

    // Append giveaway disclaimer if applicable
    for (const giveaway of giveaways) {
        if (giveaway && sanitizedContent.toUpperCase().includes(giveaway.toUpperCase())) {
            sanitizedContent += "\n\n (Offer not valid on Bluesky.)";
            break;
        }
    }

    return sanitizedContent
}

/**
 * Processes media attachments for a post.
 * - Splits videos longer than 60 seconds into multiple segments.
 */
function processMedia(attachments: MastodonPost['media_attachments'] = []): ProcessMediaResult {
    const urls: string[] = [];
    const altTexts: string[] = [];

    attachments.forEach((media) => {
        if (media.type === "iamge" || media.type === "gifv" || media.type === "video") {
            // Handle videos longer than 60 seconds
            if (media.type === "video" && media.meta?.original.duration && media.meta.original.duration > MAX_VIDEO_DURATION) {
                const duration = media.meta.original.duration;
                const segmentCount = Math.ceil(duration / MAX_VIDEO_DURATION); // Number of segments needed

                for (let i = 0; i < segmentCount; i++) {
                    const startTime = i * MAX_VIDEO_DURATION;
                    const endTime = Math.min((i + 1) * MAX_VIDEO_DURATION, duration);
          
                    // Generate a unique URL or identifier for each segment
                    const segmentUrl = `${media.url}#t=${startTime},${endTime}`;
                    urls.push(segmentUrl);
          
                    // Add alt text for the segment
                    altTexts.push(
                      `Segment ${i + 1}: ${media.description || "None"} (${startTime}s-${endTime}s)`
                    );
                  }
            } else {
                // Handle images, GIFs, and videos shorter than 60 seconds
                urls.push(media.url);
                if (media.type === "video" || media.type === "gifv") {
                    altTexts.push(
                        `${media.meta?.original.width}@#*${media.meta?.original.height}@#*${media.meta?.original.duration}@#*${media.preview_url}`
                    );
                } else {
                    altTexts.push(media.description || "None");
                }
            }
        } else {
            // Handle unsupported media types
            urls.push("None");
            altTexts.push("None");
        }
    });

    return {
        media: urls.join(DELIMITER.MEDIA),
        altTexts: altTexts.join(DELIMITER.MEDIA),
    };
}

/**
 * Processes card data for a post.
 */
function processCard(card: MastodonPost['card']): string {
    if (!card) return "None";

    const { url, title, description, image } = card
    return [url, title, description, image].join(DELIMITER.MEDIA)
}

/**
 * Processes a single Mastodon post into a Bluesky-compatible format.
 */
function processPost(post: MastodonPost): ProcessedPost {
    const { media, altTexts } = processMedia(post.media_attachments);
    const card = processCard(post.card)
    const content = sanitizedContent(post.content);

    return { content, media, altText: altTexts, card }
}

/**
 * Main function to fetch and process Mastodon posts.
 */
export default async function getPosts(): Promise<string> {
    try {
        const posts = await fetchMastodonPosts(MAX_POSTS);
        const processedPosts = posts.map(processPost)

        // Combine all processed posts into a single string
        return processedPosts
            .map((post) => [post.media, post.content, post.altText, post.card].join(DELIMITER.CARD))
            .join(DELIMITER.SECTION);
    } catch (error) {
        console.error("Failed to generate post text:", error)
        return "";
    }
}