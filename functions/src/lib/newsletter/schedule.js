/**
 * schedule.js — when an approved issue goes out (ADR 0030 §2a).
 *
 * The owner sets a weekday, a wall-clock time and a time zone ("Tuesday 09:00
 * America/Chicago"). Everything else in this app is UTC (#416), so the one
 * place a local wall clock is honoured is here, and it is converted to a UTC
 * instant before Resend ever sees it.
 *
 * Why a time zone rather than a UTC hour: "09:00 Central" is a promise to the
 * reader's inbox, and it has to stay 09:00 through daylight saving. A fixed UTC
 * hour would move the send an hour every March and November.
 */

export const SEND_DAYS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

/** The longest an approved issue waits for its slot before it simply goes now. */
export const MAX_WAIT_FOR_SLOT_MS = 72 * 60 * 60 * 1000;

/** @param {string} value */
export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** `HH:MM`, 24-hour. */
export function isValidSendTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The wall-clock parts of `date` in `timeZone`. */
function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: String(parts.weekday).toLowerCase(),
  };
}

/** The UTC offset of `timeZone` at `date`, in milliseconds. */
function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time. Two passes, because the offset
 * to use is the offset AT the answer, which is not always the offset now.
 */
export function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/**
 * The next send slot at or after `now`.
 *
 * @param {Date} now
 * @param {{ sendDay: string, sendTime: string, timeZone: string }} settings
 * @returns {Date}
 */
export function nextSendSlot(now, { sendDay, sendTime, timeZone }) {
  if (!SEND_DAYS.includes(sendDay)) throw new Error(`sendDay must be one of ${SEND_DAYS.join(', ')}`);
  if (!isValidSendTime(sendTime)) throw new Error('sendTime must be HH:MM');
  if (!isValidTimeZone(timeZone)) throw new Error(`${timeZone} is not a time zone`);
  const [hour, minute] = sendTime.split(':').map(Number);

  // Walk local calendar days from today; eight covers "today, but the slot has
  // passed" landing on the same weekday next week.
  const today = zonedParts(now, timeZone);
  for (let offset = 0; offset < 8; offset += 1) {
    const civil = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12));
    const weekday = SEND_DAYS[civil.getUTCDay()];
    if (weekday !== sendDay) continue;
    const slot = zonedTimeToUtc(
      {
        year: civil.getUTCFullYear(),
        month: civil.getUTCMonth() + 1,
        day: civil.getUTCDate(),
        hour,
        minute,
      },
      timeZone
    );
    if (slot.getTime() > now.getTime()) return slot;
  }
  /* c8 ignore next */
  throw new Error('no send slot found within a week');
}

/**
 * When an issue approved at `now` should go out: its slot if that is within
 * three days, otherwise immediately. An issue approved on Wednesday would
 * otherwise wait six days and arrive describing a week that ended long ago.
 *
 * @returns {{ sendNow: true } | { sendNow: false, scheduledAt: string }}
 */
export function resolveSendTime(now, settings) {
  const slot = nextSendSlot(now, settings);
  if (slot.getTime() - now.getTime() > MAX_WAIT_FOR_SLOT_MS) return { sendNow: true };
  return { sendNow: false, scheduledAt: slot.toISOString() };
}
