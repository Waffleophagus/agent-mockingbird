type SignalTarget = { type: "recipient"; recipient: string } | { type: "group"; groupId: string };

export function normalizeSignalId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("uuid:")) {
    return `uuid:${trimmed.slice("uuid:".length).trim().toLowerCase()}`;
  }
  return trimmed;
}

export function parseSignalTarget(raw: string): SignalTarget {
  let value = raw.trim();
  if (!value) {
    throw new Error("Signal target is required");
  }
  if (value.toLowerCase().startsWith("signal:")) {
    value = value.slice("signal:".length).trim();
  }
  if (value.toLowerCase().startsWith("group:")) {
    const groupId = value.slice("group:".length).trim();
    if (!groupId) throw new Error("Signal group target is required");
    return { type: "group", groupId };
  }
  return { type: "recipient", recipient: value };
}

export function normalizeSignalMentionRegexes(patterns: Array<string>): Array<RegExp> {
  return patterns
    .map(pattern => {
      try {
        return new RegExp(pattern, "i");
      } catch {
        return null;
      }
    })
    .filter((pattern): pattern is RegExp => Boolean(pattern));
}

export function splitSignalText(input: { text: string; limit: number; mode: "length" | "newline" }): Array<string> {
  const text = input.text.trim();
  if (!text) return [];
  const limit = Math.max(1, input.limit);
  if (text.length <= limit) return [text];

  if (input.mode === "newline") {
    const lines = text.split(/\n{2,}/).map(line => line.trim()).filter(Boolean);
    const chunks: Array<string> = [];
    let current = "";
    for (const line of lines) {
      if (!current) {
        current = line;
        continue;
      }
      const next = `${current}\n\n${line}`;
      if (next.length > limit) {
        chunks.push(current);
        current = line;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
    if (chunks.length) {
      return chunks.flatMap(chunk => splitSignalText({ text: chunk, limit, mode: "length" }));
    }
  }

  const chunks: Array<string> = [];
  for (let start = 0; start < text.length; start += limit) {
    chunks.push(text.slice(start, start + limit));
  }
  return chunks;
}
