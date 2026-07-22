import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '@/lib/firebaseConfig';
import {
  doc,
  onSnapshot,
  collection,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { recordLegacyBlogsRead } from '@/lib/legacyBlogsTelemetry';

/**
 * Custom hook to fetch a single Firestore document
 * @param {string} path - Document path (e.g., 'aws/blog/article-slug')
 * @returns {Object} { data, loading, error }
 */
export function useFirestoreDocument(path, { realtime = false } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);
  const trackedLegacyReadRef = useRef(false);

  useEffect(() => {
    if (!path) {
      return;
    }

    trackedLegacyReadRef.current = false;
    const docRef = doc(db, path);
    const isLegacyBlogsDoc = path.startsWith('blogs/');

    if (realtime) {
      if (isLegacyBlogsDoc && !trackedLegacyReadRef.current) {
        trackedLegacyReadRef.current = true;
        recordLegacyBlogsRead({ source: 'useFirestoreDocument.realtime', details: { path } });
      }
      const unsubscribe = onSnapshot(
        docRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setData({ id: docSnap.id, ...docSnap.data() });
          } else {
            setError(new Error('Document not found'));
          }
          setLoading(false);
        },
        (err) => {
          console.error('Error listening to document:', err);
          setError(err);
          setLoading(false);
        }
      );
      return unsubscribe;
    }

    if (isLegacyBlogsDoc) {
      recordLegacyBlogsRead({ source: 'useFirestoreDocument', details: { path } });
    }
    getDoc(docRef)
      .then((docSnap) => {
        if (docSnap.exists()) {
          setData({ id: docSnap.id, ...docSnap.data() });
        } else {
          setError(new Error('Document not found'));
        }
      })
      .catch((err) => {
        console.error('Error fetching document:', err);
        setError(err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [path, realtime]);

  return { data, loading, error };
}

/**
 * Custom hook to fetch a Firestore collection with optional query.
 *
 * Callers often pass options as an inline object literal, creating a new
 * reference every render. To avoid infinite re-fetch loops, options values
 * are serialized to a stable string (optionsKey). Because options contains
 * only plain JSON-serializable values, fetchCollection can parse them
 * directly from that string — no ref needed.
 *
 * @param {string} collectionPath - Collection path (e.g., 'aws/blog')
 * @param {Object} options - Query options { where, orderBy, limit }
 * @returns {Object} { data, loading, error, refetch }
 */
export function useFirestoreCollection(collectionPath, options = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(collectionPath));
  const [error, setError] = useState(null);

  // Stable string dep — only changes when option values actually change,
  // not just because the caller passed a new object reference.
  const optionsKey = JSON.stringify({
    where: options.where,
    orderBy: options.orderBy,
    limit: options.limit,
  });

  const fetchCollection = useCallback(async () => {
    // Parsed from the stable key so this callback only re-creates when
    // collectionPath or the serialized option values actually change.
    const opts = JSON.parse(optionsKey);
    try {
      setLoading(true);
      const collectionRef = collection(db, collectionPath);
      const isLegacyBlogsCollection = collectionPath === 'blogs';
      if (isLegacyBlogsCollection) {
        recordLegacyBlogsRead({
          source: 'useFirestoreCollection',
          details: { collectionPath, options: opts },
        });
      }

      let q = collectionRef;

      if (opts.where) {
        const [field, operator, value] = opts.where;
        q = query(q, where(field, operator, value));
      }

      if (opts.orderBy) {
        const [field, direction = 'asc'] = Array.isArray(opts.orderBy)
          ? opts.orderBy
          : [opts.orderBy];
        q = query(q, orderBy(field, direction));
      }

      if (opts.limit) {
        q = query(q, limit(opts.limit));
      }

      const querySnapshot = await getDocs(q);
      const documents = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setData(documents);
    } catch (err) {
      // Suppress noisy errors for known non-critical Firestore issues:
      // - Missing indexes (will be deployed later)
      // - Permission denied (rules not yet deployed)
      // - Collection doesn't exist yet
      const msg = err?.message || '';
      const isExpected =
        msg.includes('requires an index') ||
        msg.includes('Missing or insufficient permissions') ||
        msg.includes('PERMISSION_DENIED');
      if (!isExpected) {
        console.error('Error fetching collection:', err);
      }
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [collectionPath, optionsKey]);

  useEffect(() => {
    if (!collectionPath) {
      return;
    }
    const timer = setTimeout(() => {
      fetchCollection();
    }, 0);
    return () => clearTimeout(timer);
  }, [collectionPath, fetchCollection]);

  return { data, loading, error, refetch: fetchCollection };
}

/**
 * Hook to fetch data with local fallback (for development)
 * Falls back to local data if Firestore is not configured
 */
export function useContentData(collectionPath, fallbackData = []) {
  const { data, loading, error } = useFirestoreCollection(collectionPath);

  // If Firestore is not configured or returns error, use fallback
  if (error || (!loading && data.length === 0)) {
    return { data: fallbackData, loading: false, error: null };
  }

  return { data, loading, error };
}

/**
 * Hook to fetch documents with multiple where constraints.
 *
 * Firebase QueryConstraint objects cannot be round-tripped through JSON, so
 * a ref holds the live constraint objects for the fetch effect. The ref is
 * kept in sync via its own effect (with constraints as a complete dep), while
 * a separate serialized key (constraintKey) gates the actual fetch so it only
 * runs when constraint values meaningfully change — not on every render when
 * callers pass inline arrays.
 *
 * @param {string} collectionPath - Path to collection
 * @param {Array} constraints - Array of Firebase constraint objects from where(), orderBy(), limit()
 * @returns {Object} { data, loading, error }
 */
export function useFirestoreQuery(collectionPath, constraints = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(collectionPath));
  const [error, setError] = useState(null);

  // Stable string dep derived from the constraint field/op/value properties.
  const constraintKey = JSON.stringify(
    constraints.map((c) => {
      if (c && typeof c === 'object' && c.type) {
        return { type: c.type, field: c._field?.segments, op: c.op, value: c._value };
      }
      return String(c);
    })
  );

  // Ref holds the live Firebase constraint objects. Synced in its own effect
  // with complete deps so the fetch effect can always spread the latest
  // constraints into query() without triggering a re-fetch on every render.
  const constraintsRef = useRef(constraints);
  useEffect(() => {
    constraintsRef.current = constraints;
  }, [constraints]);

  useEffect(() => {
    if (!collectionPath) {
      return;
    }

    const fetchQuery = async () => {
      try {
        setLoading(true);
        const collectionRef = collection(db, collectionPath);
        const isLegacyBlogsCollection = collectionPath === 'blogs';
        if (isLegacyBlogsCollection) {
          recordLegacyBlogsRead({
            source: 'useFirestoreQuery',
            details: { collectionPath, constraintKey },
          });
        }

        const q = query(collectionRef, ...constraintsRef.current);

        const querySnapshot = await getDocs(q);
        const documents = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setData(documents);
      } catch (err) {
        // Suppress expected Firestore errors
        const msg = err?.message || '';
        const isExpected =
          msg.includes('requires an index') ||
          msg.includes('Missing or insufficient permissions') ||
          msg.includes('PERMISSION_DENIED');
        if (!isExpected) {
          console.error('Error fetching query:', err);
        }
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuery();
  }, [collectionPath, constraintKey]);

  return { data, loading, error };
}

export default {
  useFirestoreDocument,
  useFirestoreCollection,
  useContentData,
  useFirestoreQuery,
};
