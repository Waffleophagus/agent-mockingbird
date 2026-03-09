import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsNativeEngineAvailable = vi.hoisted(() => vi.fn(() => true));
const mockCreateNativeEngine = vi.hoisted(() => vi.fn(() => ({ engine: "native" })));
const mockCodeToTokensBase = vi.hoisted(() =>
  vi.fn(async () => [[{ content: "const", color: "#ffffff" }]])
);
const mockCreateBundledHighlighter = vi.hoisted(() => vi.fn());
const mockMakeSingletonHighlighter = vi.hoisted(() => vi.fn());
const shikiFixtures = vi.hoisted(() => {
  const javascriptGrammar = {
    name: "javascript",
    scopeName: "source.js",
    patterns: [],
  };
  const typescriptGrammar = {
    name: "typescript",
    scopeName: "source.ts",
    patterns: [],
  };
  return {
    javascriptGrammar,
    loadJavascript: vi.fn(async () => ({ default: [javascriptGrammar] })),
    loadTypescript: vi.fn(async () => ({ default: [typescriptGrammar] })),
  };
});

vi.mock("react-native-shiki-engine", () => ({
  createNativeEngine: mockCreateNativeEngine,
  isNativeEngineAvailable: mockIsNativeEngineAvailable,
}));

vi.mock("@shikijs/core", () => ({
  createBundledHighlighter: mockCreateBundledHighlighter,
  makeSingletonHighlighter: mockMakeSingletonHighlighter,
}));

vi.mock("shiki/langs", () => ({
  bundledLanguages: {
    javascript: shikiFixtures.loadJavascript,
    typescript: shikiFixtures.loadTypescript,
  },
}));

describe("@streamdown/code-native", () => {
  const langs = ["javascript"];
  const themes = [{ name: "github-dark" }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateBundledHighlighter.mockImplementation((options: any) => {
      return async ({ langs: requestedLangs }: { langs: string[] }) => {
        const loaded = new Set<string>();

        for (const language of requestedLangs) {
          const input = options.langs[language];
          if (!input) {
            throw new Error(`Unknown language "${language}"`);
          }
          if (typeof input === "function") {
            await input();
            loaded.add(language);
            continue;
          }
          if (typeof input === "string") {
            if (input === "javascript") {
              await shikiFixtures.loadJavascript();
              loaded.add("javascript");
              continue;
            }
            if (input === "typescript") {
              await shikiFixtures.loadTypescript();
              loaded.add("typescript");
              continue;
            }
            throw new Error(`Unknown language "${input}"`);
          }
          if (typeof input?.import === "function") {
            await input.import();
            loaded.add(language);
            continue;
          }
          if (input?.id) {
            if (input.id === "javascript") {
              await shikiFixtures.loadJavascript();
              loaded.add("javascript");
              continue;
            }
            if (input.id === "typescript") {
              await shikiFixtures.loadTypescript();
              loaded.add("typescript");
              continue;
            }
            throw new Error(`Unknown language "${input.id}"`);
          }
          loaded.add(language);
        }

        return {
          codeToTokensBase: vi.fn(async (_code: string, { lang }: { lang: string }) => {
            if (!loaded.has(lang)) {
              throw new Error(`Language \`${lang}\` not found, you may need to load it first`);
            }
            return mockCodeToTokensBase();
          }),
        };
      };
    });
    mockMakeSingletonHighlighter.mockImplementation((createHighlighter: any) => {
      let singleton: any;
      const loaded = new Set<string>();
      return async (options: { langs: string[] }) => {
        for (const lang of options.langs) {
          loaded.add(lang);
        }
        if (!singleton) {
          singleton = await createHighlighter(options);
        } else {
          await createHighlighter(options);
        }
        return singleton;
      };
    });
  });

  it("throws when strict native engine is required but unavailable", async () => {
    mockIsNativeEngineAvailable.mockReturnValueOnce(false);
    const { createNativeCodePlugin } = await import("../index");
    expect(() =>
      createNativeCodePlugin({
        langs,
        themes,
      })
    ).toThrow("Native Shiki engine is unavailable");
  });

  it("supports languages and aliases", async () => {
    const { createNativeCodePlugin } = await import("../index");
    const plugin = createNativeCodePlugin({
      langs,
      themes,
      languageAliases: {
        js: "javascript",
      },
    });

    expect(plugin.name).toBe("shiki-native");
    expect(plugin.type).toBe("code-highlighter");
    expect(plugin.supportsLanguage("javascript")).toBe(true);
    expect(plugin.supportsLanguage("js")).toBe(true);
    expect(plugin.supportsLanguage("python")).toBe(false);
    expect(plugin.getThemes()).toEqual(["github-dark"]);
  });

  it("resolves metadata language entries (e.g. bundledLanguagesInfo style)", async () => {
    const { createNativeCodePlugin } = await import("../index");
    const plugin = createNativeCodePlugin({
      langs: [{ id: "javascript", name: "JavaScript" }],
      themes,
    });
    const callback = vi.fn();

    expect(
      plugin.highlight(
        {
          code: "const z = 3;",
          language: "javascript",
        },
        callback
      )
    ).toBeNull();

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    });
    expect(shikiFixtures.loadJavascript).toHaveBeenCalledTimes(1);
  });

  it("highlights asynchronously and returns cached result on repeat", async () => {
    const { createNativeCodePlugin } = await import("../index");
    const plugin = createNativeCodePlugin({
      langs,
      themes,
    });
    const callback = vi.fn();

    const first = plugin.highlight(
      {
        code: "const x = 1;",
        language: "javascript",
      },
      callback
    );
    expect(first).toBeNull();

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateBundledHighlighter).toHaveBeenCalledTimes(1);
    const resultFromCallback = callback.mock.calls[0][0];
    expect(resultFromCallback.tokens[0][0].content).toBe("const");

    const second = plugin.highlight({
      code: "const x = 1;",
      language: "javascript",
    });
    expect(second).not.toBeNull();
    expect(second?.tokens[0][0].content).toBe("const");
  });

  it("does not fallback unknown language to the first configured language", async () => {
    const { createNativeCodePlugin } = await import("../index");
    const plugin = createNativeCodePlugin({
      langs,
      themes,
    });

    const result = plugin.highlight({
      code: "no language",
      language: "",
    });
    expect(result).toBeNull();
    expect(mockCodeToTokensBase).not.toHaveBeenCalled();
  });

  it("logs clear error when a language id cannot be resolved", async () => {
    const { createNativeCodePlugin } = await import("../index");
    expect(() =>
      createNativeCodePlugin({
        langs: ["definitely-not-real"],
        themes,
      })
    ).toThrow('Unknown language "definitely-not-real"');
  });

  it("notifies multiple subscribers for an in-flight highlight", async () => {
    const { createNativeCodePlugin } = await import("../index");
    const plugin = createNativeCodePlugin({
      langs,
      themes,
    });
    const callbackOne = vi.fn();
    const callbackTwo = vi.fn();

    plugin.highlight(
      {
        code: "const y = 2;",
        language: "javascript",
      },
      callbackOne
    );
    plugin.highlight(
      {
        code: "const y = 2;",
        language: "javascript",
      },
      callbackTwo
    );

    await vi.waitFor(() => {
      expect(callbackOne).toHaveBeenCalledTimes(1);
      expect(callbackTwo).toHaveBeenCalledTimes(1);
    });
  });

  it("handles highlighter failures without throwing from highlight", async () => {
    mockCodeToTokensBase.mockImplementationOnce(async () => {
      throw new Error("synthetic highlight failure");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { createNativeCodePlugin } = await import("../index");
    const plugin = createNativeCodePlugin({
      langs,
      themes,
    });

    expect(() =>
      plugin.highlight({
        code: "const fail = true;",
        language: "javascript",
      })
    ).not.toThrow();

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
  });
});
