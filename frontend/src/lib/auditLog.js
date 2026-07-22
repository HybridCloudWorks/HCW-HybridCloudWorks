/**
 * Admin Audit Logging
 * Centralized helper for logging admin actions
 *
 * Usage:
 *   import { logAdminAction } from '@/lib/auditLog';
 *   await logAdminAction('draft_saved', { contentId: blogId });
 */
import { getAuth } from 'firebase/auth';
import { postJSON } from '@/lib/api';
import { app } from '@/lib/firebaseConfig';

const SENSITIVE_KEY_PATTERN = /(token|secret|password|credential|api[_-]?key|private[_-]?key)/i;
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;

function createSessionId() {
  if (typeof window === 'undefined') return null;

  const key = 'hcw_admin_audit_session_id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;

  const next =
    typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(key, next);
  return next;
}

function sanitizeDetails(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[Truncated: depth limit reached]';

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetails(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, val]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        acc[key] = '[REDACTED]';
      } else {
        acc[key] = sanitizeDetails(val, depth + 1);
      }
      return acc;
    }, {});
  }

  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
  }

  return value;
}

/**
 * Log an admin action to Firestore
 * @param {string} action - Action name (e.g., 'draft_saved', 'content_scheduled')
 * @param {Object} details - Additional context for the action
 * @returns {Promise<void>}
 *
 * @example
 * await logAdminAction('draft_saved', {
 *   contentId: 'abc123',
 *   fieldUpdated: 'blogDraft',
 *   characterCount: 1234
 * });
 */
export async function logAdminAction(action, details = {}) {
  const auth = getAuth(app);
  const user = auth.currentUser;

  if (!user) {
    console.warn('Audit log skipped: No authenticated user');
    return;
  }

  try {
    const safeDetails = sanitizeDetails(details);
    await postJSON('recordAdminAudit', {
      action,
      details: {
        ...safeDetails,
        userId: user.uid,
        userEmail: user.email,
        route: typeof window !== 'undefined' ? window.location.pathname : null,
        sessionId: createSessionId(),
        clientTimestamp: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });
  } catch (err) {
    console.error('Audit log failed:', err);
    // Don't throw - logging failure shouldn't break user action
  }
}
