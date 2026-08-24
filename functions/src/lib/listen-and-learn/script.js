/**
 * Write the two-host dialogue for one Listen & Learn episode.
 *
 * Grounding is deliberate: the model is given the *official* study guide area
 * — its name, exam weighting, sub-headings and objective bullets — and nothing
 * else. It is not given YouTube transcripts. A single outdated video
 * demonstrating a retired portal flow would otherwise be laundered into an
 * episode that sounds authoritative, and exam prep is exactly the context
 * where confidently wrong is worse than absent.
 *
 * Ported from Site-Main `functions/listen-and-learn/script.js` (088f458). The
 * prompt, the coverage requirement and the trimming rules are unchanged. Two
 * things differ:
 *
 *   - The model is reached through this repository's AI router rather than
 *     `lib/ai-model-router` directly, and arrives as an injected `generate`
 *     so the whole pipeline stays testable without a key.
 *   - The byte budget is no longer shaped by a per-request API cap. Upstream
 *     sized it around Cloud TTS's 4,000-byte `multiSpeakerMarkup` limit. Neither
 *     provider here has that shape: Gemini takes the whole script in one
 *     request inside a 32k-token session, and Azure chunks against a
 *     ten-minute audio cap. `MAX_SCRIPT_BYTES` is therefore an editorial bound
 *     — this is a refresher, and an unbounded episode is one nobody finishes.
 */

/**
 * Total script budget across all turns. Editorial, not technical: see the
 * header. Roughly 20-25 minutes of speech at the default voices' rate.
 */
export const MAX_SCRIPT_BYTES = 9000;

/** Floor for a small area, so a 3-objective section still gets a real episode. */
const MIN_TARGET_BYTES = 3600;

/**
 * Roughly this many bytes of speech per measured line item — about 30 words,
 * enough to say what a thing is and when you would reach for it. Areas vary
 * enormously (AZ-104 has 15 line items, SAA-C03 domain 1 has 32), so a fixed
 * budget either starves the big ones or pads the small ones.
 */
const BYTES_PER_LINE_ITEM = 190;

export function targetBytesFor(area) {
  const items = area.objectives?.length || 0;
  return Math.min(MAX_SCRIPT_BYTES, Math.max(MIN_TARGET_BYTES, 600 + items * BYTES_PER_LINE_ITEM));
}

/**
 * The host names the model is told to use, and what the speech providers map
 * onto voices. The two must agree — a turn whose speaker has no voice mapping
 * is a hard synthesis error, which is why validateScript rejects an unknown
 * name here rather than letting it reach the API.
 *
 * The prompt deliberately says nothing about the hosts' gender. Upstream did,
 * because the Google voices it used were both documented female; the Gemini
 * voice list publishes a descriptor per voice and no gender at all, so
 * asserting one in the script would be a claim about the audio that nothing
 * guarantees. Two hosts a listener can tell apart is the requirement, and that
 * is a property of the voice pairing (speech/gemini.js), not of the script.
 */
export const DEFAULT_SPEAKERS = { a: 'Maya', b: 'Elena' };

/**
 * Spoken first, every episode, before anything else.
 *
 * These are AI-generated summaries of an exam's objectives, published under
 * Saul's name on pages people study from. Saying so out loud — not only in
 * small print under the player — is the honest thing to do, and it is the one
 * line that must never be trimmed.
 */
export const DISCLAIMER =
  'Quick note before we start: as always, this is a refresher. ' +
  'It should not replace studying the core content and the official documentation.';

export class ScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScriptError';
  }
}

/** UTF-8 byte length of the text the synthesiser will actually receive. */
export function dialogueByteLength(turns) {
  return turns.reduce((total, turn) => total + Buffer.byteLength(turn.text || '', 'utf8'), 0);
}

/**
 * Drop whole turns from the end until the dialogue fits.
 *
 * Whole turns, never mid-sentence: a truncated final sentence is far more
 * jarring in audio than an episode that simply ends a beat early.
 *
 * The dangling-question guard only applies when trimming actually happened.
 * An earlier version dropped the final turn whenever it came from the same
 * host who opened, on the theory that a conversation should close on a
 * response. That was wrong, and the first live run proved it: the prompt asks
 * for a closing summary of what matters most, the lead host naturally
 * delivers it, and the rule deleted it every time — on a script 1,500 bytes
 * inside the limit, where no trimming was warranted at all.
 */
export function fitToByteLimit(turns, limit = MAX_SCRIPT_BYTES) {
  const kept = [...turns];
  let trimmed = false;
  while (kept.length > 1 && dialogueByteLength(kept) > limit) {
    kept.pop();
    trimmed = true;
  }
  // Only a cut-short episode can end mid-thought on a question nobody answers.
  if (trimmed && kept.length > 1 && /\?\s*$/.test(kept.at(-1).text)) {
    kept.pop();
  }
  return kept;
}

/**
 * Render the area as subsection → its own line items.
 *
 * Grouped rather than flat because the episode has to work through the guide
 * the way the guide is written. A flat list of 32 bullets invites the model to
 * summarise the theme and skip the specifics; showing the structure makes the
 * omissions obvious to it, and to anyone reviewing the transcript.
 */
function renderSections(area) {
  if (area.sections?.length) {
    return area.sections
      .map((section, i) => {
        const items = section.objectives.length
          ? section.objectives.map((o) => `     - ${o}`).join('\n')
          : '     (no line items listed)';
        return `  ${i + 1}. ${section.title}\n${items}`;
      })
      .join('\n');
  }
  // Guides that list objectives without sub-headings still get a flat list.
  return area.objectives.length
    ? area.objectives.map((o) => `     - ${o}`).join('\n')
    : '     (none listed)';
}

export function buildPrompt({ cert, area, speakers }) {
  const targetBytes = targetBytesFor(area);
  const lineItems = area.objectives?.length || 0;
  const sectionCount = area.sections?.length || 0;

  return `You are scripting one episode of a study podcast for the ${cert.examCode} certification exam (${cert.title}).

This episode covers a single scored area of the official study guide, and must cover it completely.

AREA: ${area.name}
EXAM WEIGHT: ${area.weightLabel || 'unspecified'}

SUBSECTIONS AND THEIR MEASURED LINE ITEMS:
${renderSections(area)}

Write a natural conversation between two hosts, ${speakers.a} and ${speakers.b}, that teaches this area to someone preparing for the exam.

COVERAGE — this is the requirement that matters most:
- Work through all ${sectionCount || 1} subsections in the order listed above, naming each one as you reach it.
- Address every one of the ${lineItems} line items. Not one is optional, and none may be merged away into a general remark about its subsection.
- Give each line item at least a sentence saying what it is and, where it is a task, how it is actually done or when you would choose it.
- Depth may vary — spend longer on the harder items — but nothing may be skipped.

Style:
- Ground every claim in the line items above. Do not introduce services, features or exam details that are not implied by them.
- ${speakers.a} leads and frames; ${speakers.b} asks the question a learner would ask and adds practical colour.
- Do not write stage directions, sound effects or speaker labels inside the text of a turn.
- Begin the very first turn with exactly this sentence, then continue naturally: "${DISCLAIMER}"
- After the disclaimer, name the area and its exam weight so the listener knows how much it matters.
- Close with the one or two things most worth remembering.
- Conversational but dense. No filler, no "welcome back to the show", no sponsor talk, no invented statistics.
- Aim for about ${targetBytes} bytes of UTF-8 across all turns (roughly ${Math.floor(targetBytes / 6)} words). Full coverage matters more than brevity, but do not pad.
- Alternate speakers. Use only the names ${speakers.a} and ${speakers.b}.

Return JSON only, matching exactly:
{
  "title": "short episode title, no exam code prefix",
  "summary": "one sentence describing what this episode covers",
  "keyTakeaways": ["3 to 5 short strings"],
  "dialogue": [{ "speaker": "${speakers.a}", "text": "..." }]
}`;
}

/** Reject anything that would make synthesis fail or produce a wrong episode. */
export function validateScript(parsed, { speakers }) {
  if (!parsed || typeof parsed !== 'object') {
    throw new ScriptError('Model did not return an object');
  }
  const dialogue = Array.isArray(parsed.dialogue) ? parsed.dialogue : null;
  if (!dialogue || dialogue.length === 0) {
    throw new ScriptError('Model returned no dialogue turns');
  }

  const allowed = new Set([speakers.a, speakers.b]);
  const turns = dialogue
    .map((turn) => ({
      speaker: String(turn?.speaker || '').trim(),
      text: String(turn?.text || '').trim(),
    }))
    .filter((turn) => turn.text);

  const unknown = turns.find((turn) => !allowed.has(turn.speaker));
  if (unknown) {
    // Each speech provider maps a speaker name to one of its voices; an
    // unmapped name reaches the API as a missing voice, so catch it here where
    // the message can name both the offender and what was expected.
    throw new ScriptError(
      `Dialogue used unknown speaker "${unknown.speaker}"; expected ${speakers.a} or ${speakers.b}`
    );
  }
  if (turns.length === 0) throw new ScriptError('Model returned only empty dialogue turns');

  return turns;
}

/**
 * Generate the script for one skill area.
 *
 * Returns the trimmed dialogue plus the metadata the episode card renders,
 * and reports whether trimming happened so a caller can log or regenerate.
 *
 * @param {object} params
 * @param {{ examCode: string, title: string }} params.cert
 * @param {object} params.area a parsed study-guide area
 * @param {{ a: string, b: string }} [params.speakers]
 * @param {Function} params.generate the router's `generateJsonResponse`
 * @param {object[]} [params.usageOut] the router appends this call's cost here
 */
export async function generateEpisodeScript({
  cert,
  area,
  speakers = DEFAULT_SPEAKERS,
  generate,
  usageOut,
}) {
  if (!cert?.examCode) throw new ScriptError('cert.examCode is required');
  if (!area?.name) throw new ScriptError('area.name is required');
  if (typeof generate !== 'function') throw new ScriptError('generate is required');

  const parsed = await generate({
    prompt: buildPrompt({ cert, area, speakers }),
    purpose: 'analysis',
    feature: 'listenAndLearn',
    // The router appends what the call actually cost, including which provider
    // served it after any failover. The run records it so the portal's spend
    // page shows the script half of an episode, not only the audio half.
    usageOut,
    systemPrompt:
      'You are a certification instructor who writes accurate, tightly-scoped audio scripts. You return JSON only.',
  });

  const allTurns = validateScript(parsed, { speakers });
  const turns = fitToByteLimit(allTurns, MAX_SCRIPT_BYTES);

  return {
    title: String(parsed.title || area.name).trim(),
    summary: String(parsed.summary || '').trim(),
    keyTakeaways: Array.isArray(parsed.keyTakeaways)
      ? parsed.keyTakeaways
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
    speakers,
    dialogue: turns,
    byteLength: dialogueByteLength(turns),
    trimmedTurns: allTurns.length - turns.length,
  };
}
