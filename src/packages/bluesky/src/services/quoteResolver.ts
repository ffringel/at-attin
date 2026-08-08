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
 * A quote target still missing its CID — only the URI is known, so the CID
 * must be fetched via `getPosts` before the embed can be built.
 */
interface UriOnly {
    uri: string;
    cid?: undefined;
    source: 'at-uri';
}

/**
 * A fully-resolved quote target (URI + CID) obtained without a `getPosts`
 * round-trip — either from the in-run id→record map or the author feed.
 */
interface RecordResolved {
    uri: string;
    cid: string;
    source: 'map' | 'feed';
}

type ResolvedRecord = RecordResolved | UriOnly;

/**
 * Resolves a quoted Mastodon status to a Bluesky quote-embed target.
 *
 * Two steps, both extracted from EmbedBuilder so it can stay construction-only:
 *   1. find the Bluesky record (URI + CID) for the quoted status — an `at://`
 *      URI on the quoted status itself, a registry lookup by Mastodon ID
 *      (the quotee was processed earlier this run), or a content-prefix
 *      search of the author feed (the quotee was mirrored in a previous run),
 *      and
 *   2. when a CID wasn't carried along (only the `at://` case), fetch it via
 *      `getPosts`.
 *
 * The map and feed paths carry the CID from post time / the feed post, so the
 * common same-run own-quote builds its embed WITHOUT a `getPosts` round-trip.
 * That matters: `getPosts` on a just-created quotee races the AppView index
 * (returns empty) and was degrading own-quotes to plain links.
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
        const record = this.getBlueskyRecord(quotedStatus);
        if (!record) {
            console.warn(
                `[quote] unresolved (isOwnQuote=${!!quotedStatus.isOwnQuote}, ` +
                `quotedId=${quotedStatus.mastodonId ?? 'none'}) — degrading to link fallback`
            );
            return undefined;
        }

        // Use the carried CID when we have it (map/feed paths); only the rare
        // at:// case lacks one and needs a getPosts fetch.
        let cid = record.cid;
        if (!cid) {
            cid = await this.fetchCid(record.uri);
            if (!cid) {
                console.warn(
                    `[quote] resolved uri via ${record.source} but getPosts returned no CID ` +
                    `for ${record.uri} — degrading to link fallback`
                );
                return undefined;
            }
        }

        console.log(
            `[quote] resolved via ${record.source} ` +
            `(isOwnQuote=${!!quotedStatus.isOwnQuote}, ` +
            `quotedId=${quotedStatus.mastodonId ?? 'none'}): ${record.uri}`
        );
        return { uri: record.uri, cid };
    }

    /**
     * Get the Bluesky record for a quoted Mastodon status — URI plus CID when
     * available without a fetch.
     * Priority:
     *   1) an `at://` URI on the status itself (Bluesky-to-Bluesky quotes) —
     *      CID unknown, fetched later,
     *   2) a registry lookup by Mastodon ID (or ID extracted from URL) — the
     *      quotee was processed earlier this run; carries the CID,
     *   3) a content-prefix search of the author feed — the quotee was
     *      mirrored in a *previous* run and isn't in the current Mastodon
     *      fetch, so its ID was never mapped this run; carries the CID. See
     *      PostRegistry.findRootUriByContent for why this fallback exists.
     */
    private getBlueskyRecord(quotedStatus: NonNullable<PostContent['quotedStatus']>): ResolvedRecord | undefined {
        // First check if the URI is already an AT URI (for Bluesky-to-Bluesky quotes)
        if (quotedStatus.uri?.startsWith('at://')) {
            return { uri: quotedStatus.uri, source: 'at-uri' };
        }

        // Use mastodonId if available, otherwise extract from URL
        const quotedId = quotedStatus.mastodonId ||
                         quotedStatus.url?.match(/\/statuses?\/(\d+)/)?.[1] ||
                         quotedStatus.url?.match(/\/(\d+)$/)?.[1];

        if (quotedId) {
            const mapped = this.registry.getRecord(quotedId);
            if (mapped) {
                return { uri: mapped.uri, cid: mapped.cid, source: 'map' };
            }
        }

        // Feed fallback: the quotee was mirrored in a prior run and isn't in
        // this run's Mastodon fetch, so its ID is absent from the in-memory
        // map. Match the quotee's sanitized content against the author feed
        // to recover its Bluesky record. Without this, an own-quote of an
        // older post degrades to a plain Twitter/x.com link (the postContent
        // fallback) instead of a real Bluesky quote embed.
        if (quotedStatus.content) {
            const found = this.registry.findRootUriByContent(quotedStatus.content);
            if (found) {
                return { uri: found.uri, cid: found.cid, source: 'feed' };
            }
        }
        return undefined;
    }

    /**
     * Fetch the post to get its actual CID. Returns undefined (warns) on any
     * failure so the caller can drop the quote embed gracefully. Only used in
     * the rare `at://` path where no CID was carried; the map and feed paths
     * supply the CID directly and skip this racy round-trip.
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