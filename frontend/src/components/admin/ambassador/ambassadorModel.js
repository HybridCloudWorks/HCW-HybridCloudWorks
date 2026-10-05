/**
 * The Ambassador hub's pure rules (ADR 0033 §4): the status vocabulary and
 * the moves between statuses (mirroring functions/src/lib/ambassador.js,
 * which is the authority — the server refuses a move this table does not
 * list), what the Dashboard surfaces, and the application export. No React,
 * no fetching; tested in ambassadorModel.test.js.
 */

import { statusTable } from '@/lib/status';

/** StatusBadge input per status, built by lib/status.js so the record shape is shared. */
export const AMBASSADOR_STATUS = statusTable({
  interested: ['Interested', 'muted', 'A program worth pursuing; nothing gathered yet.'],
  preparing: ['Preparing', 'warn', 'Collecting evidence and writing responses.'],
  ready: ['Ready', 'ok', 'Every requirement met; waiting for the window.'],
  submitted: ['Submitted', 'warn', 'Sent to the program; nothing more to do but wait.'],
  under_review: ['Under review', 'warn', 'The program has acknowledged it and is reviewing.'],
  accepted: ['Accepted', 'ok', 'Approved; the award has not started yet.'],
  active: ['Active', 'ok', 'Holding the award now.'],
  renewal_due: [
    'Renewal due',
    'warn',
    'The renewal window is open or close; gather this cycle’s evidence.',
  ],
  renewed: ['Renewed', 'ok', 'Renewed for another cycle.'],
  denied: ['Denied', 'bad', 'Not selected; a new pursuit can start from here.'],
  expired: ['Expired', 'off', 'The award lapsed without renewal.'],
  withdrawn: ['Withdrawn', 'off', 'Pulled before a decision.'],
});

/** The statuses in lifecycle order: the table's key order. */
export const APPLICATION_STATUSES = Object.freeze(Object.keys(AMBASSADOR_STATUS));

/**
 * Where the owner stands with a program, a fact about the program rather
 * than a step of an application (owner request 2026-10-05). Mirrors
 * MEMBERSHIP_STATUSES in functions/src/lib/ambassador/model.js.
 */
export const MEMBERSHIP_STATUS = statusTable({
  none: ['Not a member', 'muted', 'Not held and not being pursued.'],
  working: ['Working', 'warn', 'Qualifying or applying.'],
  active: ['Active', 'ok', 'Holding it now.'],
  denied: ['Denied', 'bad', 'Refused; a new pursuit can start.'],
});
export const MEMBERSHIP_STATUSES = Object.freeze(Object.keys(MEMBERSHIP_STATUS));

/** The most recently updated application for a program, or null. */
export function latestApplicationFor(applications, programId) {
  return (
    (applications || [])
      .filter((a) => a.programId === programId)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null
  );
}

/** A program's place in the catalogue, for the Settings table. */
export const PROGRAM_STATE = statusTable({
  enabled: ['Enabled', 'ok', 'Offered on the Programs tab.'],
  disabled: ['Disabled', 'off', 'Hidden from new applications.'],
});

/** Whether a reviewer could confirm an evidence item, for the Evidence tab. */
export const VERIFICATION_STATUS = statusTable({
  verified: ['Verified', 'ok', 'A reviewer could confirm it from the URL or files.'],
  unverified: ['Unverified', 'muted', 'Recorded, not yet confirmed.'],
});

export function ambassadorStatusInfo(status) {
  return AMBASSADOR_STATUS[status] || AMBASSADOR_STATUS.interested;
}

/** Allowed status moves — the same table the API enforces. */
export const APPLICATION_TRANSITIONS = Object.freeze({
  interested: ['preparing', 'withdrawn'],
  preparing: ['ready', 'interested', 'withdrawn'],
  ready: ['submitted', 'preparing', 'withdrawn'],
  submitted: ['under_review', 'accepted', 'denied', 'withdrawn'],
  under_review: ['accepted', 'denied', 'withdrawn'],
  accepted: ['active', 'expired'],
  active: ['renewal_due', 'expired', 'withdrawn'],
  renewal_due: ['renewed', 'expired', 'denied', 'withdrawn'],
  renewed: ['active', 'renewal_due', 'expired'],
  denied: ['interested', 'preparing'],
  expired: ['interested', 'preparing'],
  withdrawn: ['interested', 'preparing'],
});

export function allowedTransitions(status) {
  return APPLICATION_TRANSITIONS[status] || [];
}

/** Statuses that mean a pursuit is live, for the Dashboard's "pursued" count. */
export const PURSUING_STATUSES = Object.freeze([
  'interested',
  'preparing',
  'ready',
  'submitted',
  'under_review',
]);
/** Statuses that mean the award is held. */
export const HOLDING_STATUSES = Object.freeze(['accepted', 'active', 'renewal_due', 'renewed']);

export const EVIDENCE_SOURCES = Object.freeze([
  'speaking',
  'certifications',
  'content',
  'listen-and-learn',
  'labs',
  'newsletter',
  'manual',
]);

export const SOURCE_LABELS = Object.freeze({
  speaking: 'Speaking',
  certifications: 'Certifications',
  content: 'Published content',
  'listen-and-learn': 'Listen & Learn',
  labs: 'Labs',
  newsletter: 'Newsletter',
  manual: 'Manual',
});

/** The three sources the import picker offers (the API reads these containers). */
export const IMPORT_SOURCES = Object.freeze(['speaking', 'certifications', 'content']);

/**
 * The most CSV text one import takes, in characters — the API's
 * CSV_IMPORT_MAX_CHARS (functions/src/lib/ambassador/import-readers.js),
 * which answers 413 past it. The dialog refuses an oversized file or paste
 * before sending, so nothing is ever clipped on the way.
 */
export const CSV_IMPORT_MAX_CHARS = 1_000_000;

/** The files the import can read (the API's CSV_READERS): the reader id, its label, the source its rows land under. */
export const CSV_IMPORTS = Object.freeze([
  {
    reader: 'mct-classes',
    label: 'MCT classes (Metrics That Matter CSV)',
    sourceModule: 'manual',
    hint: 'The classes-delivered export: class id, course, learning method, instructor, start and end date, location. One evidence row per class, once per class id.',
  },
]);

/** How a program's official application question is answered (mirrors the API's QUESTION_KINDS). */
export const QUESTION_KINDS = Object.freeze([
  'profile',
  'text',
  'choice',
  'yesno',
  'url',
  'scale',
  'links',
  'activities',
]);

export const sourceLabel = (source) => SOURCE_LABELS[source] || source || 'Manual';

const DAY_MS = 86_400_000;

export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole calendar days from `today` to `day`, both `YYYY-MM-DD`; null when either is missing. */
export function daysUntil(day, today) {
  if (!day || !today) return null;
  const parse = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(day) - parse(today)) / DAY_MS);
}

export const programById = (programs) => new Map((programs || []).map((p) => [p.id, p]));

/**
 * Whether a program's application window is open on `today`: 'open',
 * 'closed', or 'rolling' when it declares no dates.
 */
export function windowState(program, today) {
  const w = program?.applicationWindow || {};
  if (!w.opens && !w.closes) return 'rolling';
  if (w.opens && today < w.opens) return 'closed';
  if (w.closes && today > w.closes) return 'closed';
  return 'open';
}

/**
 * Everything dated that is coming up within `days`: application submission
 * deadlines and renewals, and program windows opening or closing. Sorted
 * soonest first. The Calendar slice reads the same dates from the API; this
 * is the hub's own view of them.
 */
export function upcomingDeadlines(applications, programs, { today, days = 120 } = {}) {
  const now = today || todayIso();
  const byId = programById(programs);
  const out = [];
  const push = (date, kind, label, href) => {
    const left = daysUntil(date, now);
    if (left === null || left < 0 || left > days) return;
    out.push({ date, kind, label, daysLeft: left, href });
  };
  for (const app of applications || []) {
    const name = byId.get(app.programId)?.name || app.title || 'Application';
    push(app.submissionDeadline, 'deadline', `${name}: submission deadline`, app.id);
    push(app.renewalDate, 'renewal', `${name}: renewal`, app.id);
    push(app.expirationDate, 'expiry', `${name}: award expires`, app.id);
  }
  for (const program of programs || []) {
    if (program.enabled === false) continue;
    push(program.applicationWindow?.opens, 'window', `${program.name}: window opens`, program.id);
    push(program.applicationWindow?.closes, 'window', `${program.name}: window closes`, program.id);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Evidence about to leave a rolling twelve-month window: dated between ten
 * and twelve months ago. A renewal reads this as "what stops counting soon".
 */
export function expiringEvidence(evidence, { today } = {}) {
  const now = today || todayIso();
  return (evidence || [])
    .filter((item) => {
      const age = item.date ? -daysUntil(item.date, now) : null;
      return age !== null && age >= 305 && age <= 365;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function recentEvidence(evidence, count = 6) {
  return [...(evidence || [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, count);
}

export function statusCounts(applications) {
  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
  for (const app of applications || []) {
    if (counts[app.status] !== undefined) counts[app.status] += 1;
  }
  return counts;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A deadline within the next thirty days, today included. */
const closingSoon = (daysLeft) => daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;

/**
 * What one pursued application may need next, one rule per entry: `when`
 * reads the application's facts, `say` words the action. Evaluated in order,
 * so the shortfall comes before the attach reminder before the deadline.
 */
const APPLICATION_ACTIONS = Object.freeze([
  {
    when: ({ readiness }) => Boolean(readiness?.missing?.length),
    say: ({ name, readiness }) => {
      const [first] = readiness.missing;
      return `${name}: ${first.shortfall} more ${first.label.toLowerCase()} needed.`;
    },
  },
  {
    when: ({ app }) => (app.evidenceIds || []).length === 0,
    say: ({ name }) => `${name}: attach evidence from the Evidence tab.`,
  },
  {
    when: ({ app, daysLeft }) => closingSoon(daysLeft) && app.status !== 'submitted',
    say: ({ name, daysLeft }) => `${name}: submission closes in ${plural(daysLeft, 'day')}.`,
  },
]);

/** The facts the action rules read for one application. */
function applicationFacts(app, { byId, readinessById, now }) {
  return {
    app,
    name: byId.get(app.programId)?.name || app.title,
    readiness: readinessById?.[app.programId],
    daysLeft: daysUntil(app.submissionDeadline, now),
  };
}

const isUnverified = (item) => (item.verificationStatus || 'unverified') !== 'verified';

/**
 * The next things worth doing, in words, from what the hub knows: unmet
 * requirements on readiness, applications with no evidence attached, windows
 * closing soon, and evidence awaiting verification.
 */
export function recommendedActions({ applications, programs, evidence, readinessById, today }) {
  const context = { byId: programById(programs), readinessById, now: today || todayIso() };
  const actions = (applications || [])
    .filter((app) => PURSUING_STATUSES.includes(app.status))
    .map((app) => applicationFacts(app, context))
    .flatMap((facts) =>
      APPLICATION_ACTIONS.filter((rule) => rule.when(facts)).map((rule) => rule.say(facts))
    );
  const unverified = (evidence || []).filter(isUnverified).length;
  if (unverified > 0) actions.push(`${plural(unverified, 'evidence item')} still unverified.`);
  return actions.slice(0, 8);
}

/** The evidence rows an application has attached. */
export function evidenceForApplication(application, evidence) {
  const ids = new Set(application?.evidenceIds || []);
  return (evidence || []).filter((item) => ids.has(item.id));
}

/**
 * Evidence relevant to a program: names it, names no program at all, or —
 * for a program additional to another — names the parent (an MCT's record
 * is the Regional Lead's record too; the API's readiness.js agrees).
 */
export function evidenceRelevant(item, programId, parentProgramId = null) {
  const ids = Array.isArray(item.programIds) ? item.programIds : [];
  return (
    ids.length === 0 ||
    ids.includes(programId) ||
    (Boolean(parentProgramId) && ids.includes(parentProgramId))
  );
}

/**
 * A program additional to another (`parentProgramId`; MCT Regional Lead to
 * MCT, owner request 2026-10-05) is shown, and may start an application,
 * only while the parent's membership is this status. The API refuses the
 * application otherwise (409 PARENT_NOT_ACTIVE); the tabs hide the card and
 * disable the controls so the refusal is never the first thing seen.
 */
export const UNLOCKING_MEMBERSHIP = 'active';

/** `{ gated, unlocked, parent }` for a program, given the catalogue as `programById` holds it. */
export function programGate(program, byId) {
  if (!program?.parentProgramId) return { gated: false, unlocked: true, parent: null };
  const parent = byId?.get?.(program.parentProgramId) || null;
  const membershipStatus = MEMBERSHIP_STATUSES.includes(parent?.membershipStatus)
    ? parent.membershipStatus
    : 'none';
  return {
    gated: true,
    unlocked: Boolean(parent) && membershipStatus === UNLOCKING_MEMBERSHIP,
    parent: { id: program.parentProgramId, name: parent?.name || null, membershipStatus },
  };
}

/** The programs additional to `parentId`, in catalogue order. */
export function childProgramsOf(programs, parentId) {
  return (programs || [])
    .filter((p) => p.parentProgramId === parentId)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * The programs in play: every top-level program, each followed by the
 * additional programs its membership has unlocked. A locked child is not
 * listed — it appears the day the parent goes Active.
 */
export function programsInPlay(programs) {
  const byId = programById(programs);
  // Top level is also where a program lands when its parent is itself
  // parented (a chain or a cycle the API's one-level rule did not catch in a
  // race): shown, not hidden, so the catalogue can be repaired on Settings.
  const topLevel = (p) =>
    !p.parentProgramId || Boolean(byId.get(p.parentProgramId)?.parentProgramId);
  const top = (programs || []).filter(topLevel);
  return top.flatMap((parent) => [
    parent,
    ...childProgramsOf(programs, parent.id)
      .filter((child) => !topLevel(child))
      .filter((child) => programGate(child, byId).unlocked),
  ]);
}

/**
 * The JSON an export downloads: the application, its program's name and
 * requirements, and the attached evidence with snapshots. Private records,
 * so the export is a file the owner keeps — never a public page.
 */
export function applicationExport(application, program, evidence) {
  return {
    exportedAt: new Date().toISOString(),
    application,
    program: program
      ? {
          id: program.id,
          name: program.name,
          provider: program.provider,
          requirements: program.requirements,
        }
      : null,
    evidence: evidenceForApplication(application, evidence),
  };
}

/** Trigger a JSON download in the browser; a no-op where object URLs do not exist (tests). */
export function downloadJson(filename, data) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

export const EMPTY_PROGRAM_FORM = Object.freeze({
  name: '',
  provider: '',
  category: 'community-expert',
  description: '',
  applicationUrl: '',
  eligibility: '',
  criteria: '',
  recommendedActivities: '',
  applicationWindow: { opens: '', closes: '', note: '' },
  renewalCadence: 'annual',
  expirationRule: '',
  requirements: [],
  evidenceTypes: [],
  reminders: { daysBeforeDeadline: 14, daysBeforeRenewal: 30 },
  customFields: [],
  membershipStatus: 'none',
  parentProgramId: '',
});

export const EMPTY_REQUIREMENT = Object.freeze({
  id: '',
  label: '',
  description: '',
  evidenceTypes: [],
  minCount: 1,
  weight: 1,
});

const lines = (text) =>
  String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** A stored value as the form holds it: the text, or the field's default when unset. */
const textOf = (value, fallback = '') => value || fallback;
/** A stored list as one-per-line text. */
const linesOf = (list) => (list || []).join('\n');

/** A stored program as the Settings editor's form (lists as one-per-line text). */
export function programForm(program) {
  if (!program) return { ...EMPTY_PROGRAM_FORM };
  const window = program.applicationWindow || {};
  const reminders = program.reminders || {};
  return {
    ...EMPTY_PROGRAM_FORM,
    name: textOf(program.name),
    provider: textOf(program.provider),
    category: textOf(program.category, EMPTY_PROGRAM_FORM.category),
    description: textOf(program.description),
    applicationUrl: textOf(program.applicationUrl),
    eligibility: linesOf(program.eligibility),
    criteria: linesOf(program.criteria),
    recommendedActivities: linesOf(program.recommendedActivities),
    applicationWindow: {
      opens: textOf(window.opens),
      closes: textOf(window.closes),
      note: textOf(window.note),
    },
    renewalCadence: textOf(program.renewalCadence, EMPTY_PROGRAM_FORM.renewalCadence),
    expirationRule: textOf(program.expirationRule),
    membershipStatus: MEMBERSHIP_STATUSES.includes(program.membershipStatus)
      ? program.membershipStatus
      : 'none',
    parentProgramId: textOf(program.parentProgramId),
    requirements: (program.requirements || []).map((r) => ({ ...EMPTY_REQUIREMENT, ...r })),
    evidenceTypes: program.evidenceTypes || [],
    reminders: {
      daysBeforeDeadline:
        reminders.daysBeforeDeadline ?? EMPTY_PROGRAM_FORM.reminders.daysBeforeDeadline,
      daysBeforeRenewal:
        reminders.daysBeforeRenewal ?? EMPTY_PROGRAM_FORM.reminders.daysBeforeRenewal,
    },
    customFields: program.customFields || [],
  };
}

/** What a program save sends; `{ error }` names the first problem instead. */
export function programPayload(form) {
  if (!String(form.name || '').trim()) return { error: 'Program name is required.' };
  if (form.applicationUrl && !/^https?:\/\//i.test(form.applicationUrl.trim())) {
    return { error: 'Application URL must start with http:// or https://.' };
  }
  const requirements = (form.requirements || []).map((r, index) => ({
    id: String(r.id || '').trim() || `req-${index + 1}`,
    label: String(r.label || '').trim(),
    description: String(r.description || '').trim(),
    evidenceTypes: (r.evidenceTypes || []).filter((t) => EVIDENCE_SOURCES.includes(t)),
    minCount: Math.max(0, Math.floor(Number(r.minCount) || 0)),
    weight: Math.max(0, Number(r.weight) || 0),
  }));
  const unlabeled = requirements.findIndex((r) => !r.label);
  if (unlabeled !== -1) return { error: `Requirement ${unlabeled + 1} needs a label.` };
  return {
    value: {
      name: form.name.trim(),
      provider: form.provider.trim(),
      category: form.category.trim(),
      membershipStatus: MEMBERSHIP_STATUSES.includes(form.membershipStatus)
        ? form.membershipStatus
        : 'none',
      parentProgramId: String(form.parentProgramId || '').trim() || null,
      description: form.description.trim(),
      applicationUrl: form.applicationUrl.trim() || null,
      eligibility: lines(form.eligibility),
      criteria: lines(form.criteria),
      recommendedActivities: lines(form.recommendedActivities),
      applicationWindow: {
        opens: form.applicationWindow.opens || null,
        closes: form.applicationWindow.closes || null,
        note: form.applicationWindow.note.trim(),
      },
      renewalCadence: form.renewalCadence.trim(),
      expirationRule: form.expirationRule.trim(),
      requirements,
      evidenceTypes: form.evidenceTypes,
      reminders: {
        daysBeforeDeadline: Math.max(0, Math.floor(Number(form.reminders.daysBeforeDeadline) || 0)),
        daysBeforeRenewal: Math.max(0, Math.floor(Number(form.reminders.daysBeforeRenewal) || 0)),
      },
      customFields: (form.customFields || []).filter((f) => f.id && f.label),
    },
  };
}
