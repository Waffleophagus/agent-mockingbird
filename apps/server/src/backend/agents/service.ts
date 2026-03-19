import {
  agentTypeToLegacySpecialist,
} from "@agent-mockingbird/contracts/agentTypes";
import type { SpecialistAgent } from "@agent-mockingbird/contracts/dashboard";

import type { AgentTypeDefinition } from "../config/schema";

export function toLegacySpecialistAgent(agentType: AgentTypeDefinition): SpecialistAgent {
  return agentTypeToLegacySpecialist(agentType) as SpecialistAgent;
}
