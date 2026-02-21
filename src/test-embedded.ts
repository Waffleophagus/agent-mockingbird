import { embeddedFiles } from "bun";

console.log("Embedded files:");
for (const [index, file] of embeddedFiles.entries()) {
  console.log(`  [${index}] ${file.type || "application/octet-stream"} (${file.size} bytes)`);
}
