import { createNativeCodePlugin } from "@streamdown/code-native";
import type { CodeHighlighterPlugin } from "@streamdown/react-native";
import githubDark from "@shikijs/themes/github-dark";
import { bundledLanguagesInfo } from "shiki/langs";

const supportedLanguageIds = new Set([
  "c",
  "cpp",
  "css",
  "docker",
  "elixir",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "mermaid",
  "php",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "shellscript",
  "sql",
  "swift",
  "tsx",
  "typescript",
  "xml",
  "yaml",
]);

const codeLanguages = bundledLanguagesInfo.filter((language) =>
  supportedLanguageIds.has(language.id)
);

const codeLanguageAliases: Record<string, string> = {
  cjs: "javascript",
  docker: "docker",
  dockerfile: "docker",
  js: "javascript",
  jsx: "jsx",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  tsx: "tsx",
  zsh: "shellscript",
  yml: "yaml",
};

let plugin: CodeHighlighterPlugin | null = null;
let didWarn = false;

export function getStreamdownCodePlugin(): CodeHighlighterPlugin | undefined {
  if (plugin) return plugin;

  try {
    plugin = createNativeCodePlugin({
      langs: codeLanguages,
      themes: [githubDark],
      languageAliases: codeLanguageAliases,
      strictNativeEngine: true,
    }) as unknown as CodeHighlighterPlugin;
    return plugin;
  } catch (error) {
    if (!didWarn) {
      didWarn = true;
      console.warn("[mobile] Streamdown native highlighter unavailable:", error);
    }
    return undefined;
  }
}
