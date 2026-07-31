// Post limits
export const MAX_POST_LENGTH = 300;
export const CHUNK_BUFFER = 6; // Space for [x/y] suffix

// Media size limits (updated to current AT Protocol limits)
export const MAX_IMAGE_SIZE = 2000000;    // 2MB
export const MAX_VIDEO_SIZE = 100000000;  // 100MB

// Embed limits
export const MAX_IMAGES_PER_POST = 4;

// Retry configuration
export const BASE_RETRY_DELAY = 1000;     // 1s base for exponential backoff
export const MAX_RETRIES = 3;             // Max retry attempts
export const MAX_RETRY_DELAY = 10000;     // 10s max delay between retries
// Max time to wait on a 429 before giving up this run. The cron runs every 5
// min, so spending longer than this sleeping out a rate-limit window would
// stall the run; bailing lets the next cron run retry (the post is re-fetched,
// not yet a duplicate, so it retries naturally). Bounds each retry's sleep
// even when MAX_RETRIES caps the count.
export const MAX_RATE_LIMIT_WAIT = 60000;  // 60s