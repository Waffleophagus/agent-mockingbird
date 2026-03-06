# Systemd Deployment (Sidecar Model)

This setup runs **two services on one VM**:

- `opencode.service` (local sidecar on `127.0.0.1:4096`)
- `agent-mockingbird.service` (dashboard/API on `127.0.0.1:3001`)

Both are pinned to one project workspace (`/srv/agent-mockingbird/app`).

## 1. Install units

```bash
sudo install -D -m 0644 deploy/systemd/opencode.service /etc/systemd/system/opencode.service
sudo install -D -m 0644 deploy/systemd/agent-mockingbird.service /etc/systemd/system/agent-mockingbird.service
sudo systemctl daemon-reload
```

## 2. Enable + start

```bash
sudo systemctl enable --now opencode.service agent-mockingbird.service
```

## 3. Verify

```bash
systemctl status opencode.service --no-pager
systemctl status agent-mockingbird.service --no-pager
curl -sS http://127.0.0.1:3001/api/health
curl -sS http://127.0.0.1:3001/api/runtime/info
```

## 4. Logs

```bash
journalctl -u opencode.service -f
journalctl -u agent-mockingbird.service -f
```

## Notes

- OpenCode runtime settings (`baseUrl`, `directory`, model/provider/timeouts) now come from agent-mockingbird config JSON (`runtime.opencode.*`), not runtime env vars.
- Set `AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR` in `agent-mockingbird.service` to the same project path used by `opencode.service` `WorkingDirectory`.
- If migrating older env-based settings, run `bun run config:migrate-opencode-env` once before service start.
- Agent edits from Agent Mockingbird persist to project-local OpenCode config (typically `.opencode/opencode.jsonc` under that directory).
- If OpenCode TUI/web appears different, launch/attach it with the same workspace directory.
