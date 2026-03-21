# Release + Install

This project is published to npm and source-hosted on GitHub.

## User onboarding flow (npm + systemd user services)

Recommended first-run flow on Linux:

```bash
npm i -g agent-mockingbird
agent-mockingbird install
```

That is the main public install path. `agent-mockingbird install` handles service setup and launches interactive onboarding on TTY installs.

Optional curl bootstrap wrapper:

```bash
curl -fsSL "https://raw.githubusercontent.com/waffleophagus/agent-mockingbird/main/scripts/onboard/bootstrap.sh" | bash
```

This installs:

- `agent-mockingbird` from npmjs
- `opencode-ai` from npmjs
- user services (`opencode.service`, `agent-mockingbird.service`) in `~/.config/systemd/user`
- automatic service start and health verification
- interactive onboarding on TTY installs (`provider auth`, default model, memory/Ollama, optional OpenClaw import)

Install root defaults to `~/.agent-mockingbird`.

After install, operational commands are available through `agent-mockingbird`:

```bash
agent-mockingbird status
agent-mockingbird restart
agent-mockingbird update
```

Feature branch preview install:

```bash
VERSION="<published-preview-version>"
npm i -g "agent-mockingbird@${VERSION}"
agent-mockingbird install
```

## Maintainer flow (build + publish)

1. Configure npm trusted publishing for:
   - `agent-mockingbird`
2. Point the trusted publisher entry at `waffleophagus/agent-mockingbird` and workflow file `ci.yml`.
3. Push a tag like `v0.1.0` from `main` to publish the package to npm tag `latest`.
4. Push a non-`main` branch to publish a preview build to npm tag `next`.
5. Plain pushes to `main` run checks only; they do not publish.

For branch previews, pin `AGENT_MOCKINGBIRD_TAG` to the exact published `next` version so the bootstrap script and package version match.

Repository build policy:

- `dist/app` is treated as a committed artifact generated locally before commit.
- The repo `pre-commit` hook runs lint, typecheck, `build`, and `build:bin`, then stages `dist/app`.
- CI no longer rebuilds the OpenCode web bundle from vendored dependencies; it verifies the committed `dist/app` bundle and rebuilds only the standalone runtime binary.

## Manual host install flow

Clone a tagged revision on your target Linux host, then run the bundled install script:

```bash
git clone https://github.com/waffleophagus/agent-mockingbird.git
cd agent-mockingbird
git checkout v0.1.0
sudo bash scripts/install-systemd.sh
```

Optional install overrides:

```bash
sudo AGENT_MOCKINGBIRD_USER=agent-mockingbird \
  AGENT_MOCKINGBIRD_GROUP=agent-mockingbird \
  AGENT_MOCKINGBIRD_APP_DIR=/srv/agent-mockingbird/app \
  AGENT_MOCKINGBIRD_DATA_DIR=/var/lib/agent-mockingbird \
  bash scripts/install-systemd.sh
```

Prerequisites on host:

- `bun` in `PATH`
- `opencode` in `PATH`
- `systemd`

After install, verify:

```bash
systemctl status opencode.service --no-pager
systemctl status agent-mockingbird.service --no-pager
curl -sS http://127.0.0.1:3001/api/health
```

For tailnet access, expose the local service with:

```bash
tailscale serve --bg 3001
```

## Install via Git URL (Bun global)

No package registry is required. Install directly from the git tag:

```bash
OWNER="<github-owner>"
REPO="<repo-name>"
VERSION="v0.1.0"
bun add -g "github:${OWNER}/${REPO}#${VERSION}"
agent-mockingbird
```
