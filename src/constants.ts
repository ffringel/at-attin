import { sourceAccount, sourceAccountId } from "./config/config.js";

export const MAX_POSTS = 20;
export const MAX_IMAGE_SIZE = 1000000; // 1MB
export const MAX_VIDEO_SIZE = 20000000; // 20MB
export const MAX_POST_LENGTH = 300;
export const CHUNK_BUFFER = 6; // Space for [x/y] suffix
  
  export const VIDEO_CONFIG = {
    SEGMENT_DURATION: 60
  } as const;
  
// Precompiled Regex Patterns
export const REGEX = {
    P_TAGS: /<\/p><p>/g,
    BR_TAGS: /<br>/g,
    QUOTES: /\\"/g,
    AMP: /&amp;/g,
    NBSP: /&nbsp;/g,
    TWITTER: /@twitter.com/g,
    ACCOUNT: new RegExp(sourceAccount, "g"),
    SERVER: new RegExp("@" + sourceAccountId.split("@")[2], "g"),
    HTML_TAGS: /<[^>]+>/g,
    INVALID_LINKS: /\S*(\.com|\.ca|\.org|\.net)\S*(…|\.\.\.)/g,
} as const;