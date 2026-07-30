import { AppBskyFeedPost, AppBskyFeedGetAuthorFeed, AppBskyFeedPost as FeedPost } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';
import type { BotOptions, PostContent } from '@at-attin/types';
import type { FeedViewPost } from '@atproto/api/dist/client/types/app/bsky/feed/defs.js';
import { SessionManager } from './sessionManager.js';
import { ThreadManager } from './threadManager.js';
import { MediaUploader } from './mediaUploader.js';
import { EmbedBuilder } from './embedBuilder.js';
import { PostBuilder } from './postBuilder.js';

/**
 * BlueskyBot - Main bot class for posting to Bluesky
 *
 * Composes multiple specialized modules:
 * - SessionManager: Authentication and session management
 * - ThreadManager: Reply thread handling
 * - MediaUploader: Media upload with retry logic
 * - EmbedBuilder: Build embed structures
 * - PostBuilder: Post record validation
 */
export class BlueskyBot {
    private readonly sessionManager: SessionManager;
    private readonly threadManager: ThreadManager;
    private readonly mediaUploader: MediaUploader;
    private readonly embedBuilder: EmbedBuilder;
    private readonly postBuilder: PostBuilder;
    private readonly dryRun: boolean;
    private feed?: AppBskyFeedGetAuthorFeed.Response;

    static defaultOptions: BotOptions = {
        service: 'https://bsky.social',
        dryRun: false,
    };

    constructor(
        options?: Partial<BotOptions>,
        altCardImage?: string
    ) {
        const { service, dryRun } = Object.assign({}, BlueskyBot.defaultOptions, options);

        // Initialize session manager
        this.sessionManager = new SessionManager(new URL(service.toString()));
        this.dryRun = dryRun;

        // Initialize sub-modules
        this.threadManager = new ThreadManager();
        this.mediaUploader = new MediaUploader(this.sessionManager.getAgent(), altCardImage);
        this.embedBuilder = new EmbedBuilder(this.mediaUploader);
        this.postBuilder = new PostBuilder(this.sessionManager.getAgent());
    }

    /**
     * Login to Bluesky
     */
    async login(): Promise<void> {
        await this.sessionManager.login({
            identifier: process.env.BSKY_HANDLE!,
            password: process.env.BSKY_PASSWORD!,
        });
    }

    /**
     * Run the bot with the provided post fetcher
     */
    static async run(
        getPosts: () => Promise<PostContent[]>,
        options?: Partial<BotOptions>,
        altCardImage?: string
    ): Promise<void> {
        const bot = new BlueskyBot(options, altCardImage);

        try {
            await bot.login();
            await bot.recentFeed();
            const posts = await getPosts();

            for (const post of posts) {
                if (post.content.length <= 300) {
                    await bot.handleShortPost(post);
                } else {
                    await bot.handleLongPost(post);
                }
            }
        } catch (error) {
            console.error('Error in bot execution:', (error as Error).message);
            process.exit(1);
        }
    }

    /**
     * Fetch recent feed for duplicate detection
     */
    private async recentFeed(): Promise<void> {
        try {
            const did = this.sessionManager.getDid() || '';
            this.feed = await this.sessionManager.getAgent().app.bsky.feed.getAuthorFeed({
                actor: did,
                limit: 20,
            });
        } catch (error) {
            if (error instanceof XRPCError) {
                console.error('Failed to fetch feed:', error.status, error.error);
            }
            throw error;
        }
    }

    /**
     * Check if a post is a duplicate
     */
    private async isDuplicatePost(post: PostContent, isReply: boolean): Promise<boolean> {
        const text = post.content.trim();
        const parentUri = isReply ? this.threadManager.getReplyRef()?.parent.uri : null;

        if (!this.feed?.data?.feed) return false;

        return this.feed.data.feed.some((postView: FeedViewPost) => {
            const currentRecord = postView.post.record as AppBskyFeedPost.Record | undefined;
            const currentText = currentRecord?.text?.trim();

            if (currentText === text) return true;

            if (isReply && parentUri) {
                const replyParentUri = postView.reply?.parent?.uri;
                if (replyParentUri === parentUri && currentText === text) {
                    return true;
                }
            }

            return false;
        });
    }

    /**
     * Post content to Bluesky
     */
    async postContent(post: PostContent, isReply = false): Promise<void> {
        // Check for duplicates
        if (await this.isDuplicatePost(post, isReply)) {
            console.log('Skipping duplicate post:', post.content.substring(0, 50) + '...');
            return;
        }

        try {
            // Build embed structure
            const embed = await this.embedBuilder.build(post);

            // Get reply reference if this is a reply
            const replyRef = isReply ? this.getReplyRefFromThread() : undefined;

            // Build and validate post record
            const { record } = await this.postBuilder.build(post, embed, replyRef);

            if (this.dryRun) {
                console.log('Dry run - would post:', JSON.stringify(record, null, 2));
                return;
            }

            // Post with error handling
            try {
                const response = await this.sessionManager.getAgent().post(record);
                this.threadManager.updateReplyRefs(response);
                console.log('Posted successfully:', record.text);
            } catch (error) {
                await this.handlePostError(error as XRPCError, post, isReply);
            }

        } catch (error) {
            if (error instanceof XRPCError) {
                console.error('XRPC Error posting content:', error.status, error.error);
            } else {
                console.error('Error posting content:', (error as Error).message);
            }
            throw error;
        }
    }

    /**
     * Get reply ref from thread manager in AT Protocol format
     */
    private getReplyRefFromThread(): FeedPost.ReplyRef | undefined {
        const ref = this.threadManager.getReplyRef();
        if (!ref) return undefined;
        return {
            root: { uri: ref.root.uri, cid: ref.root.cid },
            parent: { uri: ref.parent.uri, cid: ref.parent.cid },
        };
    }

    /**
     * Handle post errors with appropriate recovery
     */
    private async handlePostError(
        error: XRPCError,
        post: PostContent,
        isReply: boolean
    ): Promise<void> {
        switch (error.status) {
            case 429: {
                const retryAfter = error.headers?.['ratelimit-reset']
                    ? parseInt(error.headers['ratelimit-reset'], 10) * 1000
                    : 60000;
                console.warn(`Rate limited. Retrying after ${retryAfter}ms`);
                await this.sleep(retryAfter);
                return this.postContent(post, isReply);
            }
            case 401: {
                console.error('Authentication expired, attempting re-login');
                await this.login();
                return this.postContent(post, isReply);
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

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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
}
