import type { PostContent } from '@at-attin/types';
import type { JSON as MastodonJSON } from 'tsl-mastodon-api';
import { MastodonClient } from './apiClient.js';
import { handleMastodonError } from './errorHandling.js';
import { sanitizeContent } from './contentSanitizer.js';
import { processImages, processVideo, processCard } from './mediaProcessor.js';

/**
 * Configuration for Mastodon service
 */
export interface MastodonServiceConfig {
    accessToken: string;
    apiUrl: string;
    sourceAccountId: string;
    blueskyHandle: string;
    giveaways?: string[];
}

/**
 * Fetch and process Mastodon posts for Bluesky mirroring
 */
export default class MastodonService {
    private readonly client: MastodonClient;
    private readonly config: MastodonServiceConfig;

    constructor(config: MastodonServiceConfig) {
        this.config = config;
        this.client = new MastodonClient({
            accessToken: config.accessToken,
            apiUrl: config.apiUrl,
        });
    }

    /**
     * Fetch and process posts from a Mastodon account
     * @param limit - Maximum number of posts to fetch
     * @returns Processed posts ready for Bluesky
     */
    async getPosts(limit: number = 20): Promise<PostContent[]> {
        try {
            const statuses = await this.client.getStatuses(
                this.config.sourceAccountId,
                limit
            );

            return this.processPosts(statuses);
        } catch (error) {
            handleMastodonError(error, 'Failed to fetch Mastodon posts');
            throw error;
        }
    }

    /**
     * Process array of Mastodon statuses into PostContent
     */
    private processPosts(statuses: MastodonJSON.Status[]): PostContent[] {
        return statuses
            .filter((post) => !post.reblog)
            .map(post => ({
                created_at: post.created_at,
                content: sanitizeContent(post.content, {
                    blueskyHandle: this.config.blueskyHandle,
                    accountRegex: new RegExp(this.config.sourceAccountId, 'g'),
                    serverRegex: new RegExp(
                        '@' + this.config.sourceAccountId.split('@')[2],
                        'g'
                    ),
                    giveaways: this.config.giveaways,
                }),
                images: processImages(post.media_attachments),
                video: processVideo(post.media_attachments),
                card: processCard(post.card ?? undefined),
            }))
            .sort((a, b) => {
                return Date.parse(a.created_at) - Date.parse(b.created_at);
            });
    }
}
