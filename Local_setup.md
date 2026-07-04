# MoldPilot Local Setup

This guide explains how to run MoldPilot locally on your Mac, including online setup, offline setup, and why the app worked inside Codex even when `node` and `pnpm` were missing from your normal Terminal.

## Key Point

`http://localhost:3000` only works while the Next.js dev server is running.

If the terminal running MoldPilot is closed, stopped, or never started, Chrome will not be able to open `localhost:3000`.

## Required Tools

Install these on your Mac for normal local development:

1. Node.js 24+
2. pnpm
3. Docker Desktop

Docker is used for PostgreSQL. Node and pnpm are used to install and run the web app.

## Why It Worked In Codex Before

Codex used its own bundled Node and pnpm runtime:

```bash
/Users/ipwaikei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
/Users/ipwaikei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin
```

Your normal Mac Terminal does not automatically use that runtime. That is why Terminal may show:

```bash
zsh: command not found: node
zsh: command not found: pnpm
```

## Option A: Normal Online Setup

Use this path for the clean long-term setup.

### 1. Install Node

If you have Homebrew:

```bash
brew install node
```

If Homebrew is missing, install it from:

```text
https://brew.sh
```

Or install Node directly from:

```text
https://nodejs.org
```

After installing Node, reopen Terminal and check:

```bash
node -v
```

MoldPilot expects Node 24+.

### 2. Enable pnpm

```bash
corepack enable
corepack prepare pnpm@11.5.3 --activate
pnpm --version
```

### 3. Open Docker Desktop

Open Docker Desktop and wait until it says Docker is running.

### 4. Run MoldPilot

```bash
cd /Users/ipwaikei/Documents/MoldPilot
./scripts/run-local-pilot.sh
```

Keep this terminal open.

When the script says the app is ready, open Chrome:

```text
http://localhost:3000
```

## Option B: Use Codex Runtime Temporarily

This avoids installing Node immediately, but it depends on Codex's local runtime cache still existing on your Mac.

Run:

```bash
export PATH="/Users/ipwaikei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export PATH="/Users/ipwaikei/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH"
```

Check:

```bash
node -v
pnpm --version
```

Then run:

```bash
cd /Users/ipwaikei/Documents/MoldPilot
./scripts/run-local-pilot.sh
```

This is useful as a temporary shortcut. Installing Node normally is better for long-term local development.

## Option C: Offline Setup

Offline setup has two phases:

1. Create the cache while online.
2. Use the cache later without internet.

Offline mode still requires Node 24+, pnpm, and Docker Desktop already installed on the Mac.

### Create Offline Cache While Online

Open Docker Desktop first if you also want to cache the PostgreSQL Docker image.

Then run:

```bash
cd /Users/ipwaikei/Documents/MoldPilot
pnpm offline:cache
```

This creates the cache **outside** the repo (an in-repo cache bloats the dev server's file watcher and can hang compiles):

```text
~/.moldpilot-offline
```

Override the location with the `MOLDPILOT_OFFLINE_DIR` environment variable (it must resolve outside the repo).

Migrating an existing setup: if you already have an in-repo `.moldpilot-offline/`, move it once with `mv .moldpilot-offline ~/.moldpilot-offline`.

The cache includes:

- pnpm package store archive
- `postgres:16` Docker image archive, if Docker Desktop was running

### Install From Offline Cache Later

Run:

```bash
cd /Users/ipwaikei/Documents/MoldPilot
pnpm offline:install
./scripts/run-local-pilot.sh
```

Then open:

```text
http://localhost:3000
```

If moving MoldPilot to another Mac, copy the `~/.moldpilot-offline` folder too (it lives in your home directory, outside the project), or set `MOLDPILOT_OFFLINE_DIR` to wherever you keep it.

## Useful Commands

Start the full local pilot:

```bash
./scripts/run-local-pilot.sh
```

Prepare database and seed only:

```bash
pnpm pilot:setup
```

Start app after setup:

```bash
pnpm dev
```

Check local readiness:

```bash
pnpm pilot:preflight
```

Verify database, seed, and app pages:

```bash
pnpm pilot:check
```

Stop the website:

```text
Control + C
```

## Troubleshooting

### `node: command not found`

Node is not installed or not on PATH.

Install Node, then reopen Terminal:

```bash
brew install node
node -v
```

### `pnpm: command not found`

pnpm is not enabled.

Run:

```bash
corepack enable
corepack prepare pnpm@11.5.3 --activate
pnpm --version
```

### Docker Is Not Running

Open Docker Desktop and wait until it finishes starting.

Then rerun:

```bash
./scripts/run-local-pilot.sh
```

### Chrome Cannot Open `localhost:3000`

Check that the terminal running MoldPilot is still open.

If not, restart:

```bash
cd /Users/ipwaikei/Documents/MoldPilot
./scripts/run-local-pilot.sh
```

### `node_modules/.bin/prisma was not found`

This can happen when pnpm's offline cache exists, but the project-level `node_modules` links were not created yet.

Run:

```bash
cd /Users/ipwaikei/Documents/MoldPilot
pnpm offline:install
./scripts/run-local-pilot.sh
```

The offline installer now checks for required binaries like Prisma and Next. If they are missing, it rebuilds the generated `node_modules` links from the offline cache (`~/.moldpilot-offline` by default, or `$MOLDPILOT_OFFLINE_DIR`).

### Port 3000 Is Already In Use

Another app may already be using port 3000.

Stop that app, or close the old MoldPilot terminal with:

```text
Control + C
```

Then rerun the local pilot script.
