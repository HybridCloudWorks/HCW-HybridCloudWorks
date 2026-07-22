/**
 * Modern Admin Auth Hook (v2)
 *
 * Replaces the old hardcoded environment variable approach.
 * This hook:
 * 1. Gets current user from Firebase Auth
 * 2. Calls backend API to fetch admin status (uses Custom Claims)
 * 3. Caches result and syncs with admin config
 * 4. Returns admin status for UI gating
 *
 * This is the ONLY source of truth for admin status on the frontend.
 * No more manual environment variables, no more hardcoding, no more manual syncing.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { setCachedAdminStatus } from '@/config/admin-v2';
import { authedFetch } from '@/lib/api';
import { app } from '@/lib/firebaseConfig';

// Cache admin status per-uid to prevent leaking one user's status to another
// after a sign-out/sign-in within the same tab (OWASP A01 — broken access control).
const adminStatusCache = new Map(); // uid -> { status, time }
const ADMIN_STATUS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch admin status from backend.
 * Backend authorizes this via Firebase Custom Claims.
 *
 * @returns {Promise<Object>} Admin status object or null
 */
async function fetchAdminStatusFromBackend() {
  try {
    // Call backend function to get current user's admin status
    const response = await authedFetch('getCurrentAdminStatus', {
      method: 'GET',
    });

    if (!response.ok) {
      console.warn('Not an admin or token expired');
      return { isAdmin: false };
    }

    const status = await response.json();
    return status;
  } catch (err) {
    console.warn('Failed to fetch admin status:', err.message);
    return { isAdmin: false };
  }
}

/**
 * Get cached or fetch admin status with TTL, keyed by uid.
 */
async function getAdminStatus(uid) {
  if (!uid) return fetchAdminStatusFromBackend();

  const now = Date.now();
  const entry = adminStatusCache.get(uid);

  // Return cached if still valid
  if (entry && now - entry.time < ADMIN_STATUS_CACHE_TTL) {
    return entry.status;
  }

  // Fetch fresh
  const status = await fetchAdminStatusFromBackend();
  adminStatusCache.set(uid, { status, time: now });

  return status;
}

/**
 * Clear cached admin status (call on logout). Pass a uid to clear only that
 * user; omit to clear the whole cache.
 */
export function clearAdminStatusCache(uid) {
  if (uid) {
    adminStatusCache.delete(uid);
  } else {
    adminStatusCache.clear();
  }
}

// ============================================================================
// HOOK: useAdminAuth
// ============================================================================

/**
 * Hook to get current user's admin status.
 *
 * @returns {Object} {
 *   authReady: boolean - True when Firebase Auth state has been resolved
 *   isLoading: boolean - True while fetching admin status
 *   user: Object|null - Current Firebase user
 *   adminStatus: Object|null - Admin status (isAdmin, role, permissions, etc)
 *   error: string|null - Error message if fetch failed
 *   hasPermission: (permission) => boolean - Check if user has permission
 *   hasRole: (role) => boolean - Check if user has role
 * }
 */
export function useAdminAuth() {
  const [authReady, setAuthReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [adminStatus, setAdminStatus] = useState(null);
  const [error, setError] = useState(null);

  // Listen for Firebase Auth state changes
  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setError(null);

      if (!firebaseUser) {
        // User logged out
        setAdminStatus(null);
        setCachedAdminStatus({ isAdmin: false });
        clearAdminStatusCache();
        setAuthReady(true);
        return;
      }

      // User logged in, fetch their admin status
      setIsLoading(true);
      try {
        const status = await getAdminStatus(firebaseUser.uid);
        setAdminStatus(status);
        setCachedAdminStatus(status);
      } catch (err) {
        console.error('Error fetching admin status:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
        setAuthReady(true);
      }
    });

    return unsubscribe;
  }, []);

  // Helper functions
  const hasPermission = useCallback(
    (permission) => {
      if (!adminStatus?.permissions || !Array.isArray(adminStatus.permissions)) {
        return false;
      }
      return adminStatus.permissions.includes(permission);
    },
    [adminStatus]
  );

  const hasRole = useCallback(
    (role) => {
      if (!adminStatus?.role) return false;
      const ADMIN_ROLES = {
        viewer: 1,
        editor: 2,
        publisher: 3,
        super_admin: 4,
      };
      const userLevel = ADMIN_ROLES[adminStatus.role] || 0;
      const requiredLevel = ADMIN_ROLES[role] || 999;
      return userLevel >= requiredLevel;
    },
    [adminStatus]
  );

  return {
    authReady,
    isLoading,
    user,
    adminStatus,
    error,
    isAdmin: adminStatus?.isAdmin === true,
    hasPermission,
    hasRole,
  };
}

// ============================================================================
// HOOK: useAuthReady (backward compat - DEPRECATED)
// ============================================================================

/**
 * DEPRECATED: Use useAdminAuth() instead.
 *
 * This hook is provided for backward compatibility only.
 * All new code should use useAdminAuth().
 */
export function useAuthReady() {
  const { authReady, user, isAdmin } = useAdminAuth();

  return {
    authReady,
    user,
    isAdmin,
  };
}
