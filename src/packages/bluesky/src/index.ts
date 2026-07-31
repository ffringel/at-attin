/**
 * @at-attin/bluesky - Bluesky bot for posting content via AT Protocol
 *
 * Public API: `BlueskyBot` (and the `BotOptions` type its `run` accepts).
 * The supporting modules (PostService, ThreadManager, PostRegistry,
 * MediaUploader, EmbedBuilder, PostBuilder) are internal implementation
 * details and are not re-exported.
 */
export { BlueskyBot } from './blueskyBot.js';
export type { BotOptions } from '@at-attin/types';