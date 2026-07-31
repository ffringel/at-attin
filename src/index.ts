import MastodonService from '@at-attin/mastodon';
import { BlueskyBot } from '@at-attin/bluesky';
import { bskyAccount, altCardImage, giveaways, sourceAccountId, sourceAccount, mastodonApi, access_token } from './config/config.js';

// Create Mastodon service instance
const mastodonService = new MastodonService({
    accessToken: access_token,
    apiUrl: mastodonApi,
    sourceAccountId: sourceAccountId,
    sourceAccount: sourceAccount,
    blueskyHandle: bskyAccount.identifier,
    giveaways: giveaways,
});

// Run the bot
BlueskyBot.run(
    () => mastodonService.getPosts(),
    { dryRun: false },
    altCardImage
).catch(console.error);
