export interface BotOptions {
    service: string | URL;
    dryRun: boolean;
}

/**
 * Quoted status from Mastodon (for quote posts)
 *
 * `uri`/`url` are optional: the mastodon producer emits the raw `quoted.uri` /
 * `quoted.url` (which may be absent or null) rather than coercing absent
 * values to ''. Downstream consumers treat both '' and undefined as "no value"
 * (via `?.` chains and truthy guards), so this is a precision change with no
 * behavior difference.
 */
export interface QuotedStatus {
    uri?: string;
    url?: string;
    content: string;
    account: QuotedStatusAccount;
    mastodonId?: string;  // The Mastodon post ID for mapping to Bluesky
    isOwnQuote?: boolean; // True if the quoted post is from the same source account
}

/**
 * Account info for quoted status
 */
export interface QuotedStatusAccount {
    id?: string;      // The Mastodon account ID, used to detect own quotes
    username: string;
    acct: string;
    display_name: string;
}

export interface PostContent {
    created_at: string;
    content: string;
    images?: Image[];
    video?: Video;
    card?: Card;
    quotedStatus?: QuotedStatus;
    mastodonId?: string;  // Mastodon post ID for mapping to Bluesky
    crossPostId?: string; // Referenced post ID (Twitter/sportsbots status ID) for quote mapping
}

export interface Image {
    url: string;
    alt?: string;
    aspectRatio?: {
        width?: number;
        height?: number;
    };
}

export interface Video {
    url: string;
    alt?: string;  // Alt text for accessibility (max 1000 graphemes)
    metadata?: VideoMetadata;
}

export interface VideoMetadata {
    width?: number;
    height?: number;
    duration?: number;
    preview_url?: string;
}

/**
 * Link card attached to a post.
 *
 * `uri`/`title`/`description` are required: the mastodon producer
 * (`processCard`) returns `undefined` when there's no URL, and otherwise
 * always sets all three (coercing empty to ''). Only `image` is genuinely
 * optional. This lets `embedBuilder.buildExternalEmbed` drop its `card.uri!`
 * non-null assertion — the type now carries the guard the caller already
 * performs.
 */
export interface Card {
    uri: string;
    title: string;
    description: string;
    image?: string;
}
