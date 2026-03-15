import { buildWorkspaceBootstrapPromptContext } from "../agents/bootstrapContext";
import { getConfigSnapshot } from "../config/service";
import {
  getLocalSessionIdByRuntimeBinding,
  listMessagesForSession,
} from "../db/repository";
import { env } from "../env";

const OPENCODE_RUNTIME_ID = "opencode";
const MAX_COMPACTION_RECENT_MESSAGES = 6;
const MAX_COMPACTION_RECENT_MESSAGE_CHARS = 220;
const MAX_COMPACTION_IDENTIFIERS = 10;
const MAX_COMPACTION_PATHS = 8;

function trimCompactionLine(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_COMPACTION_RECENT_MESSAGE_CHARS) return compact;
  return `${compact.slice(0, MAX_COMPACTION_RECENT_MESSAGE_CHARS - 3).trimEnd()}...`;
}

function collectRecentTranscriptLines(externalSessionId?: string) {
  const sessionId = externalSessionId?.trim()
    ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId)
    : null;
  if (!sessionId) return [];
  const messages = listMessagesForSession(sessionId);
  return messages
    .slice(-MAX_COMPACTION_RECENT_MESSAGES)
    .map(message => {
      const content = trimCompactionLine(message.content);
      if (!content) return null;
      const role = message.role === "user" ? "User" : "Assistant";
      return `- ${role}: ${content}`;
    })
    .filter((line): line is string => Boolean(line));
}

function collectLatestUserAsk(externalSessionId?: string) {
  const sessionId = externalSessionId?.trim()
    ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId)
    : null;
  if (!sessionId) return null;
  const messages = listMessagesForSession(sessionId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const content = trimCompactionLine(message.content);
    if (content) return content;
  }
  return null;
}

function collectOpaqueIdentifiers(externalSessionId?: string) {
  const sessionId = externalSessionId?.trim()
    ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId)
    : null;
  if (!sessionId) return [];
  const messages = listMessagesForSession(sessionId);
  const haystack = messages.slice(-10).map(message => message.content).join("\n");
  const matches =
    haystack.match(
      /([A-Fa-f0-9]{8,}|https?:\/\/\S+|\/[\w./-]{2,}|[A-Za-z]:\\[\w\\./-]+|\b\d{4}-\d{2}-\d{2}\b|\b\d{6,}\b|localhost:\d{2,5}|\b\d{2,5}\b)/g,
    ) ?? [];
  return [...new Set(matches.map(match => match.replace(/[),.;]+$/g, "").trim()).filter(Boolean))].slice(
    0,
    MAX_COMPACTION_IDENTIFIERS,
  );
}

function collectMentionedPaths(externalSessionId?: string) {
  const sessionId = externalSessionId?.trim()
    ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId)
    : null;
  if (!sessionId) return [];
  const messages = listMessagesForSession(sessionId);
  const haystack = messages.slice(-12).map(message => message.content).join("\n");
  const matches =
    haystack.match(
      /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b|\b[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|md|sql|mjs|cjs|css|html)\b/g,
    ) ?? [];
  return [...new Set(matches.map(match => match.replace(/[),.;]+$/g, "").trim()).filter(Boolean))].slice(
    0,
    MAX_COMPACTION_PATHS,
  );
}

function buildSessionAwareCompactionContext(externalSessionId?: string) {
  const latestAsk = collectLatestUserAsk(externalSessionId);
  const identifiers = collectOpaqueIdentifiers(externalSessionId);
  const paths = collectMentionedPaths(externalSessionId);
  const recentTranscript = collectRecentTranscriptLines(externalSessionId);
  const sections: string[] = [];

  if (latestAsk || identifiers.length > 0 || paths.length > 0) {
    const lines = [
      "Transcript continuity requirements:",
      "- Preserve the latest unresolved user ask and any unfinished work, approvals, or blockers.",
      "- Preserve exact literal identifiers when they matter for continuation: file paths, URLs, ports, dates, hashes, IDs.",
    ];
    if (latestAsk) {
      lines.push(`- Latest user ask to carry forward: ${latestAsk}`);
    }
    if (identifiers.length > 0) {
      lines.push(`- Exact identifiers seen recently: ${identifiers.join(", ")}`);
    }
    if (paths.length > 0) {
      lines.push(`- Files and paths explicitly mentioned: ${paths.join(", ")}`);
    }
    sections.push(lines.join("\n"));
  }

  if (recentTranscript.length > 0) {
    sections.push(
      [
        "Recent turns to preserve verbatim when useful:",
        ...recentTranscript,
      ].join("\n"),
    );
  }

  return sections;
}

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

export function buildAgentMockingbirdCompactionContext(externalSessionId?: string) {
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

  sections.push(...buildSessionAwareCompactionContext(externalSessionId));

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
