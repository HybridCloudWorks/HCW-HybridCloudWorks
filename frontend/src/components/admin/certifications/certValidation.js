/**
 * The Certifications editor's validation (ADR 0033, Spotlight slice): the
 * same rules the API enforces (functions/src/lib/admin-crud.js
 * `validateCertification`), stated here so a refusal is shown beside the
 * field rather than as a toast after the round trip. One rule per entry in a
 * table, so a new field is one line and no rule hides inside another's branch.
 */
import { isIsoDate } from '@/lib/certStatus';

const isHttpUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || '').trim());
const isImageRef = (value) => isHttpUrl(value) || /^\/\S+$/.test(String(value || '').trim());
const filled = (value) => Boolean(String(value ?? '').trim());

/** An empty order is fine (the default applies); anything else is a whole number, 0 or more. */
function validOrder(order) {
  if (order === '' || order === null || order === undefined) return true;
  const n = Number(order);
  return Number.isInteger(n) && n >= 0;
}

const URL_MESSAGE = 'Must start with http:// or https://.';
const DATE_MESSAGE = 'Enter a real date.';

/** A filled URL field that is not http(s). */
const badUrl = (value) => filled(value) && !isHttpUrl(value);
/** A filled date field that is not a real `YYYY-MM-DD` day. */
const badDate = (value) => Boolean(value) && !isIsoDate(value);

/**
 * The rules, one per entry: the field the message sits beside, when it
 * fails, and what it says. Evaluated in order and the first failure on a
 * field wins, so an unreal expiry date is reported as such rather than as
 * "before the issue date".
 */
const CERT_RULES = Object.freeze([
  { field: 'name', fails: (form) => !filled(form.name), message: 'Name is required.' },
  ...['issueDate', 'expDate', 'renewalDate'].map((field) => ({
    field,
    fails: (form) => badDate(form[field]),
    message: DATE_MESSAGE,
  })),
  {
    field: 'expDate',
    fails: (form) => Boolean(form.issueDate && form.expDate) && form.expDate < form.issueDate,
    message: 'Expiration must be on or after the issue date.',
  },
  ...['verifyUrl', 'learnUrl'].map((field) => ({
    field,
    fails: (form) => badUrl(form[field]),
    message: URL_MESSAGE,
  })),
  {
    field: 'imageUrl',
    fails: (form) => filled(form.imageUrl) && !isImageRef(form.imageUrl),
    message: 'Must be an http(s) URL or an uploaded image path.',
  },
  {
    field: 'display_order',
    fails: (form) => !validOrder(form.display_order),
    message: 'A whole number, 0 or more.',
  },
]);

/** The link lists whose rows each carry a URL, reported as `list.index`. */
const LINK_LISTS = ['evidence', 'relatedLearning'];

/**
 * The editor's validation, as `{ field: message }` — empty when the form can
 * be saved.
 */
export function validateCertForm(form) {
  const errors = {};
  for (const rule of CERT_RULES) {
    if (!errors[rule.field] && rule.fails(form)) errors[rule.field] = rule.message;
  }
  for (const list of LINK_LISTS) {
    (form[list] || []).forEach((row, index) => {
      if (badUrl(row.url)) errors[`${list}.${index}`] = URL_MESSAGE;
    });
  }
  return errors;
}
