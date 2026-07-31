import { RichText, AppBskyFeedPost, AppBskyFeedPost as FeedPost, Agent } from '@atproto/api';
import type { PostContent } from '@at-attin/types';
import type { Embed } from './embedBuilder.js';

/**
 * Result of post building with validation
 */
export interface PostBuildResult {
    record: AppBskyFeedPost.Record;
    richText: RichText;
}

/**
 * Builds and validates Bluesky post records
 */
export class PostBuilder {
    private readonly agent: Agent;

    constructor(agent: Agent) {
        this.agent = agent;
    }

    /**
     * Build a post record from content
     * @param content - The post content
     * @param embed - Optional embed structure
     * @param replyRef - Optional reply reference for threading
     * @returns Validated post record
     * @throws Error if validation fails
     */
    async build(
        content: PostContent,
        embed?: Embed,
        replyRef?: FeedPost.ReplyRef
    ): Promise<PostBuildResult> {
        const text = content.content.trim();

        // Create RichText and detect facets (links, mentions, tags)
        const richText = new RichText({ text });
        await richText.detectFacets(this.agent);

        // Detect language (simple heuristic - defaults to English)
        const lang = this.detectLanguage(text);

        // Build the post record
        const record: AppBskyFeedPost.Record = {
            $type: 'app.bsky.feed.post',
            text: richText.text,
            facets: richText.facets,
            createdAt: new Date(content.created_at).toISOString(),
            ...(embed && { embed }),
            ...(replyRef && { reply: replyRef }),
            langs: [lang],
        };

        // Validate the record before returning
        const validation = AppBskyFeedPost.validateRecord(record);
        if (!validation.success) {
            throw new Error(`Invalid post record: ${validation.error?.message}`);
        }

        return { record, richText };
    }

    /**
     * Simple language detection heuristic
     */
    private detectLanguage(text: string): string {
        if (/\p{Script=Latin}/u.test(text)) {
            return 'en';
        }
        return 'en'; // Default to English
    }
}
