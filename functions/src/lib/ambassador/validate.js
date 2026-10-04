/**
 * Ambassador validation (ADR 0033 §4): a program, application or evidence
 * body with every field cleaned, or an error sentence.
 *
 * Each kind is a schema — the field names a body may carry, each with the
 * function that cleans its value or refuses it. `validateWith` walks the
 * schema once: unknown keys are refused first, a `required` field is cleaned
 * on a full write even when absent (so "name is required" comes from the
 * field's own rule), and on a partial patch only the fields present are
 * touched. The handlers in ./handlers.js never see a value a rule did not
 * pass.
 */
import {
  cleanFiles,
  cleanLinks,
  cleanPeriod,
  isBlank,
  isRecord,
  optionalStr,
  str,
  stringList,
  wholeNumber,
} from './fields.js';
import {
  APPLICATION_STATUSES,
  EVIDENCE_SOURCES,
  VERIFICATION_STATUSES,
  isHttpUrl,
  toCalendarDate,
} from './model.js';

class FieldError extends Error {}

/** Refuse the value being cleaned with the sentence the API answers with. */
const refuse = (message) => {
  throw new FieldError(message);
};

// ── shared cleaners ───────────────────────────────────────────────────────────

/** A rule: `clean(value, { partial })` answers the stored value or refuses. */
const field = (clean, { required = false } = {}) => ({ clean, required });

const bounded = (max) => (value) => str(value, max);
const listOf = (max) => (value) => stringList(value, max);
const flag = (value) => value !== false;

const requiredText = (max, name) => (value) => str(value, max) || refuse(`${name} is required`);

const oneOf = (allowed, name) => (value) =>
  allowed.includes(value) ? value : refuse(`${name} must be one of ${allowed.join(', ')}`);

const optionalUrl = (name) => (value) => {
  const url = optionalStr(value, 2000);
  if (url && !isHttpUrl(url)) refuse(`${name} must be an http(s) URL`);
  return url;
};

/** A calendar day, or null when sent empty. */
const dayOrNull = (value, { key }) => {
  if (value === null || value === '') return null;
  return toCalendarDate(value) || refuse(`${key} must be a YYYY-MM-DD date`);
};

// ── the schema walker ─────────────────────────────────────────────────────────

/**
 * Clean `body` against `schema`. Unknown keys first; then every rule in
 * schema order, so the first refusal is the one the caller reads.
 *
 * @returns {{ value: object } | { error: string }}
 */
function validateWith(schema, body, { partial = false } = {}) {
  const unknown = Object.keys(body).filter((key) => !Object.hasOwn(schema.fields, key));
  if (unknown.length) return { error: `Unknown ${schema.name} field(s): ${unknown.join(', ')}` };
  const out = {};
  try {
    for (const [key, rule] of Object.entries(schema.fields)) {
      const wanted = key in body || (rule.required && !partial);
      if (wanted) out[key] = rule.clean(body[key], { partial, key });
    }
  } catch (error) {
    if (!(error instanceof FieldError)) throw error;
    return { error: error.message };
  }
  return { value: out };
}

// ── programs ──────────────────────────────────────────────────────────────────

function cleanRequirements(value) {
  if (!Array.isArray(value)) refuse('requirements must be an array');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') refuse(`requirements[${index}] must be an object`);
    const label = str(item.label, 200) || refuse(`requirements[${index}].label is required`);
    return {
      id: str(item.id, 80) || `req-${index + 1}`,
      label,
      description: str(item.description, 2000),
      evidenceTypes: stringList(item.evidenceTypes).filter((t) => EVIDENCE_SOURCES.includes(t)),
      minCount: wholeNumber(item.minCount),
      weight: Math.max(0, Number(item.weight) || 0),
    };
  });
}

function cleanWindow(value) {
  const w = isRecord(value) ? value : {};
  return {
    opens: toCalendarDate(w.opens),
    closes: toCalendarDate(w.closes),
    note: str(w.note, 500),
  };
}

function cleanReminders(value) {
  const r = isRecord(value) ? value : {};
  return {
    daysBeforeDeadline: wholeNumber(r.daysBeforeDeadline),
    daysBeforeRenewal: wholeNumber(r.daysBeforeRenewal),
  };
}

function cleanCustomFields(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) =>
      isRecord(f)
        ? { id: str(f.id, 80), label: str(f.label, 200), type: str(f.type, 40) || 'text' }
        : null
    )
    .filter((f) => f && f.id && f.label)
    .slice(0, 50);
}

const PROGRAM = {
  name: 'program',
  fields: {
    name: field(requiredText(200, 'name'), { required: true }),
    provider: field(bounded(200)),
    description: field(bounded(4000)),
    category: field(bounded(100)),
    applicationUrl: field(optionalUrl('applicationUrl')),
    eligibility: field(listOf(50)),
    criteria: field(listOf(50)),
    recommendedActivities: field(listOf(50)),
    evidenceTypes: field(listOf(50)),
    applicationWindow: field(cleanWindow),
    renewalCadence: field(bounded(100)),
    expirationRule: field(bounded(1000)),
    requirements: field(cleanRequirements),
    enabled: field(flag),
    order: field(wholeNumber),
    reminders: field(cleanReminders),
    customFields: field(cleanCustomFields),
  },
};

/** A program patch with every field cleaned, or an error sentence. */
export function validateProgram(body, options) {
  return validateWith(PROGRAM, body, options);
}

// ── applications ──────────────────────────────────────────────────────────────

const APPLICATION_DATE_FIELDS = [
  'applicationDate',
  'submissionDeadline',
  'decisionDate',
  'startDate',
  'expirationDate',
  'renewalDate',
];

function cleanResponses(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) =>
      isRecord(r) ? { questionId: str(r.questionId, 120), text: str(r.text, 20000) } : null
    )
    .filter((r) => r && r.questionId)
    .slice(0, 100);
}

function cleanBadgeUrl(value) {
  const url = optionalStr(value, 2000);
  if (url && !isHttpUrl(url) && !url.startsWith('/'))
    refuse('badgeImageUrl must be an http(s) URL or a site path');
  return url;
}

function cleanCustomValues(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([k, v]) => [str(k, 80), str(v, 4000)])
  );
}

const APPLICATION = {
  name: 'application',
  fields: {
    programId: field(requiredText(120, 'programId'), { required: true }),
    title: field(bounded(300)),
    status: field(oneOf(APPLICATION_STATUSES, 'status')),
    statusNote: field(bounded(2000)),
    qualificationPeriod: field(cleanPeriod),
    ...Object.fromEntries(APPLICATION_DATE_FIELDS.map((key) => [key, field(dayOrNull)])),
    notes: field(bounded(20000)),
    reviewerFeedback: field(bounded(20000)),
    responses: field(cleanResponses),
    files: field(cleanFiles),
    images: field(cleanFiles),
    links: field(cleanLinks),
    badgeImageUrl: field(cleanBadgeUrl),
    evidenceIds: field(listOf(500)),
    customValues: field(cleanCustomValues),
    private: field(flag),
  },
};

/** An application patch with every field cleaned, or an error sentence. */
export function validateApplication(body, options) {
  return validateWith(APPLICATION, body, options);
}

// ── evidence ──────────────────────────────────────────────────────────────────

function cleanMetrics(value) {
  const m = isRecord(value) ? value : {};
  const num = (v) => (isBlank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
  return { reach: num(m.reach), attendees: num(m.attendees), views: num(m.views) };
}

function cleanSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    title: str(value.title, 300),
    date: toCalendarDate(value.date),
    url: isHttpUrl(value.url) ? str(value.url, 2000) : null,
    capturedAt: value.capturedAt ? String(value.capturedAt) : null,
  };
}

/** Required on a full write; a partial patch may clear it. */
function cleanEvidenceDate(value, { partial }) {
  if (isBlank(value)) return partial ? null : refuse('date is required (YYYY-MM-DD)');
  return toCalendarDate(value) || refuse('date must be a YYYY-MM-DD date');
}

const cleanSourceModule = (value) => oneOf(EVIDENCE_SOURCES, 'sourceModule')(value || 'manual');

const EVIDENCE = {
  name: 'evidence',
  fields: {
    title: field(requiredText(300, 'title'), { required: true }),
    description: field(bounded(8000)),
    date: field(cleanEvidenceDate, { required: true }),
    sourceModule: field(cleanSourceModule, { required: true }),
    sourceId: field((value) => optionalStr(value, 300)),
    snapshot: field(cleanSnapshot),
    url: field(optionalUrl('url')),
    files: field(cleanFiles),
    images: field(cleanFiles),
    metrics: field(cleanMetrics),
    technology: field(listOf(50)),
    programIds: field(listOf(50)),
    tags: field(listOf(50)),
    qualificationPeriod: field(cleanPeriod),
    verificationStatus: field(oneOf(VERIFICATION_STATUSES, 'verificationStatus')),
    notes: field(bounded(8000)),
  },
};

/** An evidence patch with every field cleaned, or an error sentence. */
export function validateEvidence(body, options) {
  return validateWith(EVIDENCE, body, options);
}
