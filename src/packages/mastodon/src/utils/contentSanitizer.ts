import { REGEX } from '../config/constants.js';

/**
 * Configuration for a Sanitizer instance.
 */
export interface SanitizerConfig {
    /** Bluesky handle substituted for the source account reference. */
    blueskyHandle: string;
    /** Source Mastodon account handle in "@user@domain" form — builds the
     *  account/server regexes. NOT the numeric account ID. */
    sourceAccount: string;
    /** Giveaway keywords that trigger a disclaimer append. */
    giveaways?: string[];
}

/** Escape regex metacharacters in a literal string used to build a RegExp. */
function escapeRegex(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A regex that never matches anywhere, used as a "disabled" sentinel for the
// account/server rewrite (e.g. when sanitizing quoted foreign-account content,
// or when the source handle is empty/malformed). Unlike `new RegExp('')` —
// which matches the empty string once at position 0 and so is only a no-op
// when the replacement is '' — this is a true no-op regardless of replacement,
// so it's safe even when the replacement is the (non-empty) Bluesky handle.
// `(?!)` is a negative lookahead of an empty pattern: the empty pattern always
// matches, so the negative lookahead always fails.
const NEVER_REGEX = /(?!)/;

/**
 * Sanitizes Mastodon HTML content into Bluesky plain text.
 *
 * A single instance compiles the account/server regexes once (from the
 * sourceAccount handle) and reuses them across every post, instead of rebuilding
 * them per status. String.replace with a global regex always runs a fresh
 * full scan and resets lastIndex, so reusing the compiled regexes is safe.
 */
export class Sanitizer {
    private readonly accountRegex: RegExp;
    private readonly serverRegex: RegExp;
    private readonly blueskyHandle: string;
    private readonly giveaways?: string[];

    constructor(config: SanitizerConfig) {
        // accountRegex matches the source account's "@user@domain" handle so
        // self-references are rewritten to the Bluesky handle. Built from the
        // handle (NOT the numeric account ID — the prior code passed the ID,
        // so split('@')[2] was undefined and serverRegex became /@undefined/g,
        // a no-op that stripped nothing). Escaped so handle characters are
        // treated literally. Guarded: an empty handle falls back to a no-op
        // regex rather than matching the empty string everywhere (which would
        // insert the Bluesky handle between every character).
        this.accountRegex = config.sourceAccount
            ? new RegExp(escapeRegex(config.sourceAccount), 'g')
            : NEVER_REGEX;
        // serverRegex strips the "@domain" suffix from same-server mentions
        // (e.g. "@other@sportsbots.xyz" -> "@other"). Guarded: if the handle
        // isn't "@user@domain" (no domain part), fall back to a no-op rather
        // than /@/g, which would strip every '@' in the post.
        const domain = config.sourceAccount.split('@')[2];
        this.serverRegex = domain
            ? new RegExp('@' + escapeRegex(domain), 'g')
            : NEVER_REGEX;
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
        return this.run(content, NEVER_REGEX, NEVER_REGEX, '', undefined);
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