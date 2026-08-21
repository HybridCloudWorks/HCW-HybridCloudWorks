/**
 * voice.js — vertical voice, rotating formats and the anti-generic guardrails
 * every generated article is prompted with.
 *
 * Ported from Site-Main `lib/content-voice.js` (088f458). The banned-phrase
 * list and `mergeBannedPhrases` already live in ../cms/content-modules.js
 * (lifted earlier for the quality scorers); this module reuses them rather
 * than carrying a second copy that would drift.
 *
 * One I/O function, `pickNextFormat`, reads the last few inspected documents
 * for a provider so consecutive posts do not all come out the same shape. It
 * fails open to the first library format: a missing index must never block
 * an ingest.
 */
import { mergeBannedPhrases } from '../cms/content-modules.js';

export const VERTICAL_VOICE = Object.freeze({
  aws: 'Write as an AWS-focused practitioner. Reference actual service names, tiers, and quotas (e.g. "m6i.2xlarge", "gp3 volumes", specific IAM actions) rather than generic "cloud compute" language. Where the source supports it, include real CLI commands (aws ...) or console navigation steps.',
  azure:
    'Write as an Azure-focused practitioner. Reference actual resource types and SKUs (e.g. "Premium_LRS", "Standard_D4s_v5") and, where the source supports it, real Azure CLI (az ...) or ARM/Bicep snippets rather than generic descriptions.',
  gcp: 'Write as a GCP-focused practitioner. Reference actual product names and tiers (e.g. "e2-standard-4", "Cloud SQL for PostgreSQL") and, where the source supports it, real gcloud CLI commands rather than generic descriptions.',
  vmware:
    'Write as a VMware infrastructure practitioner (vSphere, NSX, VCF). Reference actual component names, version numbers, and configuration specifics rather than generic virtualization language.',
  ansible:
    'Write as an automation engineer. Where the source supports it, include an actual playbook/task YAML excerpt rather than describing automation in the abstract.',
  github:
    'Write as a DevOps engineer using GitHub. Where the source supports it, include an actual GitHub Actions YAML snippet or CLI command rather than describing the workflow in the abstract.',
  terraform:
    'Write as an infrastructure-as-code practitioner. Where the source supports it, quote an actual HCL resource block rather than describing the configuration in the abstract.',
  finops:
    'Write as a FinOps practitioner. Every claim should tie back to a concrete dollar amount, percentage, or unit-cost figure from the source — never just "reduces costs" without a number.',
  multi:
    'Write as a platform engineer comparing providers. Be explicit about which claim applies to which provider — never blur them into one generic "the cloud" statement.',
});

const DEFAULT_VOICE = VERTICAL_VOICE.multi;

export function normalizeProviderKey(cloudProvider) {
  return String(cloudProvider || '')
    .trim()
    .toLowerCase();
}

export function voiceForProvider(cloudProvider) {
  return VERTICAL_VOICE[normalizeProviderKey(cloudProvider)] || DEFAULT_VOICE;
}

// Rotating structural skeletons, so consecutive posts — even for the same
// provider — do not all open the same way, run the same length, or close with
// the same "conclusion" section.
export const FORMAT_LIBRARY = Object.freeze([
  {
    key: 'how_to',
    label: 'How-To / Tutorial',
    wordRange: [1000, 1500],
    structure:
      'Open with the specific problem being solved (one sentence, no throat-clearing). Then numbered steps, each with a command or config snippet where the source supports it. Close with a short "Verify it worked" check, not a generic conclusion.',
    modules: {
      min: 2,
      max: 4,
      use: ['recommendation', 'code'],
      note: 'A recommendation module for one best-practice callout tied to a step, plus a code module for the actual command/snippet if the source has one.',
    },
  },
  {
    key: 'comparison',
    label: 'Comparison / Trade-off',
    wordRange: [900, 1300],
    structure:
      'State the two (or more) options being compared in the first sentence. Use a short comparison table or bullet contrast for the 3-4 dimensions that actually matter (cost, latency, ops burden, lock-in). End with a one-sentence recommendation tied to a specific use case, not "it depends."',
    modules: {
      min: 2,
      max: 3,
      use: ['text', 'text', 'fact'],
      note: 'Two text (frame) modules placed back to back, one align="left" and one align="right", each listing one option\'s specifics — they render as a side-by-side pair. Optionally one fact module for a tangential stat.',
    },
  },
  {
    key: 'checklist',
    label: 'Checklist',
    wordRange: [700, 1100],
    structure:
      'A scannable checklist of 6-10 concrete, individually actionable items grouped under 2-3 short headers. Each item is a specific check or action, not a vague principle. No introduction longer than two sentences.',
    modules: {
      min: 1,
      max: 2,
      use: ['fact'],
      note: 'One fact module with a genuinely interesting, tangential trivia point about the topic (origin story, an odd historical detail) — adds a hook without padding the checklist itself.',
    },
  },
  {
    key: 'case_study',
    label: 'Case Study / Real-World Walkthrough',
    wordRange: [1200, 1700],
    structure:
      'Frame around the specific scenario from the source: the starting state, what changed, and the measurable outcome. Include at least one concrete number (before/after). Avoid generic "many organizations struggle with..." framing.',
    modules: {
      min: 2,
      max: 4,
      use: ['fact', 'links'],
      note: 'One fact module for a supporting stat, one links module pointing back to the source/reference material. Add a design module only if the scenario involves an architecture worth diagramming.',
    },
  },
  {
    key: 'contrarian',
    label: 'Contrarian Take / Myth-Bust',
    wordRange: [800, 1200],
    structure:
      'Open by stating the common assumption, then immediately state why it is wrong or incomplete, backed by a specific detail from the source. Structure as claim, then evidence, then what to do instead. Do not hedge every sentence.',
    modules: {
      min: 2,
      max: 3,
      use: ['recommendation', 'fact'],
      note: 'One recommendation module for what to do instead of the myth, one fact module for a supporting data point.',
    },
  },
  {
    key: 'news_analysis',
    label: 'News Analysis',
    wordRange: [700, 1100],
    structure:
      'Lead with what actually changed (the news), not background context. Then explain the concrete practical impact for a practitioner in one or two sections. Skip generic "this is significant because cloud is important" framing entirely.',
    modules: {
      min: 1,
      max: 2,
      use: ['links'],
      note: 'One links module pointing to the original announcement/source.',
    },
  },
  {
    key: 'deep_dive',
    label: 'Technical Deep Dive',
    wordRange: [1600, 2200],
    structure:
      'Cover architecture/mechanism first, then trade-offs, then a concrete implementation detail (code, config, or CLI). Reserve this format for sources with enough technical depth to sustain it — do not pad a thin source to hit this length.',
    modules: {
      min: 3,
      max: 6,
      use: ['design', 'code', 'fact'],
      note: 'A design module (Mermaid diagram) of the architecture or flow being described when the topic is architectural, a code module for a real snippet, and a fact or recommendation module. The design module is the highest-value module for this format — use it whenever there is a system, pipeline, or flow to diagram.',
    },
  },
]);

// Exact tag syntax the frontend module parser expects
// (frontend/src/lib/moduleParser.js, MODULE_TAG_REGEX in content-modules.js).
export const MODULE_TAG_SYNTAX = `Modules are inline tags embedded directly in postContent markdown at the point they belong contextually — never all clustered at the end. Exact syntax per type:
- fact (interesting, tangential trivia related to the topic — not core information): <module type="fact" align="left">...</module>
- recommendation (a concrete, actionable best-practice tip): <module type="recommendation" align="left">...</module>
- text (a standalone callout; place two in a row — one align="left", one align="right" — for a two-column comparison, they render side by side): <module type="text" align="left">...</module>
- code (a real command, config, or code snippet taken from or clearly implied by the source — plain text inside the tag, no markdown code fences): <module type="code" align="left">...</module>
- links (reference links; content must be a single JSON object, not markdown): <module type="links" align="left">{"links":[{"title":"...","url":"..."}]}</module>
- design (an architecture, flow, or sequence diagram as Mermaid syntax, e.g. "graph TD" or "sequenceDiagram" — plain Mermaid text inside the tag): <module type="design" align="all">...</module>

align is one of "left", "right", "all". Never emit picture, video, or spacer modules — there is no real media to put there and a broken placeholder is worse than no module. Never fabricate a links URL that isn't the source URL or a well-known official documentation page.`;

export function buildBannedPhrasesClause(extraBanned = []) {
  return `Never use these overused AI-sounding phrases or close variants of them: ${mergeBannedPhrases(
    extraBanned
  )
    .map((phrase) => `"${phrase}"`)
    .join(', ')}.`;
}

export function buildStyleRulesClause(styleRules = {}) {
  const rules = [];
  if (styleRules.noEmDash !== false) {
    rules.push(
      'Never use em dashes (—) or en dashes (–) anywhere. Restructure with commas, periods, or parentheses instead.'
    );
  }
  if (styleRules.noHyphenTells !== false) {
    rules.push(
      'Avoid hyphenated compound-adjective pileups ("cutting-edge", "best-in-class", "purpose-built"). Only hyphenate when grammar genuinely requires it (real service names, CLI flags, config keys are fine).'
    );
  }
  for (const custom of styleRules.custom || []) rules.push(String(custom));
  return rules.length ? `Style rules (hard requirements):\n- ${rules.join('\n- ')}` : '';
}

// Deterministic, not random: the first library format not in the recent
// history, so re-running the same source yields the same format.
export function pickFormat(recentFormatKeys = []) {
  const recent = new Set((recentFormatKeys || []).filter(Boolean));
  const unused = FORMAT_LIBRARY.filter((format) => !recent.has(format.key));
  return (unused.length > 0 ? unused : FORMAT_LIBRARY)[0];
}

/**
 * The format the next article for this provider should take, from the last
 * few inspected documents. Fails open to the first format.
 *
 * @param {{ queryDocs: Function }} store
 * @param {string} collectionName
 * @param {string|null} cloudProvider
 */
export async function pickNextFormat(
  store,
  collectionName,
  cloudProvider,
  { historyLimit = 5 } = {}
) {
  try {
    const where = cloudProvider ? 'WHERE c.cloudProvider = @provider' : '';
    const rows = await store.queryDocs(
      collectionName,
      `SELECT TOP ${Math.max(1, historyLimit)} c.format FROM c ${where} ORDER BY c.scrapedAt DESC`.replace(
        /\s+/g,
        ' '
      ),
      cloudProvider ? [{ name: '@provider', value: cloudProvider }] : []
    );
    return pickFormat((rows || []).map((row) => row?.format).filter(Boolean));
  } catch {
    return FORMAT_LIBRARY[0];
  }
}

/**
 * The Voice + Format block appended to the analysis system prompt. `overrides`
 * carries the admin-editable pieces from admin_config/forge_prompts
 * ({ masterPrompt, extraBanned, styleRules }); all optional.
 */
export function buildVoiceAndFormatBlock(cloudProvider, format, overrides = {}) {
  const voice = voiceForProvider(cloudProvider);
  const chosenFormat = format || FORMAT_LIBRARY[0];
  const [minWords, maxWords] = chosenFormat.wordRange;
  const modules = chosenFormat.modules || { min: 1, max: 3, use: ['fact'], note: '' };
  const masterPrefix = String(overrides.masterPrompt || '').trim();
  const styleClause = buildStyleRulesClause(overrides.styleRules || {});

  return `${masterPrefix ? `${masterPrefix}\n\n` : ''}Voice: ${voice}

Format for this article: "${chosenFormat.label}" (internal key: ${chosenFormat.key}).
Structure: ${chosenFormat.structure}
Target length for this format: ${minWords}-${maxWords} words. Do not pad to hit the top of the range if the source does not support it — a shorter, denser article beats a padded one.

${buildBannedPhrasesClause(overrides.extraBanned)}${styleClause ? `\n${styleClause}` : ''}
Ground every claim in specifics from the source (numbers, names, commands, error messages, versions) rather than paraphrasing it at a higher level of abstraction. If the source lacks a specific detail a section would need, say so plainly instead of inventing one.

Modules: include between ${modules.min} and ${modules.max} module tags in postContent for this format, prioritizing types: ${modules.use.join(', ')}. ${modules.note} Skip a module type from that list if the source genuinely doesn't support it rather than forcing one in — but never fall below the minimum of ${modules.min}.

${MODULE_TAG_SYNTAX}`;
}
