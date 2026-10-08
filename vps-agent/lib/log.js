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
 * error) gets its own. The first line carries the timestamp and the agent id,
 * as before.
 *
 * No dependency: `node:util`'s format is what console.log uses, so a line
 * reads exactly as it did.
 */
import { format } from 'node:util';

/** sd-daemon priorities: SD_ERR, SD_WARNING, SD_INFO. */
export const PRIORITY = Object.freeze({ error: 3, warn: 4, info: 6 });

/**
 * The text one call writes: `[<N>]<iso> [<agentId>] <message>`, a prefix on
 * every line for warn and error, none for info. Ends with a newline.
 *
 * @param {{ level: 'error'|'warn'|'info', agentId: string, at: Date, args: unknown[] }} line
 */
export function formatLine({ level, agentId, at, args }) {
  const prefix = level === 'info' ? '' : `<${PRIORITY[level]}>`;
  const message = `${at.toISOString()} [${agentId}] ${format(...args)}`;
  return `${message
    .split(/\r?\n/)
    .map((text) => `${prefix}${text}`)
    .join('\n')}\n`;
}

/**
 * @param {object} options
 * @param {string} options.agentId
 * @param {(stream: 'stdout'|'stderr', text: string) => void} [options.write]
 *   stdout for info, stderr for warn and error; both reach the journal
 * @param {() => Date} [options.now]
 */
export function createLogger({
  agentId,
  write = (stream, text) => process[stream].write(text),
  now = () => new Date(),
}) {
  const emit = (level, stream) => (...args) => write(stream, formatLine({ level, agentId, at: now(), args }));
  return {
    info: emit('info', 'stdout'),
    warn: emit('warn', 'stderr'),
    error: emit('error', 'stderr'),
  };
}
