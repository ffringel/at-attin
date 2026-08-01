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
    MASTODON_ACCESS_TOKEN: z.string().optional().default(""),
    GIVEAWAYS: z.string().nonempty().default("#AD"),
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
// Optional Mastodon API access token — public timelines need no auth.
// Defaults to "" via the zod schema (env var MASTODON_ACCESS_TOKEN).
export const accessToken = parsedSchema.MASTODON_ACCESS_TOKEN;
export const giveaways = parsedSchema.GIVEAWAYS.split(",");