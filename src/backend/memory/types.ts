export type MemoryRecordType = "decision" | "preference" | "fact" | "todo" | "observation";

export type MemoryRecordSource = "user" | "assistant" | "system";
export type MemoryToolMode = "hybrid" | "inject_only" | "tool_only";
export type MemoryWritePolicy = "conservative" | "moderate" | "aggressive";

export interface MemoryRecordInput {
  type: MemoryRecordType;
  source: MemoryRecordSource;
  content: string;
  entities?: string[];
  confidence?: number;
  supersedes?: string[];
}

export interface MemoryRecord extends MemoryRecordInput {
  id: string;
  recordedAt: string;
}

export interface MemoryRememberInput extends MemoryRecordInput {
  sessionId?: string;
  topic?: string;
  ttl?: number;
}

export interface MemoryChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

export interface MemorySearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: "memory";
  score: number;
  snippet: string;
  citation: string;
}

export interface MemoryStatus {
  enabled: boolean;
  workspaceDir: string;
  provider: string;
  model: string;
  toolMode: MemoryToolMode;
  writePolicy: MemoryWritePolicy;
  minConfidence: number;
  files: number;
  chunks: number;
  records: number;
  cacheEntries: number;
  indexedAt: string | null;
}

export interface MemoryPolicyInfo {
  mode: MemoryToolMode;
  writePolicy: MemoryWritePolicy;
  minConfidence: number;
  allowedTypes: MemoryRecordType[];
  disallowedTypes: MemoryRecordType[];
  guidance: string[];
}

export interface MemoryWriteValidation {
  accepted: boolean;
  reason: string;
  normalizedContent: string;
  normalizedConfidence: number;
  duplicateRecordId?: string;
}

export interface MemoryRememberResult {
  accepted: boolean;
  reason: string;
  policy: MemoryWritePolicy;
  validation: MemoryWriteValidation;
  record?: MemoryRecord;
  path?: string;
}

export interface MemoryWriteEvent {
  id: string;
  status: "accepted" | "rejected";
  reason: string;
  type: MemoryRecordType;
  source: MemoryRecordSource;
  content: string;
  confidence: number;
  sessionId: string | null;
  topic: string | null;
  recordId: string | null;
  path: string | null;
  createdAt: string;
}

export interface MemoryLintReport {
  ok: boolean;
  totalRecords: number;
  duplicateActiveRecords: Array<{
    type: MemoryRecordType;
    content: string;
    count: number;
    recordIds: string[];
  }>;
  danglingSupersedes: Array<{
    recordId: string;
    missingSupersedes: string[];
  }>;
}
