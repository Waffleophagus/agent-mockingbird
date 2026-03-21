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
