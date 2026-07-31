import type { PostContent } from '@at-attin/types';
import type { JSON as MastodonJSON } from 'tsl-mastodon-api';
import { MastodonClient } from './apiClient.js';
import { handleMastodonError } from './errorHandling.js';
import { sanitizeContent } from './contentSanitizer.js';
import { processImages, processVideo, processCard } from './mediaProcessor.js';
import { MAX_POSTS } from './constants.js';

/**
 * Mastodon Quote type (v4.5+)
 * This is a local definition since tsl-mastodon-api may not have it yet
 */
interface MastodonQuote {
    state: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'deleted' | 'unauthorized' | 'blocked_account' | 'blocked_domain' | 'muted_account';
    quoted_status?: MastodonJSON.Status;
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
    private readonly client: MastodonClient;
    private readonly config: MastodonServiceConfig;

    constructor(config: MastodonServiceConfig) {
        this.config = config;
        this.client = new MastodonClient({
            accessToken: config.accessToken,
            apiUrl: config.apiUrl,
        });
    }

    /**
     * Fetch and process posts from a Mastodon account
     * @param limit - Maximum number of posts to fetch (defaults to MAX_POSTS constant)
     * @returns Processed posts ready for Bluesky
     */
    async getPosts(limit: number = MAX_POSTS): Promise<PostContent[]> {
        try {
            const statuses = await this.client.getStatuses(
                this.config.sourceAccountId,
                limit
            );

            return this.processPosts(statuses);
        } catch (error) {
            handleMastodonError(error, 'Failed to fetch Mastodon posts');
            throw error;
        }
    }

    /**
     * Process array of Mastodon statuses into PostContent
     */
    private processPosts(statuses: MastodonJSON.Status[]): PostContent[] {
        return statuses
            .filter((post) => !post.reblog)
            .map(post => {
                const quotedStatus = processQuotedStatus((post as any).quote ?? null);

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
                    content: sanitizeContent(content, {
                        blueskyHandle: this.config.blueskyHandle,
                        accountRegex: new RegExp(this.config.sourceAccountId, 'g'),
                        serverRegex: new RegExp(
                            '@' + this.config.sourceAccountId.split('@')[2],
                            'g'
                        ),
                        giveaways: this.config.giveaways,
                    }),
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

    /**
     * Get the Mastodon post ID from a URL
     * Handles various formats:
     * - https://mastodon.social/@user/123456 -> 123456
     * - https://sportsbots.xyz/users/jeffzrebiec/statuses/123456 -> 123456
     * - https://twitter.com/user/status/123456 -> 123456
     */
    static extractPostId(url: string): string | undefined {
        const match = url.match(/\/statuses?\/(\d+)$/) || url.match(/\/(\d+)$/);
        return match?.[1];
    }
}

/**
 * Process quote status from Mastodon
 * Mastodon v4.5+ uses quote.quoted_status for quote posts
 */
function processQuotedStatus(quote: MastodonQuote | null): PostContent['quotedStatus'] {
    // Only process if quote is accepted and has a quoted status
    if (!quote || quote.state !== 'accepted' || !quote.quoted_status) {
        return undefined;
    }

    const quoted = quote.quoted_status;
    return {
        uri: quoted.uri ?? '',
        url: quoted.url ?? '',
        content: sanitizeContent(quoted.content, {
            blueskyHandle: '',
            accountRegex: new RegExp(''),
            serverRegex: new RegExp(''),
        }),
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
