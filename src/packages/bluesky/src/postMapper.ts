/**
 * Maps Mastodon post IDs to Bluesky AT URIs
 * Enables quote posts by finding the Bluesky equivalent of a Mastodon post
 */
export class PostMapper {
    private readonly idToUri = new Map<string, string>();

    /**
     * Store a mapping from Mastodon post ID to Bluesky AT URI
     */
    set(id: string, _url: string, uri: string): void {
        this.idToUri.set(id, uri);
    }

    /**
     * Get Bluesky AT URI for a Mastodon post ID
     */
    get(id: string): string | undefined {
        return this.idToUri.get(id);
    }
}
