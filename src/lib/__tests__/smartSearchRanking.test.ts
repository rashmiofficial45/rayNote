import { describe, it, expect } from "vitest";
import {
  normalizeQuery,
  tokenizeQuery,
  damerauLevenshtein,
  tokenSimilarity,
  scoreDocumentCandidate,
  getHighlightedSegments,
  CandidateDoc,
} from "../searchRanking";

describe("Smart Search - Query Normalization & Tokenization", () => {
  it("normalizes case-insensitivity, leading/trailing spaces, and consecutive spaces", () => {
    expect(normalizeQuery("  RayNote   Performance  ")).toBe("raynote performance");
    expect(normalizeQuery("UPPERCASE  query")).toBe("uppercase query");
  });

  it("handles punctuation and symbol stripping", () => {
    expect(normalizeQuery("rayNote: Feature Audit & Roadmap!")).toBe(
      "raynote feature audit roadmap"
    );
    expect(normalizeQuery("cache-eviction (v2.0)")).toBe("cache eviction v2 0");
  });

  it("normalizes unicode and diacritics", () => {
    expect(normalizeQuery("café résumé déjà vu")).toBe("cafe resume deja vu");
    expect(normalizeQuery("Zürich straße Über")).toBe("zurich strasse uber");
  });

  it("tokenizes normalized queries into distinct terms", () => {
    expect(tokenizeQuery("raynote performance audit")).toEqual([
      "raynote",
      "performance",
      "audit",
    ]);
    expect(tokenizeQuery("")).toEqual([]);
  });
});

describe("Smart Search - Typo Tolerance (Damerau-Levenshtein)", () => {
  it("computes exact distance for identical strings", () => {
    expect(damerauLevenshtein("performance", "performance")).toBe(0);
    expect(tokenSimilarity("performance", "performance")).toBe(1.0);
  });

  it("detects single transposition (swapped adjacent characters)", () => {
    expect(damerauLevenshtein("performace", "performance")).toBe(1); // missing n
    expect(damerauLevenshtein("perfomrance", "performance")).toBe(1); // swap m & r
  });

  it("computes reasonable similarity for typo variations", () => {
    // "performace" vs "performance"
    const sim = tokenSimilarity("performace", "performance");
    expect(sim).toBeGreaterThanOrEqual(0.85);

    // "audti" vs "audit"
    expect(damerauLevenshtein("audti", "audit")).toBe(1);
  });
});

describe("Smart Search - Multi-Tier Relevance Ranking", () => {
  const baseDoc: CandidateDoc = {
    id: "doc-1",
    title: "Performance Audit",
    search_text: "Detailed benchmark of cache latency and CPU usage.",
    preview: "Detailed benchmark of cache latency...",
    updated_at: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
    is_pinned: false,
  };

  it("1. Exact title match receives highest score (1000+)", () => {
    const res = scoreDocumentCandidate("Performance Audit", baseDoc);
    expect(res.match_type).toBe("exact_title");
    expect(res.score).toBeGreaterThanOrEqual(1000);
  });

  it("2. Title prefix match outranks substring and content matches", () => {
    const prefixRes = scoreDocumentCandidate("Performance", baseDoc);
    expect(prefixRes.match_type).toBe("title_prefix");
    expect(prefixRes.score).toBeGreaterThanOrEqual(750);

    const substringDoc: CandidateDoc = {
      ...baseDoc,
      id: "doc-sub",
      title: "Quarterly Performance Audit",
    };
    const subRes = scoreDocumentCandidate("Performance", substringDoc);
    expect(subRes.match_type).toBe("title_substring");
    expect(prefixRes.score).toBeGreaterThan(subRes.score);
  });

  it("3. Title prefix match outranks a weak content match", () => {
    const titleDoc: CandidateDoc = {
      ...baseDoc,
      id: "doc-title",
      title: "Cache Eviction Guidelines",
      search_text: "General discussion.",
    };
    const contentDoc: CandidateDoc = {
      ...baseDoc,
      id: "doc-content",
      title: "Unrelated Project Notes",
      search_text: "Notes regarding cache eviction and memory footprints.",
    };

    const titleScore = scoreDocumentCandidate("Cache", titleDoc);
    const contentScore = scoreDocumentCandidate("Cache", contentDoc);

    expect(titleScore.score).toBeGreaterThan(contentScore.score);
  });

  it("4. Multi-word queries find documents regardless of word order", () => {
    const doc: CandidateDoc = {
      ...baseDoc,
      title: "rayNote: Feature Audit & Performance Roadmap",
    };

    const resOrdered = scoreDocumentCandidate("raynote performance", doc);
    const resUnordered = scoreDocumentCandidate("performance roadmap raynote", doc);

    expect(resOrdered.match_type).toBe("title_words");
    expect(resUnordered.match_type).toBe("title_words");
    expect(resOrdered.score).toBeGreaterThanOrEqual(500);
    expect(resUnordered.score).toBeGreaterThanOrEqual(500);
  });

  it("5. Typographical errors produce relevant matches in titles", () => {
    // "performace audit" matching "Performance Audit"
    const typoRes = scoreDocumentCandidate("performace audit", baseDoc);
    expect(typoRes.match_type).toBe("fuzzy_title");
    expect(typoRes.score).toBeGreaterThanOrEqual(350);
  });

  it("6. Full-content results are scored when title does not match", () => {
    const contentOnlyDoc: CandidateDoc = {
      ...baseDoc,
      title: "Meeting Minutes - October",
      search_text: "We discussed cache eviction strategies and LRU memory bounds.",
    };

    const res = scoreDocumentCandidate("cache eviction", contentOnlyDoc);
    expect(res.match_type).toBe("content");
    expect(res.score).toBeGreaterThanOrEqual(200);
  });

  it("7. Weak or completely unrelated matches are excluded (score 0 / unmatched)", () => {
    const res = scoreDocumentCandidate("quantum mechanics astrophysics", baseDoc);
    expect(res.score).toBe(0);
    expect(res.match_type).toBe("unmatched");
  });

  it("8. Recency does NOT override a strong title match", () => {
    const oldTitleDoc: CandidateDoc = {
      id: "old-title-doc",
      title: "Architecture Guide",
      search_text: "Detailed system design.",
      preview: "Detailed system design.",
      updated_at: new Date(Date.now() - 3600000 * 24 * 30).toISOString(), // 30 days old
      is_pinned: false,
    };

    const newContentDoc: CandidateDoc = {
      id: "brand-new-content-doc",
      title: "Daily Standup Notes",
      search_text: "Quick mention of Architecture Guide.",
      preview: "Quick mention of Architecture Guide.",
      updated_at: new Date().toISOString(), // Just now (brand new)
      is_pinned: false,
    };

    const titleScore = scoreDocumentCandidate("Architecture Guide", oldTitleDoc);
    const contentScore = scoreDocumentCandidate("Architecture Guide", newContentDoc);

    // Old document with exact title match must heavily outrank brand new document with content match
    expect(titleScore.score).toBeGreaterThan(contentScore.score);
  });

  it("9. Identical queries against the same document produce deterministic scores", () => {
    const score1 = scoreDocumentCandidate("performance audit", baseDoc);
    const score2 = scoreDocumentCandidate("performance audit", baseDoc);
    expect(score1.score).toBe(score2.score);
    expect(score1.match_type).toBe(score2.match_type);
  });
});

describe("Smart Search - Text Highlighting", () => {
  it("highlights query terms accurately", () => {
    const segments = getHighlightedSegments(
      "Feature Audit & Performance Roadmap",
      "performance audit"
    );
    const matches = segments.filter((s) => s.isMatch).map((s) => s.text.toLowerCase());
    expect(matches).toContain("audit");
    expect(matches).toContain("performance");
  });

  it("parses SQLite FTS5 ==markers== in snippet", () => {
    const ftsSnippet = "Discussing ==cache== eviction and ==memory== bounds";
    const segments = getHighlightedSegments(ftsSnippet, "irrelevant");
    const matchedTokens = segments.filter((s) => s.isMatch).map((s) => s.text);
    expect(matchedTokens).toEqual(["cache", "memory"]);
  });
});
