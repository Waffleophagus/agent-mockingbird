# Embedded Service Contract

Embedded services in Mockingbird are mounted under a same-origin prefix and registered through the embedded-service gateway.

## Requirements

- Embedded mode must be mount-aware.
- UI asset URLs, router basenames, and browser API calls must honor the configured mount path.
- Third-party browser calls must go through Mockingbird's same-origin external proxy when the target origin is allowlisted.

## Packaging Rule

- `embedded-patched` is the default shipped mode.
- If upstream cannot satisfy the embedded contract, patch and vendor the service build.
- `upstream-fallback` is only for explicit fallback/debugging. It is not the primary shipped path.

## Registration

- Add the service to `runtime.embeddedServices`.
- Define its mount path, upstream base URL, healthcheck path, and mode.
- Add any third-party browser-call allowlist entries in the gateway definition.

## Executor

- Executor is mounted at `/executor`.
- The shipped embedded path uses the vendored patched build.
- Browser requests for npm dist-tags go through `/api/embed/external/executor/npm-registry/-/package/executor/dist-tags` in embedded mode.
