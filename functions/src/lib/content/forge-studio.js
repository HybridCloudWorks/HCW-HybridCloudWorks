/**
 * forge-studio.js — the owner's voice, editable (Blog Machine T-604, the
 * T-409 remainder). Until this existed, `admin_config/forge_profile` and
 * `admin_config/forge_prompts` could only be seeded by hand in Cosmos, which
 * meant the single most load-bearing input to the forge — whose voice it
 * writes in — had no admin surface at all.
 *
 * Two RPCs and one job:
 *   getForgeConfig    — both documents (normalized), plus the read-only
 *                       context an editor needs beside them: the format
 *                       library summary and the forge_stats scoreboard.
 *   updateForgeConfig — whitelist-validated partial update of either
 *                       document. The whitelist is the normalizers the
 *                       PIPELINE already trusts (normalizeProfile /
 *                       normalizePrompts), so nothing can be stored that the
 *                       forge would not read back the same way. Audited.
 *   voice-calibration — (registered in functions/forge-jobs.js) reads the
 *                       owner's recent published posts and writes SUGGESTED
 *                       wordSoup additions and style hints onto the profile's
 *                       `suggestions` field. Never merged automatically.
 *
 * The workspace half (ADR 0033 §7 slice 2, "Forge Studio as a real
 * workspace") adds three editor-side routes over a content document:
 * cms/forge/brief, cms/forge/assist and cms/forge/save.
 *
 * The code lives in ./forge-studio/ (PR #841), one module per concern; this
 * file is the import path every caller and test already uses:
 *   config.js       getForgeConfig / updateForgeConfig and their factory
 *   brief.js        the creative brief
 *   assist.js       the AI actions and the one router call per action
 *   workspace.js    the three workspace routes and their factory
 *   queue.js        the Forge Studio Queue: many URLs, their fields, their jobs
 *   calibration.js  the voice-calibration job
 */
export {
  MAX_WORD_SOUP_CHARS,
  MAX_SUGGESTIONS,
  normalizeSuggestions,
  createForgeStudioHandlers,
} from './forge-studio/config.js';
export {
  MAX_BRIEF_TEXT,
  MAX_BRIEF_LIST,
  TARGET_CHANNELS,
  BRIEF_MODES,
  normalizeBrief,
  briefHasSubstance,
  briefToMarkdown,
} from './forge-studio/brief.js';
export {
  MAX_ASSIST_TEXT_CHARS,
  FORGE_ASSIST_HTTP_BUDGET_MS,
  FORGE_ASSIST_AI_BUDGET_MS,
  ASSIST_ACTIONS,
  ASSIST_ACTION_NAMES,
  buildAssistPrompt,
} from './forge-studio/assist.js';
export {
  MAX_ACTIVITY_ENTRIES,
  MAX_SAVE_BODY_CHARS,
  activityEntry,
  appendActivity,
  applyBrief,
  workspaceWriteRefusal,
  createForgeWorkspaceHandlers,
} from './forge-studio/workspace.js';
export {
  QUEUE_DOC_TYPE,
  QUEUE_ID_PREFIX,
  LEGACY_QUEUE_DOC_ID,
  MAX_QUEUE_ITEMS,
  MAX_URLS_PER_ADD,
  QUEUE_BRIEF_FIELDS,
  QUEUE_STATUSES,
  normalizeQueueUrl,
  entryIdFor,
  readEntries,
  readEntry,
  updateEntry,
  entryBrief,
  newEntry,
  applyFields,
  outcomeFor,
  recordQueueOutcome,
  reconcileForging,
  migrateLegacyQueue,
  createForgeQueueHandlers,
} from './forge-studio/queue.js';
export {
  CALIBRATION_WRITE_ATTEMPTS,
  writeSuggestions,
  runVoiceCalibration,
} from './forge-studio/calibration.js';
