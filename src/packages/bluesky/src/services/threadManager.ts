import { MAX_POST_LENGTH, CHUNK_BUFFER } from '../config/constants.js';

/**
 * Reply reference structure for thread creation
 */
export interface ReplyRef {
    root: { uri: string; cid: string };
    parent: { uri: string; cid: string };
}

/**
 * Manages reply thread state for creating threaded posts
 */
export class ThreadManager {
    private rootUri = '';
    private rootCid = '';
    private parentUri = '';
    private parentCid = '';

    /**
     * Get the current reply reference for nesting replies
     * @returns ReplyRef or undefined if no thread started
     */
    getReplyRef(): ReplyRef | undefined {
        if (!this.rootUri || !this.parentUri) {
            return undefined;
        }
        return {
            root: { uri: this.rootUri, cid: this.rootCid },
            parent: { uri: this.parentUri, cid: this.parentCid },
        };
    }

    /**
     * Update reply references after a successful post
     * @param postResponse - Response from post creation with uri and cid
     */
    updateReplyRefs(postResponse: { uri: string; cid: string }): void {
        if (!this.rootUri) {
            this.rootUri = postResponse.uri;
            this.rootCid = postResponse.cid;
        }
        this.parentUri = postResponse.uri;
        this.parentCid = postResponse.cid;
    }

    /**
     * Reset reply references for a new thread
     */
    resetReplyRefs(): void {
        this.rootUri = '';
        this.rootCid = '';
        this.parentUri = '';
        this.parentCid = '';
    }
    /**
     * Split a long post into chunks that fit within character limits
     * @param text - The post text to split
     * @returns Array of text chunks with [x/y] suffixes
     */
    splitLongPost(text: string): string[] {
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
}
