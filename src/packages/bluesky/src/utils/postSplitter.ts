import { MAX_POST_LENGTH, CHUNK_BUFFER } from '../config/constants.js';

/**
 * Split a long post into chunks that fit within character limits.
 *
 * Pure, stateless helper: same input always yields the same chunks. Extracted
 * from ThreadManager so the reply-ref state machine (services/) is separated
 * from the pure text-splitting logic (utils/).
 * @param text - The post text to split
 * @returns Array of text chunks with [x/y] suffixes
 */
export function splitLongPost(text: string): string[] {
    const words = text.split(' ');
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentLength = 0;

    for (const word of words) {
        if (currentLength + word.length + 1 > MAX_POST_LENGTH - CHUNK_BUFFER) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [];
            currentLength = 0;
        }
        currentChunk.push(word);
        currentLength += word.length + 1;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }

    return chunks.map((chunk, index, arr) => `${chunk} [${index + 1}/${arr.length}]`);
}