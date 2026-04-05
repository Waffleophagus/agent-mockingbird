#!/usr/bin/env bun

await Bun.$`bun run ./build.ts`.cwd(import.meta.dir);
