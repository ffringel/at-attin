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
 * Configuration for Mastodon service
 */
export interface MastodonServiceConfig {
    accessToken: string;
    apiUrl: string;
    sourceAccountId: string;
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
            access_token: config.accessToken,
            api_url: config.apiUrl,
        });
        this.sanitizer = new Sanitizer({
            blueskyHandle: config.blueskyHandle,
            sourceAccountId: config.sourceAccountId,
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
    private async fetchStatuses(limit: number): Promise<Mastodon.JSON.Status[]> {
        try {
            const response = await this.api.getStatuses(
                this.config.sourceAccountId,
                { limit }
            );
            return response.json;
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
    private processPosts(statuses: Mastodon.JSON.Status[]): PostContent[] {
        return statuses
            .filter((post) => !post.reblog)
            .map(post => {
                const quotedStatus = processQuotedStatus((post as any).quote ?? null, this.sanitizer);

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

                // If this is a quote post, handle the content
                if (quotedStatus) {
                    // Strip the quote reference HTML
                    content = content.replace(/<p class="quote-inline">.*?<\/p>/g, '').trim();

                    // An "own quote" is quoting a post from the same source account.
                    // In that case we mirror it as a Bluesky quote embed (resolved via
                    // the PostMapper), so we must NOT append the quoted URL here. For
                    // quotes of other accounts we can't build a quote embed, so we
                    // append the URL which Bluesky will render as a link card.
                    const isOwnQuote = !!quotedStatus.account?.id &&
                        quotedStatus.account.id === this.config.sourceAccountId;
                    quotedStatus.isOwnQuote = isOwnQuote;

                    if (!isOwnQuote && quotedStatus.content) {
                        // Append URL - Bluesky will create a link card
                        content += `\n\n${quotedStatus.url}`;
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
                    crossPostId: crossPostId,
                };
                return result;
            })
            .sort((a, b) => {
                // Sort chronologically (oldest first)
                // This ensures quoted posts are processed before posts that quote them
                return Date.parse(a.created_at) - Date.parse(b.created_at);
            });
    }

}

/**
 * Process quote status from Mastodon
 * Mastodon v4.5+ uses quote.quoted_status for quote posts
 */
function processQuotedStatus(quote: MastodonQuote | null, sanitizer: Sanitizer): PostContent['quotedStatus'] {
    // Only process if quote is accepted and has a quoted status
    if (!quote || quote.state !== 'accepted' || !quote.quoted_status) {
        return undefined;
    }

    const quoted = quote.quoted_status;
    return {
        uri: quoted.uri ?? '',
        url: quoted.url ?? '',
        content: sanitizer.sanitizeQuoted(quoted.content),
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
