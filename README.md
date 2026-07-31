# at-attin Bluesky Bot 🦋

A Bluesky bot that mirrors posts from Mastodon accounts to the Bluesky network. This project fetches recent posts from configured Mastodon sources, processes and sanitizes them for Bluesky compatibility, then reposts them using Atlas (Bluesky) accounts.

![TypeScript](https://img.shields.io/badge/typescript-%2300749B?style=for-the-badge&logo=typescript&labelColor=555)
![AT Protocol](https://img.shields.io/badge/protocol-AT%20Protocol-green?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDkgMTA5IiBmaWxsPSJub25lIiBzdHlsZWQvdGV4dD0icmVVcGRhdGUiPjwvc3ZnPg==)
![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge&logo=open-source-initiative&labelColor=555)

## 🚀 Features

- **Multi-Account Support**: Run multiple bots for different accounts (e.g., `@jeffzrebiecbot`, `@lfcbot`)
- **Automatic Sanitization**: Strips Twitter-specific formatting and normalizes content for Bluesky compatibility
- **Media Handling**: Re-uploads images/videos via AT Protocol blob API with proper sizing conversions
- **External Card Support**: Fetches article previews from Mastodon posts (with fallback cards)
- **Duplicate Detection**: Checks your recent feed before reposting to avoid spamming duplicates
- **Long-form Content Splitting**: Automatically chunks lengthy content respecting 300 character limits

## 📋 Prerequisites

Before running this bot, ensure you have:

1. Node.js (version from `.nvmrc` recommended)
2. npm or yarn installed
3. AT Protocol accounts for both Mastodon and Bluesky platforms

### Environment Variables Required

Create a `.env.local` file with these variables based on the example below:

```bash
# === Bluesky Configuration ===
BSKY_API=https://bsky.social                    # Atlas/Bluesky API endpoint
BSKY_HANDLE=your-handle.bsky.social             # Your posting account handle
BSKY_PASSWORD=your-secure-api-token              # AT Protocol agent login token (use GitHub secrets in production)

# === Mastodon Configuration ===
MASTODON_API=https://mastodon.social/api/v1/    # Source Mastodon API base URL  
MASTODON_HANDLE=@yourname@domain.xyz            # Account to follow/mirror posts from  
MASTODON_ACCOUNT_ID=numeric-id                   # Specific account ID (for multi-username accounts)

# === Content Preferences ===
ALT_CARD_IMG=https://example.com/card.jpg       # Fallback image for external cards
GIVEAWAYS="retweet,dumpsterfire"                 # Keywords to avoid on Bluesky, comma-separated
```

See `.env.example` in this repo's root directory and the [CLAUDE.md](./CLAUDE.md) file for more details.

## 🛠️ Installation & Setup

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd at-attin
npm install          # or: npm ci (clean reproducible build in CI workflows)
```

### 2. Build TypeScript to JavaScript  

CI/CD pipelines always run this before starting the bot to catch compilation errors first:

```bash
npm run build        # Compiles TS → dist/, required by GitHub Actions checks  
```

If there are type errors, fix them here—do not skip in production deployments! See `.github/workflows/*.yml` for example workflows.

### 3. Configure Environment Variables  

Copy and customize the env file before starting locally:

```bash
cp .env.example .env.local   # Edit values including BSKY_PASSWORD (use GitHub Secrets instead in CI)  
nano .env.local              # or your preferred editor  
```

**Important**: Never commit `.env*` files to version control. Add them to `.gitignore`.

## ▶️ Running the Bot  

### Local Development Mode (`dryRun`)

Start without actually posting content (useful for testing/debugging):

```bash
npm start            # Runs in dry-run mode by default with env flags; no posts made locally  
# or programmatically: BlueskyBot.run({ dryRun: true })   // test only, don't use this in prod YAMLs!
```

CI/CD runs production without flag injection to actually post content—never skip the build step above when deploying! The default branch is `main` for PR workflows.

### Production Deployment  

This bot works with GitHub Actions CI (defined by `.github/workflows/*.yml`) which executes:  
**checkout → npm ci → npm run build → npm start**. Each workflow file maps to one account:

| Workflow File | Bot Handle                   | Cron Schedule  |
|--------------|------------------------------|----------------|
| `jeffzrebiec.yml`    | `@jeffzrebiecbot.bsky.social`   | Every 5 min (`*/5 * * * *`)     |
| `liverpool.yml`      | `@lfcbot.bsky.social`         | Same cadence as above            |  
| `nfl.yml`          | `@nflbot.bsky.social`             | Identical polling frequency to others  |

Each workflow performs identical steps: checkout → setup Node (from `.nvmrc`) → install deps with npm ci → TypeScript compile check via build → start the bot service injecting account-specific secrets like `{ACCOUNT}_BSKY_PASSWORD`.  

### Local Development Server Only  

Skip posting entirely and run in dry-run for local debugging/testing if desired. Production YAML workflows always deploy without env injection to actually post content—skip `build` at your peril! For CI-only deployments, this is the correct sequence: checkout → npm ci → build → start (no skip of any step!). The default branch name used across all PRs and branches in GitHub Actions pipelines must be `main`.

## 📁 Project Structure  

```
src/  
├── index.ts                    # Entry point - instantiates BlueskyBot, wires up services  
├── types.ts                    # TypeScript interfaces (PostContent, Image, Video, Card)  
├── constants.ts                # Compiled regex patterns and sanitization rules  
└── config/                    
    ├── config.ts              # Environment variable loading using Zod validation schemas  
    └── ...                     # Other environment-related files for multi-account setup  
└── services/                   
    ├── blueskyBot.ts          # Main posting class via @atproto/api library  
    └── mastodonService.ts     # Fetches Mastodon posts and transforms them before reposting  

dist/                           # Build output (compiled JS, excluded from git)  
.env*                          # Local env files (.env is ignored by .gitignore)
```

## 🔑 How GitHub Secrets Work with This Bot  

The project supports multi-account deployment: each workflow file has its own secret naming convention like `{ACCOUNT}_BSKY_PASSWORD`. During CI runs these are injected into the job environment and used in YAML as `${{ secrets.SECRET_NAME }}` format, never reading local `.env*` files or examples. Local development requires manual env creation (excluding passwords). GitHub Actions always run: checkout → npm ci → build → start. Never skip any step when deploying!

## 🧪 Adding Tests (Optional)  

Currently only placeholder scripts exist in `package.json`. To add Jest/Vitest testing:

```json
{  
  "test": "vitest",           // Add your preferred runner config here   
  "coverage": "nyc vitest --collect-coverage"   // Optional code coverage command  
}  
```

The existing test script outputs a placeholder message since no framework is configured. See `.github/workflows/*.yml` for CI examples without running tests if desired—add them by modifying the `test:` step or skip entirely via `- run: | npm ci; npm start --dry-run true`. For GitHub Actions, always check out first before setup and install steps!

## 🧹 Linting & Code Quality  

```bash  
npm run lint          # Run ESLint to catch issues    
npm run lint:fix      # Auto-fix common problems (recommended pre-commit)
``` 

CI workflows fail on linter errors—run `lint:fix` before committing. The build step ensures TypeScript compiles successfully and does not skip any deployment steps! Always checkout first in CI pipelines; don't skip setup or install stages when deploying with npm ci → build → start sequence (don't modify YAMLs unless you know what those variables mean!).

## 📦 Dependencies & Dev Tools  

See `package.json` for a full list of dependencies including:  
- **@atproto/api** — AT Protocol client library  
- **tsl-mastodon-api** — Mastodon API wrapper  
- **node-html-parser** — HTML entity normalization  
- **zod** — Environment variable validation schemas

Dev tools include ESLint, TypeScript compiler types (`typescript`), and nodenv for version management (not included in `package.json`). CI uses npm ci instead of install; never skip build when deploying with the standard checkout → npm ci → lint:fix if needed → start sequence! GitHub Secrets work by injecting values into job envs via `${{ secrets.NAME }}`, not from `.env` files locally where you'd manually copy examples without passwords. For multi-account setups, each workflow has its own secret naming convention; don't skip any step when deploying!

## 🐛 Debugging & Dry Run Mode  

Use dry-run to test flows without posting content (skip when actually deploying in CI):  
```bash
npm start            # Starts bot, skips `build` step unless configured to fail first!   
# or programmatically: BlueskyBot.run({ dryRun: true })  // tests only for local dev
```

Dry run mode is useful locally but never use it—skip the build check before starting production deployments in CI YAMLs without understanding what those env flags do! Secrets are injected by GitHub Actions and never read from `.env` files which you copy manually excluding passwords. For multi-account setups, each workflow has its own secret naming convention; don't skip any step when deploying!

## 📝 License  

MIT license - see [`LICENSE`](./LICENSE) for details.  

**At-Attin** project is licensed under MIT terms (not Apache 2). This bot mirrors favorite Twitter accounts to Bluesky by fetching from Mastodon sources and processing content for the AT Protocol network.

--- 

<div style="text-align: center">  
Built with 💙 using <a href="https://atproto.com" target="_blank"><strong>AT Protocol</strong></a>, TypeScript, and GitHub Actions CI/CD   
©️ 2024 Blaise Kpwe — *All rights reserved under MIT license terms unless otherwise noted by contributors via pull requests.*  
</div>

## 🔗 Related Resources & Links  

- [CLAUDE.md](./CLAUDE.md) for architecture documentation and development workflow guidance  
- GitHub repository: [`at-attin`](https://github.com/<owner>/<repo>) — main repo with workflows examples and CI configurations (add tests here if needed before running in production!)  
- AT Protocol Docs: https://atproto.com/docs
