import { AppBskyFeedPost, AppBskyFeedGetAuthorFeed, Agent } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import type { PostContent } from '@at-attin/types';
import type { FeedViewPost } from '@atproto/api/dist/client/types/app/bsky/feed/defs.js';
import { ThreadManager } from './threadManager.js';
import { MediaUploader } from './mediaUploader.js';
import { EmbedBuilder } from './embedBuilder.js';
import { PostBuilder } from './postBuilder.js';
import { PostMapper } from './postMapper.js';

// Number of posts to fetch (shared with Mastodon service)
const MAX_POSTS = 20;

/**
 * Handles all Bluesky posting operations including:
 * - Duplicate detection
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
    private readonly postMapper: PostMapper;
    private feed?: AppBskyFeedGetAuthorFeed.Response;
    // Track Mastodon post IDs that have been posted
    private readonly postedIds = new Set<string>();

    constructor(agent: Agent, altCardImage?: string) {
        this.agent = agent;
        this.postMapper = new PostMapper();
        this.threadManager = new ThreadManager();
        this.mediaUploader = new MediaUploader(agent, altCardImage);
        this.embedBuilder = new EmbedBuilder(this.mediaUploader, this.postMapper, agent);
        this.postBuilder = new PostBuilder(agent);
    }

    /**
     * Fetch recent feed for duplicate detection
     */
    async loadFeed(): Promise<void> {
        const did = (this.agent as any).session?.did || this.agent.did || '';
        this.feed = await this.agent.app.bsky.feed.getAuthorFeed({
            actor: did,
            limit: MAX_POSTS,
        });
    }

    /**
     * Check if a post is a duplicate
     * Uses Mastodon post ID for reliable matching
     */
    private isDuplicate(post: PostContent): boolean {
        // Check by Mastodon ID (most reliable)
        if (post.mastodonId && this.postedIds.has(post.mastodonId)) {
            return true;
        }

        // Also check the feed from previous runs
        if (!this.feed?.data?.feed) return false;

        return this.feed.data.feed.some((postView: FeedViewPost) => {
            const currentRecord = postView.post.record as AppBskyFeedPost.Record | undefined;
            if (!currentRecord) return false;

            // Check if this post has a matching Mastodon ID in its record
            // (stored as a custom field or in the URI)
            const currentText = currentRecord.text?.trim() || '';

            // For thread chunks, compare without the [x/y] suffix
            const threadPattern = /\s*\[\d+\/\d+\]$/;
            const normalizedText = currentText.replace(threadPattern, '').trim();

            // Check if the normalized text matches and the Mastodon ID would match
            if (post.mastodonId) {
                // If we have a Mastodon ID, check if this looks like the same post
                // by comparing text length and prefix
                if (normalizedText.length > 20 &&
                    normalizedText.substring(0, 50) === post.content.replace(threadPattern, '').trim().substring(0, 50)) {
                    return true;
                }
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
    private storeMappings(post: PostContent, response: { uri: string; cid: string }): void {
        // Track Mastodon post ID to prevent duplicates
        const mastodonId = this.extractMastodonId(post);
        if (mastodonId) {
            this.postedIds.add(mastodonId);
            this.postMapper.set(mastodonId, '', response.uri);
        }

        // Store mapping for quoted status ID
        if (post.quotedStatus) {
            const quotedId = post.quotedStatus.mastodonId ||
                             post.quotedStatus.url?.match(/\/statuses?\/(\d+)/)?.[1] ||
                             post.quotedStatus.url?.match(/\/(\d+)$/)?.[1];
            if (quotedId) {
                this.postMapper.set(quotedId, '', response.uri);
            }
        }

        // Store mapping for cross-post ID
        if (post.crossPostId) {
            this.postMapper.set(post.crossPostId, '', response.uri);
        }
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
     */
    async postContent(post: PostContent, isReply = false): Promise<void> {
        // Check for duplicates
        if (this.isDuplicate(post)) {
            console.log('Skipping duplicate post:', post.content.substring(0, 50) + '...');
            return;
        }

        // Build embed structure
        const embed = await this.embedBuilder.build(post);

        // Get reply reference if this is a reply
        const threadReplyRef = isReply ? this.threadManager.getReplyRef() : undefined;
        const replyRef = threadReplyRef ? {
            root: { uri: threadReplyRef.root.uri, cid: threadReplyRef.root.cid },
            parent: { uri: threadReplyRef.parent.uri, cid: threadReplyRef.parent.cid },
        } : undefined;

        // Build and validate post record
        const { record } = await this.postBuilder.build(post, embed, replyRef);

        // Post with error handling
        try {
            const response = await this.agent.post(record);
            this.threadManager.updateReplyRefs(response);
            this.storeMappings(post, response);
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
        const chunks = this.threadManager.splitLongPost(post.content);
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
     */
    async processPost(post: PostContent): Promise<void> {
        if (post.content.length <= 300) {
            await this.handleShortPost(post);
        } else {
            await this.handleLongPost(post);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
