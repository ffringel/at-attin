/**
 * Custom error class for Mastodon API errors.
 *
 * Errors are allowed to propagate to the single call site (BlueskyBot.run's
 * top-level catch, which logs and exits), so this module deliberately no
 * longer carries its own logging or error-classification helpers — logging
 * happens once, at the boundary, rather than being duplicated per layer.
 */
export class MastodonAPIError extends Error {
    public readonly status?: number;

    constructor(
        message: string,
        status?: number
    ) {
        super(message);
        this.name = 'MastodonAPIError';
        this.status = status;
    }
}