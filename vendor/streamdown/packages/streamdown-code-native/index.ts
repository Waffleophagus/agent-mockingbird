import { createBundledHighlighter, makeSingletonHighlighter } from "@shikijs/core";
import * as shikiLangs from "shiki/langs";
import {
  createNativeEngine,
  isNativeEngineAvailable,
} from "react-native-shiki-engine";

export interface HighlightToken {
  bgColor?: string;
  color?: string;
  content: string;
  htmlAttrs?: Record<string, string>;
  htmlStyle?: Record<string, string>;
  offset?: number;
}

export interface HighlightResult {
  bg?: string;
  fg?: string;
  rootStyle?: string | false;
  tokens: HighlightToken[][];
}

export interface HighlightOptions {
  code: string;
  language: string;
}

export interface ThemeInput {
  name?: string;
}

interface LanguageObjectInput {
  default?: unknown;
  id?: string;
  import?: unknown;
  name?: string;
}

export type LanguageInput =
  | string
  | LanguageObjectInput
  | LanguageGrammar
  | LanguageGrammar[]
  | { default: unknown };

export interface CodePluginOptions {
  languageAliases?: Record<string, string>;
  langs: LanguageInput[];
  strictNativeEngine?: boolean;
  themes: ThemeInput[];
}

export interface NativeCodeHighlighterPlugin {
  freeze: (options: HighlightOptions) => Promise<HighlightResult | null>;
  getSupportedLanguages: () => string[];
  getThemes: () => string[];
  highlight: (
    options: HighlightOptions,
    callback?: (result: HighlightResult) => void
  ) => HighlightResult | null;
  isNativeEngineAvailable: () => boolean;
  name: "shiki-native";
  supportsLanguage: (language: string) => boolean;
  type: "code-highlighter";
}

const getThemeName = (theme: ThemeInput, fallback: string): string =>
  theme?.name ?? fallback;

interface LanguageGrammar {
  aliases?: string[];
  name?: string;
  patterns?: unknown;
  scopeName?: string;
}

const bundledLanguageLoaders = (shikiLangs as { bundledLanguages?: unknown })
  .bundledLanguages as Record<string, unknown> | undefined;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const isLanguageGrammar = (value: unknown): value is LanguageGrammar =>
  isObject(value) && typeof value.scopeName === "string";

const getLanguageId = (lang: unknown): string => {
  if (typeof lang === "string") {
    return lang.toLowerCase();
  }
  if (!isObject(lang)) {
    return "";
  }
  const id = lang.id ?? lang.name;
  return typeof id === "string" ? id.toLowerCase() : "";
};

const collectSupportedLanguages = (set: Set<string>, input: unknown): void => {
  if (Array.isArray(input)) {
    for (const item of input) {
      collectSupportedLanguages(set, item);
    }
    return;
  }
  if (typeof input === "string") {
    if (input.trim().length > 0) {
      set.add(input.trim().toLowerCase());
    }
    return;
  }
  if (!isObject(input)) {
    return;
  }
  if ("default" in input) {
    collectSupportedLanguages(set, input.default);
  }
  const id = getLanguageId(input);
  if (id.length > 0) {
    set.add(id);
  }
  if (isLanguageGrammar(input)) {
    const name = typeof input.name === "string" ? input.name.toLowerCase() : "";
    if (name.length > 0) {
      set.add(name);
    }
    if (Array.isArray(input.aliases)) {
      for (const alias of input.aliases) {
        if (typeof alias === "string" && alias.length > 0) {
          set.add(alias.toLowerCase());
        }
      }
    }
  }
};

const collectInputLanguageIds = (set: Set<string>, input: unknown): void => {
  if (Array.isArray(input)) {
    for (const item of input) {
      collectInputLanguageIds(set, item);
    }
    return;
  }
  const id = getLanguageId(input);
  if (id.length > 0) {
    set.add(id);
  }
};

const resolveGrammarInput = async (
  input: unknown,
  source: string
): Promise<LanguageGrammar[]> => {
  if (Array.isArray(input)) {
    const flattened = (
      await Promise.all(
        input.map((item, index) =>
          resolveGrammarInput(item, `${source}[${index}]`)
        )
      )
    ).flat();
    if (flattened.length > 0) {
      return flattened;
    }
    throw new Error(
      `[@streamdown/code-native] Invalid language grammar from ${source}. Expected grammar objects with scopeName.`
    );
  }

  if (isLanguageGrammar(input)) {
    return [input];
  }

  if (isObject(input) && "default" in input) {
    return resolveGrammarInput(input.default, `${source}.default`);
  }

  if (isObject(input) && typeof input.import === "function") {
    const loaded = await (input.import as () => Promise<unknown>)();
    return resolveGrammarInput(loaded, `${source}.import()`);
  }

  const languageId = getLanguageId(input);
  if (languageId.length === 0) {
    throw new Error(
      `[@streamdown/code-native] Invalid language entry at ${source}. Provide a language id string, metadata with id, or loaded grammar module.`
    );
  }

  const bundledLoader = bundledLanguageLoaders?.[languageId];
  if (typeof bundledLoader !== "function") {
    throw new Error(
      `[@streamdown/code-native] Unknown language "${languageId}" at ${source}.`
    );
  }

  const loaded = await (bundledLoader as () => Promise<unknown>)();
  return resolveGrammarInput(loaded, `bundledLanguages.${languageId}`);
};

const toBundledLanguageInput = (
  input: LanguageInput,
  source: string
): unknown => {
  if (typeof input === "string") {
    const bundledLoader = bundledLanguageLoaders?.[input.toLowerCase()];
    if (typeof bundledLoader !== "function") {
      throw new Error(
        `[@streamdown/code-native] Unknown language "${input.toLowerCase()}" at ${source}.`
      );
    }
    return bundledLoader;
  }

  if (
    isObject(input) &&
    "import" in input &&
    typeof input.import === "function"
  ) {
    return async () => {
      const loaded = await (input.import as () => Promise<unknown>)();
      const resolved = await resolveGrammarInput(loaded, `${source}.import()`);
      return { default: resolved };
    };
  }

  const languageId = getLanguageId(input);
  if (languageId.length > 0) {
    const bundledLoader = bundledLanguageLoaders?.[languageId];
    if (typeof bundledLoader === "function") {
      return bundledLoader;
    }
  }

  return async () => {
    const resolved = await resolveGrammarInput(input, source);
    return { default: resolved };
  };
};

const createTokenCacheKey = (code: string, language: string, theme: string) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${theme}:${code.length}:${start}:${end}`;
};

const mapTokens = (tokens: Array<Array<{ color?: string; content: string }>>) =>
  tokens.map((row) =>
    row.map((token) => ({
      content: token.content,
      color: token.color ?? "inherit",
      bgColor: "transparent",
      htmlStyle: {},
      offset: 0,
    }))
  );

export function createNativeCodePlugin(
  options: CodePluginOptions
): NativeCodeHighlighterPlugin {
  const strictNativeEngine = options.strictNativeEngine ?? true;
  const aliases = Object.fromEntries(
    Object.entries(options.languageAliases ?? {}).map(([from, to]) => [
      from.toLowerCase(),
      to.toLowerCase(),
    ])
  );
  const langs = options.langs ?? [];
  const themes = options.themes ?? [];

  if (themes.length === 0) {
    throw new Error(
      "[@streamdown/code-native] `themes` is required. Pass at least one Shiki theme."
    );
  }
  if (langs.length === 0) {
    throw new Error(
      "[@streamdown/code-native] `langs` is required. Pass at least one Shiki language grammar."
    );
  }

  const nativeAvailable = isNativeEngineAvailable();
  if (strictNativeEngine && !nativeAvailable) {
    throw new Error(
      "[@streamdown/code-native] Native Shiki engine is unavailable. Ensure Expo prebuild/dev-client setup is complete."
    );
  }

  const supportedLanguages = new Set<string>();
  for (const [index, input] of langs.entries()) {
    collectSupportedLanguages(supportedLanguages, input);
    const ids = new Set<string>();
    collectInputLanguageIds(ids, input);
  }
  const themeNames = themes.map((theme, index) =>
    getThemeName(theme, `theme-${index}`)
  );
  const primaryTheme = themeNames[0];
  if (supportedLanguages.size === 0) {
    throw new Error(
      "[@streamdown/code-native] Unable to derive any supported languages from `langs`."
    );
  }

  const engine = createNativeEngine();
  const bundledLangMap: Record<string, unknown> = {};
  for (const [index, input] of langs.entries()) {
    const ids = new Set<string>();
    collectInputLanguageIds(ids, input);
    for (const id of ids) {
      if (id.length > 0 && !(id in bundledLangMap)) {
        bundledLangMap[id] = toBundledLanguageInput(input, `langs[${index}]`);
      }
    }
  }
  const bundledThemeMap = Object.fromEntries(
    themes.map((theme, index) => [themeNames[index], theme])
  );
  const createHighlighter = createBundledHighlighter({
    engine: () => engine,
    langs: bundledLangMap as any,
    themes: bundledThemeMap as any,
  });
  const getHighlighter = makeSingletonHighlighter(createHighlighter);
  const tokenCache = new Map<string, HighlightResult>();
  const inFlight = new Map<string, Promise<HighlightResult>>();
  const subscribers = new Map<string, Set<(result: HighlightResult) => void>>();
  const reportedErrors = new Set<string>();
  let serializedWork = Promise.resolve();

  const normalizeLanguage = (language: string): string => {
    const normalized = language.trim().toLowerCase();
    return aliases[normalized] ?? normalized;
  };

  const reportHighlightError = (languageToUse: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const logKey = `${languageToUse}:${message}`;
    if (!reportedErrors.has(logKey)) {
      reportedErrors.add(logKey);
      console.error("[@streamdown/code-native] Failed to highlight code:", error);
    }
  };

  const runSerialized = <T>(task: () => Promise<T>): Promise<T> => {
    const next = serializedWork.then(task, task);
    serializedWork = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const loadTokens = (
    code: string,
    languageToUse: string,
    cacheKey: string
  ): Promise<HighlightResult> => {
    const cachedResult = tokenCache.get(cacheKey);
    if (cachedResult) {
      return Promise.resolve(cachedResult);
    }

    const pending = inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const task = runSerialized(async () => {
      const highlighter = await getHighlighter({
        langs: [languageToUse],
        themes: themeNames,
      });
      const tokens = await highlighter.codeToTokensBase(code, {
        lang: languageToUse,
        theme: primaryTheme,
      });
      const result: HighlightResult = {
        bg: "transparent",
        fg: "inherit",
        tokens: mapTokens(tokens),
      };
      tokenCache.set(cacheKey, result);
      return result;
    }).finally(() => {
      inFlight.delete(cacheKey);
    });

    inFlight.set(cacheKey, task);
    return task;
  };

  return {
    name: "shiki-native",
    type: "code-highlighter",
    isNativeEngineAvailable: () => nativeAvailable,
    getSupportedLanguages: () => Array.from(supportedLanguages),
    getThemes: () => themeNames,
    supportsLanguage: (language: string) =>
      supportedLanguages.has(normalizeLanguage(language)),
    async freeze({ code, language }: HighlightOptions): Promise<HighlightResult | null> {
      const normalizedLanguage = normalizeLanguage(language);
      if (!supportedLanguages.has(normalizedLanguage)) {
        return null;
      }
      const cacheKey = createTokenCacheKey(code, normalizedLanguage, primaryTheme);
      try {
        return await loadTokens(code, normalizedLanguage, cacheKey);
      } catch (error) {
        reportHighlightError(normalizedLanguage, error);
        return null;
      }
    },
    highlight(
      { code, language }: HighlightOptions,
      callback?: (result: HighlightResult) => void
    ): HighlightResult | null {
      const normalizedLanguage = normalizeLanguage(language);
      if (!supportedLanguages.has(normalizedLanguage)) {
        return null;
      }
      const languageToUse = normalizedLanguage;
      const cacheKey = createTokenCacheKey(code, languageToUse, primaryTheme);

      const cachedResult = tokenCache.get(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }

      if (callback) {
        if (!subscribers.has(cacheKey)) {
          subscribers.set(cacheKey, new Set());
        }
        subscribers.get(cacheKey)?.add(callback);
      }

      void loadTokens(code, languageToUse, cacheKey)
        .then((result) => {
          const queued = subscribers.get(cacheKey);
          if (queued) {
            for (const subscriber of queued) {
              subscriber(result);
            }
            subscribers.delete(cacheKey);
          }
        })
        .catch((error) => {
          reportHighlightError(languageToUse, error);
          subscribers.delete(cacheKey);
        });

      return null;
    },
  };
}
