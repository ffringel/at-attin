import { AppBskyFeedPost, AppBskyFeedGetAuthorFeed } from '@atproto/api';
import type { PostContent } from '@at-attin/types';
import type { FeedViewPost } from '@atproto/api/dist/client/types/app/bsky/feed/defs.js';
import { splitLongPost } from '../utils/postSplitter.js';
import { MAX_POST_LENGTH } from '../config/constants.js';

/**
 * Owns the Mastodon↔Bluesky mapping and duplicate-detection state for a run:
 * the id→uri map (replaces the former PostMapper), the set of already-posted
 * Mastodon IDs, and the cached author feed. Answers "has this been mirrored,
 * and to which Bluesky URI?" Extracted from PostService so the orchestrator
 * stays free of dedup/mapping state.
 */
export class PostRegistry {
    private readonly idToUri = new Map<string, string>();
    private readonly postedIds = new Set<string>();
    private feed?: AppBskyFeedGetAuthorFeed.Response;

    /** Cache the author feed fetched by PostService for duplicate detection. */
    setFeed(feed: AppBskyFeedGetAuthorFeed.Response): void {
        this.feed = feed;
    }

    /**
     * Look up the Bluesky AT URI previously mapped to a Mastodon (or
     * cross-post) ID. Used by EmbedBuilder to resolve quote embeds.
     */
    getUri(id: string): string | undefined {
        return this.idToUri.get(id);
    }

    /**
     * Check if a post is a duplicate
     * Uses Mastodon post ID for reliable matching
     */
    isDuplicate(post: PostContent): boolean {
        // Check by Mastodon ID (most reliable) - already posted this run
        if (post.mastodonId && this.postedIds.has(post.mastodonId)) {
            return true;
        }

        // Also check the feed from previous runs
        return !!this.findDuplicateInFeed(post);
    }

    /**
     * Build the normalized first-50-char prefixes used to match a post against
     * the author feed. Long posts (mirrored as multi-post Bluesky threads)
     * contribute every chunk's prefix, since the thread starter ([1/2]) can be
     * missing from the feed while later chunk replies are present. The
     * `[x/y]` thread suffix is stripped before prefixing.
     */
    private static contentPrefixes(content: string): string[] {
        const threadPattern = /\s*\[\d+\/\d+\]$/;
        const contents = content.length > MAX_POST_LENGTH
            ? splitLongPost(content)
            : [content];
        return contents
            .map(c => c.replace(threadPattern, '').trim().substring(0, 50))
            .filter(p => p.length > 0);
    }

    /**
     * Find the first feed entry whose text shares a normalized 50-char prefix
     * with any of `prefixes`. Shared by duplicate detection and quote
     * resolution. Short feed posts (≤20 chars) are skipped to avoid
     * false positives on near-empty or placeholder text.
     */
    private matchFeedByPrefix(prefixes: string[]): FeedViewPost | undefined {
        if (!this.feed?.data?.feed || prefixes.length === 0) return undefined;

        const threadPattern = /\s*\[\d+\/\d+\]$/;
        return this.feed.data.feed.find((postView: FeedViewPost) => {
            const currentRecord = postView.post.record as AppBskyFeedPost.Record | undefined;
            if (!currentRecord) return false;

            const currentText = (currentRecord.text?.trim() || '').replace(threadPattern, '').trim();
            return currentText.length > 20 && prefixes.some(p => currentText.substring(0, 50) === p);
        });
    }

    /**
     * Find an existing Bluesky post in the loaded author feed that mirrors
     * the given Mastodon post. Returns the matching feed entry (with its
     * Bluesky URI/CID) so the mapping can be re-established for quote posts,
     * or undefined if no match is found.
     *
     * Only matches when the post carries a Mastodon ID (the guard against
     * content-only false positives) — compare normalized text prefixes to
     * tolerate thread-chunk suffixes and minor differences.
     */
    findDuplicateInFeed(post: PostContent): FeedViewPost | undefined {
        if (!post.mastodonId) return undefined;
        return this.matchFeedByPrefix(PostRegistry.contentPrefixes(post.content));
    }

    /**
     * Resolve the Bluesky root URI of a previously-mirrored post by matching
     * its sanitized content against the author feed — the feed fallback used
     * by QuoteResolver when the quotee's Mastodon ID isn't in the in-memory
     * id→uri map.
     *
     * That map starts empty each run and is only populated for posts processed
     * in THIS run (posted fresh, or detected as a duplicate via
     * `findDuplicateInFeed`). A quote of a post mirrored in a *previous* run,
     * now older than the Mastodon fetch window (MAX_POSTS statuses), is never
     * processed this run, so its ID is never mapped — yet its Bluesky mirror
     * is still in the author feed (up to 100 posts). Matching the quotee's
     * content against the feed re-establishes the link so the quote embeds the
     * Bluesky post instead of degrading to a plain Twitter/x.com URL.
     *
     * Returns the thread *root* URI when the match is a thread reply chunk, so
     * quotes reference the root post (consistent with `storeDuplicateMappings`).
     *
     * Caveat: content-prefix matching is fuzzy. For own-quotes of the source
     * account's own cross-posts, the quotee's Bluesky text (`sanitize`, with
     * the source handle rewritten to the Bluesky handle) and the quoted
     * status text we match against (`sanitizeQuoted`, no handle rewrite) are
     * identical for tweet text that doesn't mention the source handle — the
     * common case. If the first 50 chars contain the handle, the prefixes
     * diverge and the match misses, falling through to the URL fallback.
     */
    findRootUriByContent(content: string): string | undefined {
        const match = this.matchFeedByPrefix(PostRegistry.contentPrefixes(content));
        if (!match) return undefined;
        const record = match.post.record as AppBskyFeedPost.Record | undefined;
        return record?.reply?.root?.uri ?? match.post.uri;
    }

    /**
     * Store mappings for duplicate detection (and, for cross-posted IDs,
     * quote resolution). Maps this post's own Mastodon ID and cross-post ID
     * to the Bluesky URI just created.
     *
     * Note: the quoted status's ID is intentionally NOT mapped here. Its
     * Bluesky URI is the quotee's, not this (the quoter's) post's URI, and
     * the quotee's correct mapping is established separately — by
     * `storeDuplicateMappings` when the quotee was already mirrored, or by
     * this same method's own-ID path when the quotee itself is posted.
     * Mapping quotedId → response.uri here would point quote resolution at
     * the quoter and overwrite a correct quotee mapping.
     */
    storeMappings(post: PostContent, response: { uri: string; cid: string }): void {
        // Track Mastodon post ID to prevent duplicates
        if (post.mastodonId) {
            this.postedIds.add(post.mastodonId);
            this.idToUri.set(post.mastodonId, response.uri);
        }

        // Store mapping for cross-post ID
        if (post.crossPostId) {
            this.idToUri.set(post.crossPostId, response.uri);
        }
    }

    /**
     * Re-establish URI mappings for a post that was already mirrored in a
     * previous run (detected as a duplicate in the author feed). This lets
     * later quote posts that reference it resolve to a real Bluesky quote
     * embed, since the in-memory map starts empty each run.
     *
     * Unlike storeMappings, this only maps the post's own IDs (Mastodon ID
     * and cross-post ID) - not any quotedStatus - because the quoted status
     * belongs to a different post.
     */
    storeDuplicateMappings(post: PostContent, uri: string): void {
        if (post.mastodonId) {
            this.postedIds.add(post.mastodonId);
            this.idToUri.set(post.mastodonId, uri);
        }
        if (post.crossPostId) {
            this.idToUri.set(post.crossPostId, uri);
        }
    }
}