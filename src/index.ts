import MastodonService from '@at-attin/mastodon';
import { BlueskyBot } from '@at-attin/bluesky';
import { bskyApi, bskyAccount, altCardImage, giveaways, sourceAccountId, sourceAccount, mastodonApi, access_token } from './config/config.js';

// Create Mastodon service instance
const mastodonService = new MastodonService({
    accessToken: access_token,
    apiUrl: mastodonApi,
    sourceAccountId: sourceAccountId,
    sourceAccount: sourceAccount,
    blueskyHandle: bskyAccount.identifier,
    giveaways: giveaways,
});

// Run the bot. Credentials are injected (the library never reads process.env);
// errors propagate here, the single log + exit point (preserves exit code 1 for
// GitHub Actions to flag a failed cron).
BlueskyBot.run(
    () => mastodonService.getPosts(),
    bskyAccount,
    { dryRun: false, service: bskyApi },
    altCardImage
).catch((err) => {
    console.error('Bot run failed:', err);
    process.exit(1);
});
