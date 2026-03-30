import { currentMemoryConfig, logger } from "./shared";
import { getConfigSnapshot } from "../../config/service";
import { listMemoryWriteEvents, rememberMemory } from "../../memory/service";

export type CompactionMemoryCandidateConfidence = "high" | "medium" | "low";

export interface CompactionMemoryCandidate {
  content: string;
  confidence: CompactionMemoryCandidateConfidence;
  entities: string[];
  topic?: string;
}

export interface PersistCompactionMemoryCandidatesResult {
  parsedCount: number;
  attemptedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  skippedCount: number;
}

const MEMORY_CANDIDATES_HEADING = "## Memory candidates";
const RECENT_MEMORY_WRITE_WINDOW = 100;

function normalizeCandidateContent(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function confidenceToScore(value: CompactionMemoryCandidateConfidence) {
  switch (value) {
    case "high":
      return 0.9;
    case "low":
      return 0.5;
    default:
      return 0.7;
  }
}

function parseCandidateLine(line: string): CompactionMemoryCandidate | null {
  const raw = line.trim();
  if (!raw.startsWith("- ")) return null;
  const fields = raw
    .slice(2)
    .split("|")
    .map(field => field.trim())
    .filter(Boolean);
  if (fields.length === 0) return null;

  const values = new Map<string, string>();
  for (const field of fields) {
    const separator = field.indexOf(":");
    if (separator === -1) continue;
    const key = field.slice(0, separator).trim().toLowerCase();
    const value = field.slice(separator + 1).trim();
    if (!key || !value) continue;
    values.set(key, value);
  }

  const content = values.get("content")?.replace(/\s+/g, " ").trim() ?? "";
  if (!content) return null;
  const confidenceValue = values.get("confidence")?.toLowerCase();
  const confidence: CompactionMemoryCandidateConfidence =
    confidenceValue === "high" || confidenceValue === "low" || confidenceValue === "medium"
      ? confidenceValue
      : "medium";
  const entities = [
    ...new Set(
      (values.get("entities") ?? "")
        .split(",")
        .map(entity => entity.trim())
        .filter(Boolean),
    ),
  ];
  const topic = values.get("topic")?.trim() || undefined;

  return {
    content,
    confidence,
    entities,
    topic,
  };
}

export function parseCompactionMemoryCandidates(summary: string): CompactionMemoryCandidate[] {
  const lines = summary.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex(line => line.trim() === MEMORY_CANDIDATES_HEADING);
  if (startIndex === -1) return [];
  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("## ")) break;
    sectionLines.push(line);
  }
  const normalizedSection = sectionLines.join("\n").trim();
  if (!normalizedSection || normalizedSection.toLowerCase() === "none") {
    return [];
  }

  return sectionLines
    .map(parseCandidateLine)
    .filter((candidate): candidate is CompactionMemoryCandidate => Boolean(candidate));
}

export async function persistCompactionMemoryCandidates(input: {
  summary: string;
  sessionId: string;
}): Promise<PersistCompactionMemoryCandidatesResult> {
  const candidates = parseCompactionMemoryCandidates(input.summary);
  const runtimeConfig = getConfigSnapshot().config.runtime.opencode.compaction;
  if (!currentMemoryConfig().enabled || runtimeConfig.memoryAutoPersist !== true) {
    return {
      parsedCount: candidates.length,
      attemptedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      skippedCount: candidates.length,
    };
  }

  const recentWrites = await listMemoryWriteEvents(RECENT_MEMORY_WRITE_WINDOW);
  const recentContent = new Set(
    recentWrites
      .filter(event => event.sessionId === input.sessionId)
      .map(event => normalizeCandidateContent(event.content)),
  );
  const seen = new Set<string>();
  let attemptedCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    const normalizedContent = normalizeCandidateContent(candidate.content);
    if (!normalizedContent || seen.has(normalizedContent) || recentContent.has(normalizedContent)) {
      skippedCount += 1;
      continue;
    }
    seen.add(normalizedContent);
    attemptedCount += 1;
    try {
      const result = await rememberMemory({
        source: "compaction",
        content: candidate.content,
        entities: candidate.entities,
        confidence: confidenceToScore(candidate.confidence),
        sessionId: input.sessionId,
        topic: candidate.topic,
      });
      if (result.accepted) {
        acceptedCount += 1;
      } else {
        rejectedCount += 1;
      }
    } catch (error) {
      rejectedCount += 1;
      logger.warnWithCause("Failed to persist compaction memory candidate", error, {
        sessionId: input.sessionId,
        content: candidate.content,
      });
    }
  }

  return {
    parsedCount: candidates.length,
    attemptedCount,
    acceptedCount,
    rejectedCount,
    skippedCount,
  };
}
