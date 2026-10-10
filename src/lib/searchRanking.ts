/**
 * RayNote Relevance-Ranked Search & Query Normalization Engine.
 * Provides query normalization, typo tolerance, multi-tier scoring,
 * and snippet highlighting for ⌘P Smart Search.
 */

/**
 * Normalizes query and document text:
 * - Trims leading & trailing whitespace
 * - Converts to lowercase
 * - Strips diacritics / accent marks (e.g., 'é' -> 'e', 'ü' -> 'u')
 * - Strips extraneous punctuation characters
 * - Collapses consecutive spaces into a single space
 */
export function normalizeQuery(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents/diacritics
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // replace non-alphanumeric punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits normalized string into distinct non-empty word tokens.
 */
export function tokenizeQuery(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(" ").filter((t) => t.length > 0);
}

/**
 * Computes Damerau-Levenshtein distance between two strings,
 * accounting for insertions, deletions, substitutions, and adjacent transpositions.
 */
export function damerauLevenshtein(s1: string, s2: string): number {
  const chars1 = Array.from(s1);
  const chars2 = Array.from(s2);
  const len1 = chars1.length;
  const len2 = chars2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  const d: number[][] = Array.from({ length: len1 + 1 }, () =>
    new Array(len2 + 1).fill(0)
  );

  for (let i = 0; i <= len1; i++) d[i][0] = i;
  for (let j = 0; j <= len2; j++) d[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = chars1[i - 1] === chars2[j - 1] ? 0 : 1;

      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (
        i > 1 &&
        j > 1 &&
        chars1[i - 1] === chars2[j - 2] &&
        chars1[i - 2] === chars2[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[len1][len2];
}

/**
 * Computes token similarity between 0.0 (completely dissimilar) and 1.0 (identical).
 */
export function tokenSimilarity(s1: string, s2: string): number {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = damerauLevenshtein(s1, s2);
  return 1.0 - dist / maxLen;
}

export interface CandidateDoc {
  id: string;
  title: string;
  search_text: string;
  preview: string;
  updated_at: string;
  is_pinned: boolean;
  fts_snippet?: string;
}

export interface ScoredDocResult {
  score: number;
  match_type:
    | "exact_title"
    | "title_prefix"
    | "title_substring"
    | "title_words"
    | "fuzzy_title"
    | "content"
    | "recent"
    | "unmatched";
}

/**
 * Calculates deterministic relevance score for a document candidate against a query.
 * Multi-tiered scoring hierarchy:
 * 1. Exact Title Match: 1000.0
 * 2. Title Prefix Match: 800.0 - length penalty
 * 3. Title Substring Match: 650.0 - length penalty
 * 4. All Query Words in Title (Order-Independent): 500.0 + coverage bonus
 * 5. Typo-Tolerant Title Match: 350.0 + similarity bonus
 * 6. Content Match: 100.0 - 250.0
 * Secondary signals:
 * - Pinned: +15.0
 * - Recency: max +10.0 (strictly capped so recency never overrides title matches)
 */
export function scoreDocumentCandidate(
  rawQuery: string,
  candidate: CandidateDoc
): ScoredDocResult {
  const normQuery = normalizeQuery(rawQuery);
  if (!normQuery) {
    const base = candidate.is_pinned ? 100.0 : 50.0;
    return { score: base, match_type: "recent" };
  }

  const queryTokens = tokenizeQuery(normQuery);
  const normTitle = normalizeQuery(candidate.title);
  const titleTokens = tokenizeQuery(normTitle);
  const normContent = normalizeQuery(candidate.search_text);

  let baseScore = 0.0;
  let matchType: ScoredDocResult["match_type"] = "unmatched";

  // 1. Exact Title Match
  if (normTitle === normQuery) {
    baseScore = 1000.0;
    matchType = "exact_title";
  }
  // 2. Title Prefix Match
  else if (normTitle.startsWith(normQuery)) {
    const penalty = Math.min(normTitle.length - normQuery.length, 50) * 0.5;
    baseScore = 800.0 - penalty;
    matchType = "title_prefix";
  }
  // 3. Title Substring Match
  else if (normTitle.includes(normQuery)) {
    const penalty = Math.min(normTitle.length - normQuery.length, 50) * 0.3;
    baseScore = 650.0 - penalty;
    matchType = "title_substring";
  }
  // 4. All Query Words Match Title (Order-Independent)
  else if (
    queryTokens.length > 0 &&
    queryTokens.every((qTok) =>
      titleTokens.some((tTok) => tTok === qTok || tTok.startsWith(qTok))
    )
  ) {
    const matchedChars = queryTokens.reduce((acc, w) => acc + w.length, 0);
    const totalChars = Math.max(normTitle.length, 1);
    const coverage = Math.min(matchedChars / totalChars, 1.0);
    baseScore = 500.0 + coverage * 50.0;
    matchType = "title_words";
  }
  // 5. Typo-Tolerant Title Match
  else if (queryTokens.length > 0) {
    let totalSim = 0.0;
    let matchedCount = 0;

    for (const qTok of queryTokens) {
      let bestSim = 0.0;
      for (const tTok of titleTokens) {
        const sim = tokenSimilarity(qTok, tTok);
        if (sim > bestSim) bestSim = sim;
      }

      const maxDist = qTok.length <= 3 ? 0 : qTok.length <= 6 ? 1 : 2;
      const minDist = titleTokens.reduce((min, t) => {
        const d = damerauLevenshtein(qTok, t);
        return Math.min(min, d);
      }, 99);

      if (minDist <= maxDist || bestSim >= 0.8) {
        matchedCount++;
        totalSim += bestSim;
      }
    }

    if (matchedCount === queryTokens.length) {
      const avgSim = totalSim / queryTokens.length;
      baseScore = 350.0 + avgSim * 100.0;
      matchType = "fuzzy_title";
    }
  }

  // 6. Full Content Matches
  if (baseScore === 0.0) {
    if (normContent) {
      if (normContent.includes(normQuery)) {
        baseScore = 250.0;
        matchType = "content";
      } else if (
        queryTokens.length > 0 &&
        queryTokens.every((qTok) => normContent.includes(qTok))
      ) {
        baseScore = 200.0;
        matchType = "content";
      } else {
        const titleMatches = queryTokens.filter((qTok) =>
          normTitle.includes(qTok)
        ).length;
        if (titleMatches > 0) {
          const ratio = titleMatches / queryTokens.length;
          baseScore = 120.0 * ratio;
          matchType = "fuzzy_title";
        } else if (candidate.fts_snippet) {
          baseScore = 100.0;
          matchType = "content";
        }
      }
    } else if (candidate.fts_snippet) {
      baseScore = 100.0;
      matchType = "content";
    }
  }

  // Below confidence threshold
  if (baseScore < 50.0) {
    return { score: 0.0, match_type: "unmatched" };
  }

  // Secondary signals
  const pinnedBonus = candidate.is_pinned ? 15.0 : 0.0;
  let recencyBonus = 0.0;
  try {
    const updatedTime = new Date(candidate.updated_at).getTime();
    const now = Date.now();
    const ageHours = (now - updatedTime) / (1000 * 60 * 60);
    if (ageHours <= 24) {
      recencyBonus = 10.0;
    } else if (ageHours <= 168) {
      recencyBonus = 6.0;
    } else if (ageHours <= 720) {
      recencyBonus = 3.0;
    }
  } catch {}

  const finalScore = baseScore + pinnedBonus + recencyBonus;
  return { score: finalScore, match_type: matchType };
}

/**
 * Text segment representation for highlighting matching terms.
 */
export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Parses text and query into highlighted segments.
 * Supports SQLite FTS5 '==keyword==' markers as well as direct query word matching.
 */
export function getHighlightedSegments(
  text: string,
  rawQuery: string
): HighlightSegment[] {
  if (!text) return [];

  // Check for SQLite FTS5 ==marker== pattern
  if (text.includes("==")) {
    const parts = text.split(/(==.*?==)/g);
    const segments: HighlightSegment[] = [];
    for (const part of parts) {
      if (part.startsWith("==") && part.endsWith("==") && part.length >= 4) {
        segments.push({
          text: part.slice(2, -2),
          isMatch: true,
        });
      } else if (part.length > 0) {
        segments.push({
          text: part,
          isMatch: false,
        });
      }
    }
    return segments;
  }

  const normQuery = normalizeQuery(rawQuery);
  const tokens = tokenizeQuery(normQuery).filter((t) => t.length >= 2);

  if (tokens.length === 0) {
    return [{ text, isMatch: false }];
  }

  // Create regex pattern escaping special characters
  const escapedTokens = tokens
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");
  const parts = text.split(regex);

  return parts
    .filter((p) => p.length > 0)
    .map((p) => ({
      text: p,
      isMatch: regex.test(p),
    }));
}
