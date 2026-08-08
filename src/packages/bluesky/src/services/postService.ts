import { AppBskyFeedPost, Agent } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import type { PostContent } from '@at-attin/types';
import { ThreadManager } from './threadManager.js';
import { EmbedBuilder } from '../builders/embedBuilder.js';
import { PostBuilder } from '../builders/postBuilder.js';
import { PostRegistry } from './postRegistry.js';
import { splitLongPost } from '../utils/postSplitter.js';
import { sleep } from '../utils/sleep.js';
import {MAX_POST_LENGTH, MAX_RETRIES, MAX_RATE_LIMIT_WAIT} from "../config/constants.js";

// Number of recent author-feed posts to fetch for duplicate detection.
// Kept larger than a single run's post volume so previously-mirrored posts
// (including thread chunks that may be missing from the feed) remain
// detectable across runs. The Bluesky API caps this at 100.
const MAX_POSTS = 100;

/**
 * Handles all Bluesky posting operations including:
 * - Duplicate detection (delegated to PostRegistry)
 * - Embed building
 * - Post validation and submission
 * - Error handling with retry logic
 * - Thread management for long posts
 */
export class PostService {
    private readonly agent: Agent;
    private readonly threadManager: ThreadManager;
    private readonly embedBuilder: EmbedBuilder;
    private readonly postBuilder: PostBuilder;
    private readonly registry: PostRegistry;
    private readonly dryRun: boolean;

    /**
     * Pure orchestrator: all collaborators are injected (constructed by the
     * composition root, BlueskyBot). PostService owns no `new` of its
     * collaborators.
     */
    constructor(
        agent: Agent,
        registry: PostRegistry,
        threadManager: ThreadManager,
        embedBuilder: EmbedBuilder,
        postBuilder: PostBuilder,
        dryRun = false
    ) {
        this.agent = agent;
        this.registry = registry;
        this.threadManager = threadManager;
        this.embedBuilder = embedBuilder;
        this.postBuilder = postBuilder;
        this.dryRun = dryRun;
    }

    /**
     * Fetch recent feed for duplicate detection
     */
    async loadFeed(): Promise<void> {
        const did = this.agent.did ?? '';
        const feed = await this.agent.app.bsky.feed.getAuthorFeed({
            actor: did,
            limit: MAX_POSTS,
        });
        this.registry.setFeed(feed);
    }

    /**
     * Handle post errors with appropriate recovery
     */
    private async handlePostError(
        error: unknown,
        post: PostContent,
        isReply: boolean,
        attempt: number
    ): Promise<void> {
        if (!(error instanceof XRPCError)) {
            throw error;
        }

        switch (error.status) {
            case 429: {
                // Give up after MAX_RETRIES so a persistent 429 can't retry
                // forever. The reset header is an absolute Unix timestamp
                // (seconds), not a delta — sleeping for the raw value
                // (~1.78e12 ms) hangs the process for ~56 years. Compute the
                // real remaining delta, clamped ≥ 0, and bound the wait so a
                // long rate-limit window can't hang the cron either.
                if (attempt >= MAX_RETRIES) {
                    console.error(`Rate limited: exceeded ${MAX_RETRIES} retries, giving up`);
                    throw error;
                }
                const reset = Number(error.headers?.['ratelimit-reset']) || 0;
                const retryAfter = reset
                    ? Math.max(0, (reset - Date.now() / 1000) * 1000)
                    : 60000;
                // Don't hang the cron waiting out a long rate-limit window: if
                // the reset is further out than we're willing to sleep, give up
                // this run and let the next cron run retry.
                if (retryAfter > MAX_RATE_LIMIT_WAIT) {
                    console.error(
                        `Rate limited: reset in ${Math.round(retryAfter)}ms ` +
                        `(> ${MAX_RATE_LIMIT_WAIT}ms), giving up this run; ` +
                        `next cron run will retry`
                    );
                    throw error;
                }
                console.warn(`Rate limited. Retrying in ${Math.round(retryAfter)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(retryAfter);
                return this.postContent(post, isReply, attempt + 1);
            }
            case 401: {
                // Honest message: this path never re-logged in despite the old
                // "attempting re-login" log. Re-login would require the
                // CredentialSession (owned by BlueskyBot, not the orchestrator),
                // so surface the failure to the caller instead of pretending.
                console.error('Authentication failed (401)');
                throw error;
            }
            case 400: {
                console.error('Validation error:', error.error, error.message);
                throw error;
            }
            case 413: {
                console.error('Media too large:', error.message);
                throw error;
            }
            default: {
                console.error(`XRPC Error ${error.status}:`, error.error, error.message);
                throw error;
            }
        }
    }

    /**
     * Post content to Bluesky
     *
     * Note: duplicate detection happens in processPost() before splitting,
     * so this method assumes the post is not a duplicate. The rate-limit
     * retry path (handlePostError) also calls this directly and must not be
     * blocked by a duplicate check since the post hasn't been created yet.
     */
    async postContent(post: PostContent, isReply = false, attempt = 0): Promise<void> {
        // Build embed structure
        const embed = await this.embedBuilder.build(post);
        let content = post.content;

        // Fallback for own quotes: if we couldn't build a Bluesky quote embed
        // (e.g. the quoted post was mirrored in a previous run and we have no
        // URI mapping for it in this session), append the quoted URL so the
        // quote reference isn't silently dropped. Only when there's room to
        // stay within the character limit. Rewrite twitter.com -> x.com since
        // this URL is appended after sanitization.
        if (!embed && post.quotedStatus?.isOwnQuote && post.quotedStatus.url) {
            const extra = `\n\n${post.quotedStatus.url.replace(/twitter\.com/, 'x.com')}`;
            if (content.length + extra.length <= MAX_POST_LENGTH) {
                content += extra;
                post = { ...post, content };
            }
        }

        // Get reply reference if this is a reply (ThreadManager returns a fresh
        // object, so no defensive copy is needed).
        const replyRef = isReply ? this.threadManager.getReplyRef() : undefined;

        // Build and validate post record
        const record = await this.postBuilder.build(post, embed, replyRef);

        // Dry run: log what would be posted and skip the real write. Thread
        // reply-refs and mappings are also skipped, since no real URI/CID is
        // produced — so a dry run never mutates Bluesky state or this
        // session's mapping tables. Login + feed load still happen (needed
        // for duplicate detection and embed/blob upload), but nothing is
        // posted.
        if (this.dryRun) {
            console.log('[dry-run] would post:', JSON.stringify({
                text: record.text,
                reply: record.reply ?? null,
                embed: record.embed ?? null,
            }));
            return;
        }

        // Post with error handling
        try {
            const response = await this.agent.post(record);
            this.threadManager.updateReplyRefs(response);
            this.registry.storeMappings(post, response);
            console.log('Posted successfully:', record.text);
        } catch (error) {
            await this.handlePostError(error, post, isReply, attempt);
        }
    }

    /**
     * Handle long posts by splitting into threaded chunks
     */
    private async handleLongPost(post: PostContent): Promise<void> {
        const chunks = splitLongPost(post.content);
        this.threadManager.resetReplyRefs();

        for (const [i, chunk] of chunks.entries()) {
            const updatedPost = i === 0
                ? { ...post, content: chunk }
                : { created_at: post.created_at, content: chunk };

            await this.postContent(updatedPost, i > 0);
        }
    }

    /**
     * Process a single post (handles both short and long)
     *
     * Duplicate detection happens here, before splitting long posts into
     * thread chunks. A long Mastodon status mirrors as a multi-post Bluesky
     * thread, but it is one logical post - so we detect duplicates at the
     * status level. Previously the check ran per-chunk inside postContent,
     * and since only the first chunk carried the mastodonId, later chunks
     * of an already-mirrored long post were never detected as duplicates and
     * got re-posted on every run.
     */
    async processPost(post: PostContent): Promise<void> {
        if (this.registry.isDuplicate(post)) {
            console.log('Skipping duplicate post:', post.content.substring(0, 50) + '...');

            // Re-establish the URI mapping for this already-mirrored post so
            // that later quote posts referencing it can resolve to a Bluesky
            // quote embed. The registry's map is in-memory and starts empty
            // each run, so without this a quote of a previously-mirrored post
            // would fall back to a plain link instead of a true quote embed.
            const existing = this.registry.findDuplicateInFeed(post);
            if (existing) {
                // If the match is a thread reply (e.g. we matched the [2/2]
                // chunk because the [1/2] starter is missing from the feed),
                // map the Mastodon ID to the thread root so quote posts
                // reference the root post rather than the last chunk. Carry
                // the CID too (from the reply root ref or the feed post) so
                // quote resolution skips the racy getPosts CID fetch.
                const record = existing.post.record as AppBskyFeedPost.Record | undefined;
                const root = record?.reply?.root;
                const mapped = (root?.uri && root.cid)
                    ? { uri: root.uri, cid: root.cid }
                    : { uri: existing.post.uri, cid: existing.post.cid };
                this.registry.storeDuplicateMappings(post, mapped);
            }

            return;
        }

        if (post.content.length <= MAX_POST_LENGTH) {
            await this.postContent(post);
        } else {
            await this.handleLongPost(post);
        }
    }
}
