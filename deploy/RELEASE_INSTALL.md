# Release + Install

Primary install channel is the private Gitea npm registry, using the compatibility wrapper package.

## Canonical first-run flow (Gitea npm + systemd user services)

Recommended first-run flow on Linux:

```bash
npx --yes --registry "https://git.waffleophagus.com/api/packages/waffleophagus/npm/" \
  --package "@waffleophagus/agent-mockingbird-installer@latest" \
  agent-mockingbird-installer install
```

This installs:

- `@waffleophagus/agent-mockingbird` from `https://git.waffleophagus.com/api/packages/waffleophagus/npm/`
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

Fallback bootstrap wrapper:

```bash
curl -fsSL "https://git.waffleophagus.com/waffleophagus/agent-mockingbird/raw/branch/main/scripts/onboard/bootstrap.sh" | bash
```

Feature branch preview install:

```bash
BRANCH="<branch-name>"
TAG="branch-<sanitized-branch-name>"
curl -fsSL "https://git.waffleophagus.com/waffleophagus/agent-mockingbird/raw/branch/${BRANCH}/scripts/onboard/bootstrap.sh" | AGENT_MOCKINGBIRD_TAG="${TAG}" bash
```

## Maintainer flow (build + publish)

1. Push a branch, push to `main`, or push a tag (for example `v0.1.0`).
2. CI builds the compiled distributable (`dist/agent-mockingbird` + `dist/app`) and publishes:
   - `@<scope>/agent-mockingbird`
   - `@<scope>/agent-mockingbird-installer`
   - branch preview pushes update dist-tags in the form `branch-<sanitized-branch-name>`
3. The published package is the source of truth for the end-user install flow above.

## Manual host install flow

Run as root on your target Linux host:

```bash
VERSION=v0.1.0
curl -LO "https://github.com/<owner>/<repo>/releases/download/${VERSION}/agent-mockingbird-${VERSION}.tar.gz"
curl -LO "https://github.com/<owner>/<repo>/releases/download/${VERSION}/agent-mockingbird-${VERSION}.tar.gz.sha256"
sha256sum -c "agent-mockingbird-${VERSION}.tar.gz.sha256"
tar -xzf "agent-mockingbird-${VERSION}.tar.gz"
cd "agent-mockingbird-${VERSION}"
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
