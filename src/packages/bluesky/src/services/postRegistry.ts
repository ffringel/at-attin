import { AppBskyFeedPost, AppBskyFeedGetAuthorFeed } from '@atproto/api';
import type { PostContent } from '@at-attin/types';
import type { FeedViewPost } from '@atproto/api/dist/client/types/app/bsky/feed/defs.js';
import { splitLongPost } from '../utils/postSplitter.js';

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
     * Find an existing Bluesky post in the loaded author feed that mirrors
     * the given Mastodon post. Returns the matching feed entry (with its
     * Bluesky URI/CID) so the mapping can be re-established for quote posts,
     * or undefined if no match is found.
     *
     * For long posts (mirrored as a multi-post Bluesky thread) every chunk's
     * prefix is checked. The thread starter ([1/2]) can be missing from the
     * author feed — a Bluesky indexing quirk when a post and its reply are
     * created in the same second — while later chunk replies are present, so
     * matching any chunk detects an already-mirrored thread.
     */
    findDuplicateInFeed(post: PostContent): FeedViewPost | undefined {
        if (!this.feed?.data?.feed) return undefined;

        // For thread chunks, compare without the [x/y] suffix
        const threadPattern = /\s*\[\d+\/\d+\]$/;
        const contents = post.content.length > 300
            ? splitLongPost(post.content)
            : [post.content];
        const prefixes = contents
            .map(c => c.replace(threadPattern, '').trim().substring(0, 50))
            .filter(p => p.length > 0);

        return this.feed.data.feed.find((postView: FeedViewPost) => {
            const currentRecord = postView.post.record as AppBskyFeedPost.Record | undefined;
            if (!currentRecord) return false;

            const currentText = (currentRecord.text?.trim() || '').replace(threadPattern, '').trim();

            // Only match when we have a Mastodon ID; compare normalized text
            // prefixes to tolerate thread-chunk suffixes and minor differences.
            if (post.mastodonId && currentText.length > 20) {
                return prefixes.some(p => currentText.substring(0, 50) === p);
            }

            return false;
        });
    }

    /**
     * Extract Mastodon post ID from post content
     */
    private extractMastodonId(post: PostContent): string | undefined {
        if (post.mastodonId) {
            return post.mastodonId;
        }
        if (post.quotedStatus?.url) {
            const match = post.quotedStatus.url.match(/(\d+)$/);
            if (match) return match[1];
        }
        return undefined;
    }

    /**
     * Store mappings for quote post support and duplicate detection
     */
    storeMappings(post: PostContent, response: { uri: string; cid: string }): void {
        // Track Mastodon post ID to prevent duplicates
        const mastodonId = this.extractMastodonId(post);
        if (mastodonId) {
            this.postedIds.add(mastodonId);
            this.idToUri.set(mastodonId, response.uri);
        }

        // Store mapping for quoted status ID
        if (post.quotedStatus) {
            const quotedId = post.quotedStatus.mastodonId ||
                             post.quotedStatus.url?.match(/\/statuses?\/(\d+)/)?.[1] ||
                             post.quotedStatus.url?.match(/\/(\d+)$/)?.[1];
            if (quotedId) {
                this.idToUri.set(quotedId, response.uri);
            }
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