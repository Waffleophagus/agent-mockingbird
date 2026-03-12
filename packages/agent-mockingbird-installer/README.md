# @waffleophagus/agent-mockingbird-installer

Compatibility wrapper for `@waffleophagus/agent-mockingbird`.

Canonical usage:

```bash
npx --yes --registry "https://git.waffleophagus.com/api/packages/waffleophagus/npm/" \
  --package "@waffleophagus/agent-mockingbird-installer@latest" \
  agent-mockingbird-installer install
```

It forwards all arguments to:

```bash
npm exec --yes --package @waffleophagus/agent-mockingbird@latest agent-mockingbird -- <args>
```

with a temporary scoped npmrc so public deps resolve from npmjs and `@waffleophagus/*` resolves from your Gitea registry.

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
