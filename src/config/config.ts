import { AtpAgentLoginOpts } from "@atproto/api";
import { env } from "node:process";
import { z } from "zod";

const envSchema = z.object({
    BSKY_API: z.string().min(1).default("https://bsky.social"),
    BSKY_HANDLE: z.string().min(1),
    BSKY_PASSWORD: z.string().min(1),
    MASTODON_API: z.string().min(1).default("https://mastodon.social/api/v1/"),
    MASTODON_HANDLE: z.string().min(1),
    MASTODON_ACCOUNT_ID: z.string().min(1),
    ALT_CARD_IMG: z.string().min(1),
    GIVEAWAYS: z.string().min(1).default("retweet"),
});

const parsedSchema = envSchema.parse(env);

export const bskyApi = parsedSchema.BSKY_API;

export const bskyAccount: AtpAgentLoginOpts = {
    identifier: parsedSchema.BSKY_HANDLE,
    password: parsedSchema.BSKY_PASSWORD,
}

export const mastodonApi = parsedSchema.MASTODON_API;
export const mastodonAccount = parsedSchema.MASTODON_HANDLE;
export const mastodonId = parsedSchema.MASTODON_ACCOUNT_ID;
export const giveaways = parsedSchema.GIVEAWAYS.split(",");

export const altCardImage = parsedSchema.ALT_CARD_IMG;