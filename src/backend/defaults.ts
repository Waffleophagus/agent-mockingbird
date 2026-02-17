import type { SpecialistAgent } from "../types/dashboard";

export const DEFAULT_SKILLS: string[] = [];

export const DEFAULT_MCPS: string[] = [];

export const DEFAULT_AGENTS: SpecialistAgent[] = [];

export const DEFAULT_SESSIONS = [
  {
    id: "main",
    title: "Main",
    model: "claude-sonnet-4.5",
  },
];
