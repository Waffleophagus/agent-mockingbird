# @waffleophagus/wafflebot-installer

Compatibility wrapper for `@waffleophagus/wafflebot`.

It forwards all arguments to:

```bash
npm exec --yes --registry <your-registry> @waffleophagus/wafflebot@latest -- <args>
```

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
