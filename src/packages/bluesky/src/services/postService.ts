import { AppBskyFeedPost, Agent } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import type { PostContent } from '@at-attin/types';
import { ThreadManager } from './threadManager.js';
import { MediaUploader } from '../media/mediaUploader.js';
import { EmbedBuilder } from '../builders/embedBuilder.js';
import { PostBuilder } from '../builders/postBuilder.js';
import { PostRegistry } from './postRegistry.js';
import { splitLongPost } from '../utils/postSplitter.js';
import {MAX_POST_LENGTH} from "../config/constants.js";

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
    private readonly mediaUploader: MediaUploader;
    private readonly embedBuilder: EmbedBuilder;
    private readonly postBuilder: PostBuilder;
    private readonly registry: PostRegistry;
    private readonly dryRun: boolean;

    constructor(agent: Agent, altCardImage?: string, dryRun = false) {
        this.agent = agent;
        this.registry = new PostRegistry();
        this.threadManager = new ThreadManager();
        this.mediaUploader = new MediaUploader(agent, altCardImage);
        this.embedBuilder = new EmbedBuilder(this.mediaUploader, this.registry, agent);
        this.postBuilder = new PostBuilder(agent);
        this.dryRun = dryRun;
    }

    /**
     * Fetch recent feed for duplicate detection
     */
    async loadFeed(): Promise<void> {
        const did = (this.agent as any).session?.did || this.agent.did || '';
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
        isReply: boolean
    ): Promise<void> {
        if (!(error instanceof XRPCError)) {
            throw error;
        }

        const xrpcError = error as XRPCError;

        switch (xrpcError.status) {
            case 429: {
                const retryAfter = xrpcError.headers?.['ratelimit-reset']
                    ? parseInt(xrpcError.headers['ratelimit-reset'], 10) * 1000
                    : 60000;
                console.warn(`Rate limited. Retrying after ${retryAfter}ms`);
                await this.sleep(retryAfter);
                return this.postContent(post, isReply);
            }
            case 401: {
                console.error('Authentication expired, attempting re-login');
                throw error;
            }
            case 400: {
                console.error('Validation error:', xrpcError.error, xrpcError.message);
                throw error;
            }
            case 413: {
                console.error('Media too large:', xrpcError.message);
                throw error;
            }
            default: {
                console.error(`XRPC Error ${xrpcError.status}:`, xrpcError.error, xrpcError.message);
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
    async postContent(post: PostContent, isReply = false): Promise<void> {
        // Build embed structure
        let embed = await this.embedBuilder.build(post);
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

        // Get reply reference if this is a reply
        const threadReplyRef = isReply ? this.threadManager.getReplyRef() : undefined;
        const replyRef = threadReplyRef ? {
            root: { uri: threadReplyRef.root.uri, cid: threadReplyRef.root.cid },
            parent: { uri: threadReplyRef.parent.uri, cid: threadReplyRef.parent.cid },
        } : undefined;

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
            await this.handlePostError(error, post, isReply);
        }
    }

    /**
     * Handle short posts (under character limit)
     */
    private async handleShortPost(post: PostContent): Promise<void> {
        await this.postContent(post);
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
                // reference the root post rather than the last chunk.
                const record = existing.post.record as AppBskyFeedPost.Record | undefined;
                const rootUri = record?.reply?.root?.uri ?? existing.post.uri;
                this.registry.storeDuplicateMappings(post, rootUri);
            }

            return;
        }

        if (post.content.length <= MAX_POST_LENGTH) {
            await this.handleShortPost(post);
        } else {
            await this.handleLongPost(post);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
