// Adapted from qmd (MIT): reciprocal-rank fusion and strong-signal gating.
// Source: https://github.com/tobi/qmd

export interface RankedResult {
  id: string;
  score: number;
}

export interface ExpandedQuery {
  type: "lex" | "vec" | "hyde";
  text: string;
}

export function hasStrongBm25Signal(
  ranked: RankedResult[],
  thresholds: { minScore: number; minGap: number },
): boolean {
  if (!ranked.length) return false;
  const topScore = ranked[0]?.score ?? 0;
  const secondScore = ranked[1]?.score ?? 0;
  return topScore >= thresholds.minScore && topScore - secondScore >= thresholds.minGap;
}

export function reciprocalRankFusion(resultLists: RankedResult[][], weights: number[] = [], k = 60): RankedResult[] {
  const scores = new Map<string, { score: number; topRank: number }>();

  for (let listIdx = 0; listIdx < resultLists.length; listIdx += 1) {
    const list = resultLists[listIdx];
    if (!list) continue;
    const weight = weights[listIdx] ?? 1;
    for (let rank = 0; rank < list.length; rank += 1) {
      const result = list[rank];
      if (!result) continue;
      const contribution = weight / (k + rank + 1);
      const existing = scores.get(result.id);
      if (existing) {
        existing.score += contribution;
        existing.topRank = Math.min(existing.topRank, rank);
        continue;
      }
      scores.set(result.id, { score: contribution, topRank: rank });
    }
  }

  for (const entry of scores.values()) {
    if (entry.topRank === 0) entry.score += 0.05;
    else if (entry.topRank <= 2) entry.score += 0.02;
  }

  return [...scores.entries()]
    .map(([id, value]) => ({ id, score: value.score }))
    .sort((a, b) => b.score - a.score);
}

export function blendRrfAndRerank(rrfRank: number, rerankScore: number) {
  let rrfWeight = 0.4;
  if (rrfRank <= 3) rrfWeight = 0.75;
  else if (rrfRank <= 10) rrfWeight = 0.6;
  const rrfScore = 1 / Math.max(1, rrfRank);
  return rrfWeight * rrfScore + (1 - rrfWeight) * rerankScore;
}
