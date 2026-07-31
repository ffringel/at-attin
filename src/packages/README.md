# @at-attin Packages

This directory contains the core packages for the at-attin project:

## Packages

### @at-attin/types
Shared TypeScript type definitions used across all at-attin packages.

**Exports:**
- `PostContent` - Main post structure
- `Image`, `Video`, `Card` - Media types
- `BotOptions` - Configuration interface

(`MediaUpload` was relocated to `@at-attin/bluesky` — it is bluesky-internal.)

### @at-attin/mastodon
Mastodon API client for fetching and processing posts.

**Modules:**
- `apiClient` - `MastodonClient` class with rate limit awareness
- `errorHandling` - `MastodonAPIError` and error utilities
- `typeGuards` - Type guards for media attachments
- `contentSanitizer` - HTML to plain text conversion
- `mediaProcessor` - Media attachment processing
- `mastodonService` - Main service class

**Usage:**
```typescript
import MastodonService from '@at-attin/mastodon';

const service = new MastodonService({
    accessToken: '...',
    apiUrl: 'https://mastodon.example/api/v1/',
    sourceAccountId: '123456',
    blueskyHandle: 'user.bsky.social',
});

const posts = await service.getPosts(20);
```

### @at-attin/bluesky
Bluesky bot for posting content via the AT Protocol.

**Modules:**
- `blueskyBot` - Main `BlueskyBot` class (composition root + session)
- `config/constants` - Tunable limits and sizes
- `services/postService` - Posting orchestrator (dedup, build, post, thread)
- `services/postRegistry` - Mastodon↔Bluesky mapping + duplicate detection
- `services/threadManager` - Reply-ref state machine
- `builders/postBuilder` - Post record construction + validation
- `builders/embedBuilder` - Embed structure construction
- `media/mediaFetcher` - Media download + mime/size validation
- `media/mediaUploader` - PDS blob upload with retry + bounded fallback
- `utils/postSplitter` - Pure long-post splitting

**Usage:**
```typescript
import { BlueskyBot } from '@at-attin/bluesky';

await BlueskyBot.run(
    () => fetchPosts(),
    { dryRun: false },
    'https://fallback.image/'
);
```

## Building

Build all packages:
```bash
npm run build:all
```

Build individual packages:
```bash
npm run build:types
npm run build:mastodon
npm run build:bluesky
```

## Architecture

```
┌─────────────────┐
│   Main App      │
│  (src/index.ts) │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌─────────┐ ┌──────────┐
│Mastodon │ │ Bluesky  │
│Service  │ │ Bot      │
└─────────┘ └──────────┘
    │           │
    └─────┬─────┘
          │
          ▼
    ┌──────────┐
    │  Types   │
    │ Package  │
    └──────────┘
```

Each package is:
- **Independent** - Can be used standalone
- **Testable** - Easy to mock and test
- **Maintainable** - Focused responsibility
- **Type-safe** - Full TypeScript support
