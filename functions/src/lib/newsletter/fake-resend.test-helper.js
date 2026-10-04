/**
 * The fake Resend behind admin-handlers.test.js and
 * admin-handlers.amplify.test.js: one `fetch` built from a table of
 * route → reply, so a test reads which routes exist in one place and each
 * reply is a function small enough to read whole.
 *
 * Every call is recorded in `calls` (method, pathname, parsed body); the
 * broadcasts and single emails Resend accepted are kept in `broadcasts` and
 * `emails` as the bodies it was sent.
 *
 * Options, each a knob a test turns:
 *   templates      GET /templates/{id}: `{ [id]: [status, body] | Error }` or a
 *                  function of the id. Unlisted ids are 404.
 *   failEmail      POST /emails answers 403 with a message naming the address.
 *   failBroadcast  POST /broadcasts answers 422 with a message that echoes the
 *                  payload, as provider refusals sometimes do.
 *   failCreate     POST /broadcasts answers 422 naming the schedule.
 *   noAnswer       POST /broadcasts throws a timeout.
 *   onBroadcast    awaited after a broadcast is accepted, before the answer.
 *   broadcast      what GET /broadcasts/{id} answers (merged over the id), or
 *                  404 for a broadcast Resend no longer has.
 *   refuseDelete   DELETE /broadcasts/{id} answers 403 with a plan message.
 *   domains        what GET /domains lists.
 */
import { vi } from 'vitest';

const reply = (status, data) => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(data),
});

const broadcastIdOf = (pathname) => pathname.slice('/broadcasts/'.length);

// ── Replies. Each takes the call `{ method, pathname, body }` and the fake's
// `{ options, broadcasts, emails }`. ─────────────────────────────────────────

const template = ({ pathname }, { options }) => {
  const id = decodeURIComponent(pathname.slice('/templates/'.length));
  const { templates } = options;
  const answer = typeof templates === 'function' ? templates(id) : templates[id];
  if (answer instanceof Error) throw answer;
  return answer
    ? reply(...answer)
    : reply(404, { name: 'not_found', message: `Template ${id} not found` });
};

const segments = () =>
  reply(200, {
    object: 'list',
    has_more: false,
    data: [{ id: 'seg-news', name: 'Newsletter' }],
  });

const sendEmail = ({ body }, { options, emails }) => {
  if (options.failEmail) {
    return reply(403, {
      name: 'validation_error',
      message: `The domain is not verified for ${body.to}`,
    });
  }
  emails.push(body);
  return reply(200, { id: `em-${emails.length}` });
};

/** The 422 a broadcast refusal gives, when one is asked for; null otherwise. */
const broadcastRefusal = (body, { failBroadcast, failCreate }) => {
  if (failBroadcast) {
    return reply(422, {
      name: 'validation_error',
      message: `from domain not verified for PO Box 1, Austin, TX in ${body.subject}`,
    });
  }
  return failCreate
    ? reply(422, { name: 'validation_error', message: 'scheduled_at is in the past' })
    : null;
};

const createBroadcast = async ({ body }, { options, broadcasts }) => {
  if (options.noAnswer) throw new Error('The operation was aborted due to timeout');
  const refusal = broadcastRefusal(body, options);
  if (refusal) return refusal;
  broadcasts.push(body);
  await options.onBroadcast?.();
  return reply(200, { id: `bc-${broadcasts.length}` });
};

const getBroadcast = ({ pathname }, { options }) =>
  options.broadcast === 404
    ? reply(404, { name: 'not_found', message: 'Broadcast not found' })
    : reply(200, { id: broadcastIdOf(pathname), ...options.broadcast });

const deleteBroadcast = ({ pathname }, { options }) =>
  options.refuseDelete
    ? reply(403, {
        name: 'restricted_api_key',
        message: 'Scheduled broadcasts cannot be deleted on this plan',
      })
    : reply(200, { object: 'broadcast', id: broadcastIdOf(pathname), deleted: true });

const listDomains = (call, { options }) => reply(200, { data: options.domains });

const unexpected = () => reply(404, { name: 'unexpected' });

/** In the order they are tried: `[matches(method, pathname), respond(call, fake)]`. */
const ROUTES = [
  [(method, pathname) => pathname.startsWith('/templates/'), template],
  [(method, pathname) => pathname === '/segments', segments],
  [(method, pathname) => pathname === '/emails', sendEmail],
  [(method, pathname) => method === 'POST' && pathname === '/broadcasts', createBroadcast],
  [(method, pathname) => method === 'GET' && pathname.startsWith('/broadcasts/'), getBroadcast],
  [
    (method, pathname) => method === 'DELETE' && pathname.startsWith('/broadcasts/'),
    deleteBroadcast,
  ],
  [(method, pathname) => pathname === '/domains', listDomains],
];

export function fakeResend({
  templates = {},
  failEmail = false,
  failBroadcast = false,
  failCreate = false,
  noAnswer = false,
  onBroadcast,
  broadcast = { status: 'scheduled' },
  refuseDelete = false,
  domains = [],
} = {}) {
  const fake = {
    options: {
      templates,
      failEmail,
      failBroadcast,
      failCreate,
      noAnswer,
      onBroadcast,
      broadcast,
      refuseDelete,
      domains,
    },
    calls: [],
    broadcasts: [],
    emails: [],
  };
  const fetch = vi.fn(async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    fake.calls.push({ method, pathname, body });
    const [, respond] = ROUTES.find(([matches]) => matches(method, pathname)) ?? [null, unexpected];
    return respond({ method, pathname, body }, fake);
  });
  return { fetch, calls: fake.calls, broadcasts: fake.broadcasts, emails: fake.emails };
}
