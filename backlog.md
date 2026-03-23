# Backlog

- [ ] Add Fuse.js-powered fuzzy search for session/thread discovery in the UI.
- [ ] Add a SQLite FTS index for fast thread/content search.
- [ ] Add self-healing for OpenCode "Session not found" errors (detect stale/deleted remote sessions, recreate/rebind automatically, and retry once).
- [ ] Delete the stale unsupported [deploy/docker-compose.yml](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/deploy/docker-compose.yml) deployment path after the executor integration plan lands.
- [ ] Revisit the repo-local deployment/test path so local checkout installs can refresh vendored OpenCode/executor worktrees predictably without diverging from the npm-installed path.
- [ ] Consolidate config authority around OpenCode managed config. Phase 1: remove Agent Mockingbird MCP config duplication (`ui.mcps`, `ui.mcpServers`) and keep OpenCode `mcp` as the only MCP source of truth. Follow-up: audit agent definition duplication (`ui.agents`, `ui.agentTypes`) and skill state duplication (`ui.skills`).
