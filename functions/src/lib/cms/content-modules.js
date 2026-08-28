/**
 * Pure content-linting primitives: banned-phrase detection and inline-module
 * validation.
 *
 * The innermost layer of the content-quality graph the api-surface contract
 * bounds. In Site-Main this logic is scattered across three files that also
 * hold AI and pipeline code — `content-voice.js` (BANNED_PHRASES,
 * mergeBannedPhrases), `forge-pipeline.js` (validateModules, findBannedPhrases,
 * the MODULE_* constants) and `content-critique.js` (scanBannedPhrases). Only
 * these pure pieces are consumed by the quality scorers, so they are lifted
 * here as one self-contained module rather than dragging the AI-bearing files
 * across.
 *
 * Nothing here does I/O: no Firestore, no network, no process.env. Ported to
 * ESM directly; the source functions were already side-effect free.
 *
 * MODULE_TAG_REGEX must stay in lockstep with the frontend parser
 * (frontend/src/lib/moduleParser.js) — the LLM's output is parsed by the same
 * grammar as hand-authored modules, so a drift here silently breaks rendering.
 */

/**
 * Overused AI-tell phrases. Ported verbatim from Site-Main content-voice.js:136
 * — the editorial critique and quality gate both key off this exact list, so it
 * is copied rather than paraphrased.
 */
export const BANNED_PHRASES = [
  "in today's fast-paced digital landscape",
  'in the ever-evolving world of',
  "it's important to note that",
  'unlock the power of',
  'unlock the full potential',
  'seamless integration',
  'seamlessly integrate',
  'robust solution',
  'game-changer',
  'game changing',
  "let's dive in",
  "let's explore",
  'delve into',
  'in conclusion',
  'in summary',
  'at the end of the day',
  'the world of',
  'navigate the complexities',
  'take your ... to the next level',
  'whether you are a beginner or an expert',
  'as we all know',
  'cutting-edge',
  'stay ahead of the curve',
];

/** Inline module grammar. Global flag: callers must reset lastIndex before use. */
export const MODULE_TAG_REGEX =
  /<module\s+type="(\w+)"(?:\s+align="([^"]*)")?\s*>([\s\S]*?)<\/module>/g;

// The type list and each JSON payload schema are specified in
// wiki/Blog-Machine.md (the cross-package contract of record); the frontend
// twin lists live in frontend/src/lib/moduleParser.js, and each side carries
// a test asserting its list matches the documented set.
export const KNOWN_MODULE_TYPES = new Set([
  'fact', 'recommendation', 'text', 'code', 'design', 'links', 'picture', 'video', 'spacer',
  'pull_quote', 'stat_board', 'comparison', 'timeline', 'callout',
]);

/** Types whose body must be a JSON object rather than free text. */
export const JSON_MODULE_TYPES = new Set([
  'links', 'picture', 'video', 'spacer',
  'pull_quote', 'stat_board', 'comparison', 'timeline', 'callout',
]);

export const MAX_MODULES = 14;

export const MAX_STAT_BOARD_STATS = 4;

/**
 * Merge extra banned phrases into the base set, de-duplicated and trimmed.
 * Source: content-voice.js:175.
 */
export function mergeBannedPhrases(extraBanned = []) {
  const extras = (extraBanned || []).map((p) => String(p || '').trim()).filter(Boolean);
  return [...new Set([...BANNED_PHRASES, ...extras])];
}

/**
 * Banned phrases present in `markdown`. Phrases containing '...' are skipped —
 * they are display-only patterns ("take your ... to the next level") that would
 * never match literally. Source: forge-pipeline.js:61.
 */
export function findBannedPhrases(markdown = '', extraBanned = []) {
  const text = String(markdown || '').toLowerCase();
  return mergeBannedPhrases(extraBanned).filter(
    (phrase) => !phrase.includes('...') && text.includes(phrase.toLowerCase())
  );
}

/**
 * Literal-substring banned-phrase scan (no '...' skipping, no extras). The
 * critique path uses this stricter variant. Source: content-critique.js:9.
 */
export function scanBannedPhrases(text = '') {
  const lower = String(text || '').toLowerCase();
  return BANNED_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

/**
 * Validate the inline module tags in a forged draft against the grammar.
 * Source: forge-pipeline.js:72. Return shape is load-bearing —
 * buildContentQualityReport keys off { valid, moduleCount, issues, picturePrompts }.
 *
 * @returns {{ valid: boolean, moduleCount: number, issues: string[], picturePrompts: string[] }}
 */
export function validateModules(markdown = '') {
  const issues = [];
  const picturePrompts = [];
  let moduleCount = 0;

  MODULE_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = MODULE_TAG_REGEX.exec(String(markdown || ''))) !== null) {
    moduleCount += 1;
    const [, type, align, content] = match;

    if (!KNOWN_MODULE_TYPES.has(type)) {
      issues.push(`Unknown module type "${type}"`);
      continue;
    }
    if (align && !['left', 'right', 'all'].includes(align)) {
      issues.push(`Module ${moduleCount} (${type}) has invalid align "${align}"`);
    }
    if (JSON_MODULE_TYPES.has(type)) {
      try {
        const parsed = JSON.parse(content.trim());
        // A JSON body must be an object, not a bare value: `5` parses but no
        // renderer can do anything with it, and the semantic checks below
        // would silently pass for types without one.
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          issues.push(`Module ${moduleCount} (${type}) JSON body is not an object`);
          continue;
        }
        if (type === 'picture') {
          const prompt = String(parsed.imagePrompt || '').trim();
          if (prompt) picturePrompts.push(prompt);
          else if (!String(parsed.imageUrl || '').trim()) {
            issues.push(`Picture module ${moduleCount} has neither imageUrl nor imagePrompt`);
          }
        }
        if (type === 'links') {
          const links = Array.isArray(parsed.links) ? parsed.links : [];
          if (!links.length) issues.push(`Links module ${moduleCount} has no links`);
        }
        if (type === 'pull_quote' && !String(parsed.text || '').trim()) {
          issues.push(`Pull-quote module ${moduleCount} has no text`);
        }
        if (type === 'stat_board') {
          const stats = Array.isArray(parsed.stats) ? parsed.stats : [];
          if (stats.length < 2 || stats.length > MAX_STAT_BOARD_STATS) {
            issues.push(
              `Stat-board module ${moduleCount} needs 2-${MAX_STAT_BOARD_STATS} stats, has ${stats.length}`
            );
          } else if (
            stats.some(
              (stat) => !String(stat?.value ?? '').trim() || !String(stat?.label || '').trim()
            )
          ) {
            issues.push(`Stat-board module ${moduleCount} has a stat missing value or label`);
          }
        }
        if (type === 'comparison') {
          const columns = Array.isArray(parsed.columns) ? parsed.columns : [];
          const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
          if (columns.length < 2 || !rows.length) {
            issues.push(`Comparison module ${moduleCount} needs at least 2 columns and 1 row`);
          } else if (rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
            issues.push(
              `Comparison module ${moduleCount} has a row that does not match its ${columns.length} columns`
            );
          }
        }
        if (type === 'timeline') {
          const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
          if (steps.length < 2) {
            issues.push(`Timeline module ${moduleCount} needs at least 2 steps`);
          } else if (steps.some((step) => !String(step?.title || '').trim())) {
            issues.push(`Timeline module ${moduleCount} has a step with no title`);
          }
        }
        if (
          type === 'callout' &&
          (!String(parsed.title || '').trim() || !String(parsed.body || '').trim())
        ) {
          issues.push(`Callout module ${moduleCount} needs both title and body`);
        }
      } catch {
        issues.push(`Module ${moduleCount} (${type}) content is not valid JSON`);
      }
    } else if (!String(content || '').trim()) {
      issues.push(`Module ${moduleCount} (${type}) is empty`);
    }
  }

  if (moduleCount > MAX_MODULES) {
    issues.push(`Too many modules: ${moduleCount} (max ${MAX_MODULES})`);
  }

  return { valid: issues.length === 0, moduleCount, issues, picturePrompts };
}
