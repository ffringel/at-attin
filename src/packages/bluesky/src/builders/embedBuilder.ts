import {
    AppBskyEmbedImages,
    AppBskyEmbedVideo,
    AppBskyEmbedExternal,
    AppBskyEmbedRecord,
} from '@atproto/api';
import type { PostContent, Image as PostImage } from '@at-attin/types';
import { MAX_IMAGES_PER_POST, MAX_VIDEO_ALT_LENGTH, MAX_EXTERNAL_TITLE_LENGTH, MAX_EXTERNAL_DESC_LENGTH } from '../config/constants.js';
import { MediaUploader } from '../media/mediaUploader.js';
import { QuoteResolver } from '../services/quoteResolver.js';
import { truncateToGraphemes } from '../utils/textUtils.js';

/**
 * Union type for all embed types including quote posts
 */
export type Embed =
    | AppBskyEmbedImages.Main
    | AppBskyEmbedVideo.Main
    | AppBskyEmbedExternal.Main
    | AppBskyEmbedRecord.Main;

/**
 * Builds embed structures for Bluesky posts based on content type.
 * Priority: Video > Images > Own-Quote (record embed) > Cross-account Quote
 * (x.com link card) > Mastodon link card > Bluesky-to-Bluesky quote (record).
 *
 * Media still wins outright: Bluesky can't attach a card or record embed
 * alongside images/video in a single post, so a quote post carrying quoter
 * media posts the media and preserves the quote reference as an in-text
 * x.com URL (the postService fallback) — there's no single-embed way to do
 * both.
 */
export class EmbedBuilder {
    private readonly mediaUploader: MediaUploader;
    private readonly quoteResolver: QuoteResolver;

    constructor(mediaUploader: MediaUploader, quoteResolver: QuoteResolver) {
        this.mediaUploader = mediaUploader;
        this.quoteResolver = quoteResolver;
    }

    /**
     * Build an embed structure from post content
     * @param post - The post content to build an embed for
     * @returns Embed object or undefined if no embeddable content
     */
    async build(post: PostContent): Promise<Embed | undefined> {
        // Priority 1: Video embed
        if (post.video) {
            return this.buildVideoEmbed(post.video);
        }

        // Priority 2: Images embed
        if (post.images && post.images.length > 0) {
            return this.buildImagesEmbed(post.images);
        }

        // Quotes (own and cross-account) only attach when there's no quoter
        // media — see the class doc.
        if (post.quotedStatus) {
            // Own-quote: embed the already-mirrored Bluesky post as a record
            // embed. Resolved via PostRegistry (cid carried from post time /
            // feed, so no racy getPosts round-trip). If it can't resolve
            // (quotee outside the feed window), fall through so the x.com URL
            // fallback (postService) preserves the reference.
            if (post.quotedStatus.isOwnQuote) {
                const quoteEmbed = await this.buildQuoteEmbed(post.quotedStatus);
                if (quoteEmbed) {
                    return quoteEmbed;
                }
            } else if (post.quotedStatus.uri?.startsWith('at://')) {
                // Bluesky-to-Bluesky quote of another account: a real record
                // embed (the quotee is a Bluesky post). CID fetched via getPosts.
                const quoteEmbed = await this.buildQuoteEmbed(post.quotedStatus);
                if (quoteEmbed) {
                    return quoteEmbed;
                }
            } else {
                // Cross-account Mastodon quote: the quotee is a tweet on
                // another account, which we can't reference as a Bluesky record.
                // Render it as an x.com link card (app.bsky.embed.external)
                // built from the quoted_status metadata — Bluesky never
                // auto-generates a card from a bare URL in the text, so the
                // card must be built explicitly. Returns undefined when no
                // usable URL is present (rare), falling through to the link
                // card / URL fallback below.
                const crossCard = this.buildCrossQuoteCard(post.quotedStatus);
                if (crossCard) {
                    return crossCard;
                }
            }
        }

        // Priority N: External card embed (Mastodon link preview on the
        // quoter's own post). Lower than quotes — a quote's reference is the
        // more salient embed — but reached when no quote embed applied.
        if (post.card?.uri && post.card.title && post.card.description) {
            return this.buildExternalEmbed(post.card);
        }

        return undefined;
    }

    /**
     * Build an x.com link card for a cross-account quote — the Bluesky
     * representation of "embed the x.com/twitter post." Bluesky does NOT
     * auto-generate a card from a URL in post text (detectFacets only makes a
     * clickable link facet), so the card must be constructed explicitly from
     * the quoted_status metadata the Mastodon bridge already provided:
     *   - uri:  the tweet's x.com URL (quotedStatus.url, twitter.com→x.com;
     *           for pending quotes, the synthesized x.com/i/status/<id> URL),
     *   - title: the quoted author's display name, or a fallback for pending
     *           quotes (no account metadata),
     *   - description: the quoted tweet's sanitized text, truncated to the
     *           external embed's 1018-grapheme cap (empty for pending).
     * No thumbnail: the bridge doesn't surface the quoted tweet's media on
     * QuotedStatus, and fetching x.com OG tags is authwalled — a text-only
     * card is the reliable representation.
     */
    private buildCrossQuoteCard(
        quotedStatus: NonNullable<PostContent['quotedStatus']>
    ): AppBskyEmbedExternal.Main | undefined {
        const rawUrl = quotedStatus.url ?? quotedStatus.uri;
        if (!rawUrl) {
            return undefined;
        }
        const uri = rawUrl.replace(/twitter\.com/, 'x.com');
        const title = quotedStatus.account?.display_name
            ? truncateToGraphemes(quotedStatus.account.display_name, MAX_EXTERNAL_TITLE_LENGTH)
            : 'Quoted post on X';
        const description = quotedStatus.content
            ? truncateToGraphemes(quotedStatus.content, MAX_EXTERNAL_DESC_LENGTH)
            : '';
        return {
            $type: 'app.bsky.embed.external',
            external: { uri, title, description },
        };
    }

    /**
     * Build a video embed. Degrades gracefully: a video that fails to
     * download/upload (e.g. exceeds Bluesky's video size limit, bad mime,
     * network error) is skipped rather than rejecting the whole embed build —
     * the post goes out text-only instead of aborting the run. Mirrors
     * buildImagesEmbed's per-image "continue without" pattern; prevents one
     * oversized video from killing the entire 5-minute cron batch.
     */
    private async buildVideoEmbed(
        video: NonNullable<PostContent['video']>
    ): Promise<AppBskyEmbedVideo.Main | undefined> {
        try {
            const videoBlob = await this.mediaUploader.upload(video.url, '', true);

            return {
                $type: 'app.bsky.embed.video',
                video: videoBlob.blob,
                alt: truncateToGraphemes(video.alt || '', MAX_VIDEO_ALT_LENGTH),
                ...(video.metadata?.width && video.metadata?.height && {
                    aspectRatio: {
                        width: video.metadata.width,
                        height: video.metadata.height,
                    },
                }),
            };
        } catch (error) {
            console.warn(
                'Skipping failed video:',
                error instanceof Error ? error.message : error
            );
            return undefined;
        }
    }

    /**
     * Build an images embed (max 4 images). Degrades gracefully per-image:
     * a single image that fails to download/upload (e.g. exceeds Bluesky's
     * 2MB image limit, bad mime, network error) is skipped rather than
     * rejecting the whole embed — the post still goes out with the surviving
     * images, or text-only if every image fails. Mirrors buildExternalEmbed's
     * "continue without" pattern; prevents one oversized image from killing
     * the entire run.
     */
    private async buildImagesEmbed(images: PostImage[]): Promise<AppBskyEmbedImages.Main | undefined> {
        const imagesToUpload = images.slice(0, MAX_IMAGES_PER_POST);

        const results = await Promise.allSettled(
            imagesToUpload.map(img =>
                this.mediaUploader.upload(img.url, img.alt || '').then(media => ({
                    image: media.blob,
                    alt: img.alt || '',
                    ...(img.aspectRatio?.width && img.aspectRatio?.height && {
                        aspectRatio: {
                            width: img.aspectRatio.width,
                            height: img.aspectRatio.height,
                        },
                    }),
                }))
            )
        );

        const uploadedImages: AppBskyEmbedImages.Image[] = [];
        for (const result of results) {
            if (result.status === 'fulfilled') {
                uploadedImages.push(result.value);
            } else {
                console.warn(
                    'Skipping failed image:',
                    result.reason instanceof Error ? result.reason.message : result.reason
                );
            }
        }

        if (uploadedImages.length === 0) {
            console.warn('All images failed to upload; posting without an image embed');
            return undefined;
        }

        return {
            $type: 'app.bsky.embed.images',
            images: uploadedImages,
        };
    }

    /**
     * Build an external card embed
     */
    private async buildExternalEmbed(
        card: NonNullable<PostContent['card']>
    ): Promise<AppBskyEmbedExternal.Main | undefined> {
        try {
            // card.title/description are validated before this method is called
            const title = card.title;
            const thumb = card.image
                ? await this.mediaUploader.upload(card.image, title)
                : null;

            return {
                $type: 'app.bsky.embed.external',
                external: {
                    uri: card.uri,
                    title: title,
                    description: card.description,
                    ...(thumb && { thumb: thumb.blob }),
                },
            };
        } catch (error) {
            console.warn('Failed to create card embed, continuing without:', (error as Error).message);
            return undefined;
        }
    }

    /**
     * Build a quote post embed (app.bsky.embed.record).
     * Delegates URI + CID resolution to QuoteResolver; this method is purely
     * construction once a {uri, cid} is resolved.
     */
    private async buildQuoteEmbed(quotedStatus: NonNullable<PostContent['quotedStatus']>): Promise<AppBskyEmbedRecord.Main | undefined> {
        const resolved = await this.quoteResolver.resolve(quotedStatus);
        if (!resolved) {
            return undefined;
        }

        return {
            $type: 'app.bsky.embed.record',
            record: {
                uri: resolved.uri,
                cid: resolved.cid,
            },
        };
    }
}
