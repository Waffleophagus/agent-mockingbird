# @waffleophagus/wafflebot-installer

Compatibility wrapper for `@waffleophagus/wafflebot`.

It forwards all arguments to:

```bash
npm exec --yes @waffleophagus/wafflebot@latest -- <args>
```

with a temporary scoped npmrc so public deps resolve from npmjs and `@waffleophagus/*` resolves from your Gitea registry.

Primary CLI is now:

```bash
wafflebot install
wafflebot update
wafflebot status
wafflebot restart
wafflebot start
wafflebot stop
wafflebot uninstall
```
