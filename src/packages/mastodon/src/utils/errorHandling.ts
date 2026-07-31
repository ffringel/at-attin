/**
 * Custom error class for Mastodon API errors
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

/**
 * Type guard to check if an error is a MastodonAPIError
 */
export function isMastodonAPIError(error: unknown): error is MastodonAPIError {
    return error instanceof MastodonAPIError;
}

/**
 * Type guard to check if an error is a network error
 */
export function isNetworkError(error: unknown): error is TypeError {
    return error instanceof TypeError && error.message.includes('fetch');
}

/**
 * Handle Mastodon API errors with appropriate logging
 */
export function handleMastodonError(error: unknown, context: string = 'Mastodon operation'): void {
    if (isMastodonAPIError(error)) {
        console.error(`${context} - API error:`, error.message, `(Status: ${error.status})`);
    } else if (isNetworkError(error)) {
        console.error(`${context} - Network error:`, error.message);
    } else {
        console.error(`${context} - Unexpected error:`, error);
    }
}
