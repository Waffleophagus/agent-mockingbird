# Backlog

- [ ] Add Fuse.js-powered fuzzy search for session/thread discovery in the UI.
- [ ] Add a SQLite FTS index for fast thread/content search.
- [ ] Add self-healing for OpenCode "Session not found" errors (detect stale/deleted remote sessions, recreate/rebind automatically, and retry once).
- [ ] Delete the stale unsupported [deploy/docker-compose.yml](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/deploy/docker-compose.yml) deployment path after the executor integration plan lands.
- [ ] Revisit the repo-local deployment/test path so local checkout installs can refresh vendored OpenCode/executor worktrees predictably without diverging from the npm-installed path.
