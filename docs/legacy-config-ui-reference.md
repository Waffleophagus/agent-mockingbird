# Legacy Config UI Reference (Add-Back TODO)

Status: keep this while we clone/adapt Opencode UI; use it to reintroduce non-chat functionality.

## Goal
Re-add legacy Agent Mockingbird functionality on top of the Opencode-like React UI after the base shell is stable.

## Add Back: Skills
- Skills list (view/search/sort as needed).
- Create/edit/delete skill flows.
- Prompt/content editor with validation.
- Enable/disable state and persistence.

## Add Back: MCP
- MCP server list + status indicators.
- Add/edit/remove MCP server configs.
- Env/header/transport configuration fields.
- Connect/disconnect/test actions.

## Add Back: Agents
- Agent list and selection UX.
- Create/edit/duplicate/delete flows.
- Model, system prompt, and tool-permission settings.
- Persistence + refresh behavior.

## Add Back: Other Settings
- Runtime/provider/config toggles from legacy UI.
- Non-chat operational settings.
- Save/validation/error feedback patterns.

## Add Back: Cron
- Cron job list and schedule editor.
- Enable/disable/delete controls.
- Run-now action + last run/error status.

## Shared UX/Behavior Requirements
- Unsaved changes detection + confirm dialog.
- Consistent toasts for success/error.
- Loading/empty/error states on each screen.
- Safe data updates (optimistic only where low risk).

## Suggested Reintroduction Order
1. Skills
2. Agents
3. MCP
4. Other Settings
5. Cron

## Notes
- Non-production app: breaking changes are acceptable.
- Favor fresh implementations against current APIs/data shapes.
