import { Agent, CredentialSession } from '@atproto/api';
import type { BotOptions, PostContent } from '@at-attin/types';
import { PostService } from './services/postService.js';

/**
 * BlueskyBot - Main entry point for posting to Bluesky
 *
 * Simple API:
 * 1. Call BlueskyBot.run() with a post fetcher function
 * 2. Posts are automatically processed (threads, quotes, media)
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
        this.postService = new PostService(this.agent, altCardImage, dryRun);
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
     * Run the bot with the provided post fetcher
     */
    static async run(
        getPosts: () => Promise<PostContent[]>,
        options?: Partial<BotOptions>,
        altCardImage?: string
    ): Promise<void> {
        const bot = new BlueskyBot(options, altCardImage);

        try {
            await bot.login(
                process.env.BSKY_HANDLE!,
                process.env.BSKY_PASSWORD!
            );

            const posts = await getPosts();

            for (const post of posts) {
                await bot.postContent(post);
            }
        } catch (error) {
            console.error('Error in bot execution:', (error as Error).message);
            process.exit(1);
        }
    }
}
