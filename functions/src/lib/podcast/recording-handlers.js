/**
 * Recording-side podcast routes (#442): script a recording, and upload audio
 * for Plaud Embedded to transcribe.
 *
 * Kept apart from `handlers.js` on purpose: that file is the article and
 * review surface and is being extended by #437 slice 2 in parallel. Both
 * routes here enqueue a platform job through the same queue output
 * `generatePodcastTranscript` uses, and answer 202 with the job id.
 *
 * Roles. Both are `editor`, matching `POST cms/podcast/transcripts/generate`
 * and the jobs they enqueue: each produces a draft, and approval stays a
 * separate publisher-gated act.
 */
import { JOBS_CONTAINER, newJobDoc } from '../jobs.js';
import { PODCAST_AUDIO_CONTAINER } from './store.js';
import {
  PLAUD_MCP_SERVER_ID,
  RECORDINGS_CONTAINER,
  RECORDING_JOB_TYPE,
  parseRecordingPayload,
  refusalForPlaud,
} from './recording-generate.js';
import {
  MAX_AUDIO_BASE64_CHARS,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_TITLE_CHARS,
  MAX_UPLOAD_REQUEST_BYTES,
  UPLOAD_JOB_TYPE,
  checkAudioUpload,
  uploadPathFor,
} from './recording-upload.js';
import { PlaudEmbeddedNotConfiguredError, isPlaudEmbeddedConfigured } from './plaud-embedded.js';
import { mediaUrlFor } from '../blob-paths.js';

const MCP_CONTAINER = 'mcp_servers';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const TOO_LARGE = `File exceeds the ${Math.round(MAX_AUDIO_UPLOAD_BYTES / 1024 / 1024)}MB upload limit`;

function readContentLength(request) {
  const raw = request?.headers?.get?.('content-length');
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ uploadBlob: Function }} deps.storage
 * @param {object} [deps.env]
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createPodcastRecordingHandlers({
  guard,
  store,
  storage,
  env = process.env,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  async function enqueueJob({ type, payload, auth, enqueue, context, label }) {
    if (typeof enqueue !== 'function') {
      context.error?.(`${label}: no queue output wired`);
      return { error: json(500, { error: 'Job queue is not configured' }) };
    }
    const jobId = uuid();
    const doc = newJobDoc({
      id: jobId,
      type,
      payload,
      requestedBy: auth.user,
      createdAt: now().toISOString(),
    });
    await store.upsertDoc(JOBS_CONTAINER, doc);
    enqueue({ jobId, type });
    return { jobId };
  }

  return {
    /**
     * POST /api/cms/podcast/transcripts/generate-from-recording —
     * `{ recordingId }` (Plaud library) or `{ storedRecordingId }` (the
     * `recordings` container). 409 with the Connect-tab sentence when no
     * Plaud token is stored; 404 when a stored recording does not exist.
     * Both refusals happen here so the tab can show them at once rather than
     * as a failed job it would have to poll for.
     *
     * @param {{ enqueue: (message: {jobId: string, type: string}) => void }} io
     */
    async generateFromRecording(request, context, { enqueue } = {}) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return json(400, { error: 'Body must be a JSON object' });
        }
        const parsed = parseRecordingPayload(body);
        if (parsed.error) return json(400, { error: parsed.error });
        const payload = parsed.value;

        let transcriptId;
        if (payload.recordingId) {
          const server = await store.readDoc(MCP_CONTAINER, PLAUD_MCP_SERVER_ID, PLAUD_MCP_SERVER_ID);
          const refusal = refusalForPlaud(server);
          if (refusal) return json(409, { error: refusal });
          transcriptId = `plaud_${payload.recordingId}`;
        } else {
          const id = payload.storedRecordingId;
          const recording = await store.readDoc(RECORDINGS_CONTAINER, id, id);
          if (!recording) return json(404, { error: `Recording ${id} was not found` });
          transcriptId = `recording_${id}`;
        }

        const queued = await enqueueJob({
          type: RECORDING_JOB_TYPE,
          payload,
          auth,
          enqueue,
          context,
          label: 'generatePodcastTranscriptFromRecording',
        });
        if (queued.error) return queued.error;

        context.log?.(
          `generatePodcastTranscriptFromRecording: queued ${queued.jobId} for ${transcriptId}`
        );
        return json(202, {
          ok: true,
          jobId: queued.jobId,
          type: RECORDING_JOB_TYPE,
          status: 'queued',
          poll: `getJob?jobId=${queued.jobId}`,
          transcriptId,
        });
      } catch (error) {
        context.error('generatePodcastTranscriptFromRecording failed:', error);
        return json(500, { error: 'Failed to queue the transcript' });
      }
    },

    /**
     * POST /api/cms/podcast/recordings/upload —
     * `{ title, fileName, contentType, dataBase64 }` → 202 with the job id,
     * the blob path and the media URL Plaud will be handed.
     *
     * Refuses before reading the body when the request is oversized, and
     * before storing anything when Plaud Embedded is not configured.
     */
    async uploadRecording(request, context, { enqueue } = {}) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      if (readContentLength(request) > MAX_UPLOAD_REQUEST_BYTES) {
        return json(413, { error: TOO_LARGE });
      }
      if (!isPlaudEmbeddedConfigured(env)) {
        return json(503, { error: new PlaudEmbeddedNotConfiguredError().message });
      }

      try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return json(400, { error: 'Body must be a JSON object' });
        }
        const title = String(body.title || '').trim();
        if (!title) return json(400, { error: 'title is required' });
        if (title.length > MAX_TITLE_CHARS) {
          return json(400, { error: `title is longer than ${MAX_TITLE_CHARS} characters` });
        }

        const media = checkAudioUpload({ contentType: body.contentType, fileName: body.fileName });
        if (!media.ok) return json(415, { error: media.message });

        const dataBase64 = String(body.dataBase64 || '');
        if (!dataBase64) return json(400, { error: 'dataBase64 is required' });
        if (dataBase64.length > MAX_AUDIO_BASE64_CHARS) return json(413, { error: TOO_LARGE });

        const buffer = Buffer.from(dataBase64, 'base64');
        if (buffer.length === 0) return json(400, { error: 'dataBase64 is not valid base64' });
        if (buffer.length > MAX_AUDIO_UPLOAD_BYTES) return json(413, { error: TOO_LARGE });

        const uploadPath = uploadPathFor(uuid(), media.extension);
        await storage.uploadBlob(
          PODCAST_AUDIO_CONTAINER,
          uploadPath,
          buffer,
          media.contentType,
          { source: 'recording-upload', uploadedBy: String(auth.user?.oid || '') },
          { overwrite: false }
        );

        const queued = await enqueueJob({
          type: UPLOAD_JOB_TYPE,
          payload: { uploadPath, title },
          auth,
          enqueue,
          context,
          label: 'uploadPodcastRecording',
        });
        if (queued.error) return queued.error;

        context.log?.(`uploadPodcastRecording: queued ${queued.jobId} (${buffer.length} B)`);
        return json(202, {
          ok: true,
          jobId: queued.jobId,
          type: UPLOAD_JOB_TYPE,
          status: 'queued',
          poll: `getJob?jobId=${queued.jobId}`,
          uploadPath,
          audioUrl: mediaUrlFor(PODCAST_AUDIO_CONTAINER, uploadPath),
          bytes: buffer.length,
        });
      } catch (error) {
        if (error?.statusCode === 404 || error?.code === 'ContainerNotFound') {
          return json(409, {
            error:
              `Blob container "${PODCAST_AUDIO_CONTAINER}" is not provisioned yet; it is declared in ` +
              'infra/storage.tf — run the Terraform apply that creates it, then upload again.',
          });
        }
        context.error('uploadPodcastRecording failed:', error);
        return json(500, { error: 'Failed to upload the recording' });
      }
    },
  };
}
