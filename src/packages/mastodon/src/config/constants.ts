// Number of posts to fetch from Mastodon
export const MAX_POSTS = 20;

// Precompiled Regex Patterns for content sanitization
export const REGEX = {
    P_TAGS: /<\/p><p>/g,
    BR_TAGS: /<br>/g,
    QUOTES: /\\"/g,
    AMP: /&amp;/g,
    NBSP: /&nbsp;/g,
    TWITTER: /@twitter.com/g,
    TWITTER_URL: /twitter\.com/g,
    HTML_TAGS: /<[^>]+>/g,
} as const;
