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