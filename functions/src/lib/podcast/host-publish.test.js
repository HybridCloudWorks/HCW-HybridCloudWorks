/**
 * Publishing an episode document to the host (#437).
 *
 * Two properties carry the issue's acceptance: a second run on the same
 * document PATCHes rather than POSTs, and a failure records itself under
 * `host.rsscom` without touching the approval. Everything else is the shape
 * of what the host is told.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  HOST_DESCRIPTION_MAX,
  HOST_TITLE_MAX,
  describeForHost,
  publishEpisodeToHost,
} from './host-publish.js';
import { RSSCOM_API_BASE_URL, RssComError, createRssComClient } from './rsscom.js';

const ENV = { RSSCOM_API_KEY: 'rk_test', RSSCOM_PODCAST_ID: '4242' };
const NOW = new Date('2026-09-09T10:00:00.000Z');
const now = () => NOW;

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

const HOST_EPISODE = {
  id: 9001,
  guid: 'guid-9001',
  status: 'scheduled',
  audio_url: 'https://media.rss.com/x/9001.mp3',
  processing: { transcode: { status: 'pending', details: null } },
};

const doc = (overrides = {}) => ({
  id: 'manage-governance',
  setId: 'azure_az-104',
  title: 'Manage Azure identities and governance',
  summary: 'What the exam expects you to know about identities, RBAC and policy.',
  keyTakeaways: ['Roles are scoped', 'Policy is not RBAC', 'Locks beat everyone'],
  audioPath: 'azure/az-104/manage-governance.mp3',
  status: 'published',
  approvedAt: '2026-09-09T09:00:00.000Z',
  approvedBy: 'oid-owner',
  ...overrides,
});

/** A fetch that answers in order and records what it was asked. */
function fakeHost(responses) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => queue.shift() || reply(200, {}));
  const calls = () => fetchImpl.mock.calls.map(([url, init]) => ({ url, method: init.method, init }));
  const methods = () => calls().map((c) => `${c.method} ${new URL(c.url).pathname}`);
  return { fetchImpl, calls, methods };
}

const readAudio = vi.fn(async () => ({ bytes: Buffer.from('mp3'), contentType: 'audio/mpeg' }));

const HAPPY = [
  reply(201, { id: 'up_1', url: 'https://store.example/put' }),
  reply(200),
  reply(201, HOST_EPISODE),
];

describe('describeForHost', () => {
  it('maps title, summary and takeaways to plain-text episode notes with the AI flag set', () => {
    const out = describeForHost(doc(), { publicUrl: 'https://hybridcloudworks.com/azure/audio' });
    expect(out).toEqual({
      title: 'Manage Azure identities and governance',
      description:
        'What the exam expects you to know about identities, RBAC and policy.\n\n' +
        'Key takeaways:\n- Roles are scoped\n- Policy is not RBAC\n- Locks beat everyone',
      ai_content: true,
      itunes_episode_type: 'full',
      custom_link: 'https://hybridcloudworks.com/azure/audio',
    });
    expect(out.description).not.toMatch(/<[a-z]+>/i);
  });

  it('omits custom_link when no public URL is supplied, rather than sending null', () => {
    const out = describeForHost(doc());
    expect('custom_link' in out).toBe(false);
  });

  it('refuses a custom_link that is not an http(s) URL', () => {
    expect(() => describeForHost(doc(), { publicUrl: 'javascript:alert(1)' })).toThrow(
      RssComError
    );
  });

  it('falls back to the title when there is no summary and no takeaways', () => {
    const out = describeForHost(doc({ summary: '', keyTakeaways: [] }));
    expect(out.description).toBe('Manage Azure identities and governance');
  });

  it('ignores blank takeaways and collapses whitespace', () => {
    const out = describeForHost(doc({ summary: '  two   words \n', keyTakeaways: ['', '  ', ' a  b '] }));
    expect(out.description).toBe('two words\n\nKey takeaways:\n- a b');
  });

  it('keeps title and description inside the spec limits, cutting at a word', () => {
    const long = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
    const out = describeForHost(doc({ title: long, summary: long, keyTakeaways: [] }));
    expect(out.title.length).toBeLessThanOrEqual(HOST_TITLE_MAX);
    expect(out.description.length).toBeLessThanOrEqual(HOST_DESCRIPTION_MAX);
    expect(out.title.endsWith('…')).toBe(true);
    // Never mid-word: what precedes the ellipsis is a prefix of the input that
    // ends exactly where a space was.
    expect(long.startsWith(`${out.title.slice(0, -1)} `)).toBe(true);
    expect(long.startsWith(`${out.description.slice(0, -1)} `)).toBe(true);
  });

  it('refuses an episode with no title', () => {
    expect(() => describeForHost(doc({ title: '   ' }))).toThrow(/no title/);
  });
});

describe('publishEpisodeToHost — first publish', () => {
  it('uploads, creates, and returns the host record to store', async () => {
    const host = fakeHost(HAPPY);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({
      client,
      readAudio,
      doc: doc(),
      now,
      publicUrl: 'https://hybridcloudworks.com/azure/audio',
    });

    expect(host.methods()).toEqual([
      'POST /v4/podcasts/4242/assets/presigned-uploads',
      'PUT /put',
      'POST /v4/podcasts/4242/episodes',
    ]);
    expect(readAudio).toHaveBeenCalledWith('azure/az-104/manage-governance.mp3');

    const [presign, put, create] = host.calls();
    expect(JSON.parse(presign.init.body)).toEqual({
      asset_type: 'audio',
      expected_mime: 'audio/mpeg',
      filename: 'manage-governance.mp3',
    });
    expect(put.url).toBe('https://store.example/put');
    expect(put.init.headers['X-Api-Key']).toBeUndefined();
    expect(JSON.parse(create.init.body)).toEqual({
      title: 'Manage Azure identities and governance',
      description: expect.stringContaining('Key takeaways:'),
      ai_content: true,
      itunes_episode_type: 'full',
      custom_link: 'https://hybridcloudworks.com/azure/audio',
      audio_upload_id: 'up_1',
      schedule_datetime: NOW.toISOString(),
    });

    expect(patch).toEqual({
      host: {
        rsscom: {
          episodeId: 9001,
          guid: 'guid-9001',
          hostStatus: 'scheduled',
          audioPath: 'azure/az-104/manage-governance.mp3',
          uploadId: 'up_1',
          publishedAt: NOW.toISOString(),
          lastAttemptAt: NOW.toISOString(),
          error: null,
        },
      },
    });
    // The patch is host state only: approval fields are not the orchestrator's to write.
    expect(Object.keys(patch)).toEqual(['host']);
  });

  it('accepts a bare Buffer from readAudio and defaults the mime', async () => {
    const host = fakeHost(HAPPY);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({
      client,
      readAudio: async () => Buffer.from('mp3'),
      doc: doc(),
      now,
    });
    expect(patch.host.rsscom.error).toBeNull();
    expect(JSON.parse(host.calls()[0].init.body).expected_mime).toBe('audio/mpeg');
  });
});

describe('publishEpisodeToHost — idempotent re-publish', () => {
  const previouslyPublished = () =>
    doc({
      host: {
        rsscom: {
          episodeId: 9001,
          guid: 'guid-9001',
          hostStatus: 'published',
          audioPath: 'azure/az-104/manage-governance.mp3',
          uploadId: 'up_1',
          publishedAt: '2026-09-08T10:00:00.000Z',
          lastAttemptAt: '2026-09-08T10:00:00.000Z',
          error: null,
        },
      },
    });

  it('PATCHes the recorded episode and never POSTs a second one', async () => {
    const host = fakeHost([reply(200, { ...HOST_EPISODE, status: 'published' })]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const read = vi.fn(async () => Buffer.from('mp3'));
    const patch = await publishEpisodeToHost({
      client,
      readAudio: read,
      doc: previouslyPublished(),
      now,
    });

    expect(host.methods()).toEqual(['PATCH /v4/podcasts/4242/episodes/9001']);
    expect(read).not.toHaveBeenCalled();
    const body = JSON.parse(host.calls()[0].init.body);
    expect(body.audio_upload_id).toBeUndefined();
    // Already published on the host: not re-scheduled.
    expect(body.schedule_datetime).toBeUndefined();
    expect(body.title).toBe('Manage Azure identities and governance');

    expect(patch.host.rsscom).toEqual({
      episodeId: 9001,
      guid: 'guid-9001',
      hostStatus: 'published',
      audioPath: 'azure/az-104/manage-governance.mp3',
      uploadId: 'up_1',
      publishedAt: '2026-09-08T10:00:00.000Z',
      lastAttemptAt: NOW.toISOString(),
      error: null,
    });
  });

  it('re-uploads the audio only when audioPath changed, and records the new upload', async () => {
    const host = fakeHost([
      reply(201, { id: 'up_2', url: 'https://store.example/put2' }),
      reply(200),
      reply(200, { ...HOST_EPISODE, status: 'scheduled' }),
    ]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const regenerated = previouslyPublished();
    regenerated.audioPath = 'azure/az-104/manage-governance-v2.mp3';
    const patch = await publishEpisodeToHost({ client, readAudio, doc: regenerated, now });

    expect(host.methods()).toEqual([
      'POST /v4/podcasts/4242/assets/presigned-uploads',
      'PUT /put2',
      'PATCH /v4/podcasts/4242/episodes/9001',
    ]);
    const body = JSON.parse(host.calls()[2].init.body);
    expect(body.audio_upload_id).toBe('up_2');
    expect(patch.host.rsscom.uploadId).toBe('up_2');
    expect(patch.host.rsscom.audioPath).toBe('azure/az-104/manage-governance-v2.mp3');
    expect(patch.host.rsscom.publishedAt).toBe('2026-09-08T10:00:00.000Z');
    expect(patch.host.rsscom.episodeId).toBe(9001);
  });

  it('re-schedules a host episode that is still a draft, so a stuck first publish can finish', async () => {
    const host = fakeHost([reply(200, { ...HOST_EPISODE, status: 'scheduled' })]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const stuck = previouslyPublished();
    stuck.host.rsscom.hostStatus = 'draft';
    await publishEpisodeToHost({ client, readAudio, doc: stuck, now });
    const body = JSON.parse(host.calls()[0].init.body);
    expect(body.schedule_datetime).toBe(NOW.toISOString());
  });

  it('a retry after a recorded failure still PATCHes the same episode and clears the error', async () => {
    const host = fakeHost([reply(200, { ...HOST_EPISODE, status: 'published' })]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const failed = previouslyPublished();
    failed.host.rsscom.error = { status: 503, message: 'earlier' };
    const patch = await publishEpisodeToHost({ client, readAudio, doc: failed, now });
    expect(host.methods()).toEqual(['PATCH /v4/podcasts/4242/episodes/9001']);
    expect(patch.host.rsscom.error).toBeNull();
    expect(patch.host.rsscom.episodeId).toBe(9001);
  });
});

describe('publishEpisodeToHost — failure is recorded, never thrown', () => {
  it('records an upstream failure with status and message and keeps the previous host record', async () => {
    const host = fakeHost([
      reply(201, { id: 'up_1', url: 'https://store.example/put' }),
      reply(200),
      reply(503, { status: 503, message: 'transcoder busy' }),
    ]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const original = doc();
    const snapshot = JSON.stringify(original);
    const patch = await publishEpisodeToHost({ client, readAudio, doc: original, now });

    expect(patch).toEqual({
      host: {
        rsscom: {
          lastAttemptAt: NOW.toISOString(),
          error: {
            status: 503,
            code: 'UPSTREAM',
            message: 'RSS.com answered 503 while creating the episode: transcoder busy.',
            retryable: true,
          },
        },
      },
    });
    // No episodeId was recorded, so the next run creates rather than patches a ghost.
    expect(patch.host.rsscom.episodeId).toBeUndefined();
    // The document itself is untouched, and approval never appears in the patch.
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('approvedAt');
    expect(patch).not.toHaveProperty('approvedBy');
  });

  it('keeps the previous host record beside the error on a failed re-publish', async () => {
    const host = fakeHost([reply(500, { status: 500, message: 'down' })]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const previous = {
      episodeId: 9001,
      guid: 'guid-9001',
      hostStatus: 'published',
      audioPath: 'azure/az-104/manage-governance.mp3',
      uploadId: 'up_1',
      publishedAt: '2026-09-08T10:00:00.000Z',
      lastAttemptAt: '2026-09-08T10:00:00.000Z',
      error: null,
    };
    const patch = await publishEpisodeToHost({
      client,
      readAudio,
      doc: doc({ host: { rsscom: previous } }),
      now,
    });
    expect(patch.host.rsscom).toEqual({
      ...previous,
      lastAttemptAt: NOW.toISOString(),
      error: { status: 500, code: 'UPSTREAM', message: expect.stringContaining('500'), retryable: true },
    });
  });

  it('401 is surfaced as configured-but-rejected, not as not-configured', async () => {
    const host = fakeHost([reply(401, { status: 401, message: 'Unauthorized' })]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({ client, readAudio, doc: doc(), now });
    expect(patch.host.rsscom.error).toEqual({
      status: 401,
      code: 'KEY_REJECTED',
      message: 'RSS.com rejected the API key while creating a presigned upload (401 Unauthorized).',
      retryable: false,
    });
  });

  it('not configured → the plain sentence, no network call, no throw', async () => {
    const host = fakeHost([]);
    const client = createRssComClient({ env: {}, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({ client, readAudio, doc: doc(), now });
    expect(host.fetchImpl).not.toHaveBeenCalled();
    expect(patch.host.rsscom.error.status).toBeNull();
    expect(patch.host.rsscom.error.code).toBe('NOT_CONFIGURED');
    expect(patch.host.rsscom.error.message).toMatch(
      /^RSS\.com publishing is not configured: RSSCOM_API_KEY .* and RSSCOM_PODCAST_ID .* are not set/
    );
  });

  it('an episode with no audio is refused before any call is made', async () => {
    const host = fakeHost([]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({
      client,
      readAudio,
      doc: doc({ audioPath: null }),
      now,
    });
    expect(host.fetchImpl).not.toHaveBeenCalled();
    expect(patch.host.rsscom.error.code).toBe('VALIDATION');
    expect(patch.host.rsscom.error.message).toMatch(/no audio/);
  });

  it('a blob read that throws is recorded as UNEXPECTED rather than escaping', async () => {
    const host = fakeHost([]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({
      client,
      readAudio: async () => {
        throw new Error('BlobNotFound');
      },
      doc: doc(),
      now,
    });
    expect(host.fetchImpl).not.toHaveBeenCalled();
    expect(patch.host.rsscom.error).toEqual({
      status: null,
      code: 'UNEXPECTED',
      message: 'BlobNotFound',
      retryable: false,
    });
  });

  it('a create that answers without an id is a failure, so nothing half-recorded is stored', async () => {
    const host = fakeHost([
      reply(201, { id: 'up_1', url: 'https://store.example/put' }),
      reply(200),
      reply(201, { title: 'no id here' }),
    ]);
    const client = createRssComClient({ env: ENV, fetch: host.fetchImpl });
    const patch = await publishEpisodeToHost({ client, readAudio, doc: doc(), now });
    expect(patch.host.rsscom.episodeId).toBeUndefined();
    expect(patch.host.rsscom.error.code).toBe('UPSTREAM');
    expect(patch.host.rsscom.error.message).toMatch(/without an id/);
  });

  it('a missing client is a recorded failure too', async () => {
    const patch = await publishEpisodeToHost({ client: null, readAudio, doc: doc(), now });
    expect(patch.host.rsscom.error.code).toBe('NOT_CONFIGURED');
  });

  it('the API base URL is the v4 host the spec was read from', () => {
    expect(RSSCOM_API_BASE_URL).toBe('https://api.rss.com/v4');
  });
});
