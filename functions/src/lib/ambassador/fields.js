/**
 * Field primitives shared by the ambassador validators (ADR 0033 §4): how a
 * string, a list, a link, a file reference or a period is read off a body.
 * Pure, tolerant of the wrong shape (a non-array list is an empty list), and
 * never throwing: refusal is the validator's job.
 */
import { isHttpUrl, toCalendarDate } from './model.js';

export const str = (value, max = 4000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
export const optionalStr = (value, max) =>
  value === null || value === undefined ? null : str(value, max) || null;
export const stringList = (value, max = 50) =>
  Array.isArray(value)
    ? value
        .map((v) => str(v, 300))
        .filter(Boolean)
        .slice(0, max)
    : [];
export const wholeNumber = (value) => Math.max(0, Math.floor(Number(value) || 0));
export const isRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const isBlank = (value) => value === null || value === undefined || value === '';

export function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string')
        return isHttpUrl(item) ? { label: item, url: item.trim() } : null;
      if (!item || typeof item !== 'object') return null;
      const url = str(item.url, 2000);
      if (!isHttpUrl(url)) return null;
      return { label: str(item.label, 200) || url, url };
    })
    .filter(Boolean)
    .slice(0, 50);
}

export function cleanFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const url = str(item.url, 2000);
      if (!url) return null;
      return {
        name: str(item.name, 300) || url.split('/').pop(),
        url,
        bytes: Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : null,
        uploadedAt: item.uploadedAt ? String(item.uploadedAt) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

export function cleanPeriod(value) {
  if (!value || typeof value !== 'object') return null;
  const start = toCalendarDate(value.start);
  const end = toCalendarDate(value.end);
  if (!start && !end) return null;
  return { start, end };
}
