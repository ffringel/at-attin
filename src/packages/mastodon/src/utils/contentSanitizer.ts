import { REGEX } from '../config/constants.js';

/**
 * Configuration for a Sanitizer instance.
 */
export interface SanitizerConfig {
    /** Bluesky handle substituted for the source account reference. */
    blueskyHandle: string;
    /** Source Mastodon account ID (e.g. "@user@domain") — builds the account/server regexes. */
    sourceAccountId: string;
    /** Giveaway keywords that trigger a disclaimer append. */
    giveaways?: string[];
}

// Zero-match regex used when sanitizing quoted (foreign-account) content,
// which must not be rewritten for the source account. Reused safely: a
// non-global regex never advances lastIndex, and String.replace with it
// replaces a single empty match — a no-op when the replacement is ''.
const EMPTY_REGEX = new RegExp('');

/**
 * Sanitizes Mastodon HTML content into Bluesky plain text.
 *
 * A single instance compiles the account/server regexes once (from the
 * sourceAccountId) and reuses them across every post, instead of rebuilding
 * them per status. String.replace with a global regex always runs a fresh
 * full scan and resets lastIndex, so reusing the compiled regexes is safe.
 */
export class Sanitizer {
    private readonly accountRegex: RegExp;
    private readonly serverRegex: RegExp;
    private readonly blueskyHandle: string;
    private readonly giveaways?: string[];

    constructor(config: SanitizerConfig) {
        this.accountRegex = new RegExp(config.sourceAccountId, 'g');
        this.serverRegex = new RegExp('@' + config.sourceAccountId.split('@')[2], 'g');
        this.blueskyHandle = config.blueskyHandle;
        this.giveaways = config.giveaways;
    }

    /** Full sanitization for the source account's own posts. */
    sanitize(content: string): string {
        return this.run(
            content,
            this.accountRegex,
            this.serverRegex,
            this.blueskyHandle,
            this.giveaways
        );
    }

    /**
     * Sanitization for quoted content, which belongs to a different account:
     * no handle/account/server rewriting and no giveaway disclaimer.
     */
    sanitizeQuoted(content: string): string {
        return this.run(content, EMPTY_REGEX, EMPTY_REGEX, '', undefined);
    }

    private run(
        content: string,
        accountRegex: RegExp,
        serverRegex: RegExp,
        blueskyHandle: string,
        giveaways: string[] | undefined,
    ): string {
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
            .replace(accountRegex, blueskyHandle)
            // Strip server references
            .replace(serverRegex, '')
            // HTML entity decoding
            .replace(REGEX.NBSP, '')
            .replace(REGEX.QUOTES, '"')
            .replace(REGEX.AMP, '&')
            // Convert HTML tags to plain text
            .replace(REGEX.P_TAGS, '\n\n')
            .replace(REGEX.BR_TAGS, '\n')
            .replace(REGEX.HTML_TAGS, '');

        // Add giveaway disclaimer if needed
        if (giveaways && containsGiveaway(sanitized, giveaways)) {
            sanitized += '\n\n (Offer not valid on Bluesky.)';
        }

        return sanitized;
    }
}

/**
 * Check if content contains giveaway keywords
 */
export function containsGiveaway(content: string, giveaways: string[]): boolean {
    return giveaways.some(keyword =>
        keyword && content.toUpperCase().includes(keyword.toUpperCase())
    );
}