import { Agent } from '@atproto/api';
import type { PostContent } from '@at-attin/types';
import { PostRegistry } from './postRegistry.js';

/**
 * A resolved quote target: the Bluesky AT URI of the quoted post and its CID,
 * ready to drop into an `app.bsky.embed.record`.
 */
export interface ResolvedQuote {
    uri: string;
    cid: string;
}

/**
 * Resolves a quoted Mastodon status to a Bluesky quote-embed target.
 *
 * Two steps, both extracted from EmbedBuilder so it can stay construction-only:
 *   1. find the Bluesky AT URI for the quoted status (an `at://` URI on the
 *      quoted status itself, or a registry lookup by Mastodon ID), and
 *   2. fetch the post's CID via `getPosts` (the I/O that does not belong in a
 *      builder).
 */
export class QuoteResolver {
    private readonly agent: Agent;
    private readonly registry: PostRegistry;

    constructor(agent: Agent, registry: PostRegistry) {
        this.agent = agent;
        this.registry = registry;
    }

    async resolve(
        quotedStatus: NonNullable<PostContent['quotedStatus']>
    ): Promise<ResolvedQuote | undefined> {
        const uri = this.getBlueskyUri(quotedStatus);
        if (!uri) {
            return undefined;
        }
        const cid = await this.fetchCid(uri);
        if (!cid) {
            return undefined;
        }
        return { uri, cid };
    }

    /**
     * Get Bluesky AT URI for a quoted Mastodon status.
     * Priority: 1) an `at://` URI on the status itself (Bluesky-to-Bluesky
     * quotes), 2) a registry lookup by Mastodon ID (or ID extracted from URL).
     */
    private getBlueskyUri(quotedStatus: NonNullable<PostContent['quotedStatus']>): string | undefined {
        // First check if the URI is already an AT URI (for Bluesky-to-Bluesky quotes)
        if (quotedStatus.uri?.startsWith('at://')) {
            return quotedStatus.uri;
        }

        // Use mastodonId if available, otherwise extract from URL
        const quotedId = quotedStatus.mastodonId ||
                         quotedStatus.url?.match(/\/statuses?\/(\d+)/)?.[1] ||
                         quotedStatus.url?.match(/\/(\d+)$/)?.[1];

        if (quotedId) {
            return this.registry.getUri(quotedId);
        }
        return undefined;
    }

    /**
     * Fetch the post to get its actual CID. Returns undefined (warns) on any
     * failure so the caller can drop the quote embed gracefully.
     */
    private async fetchCid(uri: string): Promise<string | undefined> {
        try {
            // Use getPosts to fetch the post with its CID
            const result = await this.agent.app.bsky.feed.getPosts({ uris: [uri] });
            if (result.data.posts && result.data.posts.length > 0) {
                return result.data.posts[0].cid;
            }
        } catch (err) {
            console.warn(`Failed to fetch post for CID: ${err}`);
        }
        return undefined;
    }
}