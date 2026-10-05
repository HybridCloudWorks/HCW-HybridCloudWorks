/**
 * tasks.js — the AI task registry (ADR 0034 slice 1, #856).
 *
 * Every piece of work the site sends to a model is a task here: what it is
 * called, what it does, what an administrator will notice when it is off,
 * what kind of answer it needs (`modality`), the capabilities a model must
 * carry to serve it (`needs`), whether anonymous visitors can trigger it
 * (`public`), and the model the site recommends for it with the reason.
 *
 * `features-catalogue.js` derives AI_FEATURES (label, description, route) from
 * this table, so the feature switches, the call-site test and the portal's
 * toggles keep working unchanged; the ids are the feature names. Slices 2–5
 * of ADR 0034 add the catalogue, the resolver and the Tasks tab on top of
 * this file; nothing reads `modality`, `needs` or `recommended` yet.
 *
 * RECOMMENDATIONS ARE CLAIMS WITH A DATE. Each names a provider and a model
 * the cost table prices (tasks.test.js refuses an unpriced one), and says
 * why in terms of cost, quality and measured latency, with the day the
 * claim was made. The weekly probe and the usage page are what contradict a
 * stale one; the fix is a new line here with a new date, reviewed like any
 * other code.
 *
 * Owner decisions behind the choices (2026-10-04): Microsoft Foundry is the
 * paid provider for content work, first for the content features and never
 * for the public explain route; GPT-5 mini for anything that reads a whole
 * draft or article, nano for short answers. The public route stays on
 * Gemini Flash-Lite, the cheapest fast model the owner has run there since
 * 2026-08-23. Source grounding is Gemini by construction (router.js header).
 */

/** The kinds of answer a task asks for. Slice 5 adds the audio and image ones. */
export const MODALITIES = Object.freeze(['text', 'json', 'vision']);

/** The capabilities a model can carry; a task's `needs` is a subset. */
export const CAPABILITIES = Object.freeze(['text', 'json', 'vision', 'grounding']);

const ASOF = '2026-10-05';

const foundryMini = (why) =>
  Object.freeze({
    provider: 'foundry',
    model: 'gpt-5-mini',
    reason: `${why} GPT-5 mini on Foundry: $0.25 in / $2.00 out per 1M tokens, 2–3 s on the card's Test (2026-10-04), billed to the app subscription under its own budget.`,
    asOf: ASOF,
  });

const foundryNano = (why) =>
  Object.freeze({
    provider: 'foundry',
    model: 'gpt-5-nano',
    reason: `${why} GPT-5 nano on Foundry: $0.05 in / $0.40 out per 1M tokens, the cheapest model on the catalogue, 2.5 s on the card's Test (2026-10-04).`,
    asOf: ASOF,
  });

const geminiLite = (why) =>
  Object.freeze({
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    reason: `${why} Gemini 3.5 Flash-Lite: $0.30 in / $2.50 out per 1M tokens, 0.5 s on the card's Test, and the owner keeps the paid Foundry provider off the public route (2026-10-04).`,
    asOf: ASOF,
  });

const task = (fields) => Object.freeze(fields);

export const AI_TASKS = Object.freeze({
  inspector: task({
    label: 'Content Inspector',
    description: 'Generates title, summary and tags for an ingested article.',
    route: 'Article ingest (change feed) and the Inspect action in the portal.',
    modality: 'json',
    needs: ['text', 'json'],
    public: false,
    recommended: foundryMini('Reads a whole article and returns structured fields.'),
  }),
  altText: task({
    label: 'Image alt text',
    description: 'Writes alt text for images found on an inspected page.',
    route: 'Runs with the inspector; accessibility text on article images.',
    modality: 'vision',
    needs: ['text', 'vision'],
    public: false,
    recommended: foundryMini('Looks at the image itself; mini reads images, nano does not.'),
  }),
  critique: task({
    label: 'Inspector critique',
    description: 'Second pass that judges and improves the inspector output.',
    route: 'Article ingest. Turning it off keeps the inspector, drops the review.',
    modality: 'json',
    needs: ['text', 'json'],
    public: false,
    recommended: foundryMini('Judges the inspector against the article; a quality pass.'),
  }),
  forgeDrafting: task({
    label: 'Forge drafting',
    description: 'Writes the draft body for a Content Forge job.',
    route: 'Forge jobs and the nightly Auto-Forge timer. This is the writing.',
    modality: 'text',
    needs: ['text'],
    public: false,
    recommended: foundryMini('The longest output on the site; the mini tier writes it at a fifth of GPT-5’s price.'),
  }),
  forgeGrading: task({
    label: 'Forge grading',
    description: 'Scores a forged draft before it is offered for publication.',
    route: 'Forge jobs. Off means drafts arrive ungraded, not that they stop.',
    modality: 'json',
    needs: ['text', 'json'],
    public: false,
    recommended: foundryMini('Reads a whole draft and scores it.'),
  }),
  telegram: task({
    label: 'Telegram assistant',
    description: 'Free-form replies to messages sent to the Telegram bot.',
    route: 'The bot answers commands either way; only AI replies stop.',
    modality: 'text',
    needs: ['text'],
    public: false,
    recommended: foundryNano('Short owner-only replies where speed matters more than depth.'),
  }),
  voiceCalibration: task({
    label: 'Voice calibration',
    description: 'Suggests voice-profile additions from recent published posts.',
    route: 'The Calibrate button in Forge Studio. Suggestions only, never auto-applied.',
    modality: 'json',
    needs: ['text', 'json'],
    public: false,
    recommended: foundryMini('Reads several published posts at once and returns structured suggestions.'),
  }),
  socialCaption: task({
    label: 'Social captions',
    description: 'Writes a social-media caption for a published article.',
    route: 'The Social Hub Generate button and the on-publish auto-queue to Publer.',
    modality: 'text',
    needs: ['text'],
    public: false,
    recommended: foundryNano('A caption is a sentence or two.'),
  }),
  listenAndLearn: task({
    label: 'Listen & Learn scripts',
    description: 'Scripts a two-host study episode for one skill area of a certification guide.',
    route:
      'The Generate button on the Listen & Learn page, and Regenerate on one area. Off means the run fails before the model is called; existing episodes stay.',
    modality: 'text',
    needs: ['text'],
    public: false,
    recommended: foundryMini('A long two-voice script from a study guide.'),
  }),
  sourceGrounding: task({
    label: 'Source grounding',
    description: 'Reads owner-supplied web pages and YouTube videos to ground a generation.',
    route: 'Listen & Learn source-grounded episodes (#433).',
    modality: 'json',
    needs: ['text', 'json', 'grounding'],
    public: false,
    recommended: Object.freeze({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      reason:
        'The only provider that reads pages and YouTube videos, through the Interactions API (router.js header); Gemini 3.6 Flash: $1.50 in / $7.50 out per 1M tokens including the fetched pages.',
      asOf: ASOF,
    }),
  }),
  podcastScript: task({
    label: 'Podcast transcripts',
    description: 'Scripts a two-host podcast episode from a published article.',
    route:
      'The Podcast transcript action on the Publish page. Off means the job fails before the model is called; existing transcripts stay.',
    modality: 'text',
    needs: ['text'],
    public: false,
    recommended: foundryMini('A long two-voice script from an article.'),
  }),
  pricingExplain: task({
    label: 'Pricing explanations',
    description:
      'Explains a priced scenario on the public cloud pricing comparison: which provider is cheapest and what could flip it.',
    route:
      'The "Explain this number" button on /tools/comparison — the one anonymous AI call. Off answers "Explanations are not available" before any quota is counted; cached explanations still serve (#613).',
    modality: 'text',
    needs: ['text'],
    public: true,
    recommended: geminiLite('Anonymous traffic, short answers, cached.'),
  }),
  forgeAssist: task({
    label: 'Forge Studio assist',
    description:
      'Outlines, expands, condenses, rewrites, retitles or fact-checks a draft from an action in Forge Studio.',
    route:
      'The AI actions on the Draft tab in Forge Studio (ADR 0033). Off means each button answers that the feature is switched off; the draft text is untouched.',
    modality: 'text',
    needs: ['text'],
    public: false,
    recommended: foundryMini('Rewrites and expands whole drafts while the owner waits.'),
  }),
  landingZoneExplain: task({
    label: 'Landing zone explanations',
    description:
      'Explains one Landing Zone Builder component for the learner’s selection and options: why it matters, and what changes without it.',
    route:
      'The "Explain this component" button on /tools/landing-zone — the same anonymous explain route, cache and quota as pricing explanations, as kind landing-zone. Off answers "Explanations are not available" before any quota is counted; cached explanations still serve (#669).',
    modality: 'text',
    needs: ['text'],
    public: true,
    recommended: geminiLite('Anonymous traffic, short answers, cached.'),
  }),
});

export const TASK_NAMES = Object.freeze(Object.keys(AI_TASKS));

/** The task for an id, or undefined. */
export function taskFor(id) {
  return Object.hasOwn(AI_TASKS, id) ? AI_TASKS[id] : undefined;
}

/** The ids anonymous visitors can trigger: where a trial-tier provider must never serve. */
export const PUBLIC_TASKS = Object.freeze(TASK_NAMES.filter((id) => AI_TASKS[id].public));
