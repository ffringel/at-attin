/**
 * Promise-based sleep. Shared by PostService (rate-limit backoff) and
 * MediaUploader (upload retry backoff) — previously duplicated as identical
 * private one-liners in both.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}