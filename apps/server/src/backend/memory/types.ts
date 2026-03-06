export type MemoryRecordSource = "user" | "assistant" | "system";
export type MemoryToolMode = "hybrid" | "inject_only" | "tool_only";

export interface MemoryRecordInput {
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
  vectorBackendConfigured: string;
  vectorBackendActive: string;
  vectorAvailable: boolean;
  vectorDims: number | null;
  vectorIndexedChunks: number;
  vectorLastError: string | null;
  files: number;
  chunks: number;
  records: number;
  cacheEntries: number;
  indexedAt: string | null;
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
  validation: MemoryWriteValidation;
  record?: MemoryRecord;
  path?: string;
}

export interface MemoryWriteEvent {
  id: string;
  status: "accepted" | "rejected";
  reason: string;
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
    content: string;
    count: number;
    recordIds: string[];
  }>;
  danglingSupersedes: Array<{
    recordId: string;
    missingSupersedes: string[];
  }>;
}
