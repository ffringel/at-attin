import BlueskyBot from "./services/blueskyBot.js";
import getPosts from "./services/mastodonService.js";


BlueskyBot.run(getPosts, { dryRun: false }).catch(console.error);