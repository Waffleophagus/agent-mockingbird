import { buildWorkspaceBootstrapPromptContext } from "../agents/bootstrapContext";
import { getConfigSnapshot } from "../config/service";
import { env } from "../env";

function currentMemoryConfig() {
  return getConfigSnapshot().config.runtime.memory;
}

function buildConfigPolicyLines() {
  return [
    "Config policy:",
    "- Use config_manager for runtime configuration changes.",
    "- Use agent_type_manager for dedicated agent type CRUD operations.",
    "- Prefer patch_config with expectedHash from get_config to avoid conflicts.",
    "- Safe config writes enforce policy checks and may reject protected paths.",
    "- Keep runSmokeTest enabled unless explicitly instructed otherwise.",
  ];
}

function buildInteractionPolicyLines() {
  return [
    "Interaction policy:",
    "- If the user asks for an interactive multiple-choice question, use the question UI/tool instead of plain text.",
    "- Keep option labels short and descriptions concise.",
  ];
}

function buildMemoryPolicyLines() {
  return [
    "Memory policy:",
    "- Use memory_search when a request likely depends on prior durable context.",
    "- Prefer one search call first; then use memory_get only for the top 1-2 cited records before relying on details.",
    "- For people/relationships, use concrete terms (for example: daughter, spouse, partner, child, parent, names) instead of only generic words.",
    "- For broad domains (for example: portfolio), run one adjacent-term refinement (for example: metals, silver, bonds, allocation) if the first search misses.",
    "- Skip memory tool calls for clearly self-contained tasks.",
    "- If the first memory_search misses, do one refined query with entity/relationship terms before concluding no memory exists.",
    "- Use memory_remember when new context could be useful later.",
    "- Prefer supersedes when replacing older memory records.",
  ];
}

function buildCronPolicyLines() {
  return [
    "Cron policy:",
    "- Use cron_manager for recurring automation and background checks.",
    "- Prefer deterministic jobs when possible; only invoke the model when useful.",
    "- Review existing jobs before creating new ones to avoid duplicates.",
  ];
}

export function buildAgentMockingbirdSystemPrompt() {
  const memoryConfig = currentMemoryConfig();
  const config = getConfigSnapshot().config;
  const workspaceContext = buildWorkspaceBootstrapPromptContext({
    config,
  });
  const lines: string[] = [];

  lines.push(...buildConfigPolicyLines());

  lines.push("");
  lines.push(...buildInteractionPolicyLines());

  if (memoryConfig.enabled && memoryConfig.toolMode !== "inject_only") {
    lines.push("", ...buildMemoryPolicyLines());
  }

  if (env.AGENT_MOCKINGBIRD_CRON_ENABLED) {
    lines.push("", ...buildCronPolicyLines());
  }

  if (workspaceContext.section) {
    lines.push("", workspaceContext.section);
  }

  return lines.length ? lines.join("\n") : undefined;
}

export function buildAgentMockingbirdCompactionContext() {
  const memoryConfig = currentMemoryConfig();
  const workspaceContext = buildWorkspaceBootstrapPromptContext({
    config: getConfigSnapshot().config,
  });
  const sections: string[] = [];

  sections.push(
    [
      "Agent Mockingbird continuation notes:",
      "- Mention any config changes made through config_manager or agent_type_manager and whether they were applied successfully.",
      "- Mention any pending approvals or interactive questions that still block progress.",
      "- Mention any cron jobs or automation changes that were created, updated, or investigated if they affect next steps.",
    ].join("\n"),
  );

  if (memoryConfig.enabled && memoryConfig.toolMode !== "inject_only") {
    sections.push(
      [
        "Memory follow-through:",
        "- Include any retrieved memory records that materially changed the approach.",
        "- Include any new facts that should probably be persisted with memory_remember if they were not saved yet.",
      ].join("\n"),
    );
  }

  if (workspaceContext.section) {
    sections.push(
      [
        "Workspace bootstrap context:",
        workspaceContext.section,
      ].join("\n"),
    );
  }

  return sections;
}
