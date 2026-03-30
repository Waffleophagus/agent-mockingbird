# @waffleophagus/agent-mockingbird-installer

Compatibility wrapper for `agent-mockingbird`.

Canonical usage:

```bash
npx --yes \
  --package "@waffleophagus/agent-mockingbird-installer@latest" \
  agent-mockingbird-installer install
```

It forwards all arguments to:

```bash
npm exec --yes --package agent-mockingbird@latest agent-mockingbird -- <args>
```

By default it installs from npmjs. If you need a different registry for the `@waffleophagus` scope, set `AGENT_MOCKINGBIRD_REGISTRY_URL`.

Primary CLI is now:

```bash
agent-mockingbird install
agent-mockingbird update
agent-mockingbird status
agent-mockingbird restart
agent-mockingbird start
agent-mockingbird stop
agent-mockingbird uninstall
```

If a prior install was removed while keeping `~/.agent-mockingbird/data`, and a reinstall fails mid-flight, the immediate recovery path is:

```bash
rm -f ~/.agent-mockingbird/data/opencode-config/bun.lock
rm -rf ~/.agent-mockingbird/data/opencode-config/node_modules
rm -rf ~/.agent-mockingbird/data/opencode-config/.bun
agent-mockingbird install
agent-mockingbird status
```
