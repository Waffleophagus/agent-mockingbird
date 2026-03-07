import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(rootDir, "..");

for (const relativePath of [
  "android/build/generated/autolinking",
  "android/app/build/generated/autolinking",
]) {
  rmSync(path.join(appDir, relativePath), { recursive: true, force: true });
}
