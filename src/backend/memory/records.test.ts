import { describe, expect, test } from "bun:test";

import { migrateLegacyMemoryMarkdownToV2, parseMemoryRecordBlocks, parseMemoryRecords } from "./records";

describe("parseMemoryRecordBlocks", () => {
  test("extracts structured memory record blocks with line ranges", () => {
    const content = [
      "# Daily Notes",
      "",
      "### [memory:memory_a1] 2026-03-02T20:38:29.490Z",
      "meta: source=user",
      "",
      "User is currently in the NICU with Lucy Lee.",
      "",
      "### [memory:memory_b2] 2026-03-02T20:41:01.037Z",
      "meta: source=user; entities=Vulpix",
      "",
      "User's favorite Pokemon is Vulpix.",
      "",
    ].join("\n");

    const blocks = parseMemoryRecordBlocks(content);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.recordId).toBe("memory_a1");
    expect(blocks[0]?.startLine).toBe(3);
    expect(blocks[0]?.endLine).toBe(6);
    expect(blocks[1]?.recordId).toBe("memory_b2");
    expect(blocks[1]?.startLine).toBe(8);
    expect(blocks[1]?.endLine).toBe(11);
  });
});

describe("parseMemoryRecords", () => {
  test("continues parsing record metadata/body normally", () => {
    const content = [
      "### [memory:memory_z9] 2026-03-02T20:41:33.914Z",
      "meta: source=user; entities=Android; confidence=1",
      "",
      "User has an Android phone.",
    ].join("\n");
    const records = parseMemoryRecords(content);
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe("memory_z9");
    expect(records[0]?.content).toBe("User has an Android phone.");
    expect(records[0]?.source).toBe("user");
    expect(records[0]?.entities).toEqual(["Android"]);
  });
});

describe("migrateLegacyMemoryMarkdownToV2", () => {
  test("rewrites legacy JSON records into compact v2 format", () => {
    const content = [
      "### [memory:memory_z9] 2026-03-02T20:41:33.914Z",
      "```json",
      '{"id":"memory_z9","source":"user","recordedAt":"2026-03-02T20:41:33.914Z","entities":["Android"],"confidence":1}',
      "```",
      "User has an Android phone.",
      "",
    ].join("\n");

    const migrated = migrateLegacyMemoryMarkdownToV2(content);
    expect(migrated.migrated).toBe(1);
    expect(migrated.content).toContain("meta: source=user; entities=Android");
    expect(migrated.content).not.toContain("```json");
  });
});
