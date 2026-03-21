import { getResolvedDbPath } from "./client";
import { resetDatabaseToDefaults } from "./repository";

const bootstrap = resetDatabaseToDefaults();

console.log("Database reset complete.");
console.log(`Target database: ${getResolvedDbPath()}`);
console.log(
  `Sessions: ${bootstrap.sessions.map(session => `${session.id} (${session.title})`).join(", ") || "none"}`,
);
console.log(`Skills: ${bootstrap.skills.length}`);
console.log(`MCP servers: ${bootstrap.mcps.length}`);
console.log(`Agents: ${bootstrap.agents.length}`);
