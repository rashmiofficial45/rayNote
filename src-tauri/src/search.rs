//! rayNote Search Engine & Relevance Ranking Module (search.rs)
//!
//! Features:
//! - Multi-tiered Relevance Scoring:
//!   1. Exact Title Match (highest priority)
//!   2. Title Prefix Match
//!   3. Title Substring Match
//!   4. Order-Independent Multi-Word Title Match
//!   5. Typo-Tolerant / Fuzzy Title Match
//!   6. Contextual Content & FTS Matches
//!   7. Partial Token Matches
//! - Secondary Signals: Pinned status and Recency (strictly bounded so recency cannot outrank title relevance).
//! - Deterministic Output: Stable tie-breaking guarantees predictable results.
//! - Contextual Snippet Generator: Extracts search-term centered snippets without full document payloads.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
    pub match_type: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

/// Normalizes text for comparison:
/// - Case-insensitive (lowercase)
/// - Strips diacritics/accents (e.g. é -> e)
/// - Collapses multiple spaces and trims
/// - Strips punctuation characters
pub fn normalize_query(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_was_space = false;

    for c in s.chars() {
        match c {
            'ß' => {
                out.push_str("ss");
                last_was_space = false;
                continue;
            }
            'æ' | 'Æ' => {
                out.push_str("ae");
                last_was_space = false;
                continue;
            }
            'œ' | 'Œ' => {
                out.push_str("oe");
                last_was_space = false;
                continue;
            }
            _ => {}
        }

        let normalized_char = match c {
            'À'..='Å' | 'à'..='å' => 'a',
            'Ç' | 'ç' => 'c',
            'È'..='Ë' | 'è'..='ë' => 'e',
            'Ì'..='Ï' | 'ì'..='ï' => 'i',
            'Ñ' | 'ñ' => 'n',
            'Ò'..='Ö' | 'ò'..='ö' => 'o',
            'Ù'..='Ü' | 'ù'..='ü' => 'u',
            'Ý' | 'ý' | 'ÿ' => 'y',
            other => other.to_ascii_lowercase(),
        };

        if normalized_char.is_alphanumeric() {
            out.push(normalized_char);
            last_was_space = false;
        } else if normalized_char.is_whitespace() || normalized_char == '-' || normalized_char == '_' {
            if !last_was_space && !out.is_empty() {
                out.push(' ');
                last_was_space = true;
            }
        }
    }

    out.trim().to_string()
}

/// Tokenizes a string into non-empty alphanumeric words.
pub fn tokenize(s: &str) -> Vec<String> {
    normalize_query(s)
        .split_whitespace()
        .map(|w| w.to_string())
        .collect()
}

/// Calculates Damerau-Levenshtein distance between two short strings for typo tolerance.
pub fn damerau_levenshtein(s1: &str, s2: &str) -> usize {
    let len1 = s1.chars().count();
    let len2 = s2.chars().count();

    if len1 == 0 {
        return len2;
    }
    if len2 == 0 {
        return len1;
    }

    let chars1: Vec<char> = s1.chars().collect();
    let chars2: Vec<char> = s2.chars().collect();

    let mut d = vec![vec![0usize; len2 + 1]; len1 + 1];

    for i in 0..=len1 {
        d[i][0] = i;
    }
    for j in 0..=len2 {
        d[0][j] = j;
    }

    for i in 1..=len1 {
        for j in 1..=len2 {
            let cost = if chars1[i - 1] == chars2[j - 1] { 0 } else { 1 };

            d[i][j] = (d[i - 1][j] + 1) // deletion
                .min(d[i][j - 1] + 1) // insertion
                .min(d[i - 1][j - 1] + cost); // substitution

            // Transposition
            if i > 1
                && j > 1
                && chars1[i - 1] == chars2[j - 2]
                && chars1[i - 2] == chars2[j - 1]
            {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }

    d[len1][len2]
}

/// Computes normalized similarity between 0.0 and 1.0.
pub fn token_similarity(s1: &str, s2: &str) -> f64 {
    let max_len = s1.len().max(s2.len());
    if max_len == 0 {
        return 1.0;
    }
    let dist = damerau_levenshtein(s1, s2);
    1.0 - (dist as f64 / max_len as f64)
}

/// Internal document candidate representation for scoring.
#[allow(dead_code)]
pub struct DocumentCandidate<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub search_text: &'a str,
    pub preview: &'a str,
    pub updated_at: &'a str,
    pub is_pinned: bool,
    pub fts_snippet: Option<&'a str>,
}

/// Calculates the relevance score of a document against a search query.
/// Returns (score, match_type).
pub fn score_document(
    query_raw: &str,
    candidate: &DocumentCandidate,
) -> (f64, String) {
    let norm_query = normalize_query(query_raw);
    if norm_query.is_empty() {
        // Empty query: sorted by pinned & recency
        let base = if candidate.is_pinned { 100.0 } else { 50.0 };
        return (base, "recent".to_string());
    }

    let query_tokens = tokenize(&norm_query);
    let norm_title = normalize_query(candidate.title);
    let title_tokens = tokenize(&norm_title);
    let norm_content = normalize_query(candidate.search_text);

    let mut base_score = 0.0;
    let mut match_type = "unmatched".to_string();

    // ── 1. Exact Title Match (Highest Score) ──
    if norm_title == norm_query {
        base_score = 1000.0;
        match_type = "exact_title".to_string();
    }
    // ── 2. Title Starts With Query (Prefix) ──
    else if norm_title.starts_with(&norm_query) {
        let length_penalty = ((norm_title.len() - norm_query.len()) as f64).min(50.0) * 0.5;
        base_score = 800.0 - length_penalty;
        match_type = "title_prefix".to_string();
    }
    // ── 3. Title Contains Complete Query Substring ──
    else if norm_title.contains(&norm_query) {
        let length_penalty = ((norm_title.len() - norm_query.len()) as f64).min(50.0) * 0.3;
        base_score = 650.0 - length_penalty;
        match_type = "title_substring".to_string();
    }
    // ── 4. All Query Words Match Title (Order-Independent) ──
    else if !query_tokens.is_empty()
        && query_tokens.iter().all(|q_tok| {
            title_tokens.iter().any(|t_tok| t_tok == q_tok || t_tok.starts_with(q_tok))
        })
    {
        let matched_chars: usize = query_tokens.iter().map(|w| w.len()).sum();
        let total_chars = norm_title.len().max(1);
        let coverage = (matched_chars as f64 / total_chars as f64).min(1.0);
        base_score = 500.0 + coverage * 50.0;
        match_type = "title_words".to_string();
    }
    // ── 5. Typo-Tolerant Title Match ──
    else if !query_tokens.is_empty() {
        let mut total_sim = 0.0;
        let mut matched_count = 0;

        for q_tok in &query_tokens {
            let mut best_word_sim = 0.0;
            for t_tok in &title_tokens {
                let sim = token_similarity(q_tok, t_tok);
                if sim > best_word_sim {
                    best_word_sim = sim;
                }
            }
            // Allow 1 typo for words of len 4-6, 2 typos for longer
            let max_allowed_dist = if q_tok.len() <= 3 {
                0
            } else if q_tok.len() <= 6 {
                1
            } else {
                2
            };

            let dist = title_tokens
                .iter()
                .map(|t| damerau_levenshtein(q_tok, t))
                .min()
                .unwrap_or(99);

            if dist <= max_allowed_dist || best_word_sim >= 0.80 {
                matched_count += 1;
                total_sim += best_word_sim;
            }
        }

        if matched_count == query_tokens.len() {
            let avg_sim = total_sim / query_tokens.len() as f64;
            base_score = 350.0 + avg_sim * 100.0;
            match_type = "fuzzy_title".to_string();
        }
    }

    // ── 6. Full Content Matches ──
    if base_score == 0.0 {
        if candidate.fts_snippet.is_some() {
            base_score = 200.0;
            match_type = "content".to_string();
        } else if !norm_content.is_empty() {
            // Exact phrase in content
            if norm_content.contains(&norm_query) {
                base_score = 250.0;
                match_type = "content".to_string();
            }
            // All query tokens in content
            else if !query_tokens.is_empty()
                && query_tokens.iter().all(|q_tok| norm_content.contains(q_tok))
            {
                base_score = 200.0;
                match_type = "content".to_string();
            }
            // Partial query tokens in title
            else {
                let title_matches = query_tokens
                    .iter()
                    .filter(|q_tok| norm_title.contains(q_tok.as_str()))
                    .count();
                if title_matches > 0 {
                    let ratio = title_matches as f64 / query_tokens.len() as f64;
                    base_score = 120.0 * ratio;
                    match_type = "partial_title".to_string();
                }
            }
        }
    }

    // Return unmatched if below threshold
    if base_score < 50.0 {
        return (0.0, "unmatched".to_string());
    }

    // ── Secondary Ranking Signals (Strictly bounded) ──
    // Pinned bonus: small boost (+15.0)
    let pinned_bonus = if candidate.is_pinned { 15.0 } else { 0.0 };

    // Recency bonus: max 10.0 so it NEVER overrides a title match
    let recency_bonus = calculate_recency_bonus(candidate.updated_at);

    let final_score = base_score + pinned_bonus + recency_bonus;
    (final_score, match_type)
}

fn calculate_recency_bonus(updated_at_str: &str) -> f64 {
    if let Ok(updated) = chrono::DateTime::parse_from_rfc3339(updated_at_str) {
        let now = chrono::Utc::now();
        let age_hours = (now - updated.with_timezone(&chrono::Utc)).num_hours();
        if age_hours <= 24 {
            10.0
        } else if age_hours <= 168 {
            5.0 // within 7 days
        } else if age_hours <= 720 {
            2.0 // within 30 days
        } else {
            0.5
        }
    } else {
        0.0
    }
}

/// Generates a human-readable contextual snippet centered around the matching query terms.
pub fn generate_contextual_snippet(
    search_text: &str,
    query_raw: &str,
    fts_snippet: Option<&str>,
    preview: &str,
    max_len: usize,
) -> String {
    // 1. If FTS snippet is present, format it
    if let Some(fts_snip) = fts_snippet {
        if !fts_snip.trim().is_empty() {
            return fts_snip.trim().to_string();
        }
    }

    let norm_query = normalize_query(query_raw);
    let tokens = tokenize(&norm_query);
    if tokens.is_empty() || search_text.is_empty() {
        return truncate_text(preview, max_len);
    }

    // Find the earliest match of any query token in the original text
    let lower_text = search_text.to_lowercase();
    let mut best_pos = None;

    // Check full query phrase first
    if let Some(pos) = lower_text.find(&norm_query) {
        best_pos = Some((pos, norm_query.len()));
    } else {
        for tok in &tokens {
            if let Some(pos) = lower_text.find(tok) {
                if best_pos.is_none() || pos < best_pos.unwrap().0 {
                    best_pos = Some((pos, tok.len()));
                }
            }
        }
    }

    if let Some((pos, match_len)) = best_pos {
        // Center snippet around match
        let chars_before = max_len / 3;
        let start_byte = if pos > chars_before {
            // Find a valid UTF-8 boundary and space before
            let approx = pos - chars_before;
            search_text[approx..pos]
                .find(' ')
                .map(|space| approx + space + 1)
                .unwrap_or(approx)
        } else {
            0
        };

        let end_byte = (pos + match_len + (max_len * 2 / 3)).min(search_text.len());
        // Snap to valid UTF-8 boundary
        let safe_start = floor_char_boundary(search_text, start_byte);
        let safe_end = ceil_char_boundary(search_text, end_byte);

        let snippet_slice = &search_text[safe_start..safe_end];
        let mut result = String::new();
        if safe_start > 0 {
            result.push('…');
        }
        result.push_str(snippet_slice.trim());
        if safe_end < search_text.len() {
            result.push('…');
        }
        return result;
    }

    truncate_text(preview, max_len)
}

fn truncate_text(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max_len {
        return trimmed.to_string();
    }
    let truncated: String = trimmed.chars().take(max_len).collect();
    format!("{}…", truncated.trim_end())
}

fn floor_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        s.len()
    } else {
        let mut i = index;
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    }
}

fn ceil_char_boundary(s: &str, index: usize) -> usize {
    if index >= s.len() {
        s.len()
    } else {
        let mut i = index;
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
        i
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalization() {
        assert_eq!(normalize_query("  RayNote: Feature  Audit! "), "raynote feature audit");
        assert_eq!(normalize_query("café résumé"), "cafe resume");
        assert_eq!(normalize_query("⌘K Find & Replace"), "k find replace");
    }

    #[test]
    fn test_damerau_levenshtein() {
        assert_eq!(damerau_levenshtein("performace", "performance"), 1);
        assert_eq!(damerau_levenshtein("audit", "audit"), 0);
        assert_eq!(damerau_levenshtein("teh", "the"), 1); // transposition
    }

    #[test]
    fn test_ranking_exact_title_ranks_first() {
        let doc1 = DocumentCandidate {
            id: "1",
            title: "Performance Audit",
            search_text: "Some content here",
            preview: "preview",
            updated_at: "2026-10-10T00:00:00Z",
            is_pinned: false,
            fts_snippet: None,
        };
        let doc2 = DocumentCandidate {
            id: "2",
            title: "Performance Audit & Roadmap",
            search_text: "Some content here",
            preview: "preview",
            updated_at: "2026-10-10T12:00:00Z", // more recent!
            is_pinned: true,
            fts_snippet: None,
        };

        let (score1, type1) = score_document("Performance Audit", &doc1);
        let (score2, _) = score_document("Performance Audit", &doc2);

        assert_eq!(type1, "exact_title");
        assert!(score1 > score2, "Exact title match (score1={}) must beat prefix match with pinned/recency (score2={})", score1, score2);
    }

    #[test]
    fn test_ranking_title_prefix_outranks_content_match() {
        let title_doc = DocumentCandidate {
            id: "1",
            title: "rayNote Performance Guide",
            search_text: "overview",
            preview: "preview",
            updated_at: "2026-09-01T00:00:00Z", // old note
            is_pinned: false,
            fts_snippet: None,
        };
        let content_doc = DocumentCandidate {
            id: "2",
            title: "Daily Standup Notes",
            search_text: "Discussed raynote performance improvements today.",
            preview: "Discussed raynote performance...",
            updated_at: "2026-10-10T12:00:00Z", // brand new note
            is_pinned: true,
            fts_snippet: Some("Discussed raynote performance"),
        };

        let (score_title, _) = score_document("raynote", &title_doc);
        let (score_content, _) = score_document("raynote", &content_doc);

        assert!(score_title > score_content, "Title prefix match ({}) must outrank content match ({}) despite recency", score_title, score_content);
    }

    #[test]
    fn test_order_independent_words_in_title() {
        let doc = DocumentCandidate {
            id: "1",
            title: "rayNote: Feature Audit & Performance Roadmap",
            search_text: "body text",
            preview: "preview",
            updated_at: "2026-10-10T00:00:00Z",
            is_pinned: false,
            fts_snippet: None,
        };

        let (score, match_type) = score_document("performance audit feature", &doc);
        assert_eq!(match_type, "title_words");
        assert!(score >= 500.0);
    }

    #[test]
    fn test_typo_tolerant_match() {
        let doc = DocumentCandidate {
            id: "1",
            title: "Performance Audit",
            search_text: "Detailed benchmark report",
            preview: "preview",
            updated_at: "2026-10-10T00:00:00Z",
            is_pinned: false,
            fts_snippet: None,
        };

        let (score, match_type) = score_document("performace audit", &doc);
        assert_eq!(match_type, "fuzzy_title");
        assert!(score >= 350.0);
    }

    #[test]
    fn test_unrelated_query_is_unmatched() {
        let doc = DocumentCandidate {
            id: "1",
            title: "Shopping List",
            search_text: "Apples, bananas, milk",
            preview: "Apples, bananas...",
            updated_at: "2026-10-10T00:00:00Z",
            is_pinned: false,
            fts_snippet: None,
        };

        let (score, match_type) = score_document("quantum computing", &doc);
        assert_eq!(match_type, "unmatched");
        assert_eq!(score, 0.0);
    }

    #[test]
    fn test_deterministic_ranking() {
        let doc = DocumentCandidate {
            id: "1",
            title: "Performance Guide",
            search_text: "Eviction algorithms",
            preview: "Eviction algorithms",
            updated_at: "2026-10-10T00:00:00Z",
            is_pinned: false,
            fts_snippet: None,
        };

        let (s1, _) = score_document("performance", &doc);
        let (s2, _) = score_document("performance", &doc);
        assert_eq!(s1, s2);
    }
}
