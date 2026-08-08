// Post limits
export const MAX_POST_LENGTH = 300;

// Media size limits — verified July 2026 against the app.bsky.embed lexicons:
//  - images: 2MB (app.bsky.embed.images, raised from 1MB in April 2026 via
//    atproto PR #4823). CLAUDE.md's "~1MB" figure is stale.
//  - videos: 100MB (app.bsky.embed.video, raised from 50MB in March 2025 via
//    atproto PR #3602). The PDS-level per-blob upload cap
//    (PDS_BLOB_UPLOAD_LIMIT, default 50MB) is a separate, lower bound on the
//    raw uploadBlob request; bsky.social's hosted PDS may have raised it to
//    match, but if not, a 50-100MB video would 413 at upload time (handled by
//    the 413 branch in postService.handlePostError). These client-side checks
//    pre-validate against the lexicon (app-layer) limits.
export const MAX_IMAGE_SIZE = 2000000;    // 2MB — app.bsky.embed.images max
export const MAX_VIDEO_SIZE = 100000000;  // 100MB — app.bsky.embed.video max

// Embed limits
export const MAX_IMAGES_PER_POST = 4;
// app.bsky.embed.external card text limits. The bundled lexicon declares
// title/description as plain strings (no client-side maxGraphemes), but the
// PDS/AppView enforces these grapheme caps server-side — exceeding them
// rejects the record. Used for the synthesized x.com link cards built for
// cross-account quote posts.
export const MAX_EXTERNAL_TITLE_LENGTH = 300;    // external.title maxGraphemes
export const MAX_EXTERNAL_DESC_LENGTH = 1018;    // external.description maxGraphemes
// Video alt text limit: app.bsky.embed.video's `alt` field is capped at
// maxGraphemes 1000 (maxLength 10000 bytes). Mastodon media descriptions can
// exceed this, so the alt is truncated to 1000 graphemes before posting
// (grapheme-correct, not code-unit — see utils/textUtils.ts).
export const MAX_VIDEO_ALT_LENGTH = 1000;
// NOTE on image alt: app.bsky.embed.images#image.alt has NO maxGraphemes /
// maxLength in the lexicon (verified against bluesky-social/atproto main,
// July 2026) — unlike video alt. So image alt text is intentionally NOT
// truncated (processImages / buildImagesEmbed pass it through verbatim).
// Truncating would invent a constraint the platform doesn't enforce and could
// cut off legitimate long accessibility descriptions. If a future lexicon
// revision adds a bound, mirror MAX_VIDEO_ALT_LENGTH + truncateToGraphemes
// here at that time.

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