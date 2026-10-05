/**
 * containers.js — where the AI configuration lives in Cosmos: the provider
 * cards' container and the settings container with its document ids.
 *
 * Split from ai-config.js in ADR 0034 slice 3 (#858) so the catalogue's read
 * path (model-catalog-doc.js) can name the container without importing the
 * loader, which imports it. ai-config.js re-exports these; every caller
 * keeps importing them from there.
 */
export const PROVIDERS_CONTAINER = 'ai_providers';
export const SETTINGS_CONTAINER = 'admin_settings';
export const FEATURES_DOC_ID = 'ai-features';

/**
 * The Listen & Learn speech setting the config loader reads for the media
 * migration (ADR 0034 slice 5, #860): `admin_config` is partitioned on the
 * constant `configScope` (cosmos-client.js ADMIN_CONFIG_PARTITION), and the
 * document id is speech-settings.js LISTEN_AND_LEARN_SPEECH_CONFIG_ID —
 * both restated here rather than imported, for the same reason as above.
 */
export const ADMIN_CONFIG_CONTAINER = 'admin_config';
export const ADMIN_CONFIG_PARTITION = 'admin_config';
export const LISTEN_AND_LEARN_SPEECH_DOC_ID = 'listen_and_learn_speech';
/** The podcast voice model setting (speech/elevenlabs.js ELEVENLABS_MODEL_SETTING), restated likewise. */
export const PODCAST_VOICE_MODEL_SETTING = 'LISTEN_AND_LEARN_ELEVENLABS_MODEL';
