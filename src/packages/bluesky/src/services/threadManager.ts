import type { AppBskyFeedPost } from '@atproto/api';

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
    getReplyRef(): AppBskyFeedPost.ReplyRef | undefined {
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
}
