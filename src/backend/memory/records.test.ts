import { describe, expect, test } from "bun:test";

import { parseMemoryRecordBlocks, parseMemoryRecords } from "./records";

describe("parseMemoryRecordBlocks", () => {
  test("extracts structured memory record blocks with line ranges", () => {
    const content = [
      "# Daily Notes",
      "",
      "### [memory:memory_a1] 2026-03-02T20:38:29.490Z",
      "```json",
      '{"id":"memory_a1","source":"user","recordedAt":"2026-03-02T20:38:29.490Z"}',
      "```",
      "User is currently in the NICU with Lucy Lee.",
      "",
      "### [memory:memory_b2] 2026-03-02T20:41:01.037Z",
      "```json",
      '{"id":"memory_b2","source":"user","recordedAt":"2026-03-02T20:41:01.037Z"}',
      "```",
      "User's favorite Pokemon is Vulpix.",
      "",
    ].join("\n");

    const blocks = parseMemoryRecordBlocks(content);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.recordId).toBe("memory_a1");
    expect(blocks[0]?.startLine).toBe(3);
    expect(blocks[0]?.endLine).toBe(7);
    expect(blocks[1]?.recordId).toBe("memory_b2");
    expect(blocks[1]?.startLine).toBe(9);
    expect(blocks[1]?.endLine).toBe(13);
  });
});

describe("parseMemoryRecords", () => {
  test("continues parsing record metadata/body normally", () => {
    const content = [
      "### [memory:memory_z9] 2026-03-02T20:41:33.914Z",
      "```json",
      '{"id":"memory_z9","source":"user","recordedAt":"2026-03-02T20:41:33.914Z","entities":["Android"]}',
      "```",
      "User has an Android phone.",
    ].join("\n");
    const records = parseMemoryRecords(content);
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe("memory_z9");
    expect(records[0]?.content).toBe("User has an Android phone.");
  });
});
