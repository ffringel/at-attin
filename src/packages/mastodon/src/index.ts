/**
 * @at-attin/mastodon - Mastodon API client for fetching posts
 *
 * Only MastodonService is part of the public API. All other modules
 * (apiClient, contentSanitizer, mediaProcessor, typeGuards, errorHandling)
 * are internal implementation details and are not re-exported here.
 */
export { default } from './services/mastodonService.js';