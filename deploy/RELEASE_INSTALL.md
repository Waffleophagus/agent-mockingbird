# Release + Install

This project ships as a tarball from GitHub Releases.

## Private onboarding flow (Gitea npm + systemd user services)

Recommended first-run flow on Linux:

```bash
curl -fsSL "https://git.waffleophagus.com/waffleophagus/agent-mockingbird/raw/branch/main/scripts/onboard/bootstrap.sh" | bash
```

This installs:

- `@waffleophagus/agent-mockingbird` from `https://git.waffleophagus.com/api/packages/waffleophagus/npm/`
- `opencode-ai` from npmjs
- user services (`opencode.service`, `agent-mockingbird.service`) in `~/.config/systemd/user`

Install root defaults to `~/.agent-mockingbird`.

After install, operational commands are available through `agent-mockingbird`:

```bash
agent-mockingbird status
agent-mockingbird restart
agent-mockingbird update
```

## Maintainer flow (build + publish)

1. Push a tag (for example `v0.1.0`) or run the `Release Bundle` workflow manually.
2. GitHub Actions will produce and publish:
   - `agent-mockingbird-<version>.tar.gz`
   - `agent-mockingbird-<version>.tar.gz.sha256`

## Host install flow

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
