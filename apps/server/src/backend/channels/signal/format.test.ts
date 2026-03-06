import { expect, test } from "bun:test";

import {
  normalizeSignalId,
  normalizeSignalMentionRegexes,
  parseSignalTarget,
  splitSignalText,
} from "./format";

test("normalizeSignalId normalizes uuid prefix to lowercase", () => {
  expect(normalizeSignalId("UUID:ABCDEF")).toBe("uuid:abcdef");
});

test("parseSignalTarget parses group target", () => {
  const target = parseSignalTarget("signal:group:AbCd");
  expect(target).toEqual({ type: "group", groupId: "AbCd" });
});

test("splitSignalText splits by newline first in newline mode", () => {
  const chunks = splitSignalText({
    text: "alpha\n\nbeta\n\ngamma",
    limit: 8,
    mode: "newline",
  });
  expect(chunks).toEqual(["alpha", "beta", "gamma"]);
});

test("normalizeSignalMentionRegexes drops invalid regex entries", () => {
  const regexes = normalizeSignalMentionRegexes(["bot", "("]);
  expect(regexes.length).toBe(1);
  expect(regexes[0]?.test("hey bot")).toBe(true);
});

