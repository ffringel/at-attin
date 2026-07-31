/**
 * Truncate a string to at most `max` Unicode graphemes (user-perceived
 * characters), cutting on a whole grapheme-cluster boundary.
 *
 * Bluesky enforces several length limits in *graphemes* (not UTF-16 code
 * units), e.g. video alt text is capped at 1000 graphemes. String#length
 * counts code units, so an emoji-heavy string (each cluster = 2+ code
 * units) would under-count; `Intl.Segmenter` segments by grapheme cluster
 * and counts what users see.
 *
 * Pure, stateless helper.
 * @param text - The text to truncate
 * @param max - Maximum grapheme count
 * @returns `text` if it is already within the limit, else its first `max`
 *          graphemes
 */
export function truncateToGraphemes(text: string, max: number): string {
    // Fast path: a grapheme is always >=1 code unit, so a code-unit count <= max
    // guarantees a grapheme count <= max — no segmentation needed.
    if (text.length <= max) {
        return text;
    }
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let result = '';
    let count = 0;
    for (const { segment } of segmenter.segment(text)) {
        if (count >= max) {
            break;
        }
        result += segment;
        count++;
    }
    return result;
}