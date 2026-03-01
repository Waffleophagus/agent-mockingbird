# Release + Install

This project ships as a tarball from GitHub Releases.

## Private onboarding flow (Gitea npm + systemd user services)

Recommended first-run flow on Linux:

```bash
curl -fsSL "https://git.waffleophagus.com/waffleophagus/wafflebot/raw/branch/main/scripts/onboard/bootstrap.sh" | bash
```

This installs:

- `@waffleophagus/wafflebot` from `https://git.waffleophagus.com/api/packages/waffleophagus/npm/`
- `opencode-ai` from npmjs
- user services (`opencode.service`, `wafflebot.service`) in `~/.config/systemd/user`

Install root defaults to `~/.wafflebot`.

After install, operational commands are available through `wafflebot`:

```bash
wafflebot status
wafflebot restart
wafflebot update
```

## Maintainer flow (build + publish)

1. Push a tag (for example `v0.1.0`) or run the `Release Bundle` workflow manually.
2. GitHub Actions will produce and publish:
   - `wafflebot-<version>.tar.gz`
   - `wafflebot-<version>.tar.gz.sha256`

## Host install flow

Run as root on your target Linux host:

```bash
VERSION=v0.1.0
curl -LO "https://github.com/<owner>/<repo>/releases/download/${VERSION}/wafflebot-${VERSION}.tar.gz"
curl -LO "https://github.com/<owner>/<repo>/releases/download/${VERSION}/wafflebot-${VERSION}.tar.gz.sha256"
sha256sum -c "wafflebot-${VERSION}.tar.gz.sha256"
tar -xzf "wafflebot-${VERSION}.tar.gz"
cd "wafflebot-${VERSION}"
sudo bash scripts/install-systemd.sh
```

Optional install overrides:

```bash
sudo WAFFLEBOT_USER=wafflebot \
  WAFFLEBOT_GROUP=wafflebot \
  WAFFLEBOT_APP_DIR=/srv/wafflebot/app \
  WAFFLEBOT_DATA_DIR=/var/lib/wafflebot \
  bash scripts/install-systemd.sh
```

Prerequisites on host:

- `bun` in `PATH`
- `opencode` in `PATH`
- `systemd`

After install, verify:

```bash
systemctl status opencode.service --no-pager
systemctl status wafflebot.service --no-pager
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
wafflebot
```
