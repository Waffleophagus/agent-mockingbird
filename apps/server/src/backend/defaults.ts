import type { SpecialistAgent } from "@agent-mockingbird/contracts/dashboard";

import type { AgentTypeDefinition } from "./config/schema";

export const DEFAULT_SKILLS: string[] = [
  "config-editor",
  "config-auditor",
  "runtime-diagnose",
];

export const DEFAULT_MCPS: string[] = [];

export const DEFAULT_AGENTS: SpecialistAgent[] = [];
export const DEFAULT_AGENT_TYPES: AgentTypeDefinition[] = [
  {
    id: "build",
    name: "Agent Mockingbird",
    description: "Default primary agent.",
    mode: "primary",
    hidden: false,
    disable: false,
    options: {},
  },
];

export const DEFAULT_SESSIONS = [
  {
    id: "main",
    title: "Main",
    model: "claude-sonnet-4.5",
  },
];
