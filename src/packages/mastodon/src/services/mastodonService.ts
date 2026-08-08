import type { PostContent } from '@at-attin/types';
import * as Mastodon from 'tsl-mastodon-api';
import { MastodonAPIError } from '../utils/errorHandling.js';
import { Sanitizer } from '../utils/contentSanitizer.js';
import { processImages, processVideo, processCard } from '../utils/mediaProcessor.js';
import { MAX_POSTS } from '../config/constants.js';

/**
 * Mastodon Quote type (v4.5+)
 * This is a local definition since tsl-mastodon-api may not have it yet
 */
interface MastodonQuote {
    state: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'deleted' | 'unauthorized' | 'blocked_account' | 'blocked_domain' | 'muted_account';
    quoted_status?: Mastodon.JSON.Status;
}

/**
 * A Mastodon status with the v4.5+ `quote` field, which tsl-mastodon-api's
 * `JSON.Status` doesn't yet type. Modeled as a local intersection so we avoid
 * global declaration-merging (which would couple us to the library's type
 * surface and conflict if upstream ever ships its own `quote`). The cast is
 * applied once at the fetch boundary; downstream code sees a typed `quote`.
 */
type MastodonStatus = Mastodon.JSON.Status & { quote?: MastodonQuote };

/**
 * Configuration for Mastodon service
 */
export interface MastodonServiceConfig {
    /** Optional access token — public timelines (e.g. mastodon.social) need
     *  no auth; passed to the library as `accessToken ?? ''`. */
    accessToken?: string;
    apiUrl: string;
    /** Numeric Mastodon account ID — used for API calls and own-quote detection. */
    sourceAccountId: string;
    /** Source Mastodon handle in "@user@domain" form — used to build the
     *  sanitizer's account/server regexes (NOT the numeric ID). */
    sourceAccount: string;
    blueskyHandle: string;
    giveaways?: string[];
}

/**
 * Fetch and process Mastodon posts for Bluesky mirroring
 */
export default class MastodonService {
    private readonly api: Mastodon.API;
    private readonly config: MastodonServiceConfig;
    private readonly sanitizer: Sanitizer;

    constructor(config: MastodonServiceConfig) {
        this.config = config;
        this.api = new Mastodon.API({
            access_token: config.accessToken ?? '',
            api_url: config.apiUrl,
        });
        this.sanitizer = new Sanitizer({
            blueskyHandle: config.blueskyHandle,
            sourceAccount: config.sourceAccount,
            giveaways: config.giveaways,
        });
    }

    /**
     * Fetch and process posts from a Mastodon account
     * @param limit - Maximum number of posts to fetch (defaults to MAX_POSTS constant)
     * @returns Processed posts ready for Bluesky
     */
    async getPosts(limit: number = MAX_POSTS): Promise<PostContent[]> {
        const statuses = await this.fetchStatuses(limit);
        return this.processPosts(statuses);
    }

    /**
     * Fetch recent statuses for the source account.
     *
     * The tsl-mastodon-api client self-paces via its internal nextDelay (reset
     * from X-RateLimit-* headers after each request), and we make exactly one
     * request per run, so no manual delay or rate-limit logging is needed here.
     */
    private async fetchStatuses(limit: number): Promise<MastodonStatus[]> {
        try {
            const response = await this.api.getStatuses(
                this.config.sourceAccountId,
                { limit }
            );
            // Cast once at the fetch boundary: the library's JSON.Status
            // doesn't type the v4.5+ `quote` field (see MastodonStatus above).
            return response.json as MastodonStatus[];
        } catch (error) {
            // tsl-mastodon-api throws the raw API.Result object — a plain
            // object with .status/.json, NOT an Error — on any non-200
            // response, so without wrapping it the top-level catch (which logs
            // error.message) would print "undefined". Wrap it so a real Error
            // with a useful message propagates to that single log site.
            // Mastodon's human-readable detail lives in result.json.error;
            // result.error is a placeholder Error with an empty message except
            // on transport faults.
            const status = (error as { status?: number })?.status;
            const json = (error as { json?: { error?: string } })?.json;
            const inner = (error as { error?: Error })?.error;
            const detail =
                json?.error ??
                (inner instanceof Error && inner.message ? inner.message : null) ??
                'Unknown error';
            throw new MastodonAPIError(
                `Mastodon API returned error: ${detail} (Status: ${status})`,
                status
            );
        }
    }

    /**
     * Process array of Mastodon statuses into PostContent
     */
    private processPosts(statuses: MastodonStatus[]): PostContent[] {
        return statuses
            .filter((post) => !post.reblog)
            .map(post => {
                const quotedStatus = this.processQuotedStatus(post.quote ?? null);

                // Extract status ID from cross-posted social URLs (Twitter, sportsbots.xyz, etc.)
                // These are used to map Mastodon posts to Bluesky posts for quote functionality
                let crossPostId: string | undefined;
                if (!quotedStatus) {
                    // Match /statuses/ID from any domain - the HTML contains href=".../statuses/ID"
                    const match = post.content.match(/statuses\/(\d+)/);
                    if (match && match[1]) {
                        crossPostId = match[1];
                    }
                }

                let content = post.content;

                // The bridge prepends a <p class="quote-inline">RE: <url></p> to
                // the content of any quote post — accepted (with a quoted_status)
                // or pending (quoted_status null). Always strip it so the quote
                // reference doesn't leak into the posted text; the reference is
                // carried by the Bluesky quote embed (own-quotes) or an appended
                // x.com URL (cross-account). Capture the inline first so a pending
                // quote can still derive the quoted tweet's x.com URL from it.
                const quoteInlineMatch = post.content.match(/<p class="quote-inline">[\s\S]*?<\/p>/);
                content = content.replace(/<p class="quote-inline">[\s\S]*?<\/p>/g, '').trim();

                // If this is an accepted quote post, handle the content
                if (quotedStatus) {
                    // An "own quote" is quoting a post from the same source account.
                    // In that case we mirror it as a Bluesky quote embed (resolved via
                    // the PostRegistry), so we must NOT append the quoted URL here. For
                    // quotes of other accounts we can't build a quote embed, so we
                    // append the URL which Bluesky will render as a link card.
                    const isOwnQuote = !!quotedStatus.account?.id &&
                        quotedStatus.account.id === this.config.sourceAccountId;
                    quotedStatus.isOwnQuote = isOwnQuote;

                    if (!isOwnQuote && quotedStatus.url) {
                        // Append URL - Bluesky will create a link card
                        content += `\n\n${quotedStatus.url}`;
                    }
                } else if (quoteInlineMatch) {
                    // Pending/external quote: the bridge hasn't supplied
                    // quoted_status, so there's nothing to build a Bluesky quote
                    // embed from. Derive the quoted tweet's id from the inline
                    // sportsbots/ext.sportsbots URL and append an x.com permalink
                    // so Bluesky renders the quoted tweet as a link card instead of
                    // the "RE: <sportsbots url>" cruft. The i/status/<id> form
                    // avoids needing the username, which the bridge doesn't surface
                    // for pending quotes.
                    const href = quoteInlineMatch[0].match(/href="([^"]+)"/)?.[1];
                    const tweetId = href?.match(/\/statuses\/(\d+)/)?.[1];
                    if (tweetId) {
                        content += `\n\nhttps://x.com/i/status/${tweetId}`;
                    }
                }

                const result: PostContent = {
                    created_at: post.created_at,
                    content: this.sanitizer.sanitize(content),
                    images: processImages(post.media_attachments),
                    video: processVideo(post.media_attachments),
                    card: processCard(post.card ?? undefined),
                    quotedStatus,
                    mastodonId: post.id,
                    crossPostId,
                };
                return result;
            })
            .sort((a, b) => {
                // Sort chronologically (oldest first)
                // This ensures quoted posts are processed before posts that quote them
                return Date.parse(a.created_at) - Date.parse(b.created_at);
            });
    }

    /**
     * Process quote status from Mastodon
     * Mastodon v4.5+ uses quote.quoted_status for quote posts
     */
    private processQuotedStatus(quote: MastodonQuote | null): PostContent['quotedStatus'] {
        // Only process if quote is accepted and has a quoted status
        if (!quote || quote.state !== 'accepted' || !quote.quoted_status) {
            return undefined;
        }

        const quoted = quote.quoted_status;
        return {
            // uri is always a string on a Mastodon status; url is string | null |
            // undefined. Emit the raw values (no '' coercion) — QuotedStatus now
            // models both as optional, and downstream treats '' and undefined the
            // same (truthy guards / ?. chains).
            uri: quoted.uri,
            url: quoted.url ?? undefined,
            content: this.sanitizer.sanitizeQuoted(quoted.content),
            account: {
                id: quoted.account.id,
                username: quoted.account.username,
                acct: quoted.account.acct,
                display_name: quoted.account.display_name,
            },
            // Store the Mastodon post ID for mapping to Bluesky
            mastodonId: quoted.id,
        };
    }
}
