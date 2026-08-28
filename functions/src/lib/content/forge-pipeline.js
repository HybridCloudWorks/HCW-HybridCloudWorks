/**
 * forge-pipeline.js — deterministic post-generation helpers: dash scrub,
 * module repair, the forge module instruction, and title-similarity dedupe.
 *
 * Ported from Site-Main `lib/forge-pipeline.js` (088f458). `validateModules`,
 * `findBannedPhrases` and the module grammar constants were lifted earlier
 * into ../cms/content-modules.js and are imported from there; nothing here
 * does I/O.
 */
import {
  MODULE_TAG_REGEX,
  KNOWN_MODULE_TYPES,
  JSON_MODULE_TYPES,
  MAX_MODULES,
  MAX_STAT_BOARD_STATS,
} from '../cms/content-modules.js';

/**
 * Replace em/en dashes with comma or hyphen phrasing everywhere EXCEPT inside
 * code and design (Mermaid) modules, where dashes are syntax.
 */
export function scrubDashes(markdown = '') {
  const source = String(markdown || '');
  const segments = [];
  let lastIndex = 0;

  MODULE_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = MODULE_TAG_REGEX.exec(source)) !== null) {
    segments.push({ text: source.slice(lastIndex, match.index), protect: false });
    const [, type] = match;
    segments.push({ text: match[0], protect: type === 'code' || type === 'design' });
    lastIndex = match.index + match[0].length;
  }
  segments.push({ text: source.slice(lastIndex), protect: false });

  return segments
    .map((segment) => {
      if (segment.protect) return segment.text;
      return segment.text
        .replace(/\s*—\s*/g, ', ')
        .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
        .replace(/\s*–\s*/g, ', ');
    })
    .join('');
}

/**
 * Forge-specific module instruction appended after buildVoiceAndFormatBlock.
 * Overrides the base MODULE_TAG_SYNTAX prohibition on picture/spacer modules
 * because the forge pipeline resolves picture placeholders into a generated
 * image pack afterwards.
 */
export function buildForgeModuleInstruction(format) {
  const formatModules = format?.modules?.use?.join(', ') || 'fact, recommendation';
  return `ContentForge module requirements (these OVERRIDE the earlier "never emit picture/video/spacer" rule):
- Include 4 to 8 module tags total, spread through the article where they belong contextually.
- Vary align between "left" and "right" so consecutive modules alternate sides; use align="all" only for design modules.
- Include at least one spacer module as a visual break between major sections: <module type="spacer">{"style":"gradient"}</module>. Valid styles: gradient, solid, dots, double, glow, accent.
- Include at least one fact or recommendation module.
- Prioritize the format's module types (${formatModules}) plus variety from: code, links, text, design, pull_quote, stat_board, comparison, timeline, callout.
- You MAY include one or two picture modules as placeholders for generated images. Use empty imageUrl and a detailed imagePrompt describing the image to generate: <module type="picture" align="right">{"imageUrl":"","caption":"...","imagePrompt":"detailed image generation prompt"}</module>
- Still never emit video modules.
- Two text modules back to back (one align="left", one align="right") render side by side; use that for comparisons.`;
}

// ── Deterministic module repair ─────────────────────────────────────────────
//
// The prompt asks for 4-8 modules, but models routinely overshoot (16+ has
// been observed) or emit malformed modules. Repair fixes what can be fixed
// mechanically: strip invalid align attributes, remove empty/broken modules,
// and when the count still exceeds MAX_MODULES, unwrap the excess (from the
// end of the document) into plain markdown so no prose is lost.

const MAX_SPACERS = 2;
const MAX_PICTURE_PLACEHOLDERS = 2;
const VALID_ALIGNS = ['left', 'right', 'all'];

function buildModuleTag(type, align, content) {
  return `<module type="${type}"${align ? ` align="${align}"` : ''}>${content}</module>`;
}

function linksModuleToMarkdown(content) {
  try {
    const parsed = JSON.parse(String(content || '').trim());
    const links = Array.isArray(parsed.links) ? parsed.links : [];
    return links
      .filter((link) => link && link.url)
      .map((link) => `- [${link.title || link.label || link.url}](${link.url})`)
      .join('\n');
  } catch {
    return '';
  }
}

/** Best-effort JSON body → object; null when it is not a usable object. */
function parseJsonBody(content) {
  try {
    const parsed = JSON.parse(String(content || '').trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Plain-markdown fallback for a module that has to stop being a module.
// Every content-carrying type needs a case here: the default silently drops
// the body, which is only acceptable for the purely visual types.
function unwrapModuleContent(type, content) {
  const body = String(content || '').trim();
  switch (type) {
    case 'text':
    case 'fact':
    case 'recommendation':
      return body;
    case 'code':
      return body.startsWith('```') ? body : `\`\`\`\n${body}\n\`\`\``;
    case 'design':
      return body.startsWith('```') ? body : `\`\`\`mermaid\n${body}\n\`\`\``;
    case 'links':
      return linksModuleToMarkdown(body);
    case 'pull_quote': {
      const parsed = parseJsonBody(body);
      const text = String(parsed?.text || '').trim();
      if (!text) return '';
      const attribution = String(parsed?.attribution || '').trim();
      return attribution ? `> ${text}\n>\n> ${attribution}` : `> ${text}`;
    }
    case 'stat_board': {
      const parsed = parseJsonBody(body);
      const stats = Array.isArray(parsed?.stats) ? parsed.stats : [];
      return stats
        .map((stat) => ({
          label: String(stat?.label || '').trim(),
          value: String(stat?.value ?? '').trim(),
        }))
        .filter((stat) => stat.label || stat.value)
        .map(
          (stat) =>
            `- ${stat.label && stat.value ? `${stat.label}: ${stat.value}` : stat.label || stat.value}`
        )
        .join('\n');
    }
    case 'comparison': {
      const parsed = parseJsonBody(body);
      const columns = Array.isArray(parsed?.columns) ? parsed.columns : [];
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      if (columns.length < 2) return '';
      const line = (cells) => `| ${cells.map((cell) => String(cell ?? '').trim()).join(' | ')} |`;
      return [line(columns), line(columns.map(() => '---')), ...rows.map(line)].join('\n');
    }
    case 'timeline': {
      const parsed = parseJsonBody(body);
      const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
      return steps
        .map((step) => ({
          title: String(step?.title || '').trim(),
          body: String(step?.body || '').trim(),
        }))
        .filter((step) => step.title || step.body)
        .map(
          (step, i) =>
            `${i + 1}. ${step.title && step.body ? `${step.title}: ${step.body}` : step.title || step.body}`
        )
        .join('\n');
    }
    case 'callout': {
      const parsed = parseJsonBody(body);
      const title = String(parsed?.title || '').trim();
      const calloutBody = String(parsed?.body || '').trim();
      if (!title) return calloutBody;
      return calloutBody ? `**${title}**: ${calloutBody}` : `**${title}**`;
    }
    default:
      // picture placeholders, video, spacer: purely visual, safe to drop.
      return '';
  }
}

/**
 * Why validateModules would reject this JSON module's parsed payload, or null
 * when the payload is semantically sound. Mirrors the per-type checks in
 * content-modules.js validateModules — keep the two in lockstep.
 */
function jsonModuleSemanticIssue(type, parsed) {
  if (type === 'pull_quote' && !String(parsed.text || '').trim()) {
    return 'with no text';
  }
  if (type === 'stat_board') {
    const stats = Array.isArray(parsed.stats) ? parsed.stats : [];
    if (stats.length < 2 || stats.length > MAX_STAT_BOARD_STATS) {
      return `with ${stats.length} stats (needs 2-${MAX_STAT_BOARD_STATS})`;
    }
    if (stats.some((stat) => !String(stat?.value ?? '').trim() || !String(stat?.label || '').trim())) {
      return 'with a stat missing value or label';
    }
  }
  if (type === 'comparison') {
    const columns = Array.isArray(parsed.columns) ? parsed.columns : [];
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    if (columns.length < 2 || !rows.length) {
      return 'without at least 2 columns and 1 row';
    }
    if (rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
      return 'with a row that does not match its columns';
    }
  }
  if (type === 'timeline') {
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    if (steps.length < 2) return 'with fewer than 2 steps';
    if (steps.some((step) => !String(step?.title || '').trim())) return 'with an untitled step';
  }
  if (
    type === 'callout' &&
    (!String(parsed.title || '').trim() || !String(parsed.body || '').trim())
  ) {
    return 'missing title or body';
  }
  return null;
}

/** Pass-1 verdict for one module: a replacement when it must stop being a module, else null. */
function repairModuleStructure(mod) {
  if (!KNOWN_MODULE_TYPES.has(mod.type)) {
    return {
      replacement: String(mod.content || '').trim(),
      repair: `Unwrapped unknown module type "${mod.type}"`,
    };
  }
  if (JSON_MODULE_TYPES.has(mod.type)) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(mod.content || '').trim());
    } catch {
      return {
        replacement: unwrapModuleContent(mod.type, mod.content),
        repair: `Removed ${mod.type} module with invalid JSON`,
      };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        replacement: '',
        repair: `Removed ${mod.type} module whose JSON body is not an object`,
      };
    }
    if (
      mod.type === 'picture' &&
      !String(parsed.imageUrl || '').trim() &&
      !String(parsed.imagePrompt || '').trim()
    ) {
      return {
        replacement: '',
        repair: 'Removed picture module with neither imageUrl nor imagePrompt',
      };
    }
    if (mod.type === 'links' && !(Array.isArray(parsed.links) && parsed.links.length)) {
      return { replacement: '', repair: 'Removed links module with no links' };
    }
    const semanticIssue = jsonModuleSemanticIssue(mod.type, parsed);
    if (semanticIssue) {
      return {
        replacement: unwrapModuleContent(mod.type, mod.content),
        repair: `Unwrapped ${mod.type} module ${semanticIssue}`,
      };
    }
    return null;
  }
  if (!String(mod.content || '').trim()) {
    return { replacement: '', repair: `Removed empty ${mod.type} module` };
  }
  return null;
}

/** Pass 2: thin decorative modules while over the cap. */
function thinDecorativeModules(modules, isStillModule, overCap, replacements, repairs) {
  for (const [budget, matchType, label] of [
    [MAX_SPACERS, 'spacer', 'excess spacer module'],
    [MAX_PICTURE_PLACEHOLDERS, 'picture', 'excess picture placeholder module'],
  ]) {
    if (!overCap()) break;
    let seen = 0;
    for (const mod of modules) {
      if (!isStillModule(mod) || mod.type !== matchType) continue;
      seen += 1;
      if (seen <= budget) continue;
      replacements.set(mod, unwrapModuleContent(mod.type, mod.content));
      repairs.push(`Removed ${label}`);
      if (!overCap()) break;
    }
  }
}

/**
 * Mechanically repair module defects so validateModules can pass.
 * @returns {{ markdown: string, repairs: string[] }}
 */
export function repairModules(markdown = '', maxModules = MAX_MODULES) {
  const source = String(markdown || '');
  const modules = [];
  MODULE_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = MODULE_TAG_REGEX.exec(source)) !== null) {
    modules.push({
      raw: match[0],
      index: match.index,
      type: match[1],
      align: match[2],
      content: match[3],
    });
  }
  if (!modules.length) return { markdown: source, repairs: [] };

  const repairs = [];
  const replacements = new Map(); // module -> replacement string ('' = remove)

  for (const mod of modules) {
    const structural = repairModuleStructure(mod);
    if (structural) {
      replacements.set(mod, structural.replacement);
      repairs.push(structural.repair);
      continue;
    }
    if (mod.align && !VALID_ALIGNS.includes(mod.align)) {
      replacements.set(mod, buildModuleTag(mod.type, null, mod.content));
      repairs.push(`Dropped invalid align "${mod.align}" on a ${mod.type} module`);
    }
  }

  const isStillModule = (mod) => {
    const replacement = replacements.get(mod);
    return replacement === undefined || replacement.startsWith('<module ');
  };
  const overCap = () => modules.filter(isStillModule).length > maxModules;
  thinDecorativeModules(modules, isStillModule, overCap, replacements, repairs);

  if (overCap()) {
    for (let i = modules.length - 1; i >= 0 && overCap(); i -= 1) {
      const mod = modules[i];
      if (!isStillModule(mod)) continue;
      replacements.set(mod, unwrapModuleContent(mod.type, mod.content));
      repairs.push(`Unwrapped ${mod.type} module over the ${maxModules}-module cap`);
    }
  }

  if (!repairs.length) return { markdown: source, repairs: [] };

  let rebuilt = '';
  let cursor = 0;
  for (const mod of modules) {
    rebuilt += source.slice(cursor, mod.index);
    const replacement = replacements.get(mod);
    rebuilt += replacement === undefined ? mod.raw : replacement;
    cursor = mod.index + mod.raw.length;
  }
  rebuilt += source.slice(cursor);
  rebuilt = rebuilt.replace(/\n{3,}/g, '\n\n');

  return { markdown: rebuilt, repairs };
}

// ── Dedupe vs published corpus ───────────────────────────────────────────────

const TITLE_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'your',
  'how',
  'what',
  'why',
  'is',
  'are',
  'vs',
  'via',
  'from',
  'into',
  'using',
]);

export function titleTokens(title = '') {
  return new Set(
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !TITLE_STOPWORDS.has(token))
  );
}

/**
 * Jaccard similarity of meaningful title tokens against the corpus.
 * 0.55 default threshold: "AKS networking deep dive" vs "Deep dive into AKS
 * networking" collide; different topics on the same service do not.
 * @returns {{ similar: boolean, bestScore: number, bestTitle: string|null }}
 */
export function findSimilarTitle(candidateTitle, publishedTitles = [], threshold = 0.55) {
  const candidate = titleTokens(candidateTitle);
  if (!candidate.size) return { similar: false, bestScore: 0, bestTitle: null };

  let bestScore = 0;
  let bestTitle = null;
  for (const publishedTitle of publishedTitles) {
    const published = titleTokens(publishedTitle);
    if (!published.size) continue;
    let intersection = 0;
    for (const token of candidate) if (published.has(token)) intersection += 1;
    const union = candidate.size + published.size - intersection;
    const score = union > 0 ? intersection / union : 0;
    if (score > bestScore) {
      bestScore = score;
      bestTitle = publishedTitle;
    }
  }
  return { similar: bestScore >= threshold, bestScore, bestTitle };
}
