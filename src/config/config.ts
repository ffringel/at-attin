import { env } from "node:process";
import { z } from "zod";
import { AtpAgentLoginOpts } from "@atproto/api";

const envSchema = z.object({
    BSKY_API: z.string().nonempty().default("https://bsky.social"),
    BSKY_HANDLE: z.string().nonempty(),
    BSKY_PASSWORD: z.string().nonempty(),
    MASTODON_API: z.string().nonempty().default("https://mastodon.social/api/v1/"),
    MASTODON_HANDLE: z.string().nonempty(),
    MASTODON_ACCOUNT_ID: z.string().nonempty(),
    ALT_CARD_IMG: z.string().nonempty(),      
    GIVEAWAYS: z.string().nonempty().default("retweet"),
});

const parsedSchema = envSchema.parse(env);

// Bluesky account config
export const bskyApi = parsedSchema.BSKY_API;
export const bskyAccount: AtpAgentLoginOpts = {
    identifier: parsedSchema.BSKY_HANDLE,
    password: parsedSchema.BSKY_PASSWORD,
}


// Mastodon account config
export const mastodonApi = parsedSchema.MASTODON_API;
export const sourceAccount = parsedSchema.MASTODON_HANDLE;
export const sourceAccountId = parsedSchema.MASTODON_ACCOUNT_ID;
export const giveaways = parsedSchema.GIVEAWAYS.split(",");
export const altCardImage = parsedSchema.ALT_CARD_IMG;