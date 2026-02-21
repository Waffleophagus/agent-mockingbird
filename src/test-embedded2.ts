import { file, embeddedFiles } from "bun";

import journalPath from "../drizzle/meta/_journal.json";

const journal = await file(new URL("../drizzle/meta/_journal.json", import.meta.url)).json();
console.log("Journal path:", journalPath);
console.log("Journal version:", journal.version);
console.log("Entries:", journal.entries.length);

console.log("\nEmbedded files:");
for (const [index, f] of embeddedFiles.entries()) {
  console.log(`  [${index}] ${f.type || "application/octet-stream"} (${f.size} bytes)`);
}
