import { MAX_POST_LENGTH } from '../config/constants.js';

/**
 * Split a long post into chunks that each fit within the Bluesky grapheme
 * limit, with an [x/y] thread index suffix on every chunk.
 *
 * Pure, stateless helper: same input always yields the same chunks. Extracted
 * from ThreadManager so the reply-ref state machine (services/) is separated
 * from the pure text-splitting logic (utils/).
 *
 * Two edge cases the naive splitter mishandled (§3.6):
 *  - A single word longer than the per-chunk budget (e.g. a very long URL)
 *    became its own chunk that, with the suffix, exceeded the limit -> the
 *    post record failed validation and the whole run aborted. Such a word is
 *    now split at the budget boundary so its content is preserved across
 *    chunks instead of crashing.
 *  - The [x/y] suffix grows with the chunk count (6 chars for <10 chunks, 8
 *    for <100, 10 for <1000). A fixed 6-char reserve overflowed once there
 *    were >=10 chunks. The reserve is now sized to the actual chunk count:
 *    build with the tight 6-char reserve, and widen (rebuild) only if the
 *    count crosses a digit boundary — so small posts (the common case) are
 *    byte-identical to the old splitter, and only >=10-chunk posts change.
 *
 * Lengths are measured in UTF-16 code units (.length). A grapheme is always
 * >=1 code unit, so a chunk that is <= MAX_POST_LENGTH code units is also
 * <= MAX_POST_LENGTH graphemes — the budget is conservative w.r.t. the
 * grapheme limit Bluesky's validator enforces.
 * @param text - The post text to split
 * @returns Array of text chunks with [x/y] suffixes
 */
export function splitLongPost(text: string): string[] {
    const words = text.split(' ');

    // Build raw chunks (no suffix) with a per-chunk text budget of
    // MAX_POST_LENGTH - reserve, where `reserve` leaves room for the suffix.
    const build = (reserve: number): string[] => {
        const budget = MAX_POST_LENGTH - reserve;
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
    };

    // suffixLen(n) is the width of the widest suffix ' [n/n]'. Size the reserve
    // to the actual chunk count, widening only if it crossed a digit boundary.
    const suffixLen = (n: number) => ` [${n}/${n}]`.length;
    let reserve = 6; // tightest suffix (' [1/2]'); keeps small posts unchanged
    let chunks = build(reserve);
    while (suffixLen(chunks.length) > reserve) {
        reserve = suffixLen(chunks.length);
        chunks = build(reserve);
    }

    return chunks.map((chunk, index, arr) => `${chunk} [${index + 1}/${arr.length}]`);
}