import { MAX_POST_LENGTH } from '../config/constants.js';

/**
 * Split a long post into chunks that each fit within the Bluesky grapheme
 * limit.
 *
 * Pure, stateless helper: same input always yields the same chunks. Extracted
 * from ThreadManager so the reply-ref state machine (services/) is separated
 * from the pure text-splitting logic (utils/).
 *
 * One edge case the naive splitter mishandled:
 *  - A single word longer than the per-chunk budget (e.g. a very long URL)
 *    would overflow the limit and cause validation to fail. Such a word is
 *    now split at the budget boundary so its content is preserved across
 *    chunks instead of crashing.
 *
 * Lengths are measured in UTF-16 code units (.length). A grapheme is always
 * >=1 code unit, so a chunk that is <= MAX_POST_LENGTH code units is also
 * <= MAX_POST_LENGTH graphemes — the budget is conservative w.r.t. the
 * grapheme limit Bluesky's validator enforces.
 * @param text - The post text to split
 * @returns Array of text chunks
 */
export function splitLongPost(text: string): string[] {
    const words = text.split(' ');

    const budget = MAX_POST_LENGTH;
    const chunks: string[] = [];
    let current: string[] = [];
    let currentLen = 0;
    const flush = () => {
        if (current.length > 0) {
            chunks.push(current.join(' '));
            current = [];
            currentLen = 0;
        }
    };
    for (const word of words) {
        if (word.length > budget) {
            // Over-long word (e.g. a very long URL): can't fit in one
            // chunk. Split it at the budget boundary so its content is
            // preserved across chunks instead of overflowing validation.
            flush();
            for (let i = 0; i < word.length; i += budget) {
                chunks.push(word.slice(i, i + budget));
            }
            continue;
        }
        if (currentLen + word.length + 1 > budget) {
            flush();
        }
        current.push(word);
        currentLen += word.length + 1;
    }
    flush();
    return chunks;
}