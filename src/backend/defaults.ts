import type { SpecialistAgent } from "../types/dashboard";
import type { AgentTypeDefinition } from "./config/schema";

export const DEFAULT_SKILLS: string[] = [
  "config-editor",
  "config-auditor",
  "runtime-diagnose",
];

export const DEFAULT_MCPS: string[] = [];

export const DEFAULT_AGENTS: SpecialistAgent[] = [];
export const DEFAULT_AGENT_TYPES: AgentTypeDefinition[] = [];

export const DEFAULT_SESSIONS = [
  {
    id: "main",
    title: "Main",
    model: "claude-sonnet-4.5",
  },
];
