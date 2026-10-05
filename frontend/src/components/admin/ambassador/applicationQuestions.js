/**
 * The guided application's pure rules (ADR 0033 §4): a program's official
 * questions grouped by section in the form's order, how a structured answer
 * (network + URL rows, a frequency grid, tagged activities) is stored in the
 * one `responses[].text` string the API keeps, the plain text each answer
 * copies as, and the whole packet for pasting into the official form. No
 * React; applicationQuestions.test.js pins it.
 */

export const YES_NO = Object.freeze(['Yes', 'No']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isHttpUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || '').trim());

/** The questions in their sections, first-seen order kept; an unnamed section is "Questions". */
export function questionSections(questions) {
  const sections = new Map();
  for (const question of questions || []) {
    const name = question.section || 'Questions';
    if (!sections.has(name)) sections.set(name, { section: name, questions: [] });
    sections.get(name).questions.push(question);
  }
  return [...sections.values()];
}

/** The stored responses by question id. */
export const responsesMap = (responses) =>
  new Map((responses || []).map((r) => [r.questionId, r.text || '']));

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const asArray = (text) => {
  const parsed = parseJson(text);
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * A stored answer back in the shape its kind edits: links as
 * `[{ network, url }]`, a scale as `{ row: option }`, activities as evidence
 * ids; every other kind is the text itself.
 */
export function parseAnswer(kind, text) {
  const stored = typeof text === 'string' ? text : '';
  if (kind === 'links') {
    return asArray(stored)
      .filter(isRecord)
      .map((row) => ({ network: String(row.network || ''), url: String(row.url || '') }));
  }
  if (kind === 'scale') {
    const parsed = parseJson(stored);
    return isRecord(parsed)
      ? Object.fromEntries(Object.entries(parsed).map(([row, value]) => [row, String(value)]))
      : {};
  }
  if (kind === 'activities') return asArray(stored).filter((id) => typeof id === 'string');
  return stored;
}

/**
 * The edited value as the one string the API stores; an empty answer is the
 * empty string. A link row still blank is kept, so a row just added stays
 * on screen to be filled in; only a list with no rows at all is empty.
 */
export function serialiseAnswer(kind, value) {
  if (kind === 'links') {
    const rows = (Array.isArray(value) ? value : []).map((row) => ({
      network: String(row.network || ''),
      url: String(row.url || ''),
    }));
    return rows.length ? JSON.stringify(rows) : '';
  }
  if (kind === 'scale') {
    const entries = Object.entries(isRecord(value) ? value : {}).filter(([, v]) => v);
    return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '';
  }
  if (kind === 'activities') {
    const ids = (Array.isArray(value) ? value : []).filter(Boolean);
    return ids.length ? JSON.stringify(ids) : '';
  }
  return String(value ?? '');
}

/** One attached evidence item as the line an activity copies as. */
const activityLine = (item) =>
  `${item.title} — ${item.date || 'undated'}${item.url ? ` · ${item.url}` : ''}`;

/** An answer as the plain text that goes on the clipboard; `evidenceById` names tagged activities. */
export function answerText(question, text, { evidenceById } = {}) {
  const value = parseAnswer(question.kind, text);
  if (question.kind === 'links') {
    return value
      .filter((row) => row.url)
      .map((row) => `${row.network || 'Link'}: ${row.url}`)
      .join('\n');
  }
  if (question.kind === 'scale') {
    return (question.rows || [])
      .filter((row) => value[row])
      .map((row) => `${row}: ${value[row]}`)
      .join('\n');
  }
  if (question.kind === 'activities') {
    return value
      .map((id) => {
        const item = evidenceById?.get(id);
        return item ? activityLine(item) : id;
      })
      .join('\n');
  }
  return value;
}

/**
 * The whole application as plain text in the form's order — every section,
 * every question, the answer or "(not answered)" — for pasting into the
 * official form one block at a time.
 */
export function packetText(questions, responses, { evidenceById, title } = {}) {
  const by = responsesMap(responses);
  const lines = title ? [title, ''] : [];
  for (const { section, questions: list } of questionSections(questions)) {
    lines.push(`## ${section}`, '');
    for (const question of list) {
      const answer = answerText(question, by.get(question.id) || '', { evidenceById });
      lines.push(question.prompt, answer || '(not answered)', '');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

/** Whether a stored answer says anything: for links, at least one row with a URL. */
export function isAnswered(question, text) {
  if (!text) return false;
  if (question.kind === 'links') return parseAnswer('links', text).some((row) => row.url);
  return true;
}

/** How many of the questions have an answer. */
export function answeredCount(questions, responses) {
  const by = responsesMap(responses);
  return (questions || []).filter((q) => isAnswered(q, by.get(q.id))).length;
}

/** `{ [questionId]: message }` for a URL that is not http(s) or a text over its limit. */
export function questionErrors(questions, responses) {
  const by = responsesMap(responses);
  const errors = {};
  for (const question of questions || []) {
    const text = by.get(question.id) || '';
    if (!text) continue;
    if (question.kind === 'url' && !isHttpUrl(text)) {
      errors[question.id] = 'Must start with http:// or https://.';
    } else if (question.kind === 'links') {
      const bad = parseAnswer('links', text).find((row) => row.url && !isHttpUrl(row.url));
      if (bad) errors[question.id] = `"${bad.url}" must start with http:// or https://.`;
    } else if (question.maxChars && ['text', 'profile'].includes(question.kind)) {
      if (text.length > question.maxChars)
        errors[question.id] = `Over the limit by ${text.length - question.maxChars} characters.`;
    }
  }
  return errors;
}
