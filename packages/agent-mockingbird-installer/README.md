# @waffleophagus/agent-mockingbird-installer

Compatibility wrapper for `@waffleophagus/agent-mockingbird`.

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
