/**
 * The agent's log lines, each with the syslog priority journald reads.
 *
 * systemd runs the agent with stdout and stderr on the journal, and journald
 * takes a line's priority from a leading `<N>`, the sd-daemon prefix
 * (sd-daemon(3); `SyslogLevelPrefix=`, on by default and set explicitly in
 * hcw-labs-agent.service.j2). A line without one is priority 6, info. The
 * data collection rule on the lab host collects the `daemon` and `user`
 * facilities at Warning and above only (infra/lab-hybrid.tf,
 * `dcr-lab-hybrid-prod-cus`), so until #1009 every agent error — a failed
 * heartbeat, a job that errored, a result that could not be reported — was
 * written at info and none of them reached Log Analytics.
 *
 * Now an error line starts `<3>` and a warning `<4>`; info lines carry no
 * prefix and stay at journald's default. journald reads the prefix per line,
 * so every line of a message that spans several (a stack, a multi-line
 * error) gets its own.
 *
 * WHAT A COLLECTED LINE MAY SAY. Warning and above leave the host for Log
 * Analytics, and telemetry here is content-free: no document identifiers, no
 * paths, no payloads (.github/pull_request_template.md). So no line carries
 * the agent's id — journald already names the unit, and there is one agent
 * per host — and a failure is written with `fault`: the collected line says
 * what failed and the error's class, and an info line beside it, which stays
 * on the host's journal, carries the job id and the error's own text. A
 * docker-runner error can quote a path from a learner's tar payload, which
 * is exactly what must not be collected (review of #1018).
 *
 * No dependency: `node:util`'s format is what console.log uses, so a line
 * reads exactly as it did.
 */
import { format } from 'node:util';

/** sd-daemon priorities: SD_ERR, SD_WARNING, SD_INFO. */
export const PRIORITY = Object.freeze({ error: 3, warn: 4, info: 6 });

/**
 * The text one call writes: `[<N>]<iso> <message>`, a prefix on every line
 * for warn and error, none for info. Ends with a newline.
 *
 * @param {{ level: 'error'|'warn'|'info', at: Date, args: unknown[] }} line
 */
export function formatLine({ level, at, args }) {
  const prefix = level === 'info' ? '' : `<${PRIORITY[level]}>`;
  const message = `${at.toISOString()} ${format(...args)}`;
  return `${message
    .split(/\r?\n/)
    .map((text) => `${prefix}${text}`)
    .join('\n')}\n`;
}

const TOKEN = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * An error's class, never its text: a Node or system code (ETIMEDOUT), the
 * HTTP status the API client attaches (lib/api.js), or the constructor's name.
 * The only thing a collected line says about why something failed.
 */
export function errorClass(err) {
  if (err?.code !== undefined && TOKEN.test(String(err.code))) return String(err.code);
  if (Number.isInteger(err?.status)) return `HTTP ${err.status}`;
  if (typeof err?.name === 'string' && TOKEN.test(err.name)) return err.name;
  return 'Error';
}

/**
 * @param {object} [options]
 * @param {(stream: 'stdout'|'stderr', text: string) => void} [options.write]
 *   stdout for info, stderr for warn and error; both reach the journal
 * @param {() => Date} [options.now]
 */
export function createLogger({
  write = (stream, text) => process[stream].write(text),
  now = () => new Date(),
} = {}) {
  const emit = (level, stream) => (...args) => write(stream, formatLine({ level, at: now(), args }));
  const info = emit('info', 'stdout');
  const levels = { warn: emit('warn', 'stderr'), error: emit('error', 'stderr') };
  return {
    info,
    ...levels,
    /**
     * A failure in two lines: `<what> (<class>)` at `level`, collected; then
     * `<what>: <detail>: <the error's text>` at info, kept on the host.
     *
     * @param {'warn'|'error'} level
     * @param {string} what - fixed text: what failed, with no identifier in it
     * @param {unknown} err
     * @param {string} [detail] - the identifiers, e.g. `job <id>`; host only
     */
    fault(level, what, err, detail) {
      levels[level](`${what} (${errorClass(err)})`);
      const text = err instanceof Error ? err.stack || err.message : String(err);
      info(`${what}: ${detail ? `${detail}: ` : ''}${text}`);
    },
  };
}
