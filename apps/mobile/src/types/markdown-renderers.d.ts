declare module "react-native-syntax-highlighter" {
  import type { ComponentType, PropsWithChildren } from "react";

  interface SyntaxHighlighterProps {
    language?: string;
    style?: unknown;
    highlighter?: "hljs" | "prism";
    customStyle?: unknown;
    fontFamily?: string;
    fontSize?: number;
    children?: string;
  }

  const SyntaxHighlighter: ComponentType<PropsWithChildren<SyntaxHighlighterProps>>;
  export default SyntaxHighlighter;
}

declare module "react-syntax-highlighter/styles/hljs" {
  export const atomOneDark: Record<string, unknown>;
}
