import { Agent, CredentialSession } from '@atproto/api';
import type { BotOptions, PostContent } from '@at-attin/types';
import { PostService } from './services/postService.js';
import { PostRegistry } from './services/postRegistry.js';
import { ThreadManager } from './services/threadManager.js';
import { QuoteResolver } from './services/quoteResolver.js';
import { EmbedBuilder } from './builders/embedBuilder.js';
import { PostBuilder } from './builders/postBuilder.js';
import { MediaUploader } from './media/mediaUploader.js';

/**
 * BlueskyBot - Main entry point for posting to Bluesky
 *
 * Simple API:
 * 1. Call BlueskyBot.run() with a post fetcher function
 * 2. Posts are automatically processed (threads, quotes, media)
 *
 * BlueskyBot is the composition root: it owns the session/agent and constructs
 * every collaborator (PostRegistry, ThreadManager, MediaUploader, QuoteResolver,
 * EmbedBuilder, PostBuilder), injecting them into PostService — which is a
 * pure orchestrator with no `new` of its own.
 */
export class BlueskyBot {
    private readonly sessionManager: CredentialSession;
    private readonly agent: Agent;
    private readonly postService: PostService;

    static defaultOptions: BotOptions = {
        service: 'https://bsky.social',
        dryRun: false,
    };

    constructor(
        options?: Partial<BotOptions>,
        altCardImage?: string
    ) {
        const { service, dryRun } = Object.assign({}, BlueskyBot.defaultOptions, options);

        this.sessionManager = new CredentialSession(new URL(service.toString()));
        this.agent = new Agent(this.sessionManager);

        // Composition root: construct all collaborators and inject into PostService.
        const registry = new PostRegistry();
        const threadManager = new ThreadManager();
        const mediaUploader = new MediaUploader(this.agent, altCardImage);
        const quoteResolver = new QuoteResolver(this.agent, registry);
        const embedBuilder = new EmbedBuilder(mediaUploader, quoteResolver);
        const postBuilder = new PostBuilder(this.agent);

        this.postService = new PostService(
            this.agent,
            registry,
            threadManager,
            embedBuilder,
            postBuilder,
            dryRun
        );
    }

    /**
     * Login to Bluesky
     */
    async login(identifier: string, password: string): Promise<void> {
        await this.sessionManager.login({ identifier, password });
        await this.postService.loadFeed();
    }

    /**
     * Post a single piece of content
     */
    async postContent(post: PostContent): Promise<void> {
        await this.postService.processPost(post);
    }

    /**
     * Run the bot with the provided post fetcher.
     *
     * Credentials are passed in by the caller — the library does not read
     * `process.env`. Errors propagate to the caller (rethrown); the library
     * does not log or call `process.exit`. The caller owns logging and the
     * exit decision (see `src/index.ts`).
     */
    static async run(
        getPosts: () => Promise<PostContent[]>,
        credentials: { identifier: string; password: string },
        options?: Partial<BotOptions>,
        altCardImage?: string
    ): Promise<void> {
        const bot = new BlueskyBot(options, altCardImage);

        await bot.login(credentials.identifier, credentials.password);

        const posts = await getPosts();

        for (const post of posts) {
            await bot.postContent(post);
        }
    }
}
