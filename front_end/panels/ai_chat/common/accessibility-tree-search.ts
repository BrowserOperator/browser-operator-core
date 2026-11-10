// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Accessibility Tree Search - Relevance-ranked search for accessibility tree elements
 *
 * Provides smart substring matching with weighted scoring for finding elements
 * in accessibility trees. Designed for <100ms latency on large trees.
 */

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Configuration for search scoring weights
 */
export interface SearchScoringConfig {
  /** Multiplier when query matches start of text (default: 2.0) */
  startsWithBoost: number;
  /** Bonus when role matches query (default: 50) */
  roleMatchBoost: number;
  /** Bonus when name matches query (default: 30) */
  nameMatchBoost: number;
  /** Bonus for interactive elements like button, link, textbox (default: 20) */
  interactiveBoost: number;
  /** Bonus for interactive elements inside iframes (default: 15) */
  iframeInteractiveBoost: number;
}

/**
 * Parsed structure of an accessibility tree line
 */
export interface ParsedTreeLine {
  /** Original line text */
  raw: string;
  /** Indentation level (number of indent units) */
  indent: number;
  /** Encoded ID (e.g., "0-123") */
  id: string;
  /** Element role (e.g., "button", "link", "textbox") */
  role: string;
  /** Element name/text content */
  name: string;
  /** Whether element has [focused] marker */
  isFocused: boolean;
  /** Line number in original tree (0-indexed) */
  lineNumber: number;
}

/**
 * Search match with relevance score
 */
export interface ScoredSearchMatch {
  /** Encoded ID for the element */
  id: string;
  /** Element role */
  role: string;
  /** Element name/text or full line if name not extracted */
  name: string;
  /** Surrounding context lines */
  context: string;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Which field(s) matched the query */
  matchType: 'role' | 'name' | 'both';
  /** Frame ordinal extracted from EncodedId (0 = main frame, 1+ = iframe) */
  frameOrdinal: number;
}

/**
 * Options for search behavior
 */
export interface SearchOptions {
  /** Maximum results to return (default: 20, max: 100) */
  maxResults?: number;
  /** Include surrounding context lines (default: true) */
  includeContext?: boolean;
  /** Lines before match to include in context (default: 1) */
  contextLinesBefore?: number;
  /** Lines after match to include in context (default: 2) */
  contextLinesAfter?: number;
  /** Custom scoring configuration */
  scoringConfig?: Partial<SearchScoringConfig>;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_SCORING_CONFIG: SearchScoringConfig = {
  startsWithBoost: 2.0,
  roleMatchBoost: 50,
  nameMatchBoost: 30,
  interactiveBoost: 20,
  iframeInteractiveBoost: 15,
};

const DEFAULT_SEARCH_OPTIONS: Required<Omit<SearchOptions, 'scoringConfig'>> = {
  maxResults: 20,
  includeContext: true,
  contextLinesBefore: 1,
  contextLinesAfter: 2,
};

// Interactive roles that get boosted in search results
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'tab', 'menuitem', 'treeitem', 'gridcell', 'option',
  'menuitemcheckbox', 'menuitemradio', 'listbox',
]);

// =============================================================================
// TreeLineParser
// =============================================================================

// Pre-compiled regex patterns for performance
const ID_PATTERN = /\[([^\]]+)\]/;
const ROLE_PATTERN = /\]\s*(\w+)/;
const NAME_PATTERN = /(?::\s*|"\s*)([^"\[\]]+?)(?:\s*"|(?:\s*\[focused\])?\s*$)/;
const INDENT_UNIT = 2;

/**
 * Extract frame ordinal from EncodedId format "frameOrdinal-backendNodeId"
 * @param encodedId ID in format "0-123" or "1-456"
 * @returns Frame ordinal (0 for main frame, 1+ for iframes)
 */
export function parseFrameOrdinal(encodedId: string): number {
  if (!encodedId) {
    return 0;
  }
  const dashIndex = encodedId.indexOf('-');
  if (dashIndex === -1) {
    return 0;
  }
  const ordinal = parseInt(encodedId.substring(0, dashIndex), 10);
  return isNaN(ordinal) ? 0 : ordinal;
}

/**
 * Parses accessibility tree lines into structured format
 */
export class TreeLineParser {
  /**
   * Parse a single line from an accessibility tree
   * @param line Raw line text
   * @param lineNumber Position in original tree (0-indexed)
   * @returns Parsed line structure or null if line cannot be parsed
   */
  parse(line: string, lineNumber: number): ParsedTreeLine | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    const id = this.extractId(line);
    const role = this.extractRole(line);
    const name = this.extractName(line);
    const indent = this.getIndentLevel(line);
    const isFocused = line.includes('[focused]');

    return {
      raw: line,
      indent,
      id,
      role,
      name,
      isFocused,
      lineNumber,
    };
  }

  private extractId(line: string): string {
    const match = line.match(ID_PATTERN);
    return match ? match[1] : '';
  }

  private extractRole(line: string): string {
    const match = line.match(ROLE_PATTERN);
    return match ? match[1] : '';
  }

  private extractName(line: string): string {
    const match = line.match(NAME_PATTERN);
    if (match) {
      return match[1].trim();
    }
    // Fallback: return content after role if no quoted name
    const roleMatch = line.match(/\]\s*\w+\s*(.+?)(?:\s*\[focused\])?\s*$/);
    return roleMatch ? roleMatch[1].trim() : '';
  }

  private getIndentLevel(line: string): number {
    const leadingSpaces = line.match(/^(\s*)/);
    if (!leadingSpaces) {
      return 0;
    }
    return Math.floor(leadingSpaces[1].length / INDENT_UNIT);
  }
}

// =============================================================================
// SearchScorer
// =============================================================================

/**
 * Calculates relevance scores for search matches
 */
export class SearchScorer {
  private config: SearchScoringConfig;

  constructor(config?: Partial<SearchScoringConfig>) {
    this.config = { ...DEFAULT_SCORING_CONFIG, ...config };
  }

  /**
   * Preprocess query into lowercase words for efficient matching
   * Call once per search, then pass to scoreWithWords() for each line
   */
  preprocessQuery(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  }

  /**
   * Calculate relevance score for a parsed line against a query
   * @param query Search query (case-insensitive matching, tokenized by whitespace)
   * @param parsed Parsed tree line
   * @returns Score (0 if no match, higher = more relevant)
   */
  score(query: string, parsed: ParsedTreeLine): { score: number; matchType: 'role' | 'name' | 'both' | 'none' } {
    const queryWords = this.preprocessQuery(query);
    return this.scoreWithWords(queryWords, parsed);
  }

  /**
   * Calculate relevance score using preprocessed query words (more efficient for bulk scoring)
   * @param queryWords Preprocessed query words from preprocessQuery()
   * @param parsed Parsed tree line
   * @returns Score (0 if no match, higher = more relevant)
   */
  scoreWithWords(queryWords: string[], parsed: ParsedTreeLine): { score: number; matchType: 'role' | 'name' | 'both' | 'none' } {
    if (queryWords.length === 0) {
      return { score: 0, matchType: 'none' };
    }

    const roleLower = parsed.role.toLowerCase();
    const nameLower = parsed.name.toLowerCase();
    const rawLower = parsed.raw.toLowerCase();

    // For ROLE matching: require word to be a PREFIX of the role
    // This prevents "box" from matching "checkbox" while allowing "search" to match "searchbox"
    const roleMatch = queryWords.some(word => roleLower.startsWith(word));

    // For NAME matching: allow substring match (more flexible for user-visible text)
    // But prioritize prefix matches in scoring
    const nameMatch = queryWords.some(word => nameLower.includes(word) || rawLower.includes(word));

    // No match at all
    if (!roleMatch && !nameMatch) {
      return { score: 0, matchType: 'none' };
    }

    // Determine match type
    const matchType: 'role' | 'name' | 'both' = roleMatch && nameMatch ? 'both' : roleMatch ? 'role' : 'name';

    // Calculate base score
    let score = 0;
    if (roleMatch) {
      score += this.config.roleMatchBoost;
    }
    if (nameMatch) {
      score += this.config.nameMatchBoost;
    }

    // Apply starts-with boost for name matches (role already requires prefix)
    const nameStartsWithAny = queryWords.some(word => nameLower.startsWith(word));
    if (roleMatch) {
      // Role matches are already prefix-based, apply boost
      score *= this.config.startsWithBoost;
    } else if (nameMatch && nameStartsWithAny) {
      score *= this.config.startsWithBoost;
    }

    // Interactive element boost
    if (this.isInteractiveRole(parsed.role)) {
      score += this.config.interactiveBoost;

      // Additional boost for interactive elements inside iframes
      // This prioritizes actual UI controls in iframes over main frame content
      const frameOrdinal = parseFrameOrdinal(parsed.id);
      if (frameOrdinal > 0) {
        score += this.config.iframeInteractiveBoost;
      }
    }

    return { score, matchType };
  }

  private isInteractiveRole(role: string): boolean {
    return INTERACTIVE_ROLES.has(role.toLowerCase());
  }
}

// =============================================================================
// AccessibilityTreeSearcher
// =============================================================================

/**
 * Main search orchestrator for accessibility trees
 */
export class AccessibilityTreeSearcher {
  private parser: TreeLineParser;
  private scorer: SearchScorer;

  constructor(parser?: TreeLineParser, scorer?: SearchScorer) {
    this.parser = parser || new TreeLineParser();
    this.scorer = scorer || new SearchScorer();
  }

  /**
   * Search accessibility tree for elements matching query
   * @param tree Full accessibility tree string
   * @param query Search query
   * @param options Search options
   * @returns Matches sorted by relevance score (highest first)
   */
  search(tree: string, query: string, options?: SearchOptions): ScoredSearchMatch[] {
    // Validate inputs
    const trimmedQuery = query?.trim();
    if (!trimmedQuery || !tree) {
      return [];
    }

    // Merge options with defaults
    const opts = {
      ...DEFAULT_SEARCH_OPTIONS,
      ...options,
    };

    // Cap maxResults at 100 to prevent abuse
    const maxResults = Math.min(Math.max(opts.maxResults, 1), 100);

    // Use custom scorer if config provided, otherwise use instance scorer
    const scorer = options?.scoringConfig
      ? new SearchScorer(options.scoringConfig)
      : this.scorer;

    // Preprocess query once for efficiency (avoid re-splitting for every line)
    const queryWords = scorer.preprocessQuery(trimmedQuery);
    if (queryWords.length === 0) {
      return [];
    }

    const lines = tree.split('\n');
    const matches: ScoredSearchMatch[] = [];

    // Single pass through all lines
    for (let i = 0; i < lines.length; i++) {
      const parsed = this.parser.parse(lines[i], i);
      if (!parsed) {
        continue;
      }

      const { score, matchType } = scorer.scoreWithWords(queryWords, parsed);
      if (score === 0 || matchType === 'none') {
        continue;
      }

      // Build context if requested
      const context = opts.includeContext
        ? this.buildContext(lines, i, opts.contextLinesBefore, opts.contextLinesAfter)
        : '';

      // Extract frame ordinal from the encoded ID
      const frameOrdinal = parseFrameOrdinal(parsed.id);

      matches.push({
        id: parsed.id,
        role: parsed.role,
        name: parsed.name || parsed.raw.trim(),
        context,
        score,
        matchType,
        frameOrdinal,
      });
    }

    // Sort by score descending and limit results
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  private buildContext(
    lines: string[],
    matchIndex: number,
    linesBefore: number,
    linesAfter: number
  ): string {
    const start = Math.max(0, matchIndex - linesBefore);
    const end = Math.min(lines.length, matchIndex + linesAfter + 1);
    return lines.slice(start, end).join('\n');
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Search accessibility tree with default configuration
 * @param tree Full accessibility tree string
 * @param query Search query
 * @param maxResults Maximum results (default: 20, max: 100)
 * @returns Matches sorted by relevance
 */
export function searchAccessibilityTree(
  tree: string,
  query: string,
  maxResults: number = 20
): ScoredSearchMatch[] {
  const searcher = new AccessibilityTreeSearcher();
  return searcher.search(tree, query, { maxResults });
}
