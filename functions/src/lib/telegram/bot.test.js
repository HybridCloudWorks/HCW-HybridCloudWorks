/**
 * Tests for the inbound Telegram bot (T-512).
 *
 * The weight is on the two authorization checks, because they are the whole
 * security model: this route is anonymous by necessity, so if either check is
 * wrong the bot is an unauthenticated remote-control for the platform — it can
 * resolve alerts, queue forge runs and read the ops snapshot.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createTelegramBot,
  createSender,
  expectedWebhookSecret,
  secretMatches,
  isAuthorizedSender,
  countNoun,
  formatAlerts,
  formatOpsStatus,
  HELP_TEXT,
  TOGGLEABLE_COMMANDS,
  ACTIVITY_CONTAINER,
} from './bot.js';

const ENV = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '4242' };

/** sha256('test-token'), computed independently of the implementation. */
const SECRET = expectedWebhookSecret(ENV);

function makeBot(overrides = {}) {
  const store = {
    readDoc: vi.fn(async () => null),
    upsertDoc: vi.fn(async () => ({})),
    patchDoc: vi.fn(async () => ({})),
    queryDocs: vi.fn(async () => []),
    ...overrides.store,
  };
  const send = overrides.send ?? vi.fn(async () => ({ sent: true }));
  const enqueueJob = overrides.enqueueJob ?? vi.fn(async () => 'job-1');
  const snapshot =
    overrides.snapshot ??
    vi.fn(async () => ({
      readiness: { publishedCount: 3, needsReviewCount: 1, stagedCount: 0, rssCount: 9 },
      alerts: [],
      digest: null,
      operationalSignals: { queueBreachCount: 0, oldestStagedHours: 0, publishFailureCount: 0 },
    }));
  const generateText = overrides.generateText ?? vi.fn(async () => 'a grounded answer');
  const bot = createTelegramBot({
    store,
    snapshot,
    enqueueJob,
    generateText,
    send,
    env: overrides.env ?? ENV,
    uuid: () => 'fixed-id',
    now: () => new Date('2026-08-22T00:00:00Z'),
  });
  return { bot, store, send, enqueueJob, snapshot, generateText };
}

const message = (text, chatId = 4242) => ({ message: { text, chat: { id: chatId } } });

describe('webhook secret', () => {
  it('derives from the bot token, so there is only one secret to rotate', () => {
    expect(SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(expectedWebhookSecret({ TELEGRAM_BOT_TOKEN: 'test-token' })).toBe(SECRET);
    expect(expectedWebhookSecret({ TELEGRAM_BOT_TOKEN: 'other' })).not.toBe(SECRET);
  });

  it('is empty when no token is configured, so the route can refuse rather than accept', () => {
    expect(expectedWebhookSecret({})).toBe('');
  });

  it('never matches an empty or mismatched secret', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches('', '')).toBe(false);
    expect(secretMatches('', SECRET)).toBe(false);
    expect(secretMatches(SECRET, SECRET.slice(0, -1) + '0')).toBe(false);
    // Length mismatch must not throw — timingSafeEqual does on unequal buffers.
    expect(() => secretMatches('short', SECRET)).not.toThrow();
    expect(secretMatches('short', SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
  });
});

describe('chat authorization — the check the secret does NOT make', () => {
  it('accepts only the configured chat', () => {
    expect(isAuthorizedSender(4242, ENV)).toBe(true);
    expect(isAuthorizedSender('4242', ENV)).toBe(true);
    expect(isAuthorizedSender(9999, ENV)).toBe(false);
    expect(isAuthorizedSender(undefined, ENV)).toBe(false);
  });

  it('refuses everything when no chat id is configured, rather than allowing everything', () => {
    expect(isAuthorizedSender(4242, { TELEGRAM_BOT_TOKEN: 't' })).toBe(false);
  });

  it('ignores an unauthorized chat silently — no reply, nothing enqueued', async () => {
    const { bot, send, enqueueJob } = makeBot();
    const result = await bot.handleUpdate(message('/status', 9999));
    expect(result).toEqual({ handled: false, reason: 'unauthorized_chat' });
    // Replying would confirm the bot exists to whoever found it.
    expect(send).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('command dispatch', () => {
  it('answers /help without touching the store', async () => {
    const { bot, send, store } = makeBot();
    await bot.handleUpdate(message('/help'));
    expect(send).toHaveBeenCalledWith(HELP_TEXT);
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('answers /start with the same help text', async () => {
    const { bot, send } = makeBot();
    await bot.handleUpdate(message('/start'));
    expect(send).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('strips a @botname suffix, which Telegram appends in group chats', async () => {
    const { bot, send } = makeBot();
    await bot.handleUpdate(message('/help@HcwOpsBot'));
    expect(send).toHaveBeenCalledWith(HELP_TEXT);
  });

  it('reports an unknown command instead of staying silent', async () => {
    const { bot, send } = makeBot();
    await bot.handleUpdate(message('/nope'));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
  });

  it('renders /status from the snapshot', async () => {
    const { bot, send } = makeBot();
    await bot.handleUpdate(message('/status'));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('Published: 3'));
  });

  it('routes free-form text to the AI with the snapshot as context', async () => {
    const { bot, send, generateText } = makeBot();
    await bot.handleUpdate(message('how is the queue looking?'));
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('Platform status JSON') })
    );
    expect(send).toHaveBeenCalledWith('a grounded answer');
  });
});

describe('long commands enqueue rather than run inline', () => {
  // An Azure invocation ends at the response, so upstream's ack-then-work
  // shape would drop these. Each maps to a platform job that already exists.
  it.each([
    ['/rss', 'fetch-rss-feeds'],
    ['/inspect', 'batch-inspect'],
    ['/forge abc123', 'forge-article'],
  ])('%s enqueues %s', async (text, type) => {
    const { bot, enqueueJob, send } = makeBot();
    await bot.handleUpdate(message(text));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type }));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('job-1'));
  });

  it('/forge without a content id explains itself instead of queueing a nameless job', async () => {
    const { bot, enqueueJob, send } = makeBot();
    await bot.handleUpdate(message('/forge'));
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('Usage: /forge <contentId>');
  });
});

describe('alert actions', () => {
  it('/ack patches the alert and confirms', async () => {
    const { bot, store, send } = makeBot({
      store: { readDoc: vi.fn(async () => ({ id: 'a1', status: 'open' })) },
    });
    await bot.handleUpdate(message('/ack a1'));
    expect(store.patchDoc).toHaveBeenCalledWith('workflow_alerts', 'a1', 'a1', expect.any(Object));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('acknowledged'));
  });

  it('/ack on a missing alert says so and patches nothing', async () => {
    const { bot, store, send } = makeBot();
    await bot.handleUpdate(message('/ack ghost'));
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("couldn't find an alert"));
  });

  it('/resolve requires a note — a resolution with no reason is not a resolution', async () => {
    const { bot, store, send } = makeBot();
    await bot.handleUpdate(message('/resolve a1'));
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('Usage: /resolve <alertId> <note>');
  });
});

describe('command toggles', () => {
  it('honours a disabled command from admin_settings', async () => {
    const { bot, send, snapshot } = makeBot({
      store: { readDoc: vi.fn(async () => ({ id: 'telegram_bot', commands: { status: false } })) },
    });
    await bot.handleUpdate(message('/status'));
    expect(snapshot).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining('currently disabled'));
  });

  it('treats a missing settings document as everything enabled', async () => {
    const { bot, snapshot } = makeBot();
    await bot.handleUpdate(message('/status'));
    expect(snapshot).toHaveBeenCalled();
  });

  it('cannot disable /help — the way out of a misconfiguration stays open', async () => {
    const { bot, send } = makeBot({
      store: { readDoc: vi.fn(async () => ({ commands: { help: false } })) },
    });
    await bot.handleUpdate(message('/help'));
    expect(send).toHaveBeenCalledWith(HELP_TEXT);
    expect(TOGGLEABLE_COMMANDS).not.toContain('help');
  });
});

describe('failure handling', () => {
  it('reports a thrown command into the chat and logs activity, rather than throwing', async () => {
    const { bot, send, store } = makeBot({
      snapshot: vi.fn(async () => {
        throw new Error('cosmos exploded');
      }),
    });
    const result = await bot.handleUpdate(message('/status'));
    expect(result.handled).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.stringContaining('cosmos exploded'));
    expect(store.upsertDoc).toHaveBeenCalledWith(ACTIVITY_CONTAINER, expect.objectContaining({ ok: false }));
  });

  it('a failed activity write does not lose the reply', async () => {
    const { bot, send } = makeBot({
      store: {
        readDoc: vi.fn(async () => ({ id: 'a1' })),
        upsertDoc: vi.fn(async () => {
          throw new Error('activity container unavailable');
        }),
      },
    });
    await bot.handleUpdate(message('/ack a1'));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('acknowledged'));
  });

  it('ignores updates with no text', async () => {
    const { bot, send } = makeBot();
    expect(await bot.handleUpdate({})).toEqual({ handled: false, reason: 'no_text' });
    expect(await bot.handleUpdate({ message: { chat: { id: 4242 } } })).toEqual({
      handled: false,
      reason: 'no_text',
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('sender', () => {
  it('posts to sendMessage with the configured chat', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const send = createSender({ env: ENV, fetch: fetchImpl });
    await send('hello');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(JSON.parse(init.body)).toEqual({ chat_id: '4242', text: 'hello' });
  });

  it('truncates at Telegram’s 4096-character limit instead of being rejected', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    await createSender({ env: ENV, fetch: fetchImpl })('x'.repeat(5000));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).text).toHaveLength(4096);
  });

  it('does not send when unconfigured', async () => {
    const fetchImpl = vi.fn();
    const result = await createSender({ env: {}, fetch: fetchImpl })('hi');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false, reason: 'not_configured' });
  });

  it('has no cooldown — consecutive replies both send', async () => {
    // createNotifier.notifyTelegram carries a 15-minute per-source cooldown,
    // which is right for alert storms and wrong for a reply.
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const send = createSender({ env: ENV, fetch: fetchImpl });
    await send('one');
    await send('two');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('formatters', () => {
  it('countNoun singularises', () => {
    expect(countNoun(1, 'hour')).toBe('1 hour');
    expect(countNoun(3, 'hour')).toBe('3 hours');
    expect(countNoun(1, 'item has', 'items have')).toBe('1 item has');
  });

  it('formatAlerts says so when there are none', () => {
    expect(formatAlerts([])).toBe('No open workflow alerts.');
    expect(formatAlerts([{ id: 'a1', title: 'Feed down', severity: 'warn' }])).toContain('a1');
  });

  it('formatOpsStatus tolerates an empty snapshot', () => {
    expect(() => formatOpsStatus({})).not.toThrow();
    expect(formatOpsStatus({})).toContain('Published: 0');
  });
});
