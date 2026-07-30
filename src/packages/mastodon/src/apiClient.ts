import * as Mastodon from 'tsl-mastodon-api';
import { MastodonAPIError } from './errorHandling.js';

/**
 * Mastodon API Client configuration
 */
export interface MastodonClientConfig {
    accessToken: string;
    apiUrl: string;
}

/**
 * Mastodon API Client - wraps tsl-mastodon-api with additional functionality
 */
export class MastodonClient {
    private readonly client: Mastodon.API;

    constructor(config: MastodonClientConfig) {
        const mastodonConfig: Mastodon.API.Config = {
            access_token: config.accessToken,
            api_url: config.apiUrl,
        };
        this.client = new Mastodon.API(mastodonConfig);
    }

    /**
     * Get statuses from an account
     * @param accountId - The account ID to fetch statuses from
     * @param limit - Maximum number of statuses to fetch
     * @returns Array of statuses
     */
    async getStatuses(accountId: string, limit: number): Promise<Mastodon.JSON.Status[]> {
        // Respect any server-requested delay from previous request
        await this.client.delay(50);

        const queryParams: Mastodon.API.QueryParams = { limit };

        const response = await this.client.getStatuses(accountId, queryParams);

        // Check for API-level errors
        if (response.failed) {
            throw new MastodonAPIError(
                `Mastodon API returned error: ${response.error || 'Unknown error'}`,
                response.status
            );
        }

        // Log rate limit info for monitoring
        if (response.rateLimit) {
            console.log(`Mastodon rate limit: ${response.rateLimit}ms delay recommended`);
        }

        return response.json;
    }

    /**
     * Get statuses from home timeline
     * @param limit - Maximum number of statuses to fetch
     * @returns Array of statuses
     */
    async getHomeTimeline(limit: number): Promise<Mastodon.JSON.Status[]> {
        await this.client.delay(50);

        const queryParams: Mastodon.API.QueryParams = {
            limit,
            exclude_replies: true,
        };

        const response = await this.client.getStatusesOfHome(queryParams);

        if (response.failed) {
            throw new MastodonAPIError(
                `Mastodon API returned error: ${response.error || 'Unknown error'}`,
                response.status
            );
        }

        return response.json;
    }
}
