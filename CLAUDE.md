# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**at-attin** is a Bluesky bot that mirrors posts from Mastodon accounts to the Bluesky network. It fetches recent posts from configured Mastodon sources, processes and sanitizes them for Bluesky compatibility, then posts them using an Atlas (Bluesky) account. The project uses TypeScript with AT Protocol client libraries for both platforms.

## Commands

### Development Workflow
```bash
# Install dependencies  
npm install  # or npm ci for clean reproducible installs (uses package-lock.json)

# Build TypeScript to JavaScript (dist/)
npm run build      # Compiles TS without starting dev server - required by CI workflows

# Lint code and fix issues
npm run lint:fix   # Auto-fixes common lint problems before committing

# Start the bot in development/dry-run mode  
npm start          # Runs production mode; use environment flags for testing options

Note: CI/CD workflows (GitHub Actions) do NOT have a `dev` command - they always run
the full sequence: checkout → npm ci → npm run build → npm start. The `build` step 
ensures TypeScript compiles successfully before the bot starts posting, matching production behavior exactly.
```

### Testing
No test framework is currently configured. The package.json has a placeholder `test` script that outputs an error message. To add tests, install a testing library like Jest or Vitest and configure accordingly.

To temporarily skip the existing failing test command during CI/CD runs by creating a `.env.local` file with dummy values:
```bash
cp .env.example .env.local  # Create working copy without secrets
# Add minimal required env vars to avoid zod validation errors in dry-run mode
```

### Running for Local Development / Testing
Create an environment variables file (`.env`) at the project root with these variables based on `.env.example`:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `BSKY_API` | Bluesky API server URL | `https://bsky.social` |
| `BSKY_HANDLE` | Handle for your posting Bluesky account | YourBlueskyHandle.bsky.social |
| `BSKY_PASSWORD` | Password for the above account (securely managed) | [stored in GitHub secrets] |
| `MASTODON_API` | Mastodon API base URL | `https://mastodon.social/api/v1/` |
| `MASTODON_HANDLE` | Your source Mastodon username to follow | @yourname@domain.xyz |
| `MASTODON_ACCOUNT_ID` | ID of the specific account within that domain (for multi-username) | numeric string id |
| `GIVEAWAYS` | Keywords to avoid on Bluesky, comma-separated default: "retweet" | retweet,dumpsterfire |

Then run:
```bash
npm start  # Starts the bot in production mode (dryRun defaults to false)
```

To test without posting content (dry-run), pass `{ dryRun: true }` when calling `BlueskyBot.run()` or set up an environment flag if needed. The config currently uses Zod for validation, which throws on missing env vars — ensure the minimal above is always present in development mode to avoid errors during local testing runs.

## Architecture and Structure

The project follows a straightforward architecture with TypeScript compiled to ES modules:

```
src/
├── index.ts              # Entry point - instantiates BlueskyBot, wires up post fetching services
├── types.ts              # Shared type definitions (PostContent, Image, Video, Card, MediaUpload)
├── constants.ts          # Constants including regex patterns for sanitization and limits
│   └── REGEX             # Compiled regex objects used throughout the project to sanitize content
└── config/
    ├── config.ts         # Environment variable loading using Zod validation schemas
    │                       - Exports: bskyApi, bskyAccount (ATP agent login opts)
    │                       - Exports: mastodonApi, sourceAccount, sourceAccountId
    │                       - Exports: giveaways array, accessToken string
└── services/             # Core business logic for both platforms
    ├── blueskyBot.ts     # Main bot class using @atproto/api library
    └── mastodonService.ts# Fetches and transforms Mastodon posts before posting to Bluesky

dist/  (build output, not in git)
.env*          # Environment files (.env is ignored by .gitignore)
```

### Key Components Explained

1. **`index.ts`** - The application entry point that creates a `BlueskyBot` instance and wires it to the post-fetching service (Mastodon). On startup, it runs the full sync loop fetching posts and posting them sequentially until exhausting all fetched items with no retry logic or batching beyond sequential ordering.

2. **`mastodonService.ts`** - Fetches recent posts from a configured Mastodon account using `tsl-mastodon-api`. This service filters out reblogged content, processes images/videos/cards by extracting metadata (dimensions for embed structures), and applies text sanitization to comply with Bluesky formatting rules — stripping Twitter-specific entities like HTML tags while preserving essential markup.

3. **`blueskyBot.ts`** - The main posting logic that handles:
   - Authenticating with AT Protocol agents using provided credentials 
   - Fetching recent posts from your own Bluesky feed to check for duplicates before reposting (prevents spamming the same content twice in quick succession)
   - Handling long-form content by splitting it into chunks with appropriate markers ([1/2], [2/3]) that stay within 300 character limits while preserving context across split posts
   - Uploading media via AT Protocol blob API, supporting images and videos (images: ~1MB limit; video: ~20MB)
   - Creating external embeds for article links with thumbnail previews from card metadata or fallback cards

4. **Config (`config.ts`)** - Uses Zod schema validation to enforce required environment variables before runtime initialization ensures all platform endpoints, credentials and content preferences are explicitly present in .env files at startup — missing or malformed values cause immediate failures during agent creation or login operations rather than failing gracefully later in the execution flow on account lookup.

### Content Processing Pipeline Overview

1. **Fetch** → `mastodonService.ts::getPosts()` pulls latest posts via Mastodon API
2. **Filter & Transform** → Filters out reposts; extracts images/videos/cards from raw response metadata objects and constructs typed PostContent interfaces with sanitized string values ready for downstream use
3. **Sanitize Text** → Removes Twitter-specific formatting, normalizes HTML entities to Bluesky-compatible text format — strips platform-irrelevant domain references while preserving core message content

4. **Split Long Posts** → Runs through `splitLongPost()` which tokenizes by word boundaries then rebuilds chunks with suffix markers until reaching character limit threshold minus buffer space for indices
5. **Upload Media** → Fetches media files and re-uploads to Bluesky via AT Protocol blob API, using fallback card image if primary fails (configurable URL) or throwing error on failure

6. **Post & Update Refs** → Posts content with optional reply chain support by tracking root/parent URIs/CIDs from responses returned after each post completes successfully
7. **Dry Run Mode Support** — When dryRun is enabled the bot logs what would be posted instead of actually creating posts useful for testing and debugging workflows locally without consuming API rate limits

## GitHub Actions CI Configuration

This project supports multiple Bluesky accounts via separate workflow files, one per account/domain:

| Workflow | Bot Handle | Cron Schedule | Run Steps |
|----------|-----------|---------------|-----------|
| `.github/workflows/jeffzrebiec.yml` | `@jeffzrebiecbot.bsky.social` | Every 5 min (`*/5 * * * *`) | checkout → npm ci → build → start |
| `.github/workflows/liverpool.yml`   | `@lfcbot.bsky.social`        | Every 5 min    | same as above |
| `.github/workflows/nfl.yml`         | `@nflbot.bsky.social`        | Every 5 min    | same as above |
| `.github/workflows/premierleague.yml` | `premierleaguebot.bsky.social` | Every 5 min   | same as above |
| `.github/workflows/ravens.yml`      | `ravensbot.bsky.social`     | Every 5 min    | same as above |

Each workflow performs identical steps:
1. **Checkout code** via `actions/checkout@v4`
2. **Setup Node.js** using version from `.nvmrc` file (`actions/setup-node@v4`)
3. **Install dependencies** with `npm ci` (uses package-lock.json for reproducible builds in CI)
4. **TypeScript compilation** via `npm run build` - fails if there are type errors
5. **Start the bot service** via `npm start`, injecting account-specific secrets:

   ```yaml
   env:
     BSKY_HANDLE: "jeffzrebiecbot.bsky.social"  # varies per workflow
     BSKY_PASSWORD: ${{ secrets.JEFF_ZREBIEC_BSKY_PASSWORD }}
     MASTODON_HANDLE: "@jeffzrebiec@sportsbots.xyz"
     MASTODON_ACCOUNT_ID: "109706769384211873"  # varies per bot account
   ```

### Environment Variables Used in CI/CD

| Variable | Description | Example Value (varies by workflow) | Stored as GitHub Secret Name |
|----------|-------------|-------------------------------------|------------------------------|
| `BSKY_HANDLE` | Bluesky handle for posting posts to Bluesky network | `jeffzrebiecbot.bsky.social`, `lfcbot.bsky.social`, etc. | N/A (handle is in workflow file) |
| `BSKY_PASSWORD` | Password/token for the bot's AT Protocol agent login | - | `{ACCOUNT}_BSKY_PASSWORD` per account |
| `MASTODON_HANDLE` | Source Mastodon username to follow from Bluesky perspective | `@jeffzrebiec@sportsbots.xyz`, etc. | N/A (in workflow file) |
| `MASTODON_ACCOUNT_ID` | ID of the specific source account within Mastodon domain | numeric string per bot's target | - |

### How GitHub Secrets Work with These Workflows

1. **GitHub secrets** are defined in the repository settings (Settings → Secrets and variables)
2. Each workflow uses a specific secret name matching `{ACCOUNT}_BSKY_PASSWORD` format:
   - `JEFF_ZREBIEC_BSKY_PASSWORD` for jeffzrebiec bot
   - `LFC_BSKY_PASSWORD` for Liverpool FC bot  
   - `NFL_BSKY_PASSWORD` for NFL aggregator
   - etc. (varies per account naming)

3. During each workflow run, secrets are injected into the job's environment context and used in GitHub Actions YAML as `${{ secrets.SECRET_NAME }}` format

4. The workflows do not read from `.env.example` or local `.env`; they rely entirely on CI-injected secrets via `secrets.XXX_PASSWORD`. Local development requires copying these files manually to create a working copy at project root with actual values (excluding the encrypted password which should be stored separately).


## Important Notes

- **Media Handling** — Images are converted and re-uploaded when posting; videos use separate metadata handling for aspect ratio display
- **Duplicate Detection** The bot checks your recent feed before reposting to avoid duplicates (comparing post text content exactly) and also handles reply chains by matching parent URIs with original message texts from source platforms
