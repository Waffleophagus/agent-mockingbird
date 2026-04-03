# Systemd Deployment

This setup runs **two services on one VM**:

- `executor.service` (local sidecar on `127.0.0.1:8788`)
- `agent-mockingbird.service` (dashboard/API plus embedded OpenCode runtime on `127.0.0.1:3001`)

Both are pinned to one project workspace (`/srv/agent-mockingbird/app`).

## 1. Install units

```bash
sudo install -D -m 0644 deploy/systemd/executor.service /etc/systemd/system/executor.service
sudo install -D -m 0644 deploy/systemd/agent-mockingbird.service /etc/systemd/system/agent-mockingbird.service
sudo systemctl daemon-reload
```

## 2. Enable + start

```bash
sudo systemctl enable --now executor.service agent-mockingbird.service
```

## 3. Verify

```bash
systemctl status executor.service --no-pager
systemctl status agent-mockingbird.service --no-pager
curl -sS http://127.0.0.1:3001/api/health
curl -sS http://127.0.0.1:3001/api/mockingbird/runtime/info
```

## 4. Logs

```bash
journalctl -u executor.service -f
journalctl -u agent-mockingbird.service -f
```

## Notes

- OpenCode runtime settings (`baseUrl`, `directory`, model/provider/timeouts) now come from agent-mockingbird config JSON (`runtime.opencode.*`), not runtime env vars.
- `agent-mockingbird.service` now hosts the embedded OpenCode server directly. By default the runtime targets the same app service URL derived from `PORT` (`http://127.0.0.1:3001` unless overridden).
- Only set `AGENT_MOCKINGBIRD_OPENCODE_BASE_URL` when you intentionally want the backend to call a different OpenCode endpoint.
- Set `AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR` in `agent-mockingbird.service` to the same project workspace path used by the embedded OpenCode runtime.
- If migrating older env-based settings, run `bun run config:migrate-opencode-env` once before service start.
- Agent edits from Agent Mockingbird persist to the managed OpenCode config dir pointed to by `OPENCODE_CONFIG_DIR`, not to project-local `.opencode`.
- If OpenCode TUI/web appears different, launch/attach it with the same workspace directory.
