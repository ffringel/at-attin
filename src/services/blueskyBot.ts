import axios from 'axios';
import { AppBskyFeedPost, RichText, AtpAgent, AppBskyFeedGetAuthorFeed } from '@atproto/api';
import { altCardImage, bskyAccount, bskyApi } from '../config/config.js';
import { CHUNK_BUFFER, MAX_IMAGE_SIZE, MAX_POST_LENGTH, MAX_POSTS, MAX_VIDEO_SIZE } from '../constants.js';
import { BotOptions, MediaUpload, PostContent } from '../types.js';
import { FeedViewPost } from '@atproto/api/dist/client/types/app/bsky/feed/defs.js';

export default class BlueskyBot {
    private agent: AtpAgent;
    private rootUri = '';
    private rootCid = '';
    private parentUri = '';
    private parentCid = '';
    private dryRun = false;
    private feed?: AppBskyFeedGetAuthorFeed.Response;

    static defaultOptions: BotOptions = {
        service: bskyApi,
        dryRun: false,
    };

    constructor(options?: Partial<BotOptions>) {
        const { service, dryRun } = Object.assign({}, BlueskyBot.defaultOptions, options);
        this.agent = new AtpAgent({ service: service.toString() });
        this.dryRun = dryRun
    }

    async login(): Promise<void> {
        await this.agent.login({
            identifier: bskyAccount.identifier,
            password: bskyAccount.password,
        });
    }

    private async recentFeed() {
        this.feed = await this.agent.app.bsky.feed.getAuthorFeed({
            actor: this.agent.session?.did || '',
            limit: MAX_POSTS,
        });
    }

    private async isDuplicatePost(post: PostContent , isReply: boolean): Promise<boolean> {
        const text = post.content.trim();
        const parentUri = isReply ? this.parentUri : null;

        if (!this.feed?.data?.feed) return false;

        const checkPost = (postView: FeedViewPost): boolean => {
            const currentRecord = postView.post.record as AppBskyFeedPost.Record | undefined;
            const currentText = currentRecord?.text?.trim();
 
            if (currentText === text) return true;
    
            if (isReply && parentUri) {
                const replyParentUri = postView.reply?.parent?.uri;
                if (replyParentUri === parentUri && currentText === text) {
                    return true;
                }
            }
    
            return false;
        };
    
        return this.feed.data.feed.some(checkPost);
    }

    private async uploadMedia(url: string, alt: string, isVideo = false): Promise<MediaUpload> {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: { Range: `bytes=0-${(isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE) - 1}` }
            });
            const buffer = Buffer.from(response.data);
            const { data: { blob } } = await this.agent.uploadBlob(buffer, {
                encoding: isVideo ? 'video/mp4' : 'image/png',
            });
            
            return { blob: blob, alt };
        } catch (error) {
            if (altCardImage && !isVideo) return this.uploadMedia(altCardImage, 'Fallback image');
            throw new Error(`Failed to upload media: ${(error as Error).message}`);
        }
    }

    private getReplyRef() {
        return this.rootUri && this.parentUri ? {
            root: { uri: this.rootUri, cid: this.rootCid },
            parent: { uri: this.parentUri, cid: this.parentCid },
        } : undefined;
    }

    private updateReplyRefs(postResponse: { uri: string; cid: string }) {
        if (!this.rootUri) {
            this.rootUri = postResponse.uri;
            this.rootCid = postResponse.cid;
        }

        this.parentUri = postResponse.uri;
        this.parentCid = postResponse.cid;
    }

    private splitLongPost(text: string): string[] {
        const words = text.split(" ");
        const chunks: string[] = [];
        let currentChunk: string[] = [];
        let currentLength = 0;
        
        for (const word of words) {
            if (currentLength + word.length + 1 > MAX_POST_LENGTH - CHUNK_BUFFER) {
                chunks.push(currentChunk.join(" "));
                currentChunk = [];
                currentLength = 0;
            }
            currentChunk.push(word);
            currentLength += word.length + 1;
        }

        if (currentChunk.length > 0) chunks.push(currentChunk.join(" "));

        return chunks.map((chunk, index, arr) => `${chunk} [${index + 1}/${arr.length}]`)
    }

    async postContent(post: PostContent, isReply = false): Promise<void> {
        if (await this.isDuplicatePost(post, isReply)) {
            console.log('Skipping duplicate post:', post.content.substring(0, 50) + '...');
            return;
        }

        try {
            const richText = new RichText({ text: post.content.trim() });
            await richText.detectFacets(this.agent);

            // Initialize embed structure
            let embed: AppBskyFeedPost.Record["embed"];

            // Priority: Video > Images > Card
            if (post.video) {
                const video = await this.uploadMedia(post.video.url, '', true);
                const thumb = await this.uploadMedia(post.video.metadata?.preview_url || '', 'Video thumbnail');

                embed = {
                    $type: 'app.bsky.embed.video',
                    video: video.blob,
                    aspectRatio: {
                      width: post.video.metadata?.width,
                      height: post.video.metadata?.height,
                    },
                    thumb: {
                      $type: 'app.bsky.embed.video#thumb',
                      mimeType: 'image/png',
                      blob: thumb.blob,
                    }
                };
            } else if (post.images?.length) {
                const images = await Promise.all(
                    post.images.map(async img => ({
                        image: (await this.uploadMedia(img.url, img.alt || 'None')).blob,
                        alt: img.alt
                    }))
                );
                embed = {
                    $type: 'app.bsky.embed.images',
                    images
                };
            } else if (post.card) {
                const thumb = await this.uploadMedia(post.card.image!!, post.card.title!!);
                embed = {
                    $type: 'app.bsky.embed.external',
                    external: {
                      uri: post.card.uri,
                      title: post.card.title,
                      description: post.card.description,
                      thumb: thumb.blob
                    }
                };
            }

            const postRecord = {
                $type: 'app.bsky.feed.post',
                text: richText.text,
                facets: richText.facets,
                createdAt: post.created_at,
                ...(embed && { embed }),
                ...(isReply && { reply: this.getReplyRef() }),
            };

            if (this.dryRun) {
                console.log('Dry run - would post:', postRecord);
                return;
            }

            if (AppBskyFeedPost.isRecord(postRecord)) {
                const res = AppBskyFeedPost.validateRecord(postRecord)
                if (res.success) {
                    const response = await this.agent.post(postRecord);
                    this.updateReplyRefs(response);
                    console.log('Posted successfully:', postRecord.text);
                } else {
                  console.log('Error validating post:', postRecord)
                }
            }
        } catch (error) {
            console.error('Error posting content:', (error as Error).message);
            throw error;
        }
    }

    private async handleShortPost(post: PostContent): Promise<void> {
        await this.postContent(post)
    }

    private async handleLongPost(post: PostContent) {
        const chunks = this.splitLongPost(post.content);
        for (const [i, chunk] of chunks.entries()) {
            const updatedPost = i === 0 
                ? { ...post, content: chunk } 
                : { created_at: post.created_at, content: chunk };
                
            await this.postContent(updatedPost, i > 0);
        }
    }

    static async run(getPosts: () => Promise<PostContent[]>, options?: Partial<BotOptions>): Promise<void> {
        const bot = new BlueskyBot(options);

        try {
            await bot.login()
            await bot.recentFeed()
            const posts = await getPosts();

            for (const post of posts) {
                post.content.length <= MAX_POST_LENGTH 
                    ? await bot.handleShortPost(post) 
                    : await bot.handleLongPost(post);
            }
        } catch (error) {
            console.error('Error in bot execution:', (error as Error).message);
            process.exit(1);
        }
    }
 }
