import { REGEX } from '../config/constants.js';

/**
 * Sanitizes Mastodon HTML content for Bluesky plain text format
 */
export function sanitizeContent(content: string, options?: SanitizeOptions): string {
    const opts = { ...defaultOptions, ...options };

    let sanitized = content
        // Strip invisible characters that Mastodon sometimes includes
         
        .replace(/[‌‍]/g, '')
        // Strip Mastodon mention links (preserve the @username)
        .replace(/<a href="[^"]*" class="mention"[^>]*>@([^<]+)<\/a>/g, '@$1')
        // Strip Twitter references
        .replace(REGEX.TWITTER, '')
        // Rewrite twitter.com links to x.com (run after stripping @twitter.com
        // mentions so only URL occurrences are affected)
        .replace(REGEX.TWITTER_URL, 'x.com')
        // Replace account references with Bluesky handle
        .replace(opts.accountRegex, opts.blueskyHandle)
        // Strip server references
        .replace(opts.serverRegex, '')
        // HTML entity decoding
        .replace(REGEX.NBSP, '')
        .replace(REGEX.QUOTES, '"')
        .replace(REGEX.AMP, '&')
        // Convert HTML tags to plain text
        .replace(REGEX.P_TAGS, '\n\n')
        .replace(REGEX.BR_TAGS, '\n')
        .replace(REGEX.HTML_TAGS, '');

    // Add giveaway disclaimer if needed
    if (opts.giveaways && containsGiveaway(sanitized, opts.giveaways)) {
        sanitized += '\n\n (Offer not valid on Bluesky.)';
    }

    return sanitized;
}

/**
 * Options for content sanitization
 */
export interface SanitizeOptions {
    blueskyHandle: string;
    accountRegex: RegExp;
    serverRegex: RegExp;
    giveaways?: string[];
}

const defaultOptions: Omit<SanitizeOptions, 'giveaways'> & { giveaways?: string[] } = {
    blueskyHandle: '',
    accountRegex: new RegExp(''),
    serverRegex: new RegExp(''),
    giveaways: undefined,
};

/**
 * Check if content contains giveaway keywords
 */
export function containsGiveaway(content: string, giveaways: string[]): boolean {
    return giveaways.some(keyword =>
        keyword && content.toUpperCase().includes(keyword.toUpperCase())
    );
}
