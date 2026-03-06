import { type ExpandedQuery } from "./qmdPort";

const TOKEN_RE = /[a-z0-9]{3,}/g;

interface ConceptPack {
  name: string;
  triggers: string[];
  lex: string;
}

const CONCEPT_PACKS: ConceptPack[] = [
  {
    name: "family",
    triggers: ["family", "relative", "relatives", "spouse", "daughter", "child", "children", "wife", "husband"],
    lex: "spouse wife husband partner daughter son child children parent parents mother father siblings sister brother",
  },
  {
    name: "portfolio",
    triggers: ["portfolio", "investing", "investment", "allocation", "holdings", "assets", "networth", "net-worth"],
    lex: "stocks etf etfs bonds treasuries commodities metals gold silver crypto bitcoin cash real estate allocation",
  },
  {
    name: "career",
    triggers: ["career", "job", "work", "company", "employer", "role", "promotion", "manager", "team"],
    lex: "job role company employer manager team promotion compensation salary bonus",
  },
];

function collectTokens(text: string) {
  const matched = text.toLowerCase().match(TOKEN_RE) ?? [];
  return new Set(matched);
}

export function buildConceptExpandedQueries(
  query: string,
  options: { enabled: boolean; maxPacks: number; maxTerms: number },
): {
  expandedQueries: ExpandedQuery[];
  expandedTokens: string[];
  matchedConceptPacks: string[];
} {
  if (!options.enabled) {
    return {
      expandedQueries: [],
      expandedTokens: [],
      matchedConceptPacks: [],
    };
  }

  const queryTokens = collectTokens(query);
  const matched = CONCEPT_PACKS.filter(pack => pack.triggers.some(trigger => queryTokens.has(trigger))).slice(
    0,
    Math.max(0, options.maxPacks),
  );

  const expandedQueries: ExpandedQuery[] = [];
  const expandedTokens = new Set<string>();
  const matchedConceptPacks = matched.map(pack => pack.name);

  for (const pack of matched) {
    expandedQueries.push({ type: "lex", text: pack.lex });
    expandedQueries.push({ type: "vec", text: `${query} ${pack.lex}`.trim() });
    for (const token of collectTokens(pack.lex)) {
      expandedTokens.add(token);
      if (expandedTokens.size >= Math.max(1, options.maxTerms)) break;
    }
    if (expandedTokens.size >= Math.max(1, options.maxTerms)) break;
  }

  const hyde = `Information about ${query}`.trim();
  if (hyde.length > "Information about".length) {
    expandedQueries.push({ type: "hyde", text: hyde });
  }

  return {
    expandedQueries,
    expandedTokens: [...expandedTokens],
    matchedConceptPacks,
  };
}
