import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
// F10 — `firebase/storage` removed from the eager boot. Only admin pages
// need Storage; they import it via `@/lib/firebaseStorage` which lazy-loads
// the SDK chunk. This keeps the Storage SDK code out of every public-page
// visit's vendor-firebase bundle.

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const firebaseEntries = {
  VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: firebaseConfig.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: firebaseConfig.messagingSenderId,
  VITE_FIREBASE_APP_ID: firebaseConfig.appId,
};

const missingKeys = Object.entries(firebaseEntries)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

const hasAllFirebaseEnv = missingKeys.length === 0;

let dbInternal = null;
let appInternal = null;
if (hasAllFirebaseEnv) {
  appInternal = initializeApp(firebaseConfig);
  dbInternal = initializeFirestore(appInternal, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} else {
  throw new Error(
    `Firebase initialization failed. Missing env vars: ${missingKeys.join(', ')}. Check your .env file.`
  );
}

export const app = appInternal;
export const db = dbInternal;
// `storage` moved to @/lib/firebaseStorage (lazy module). Import it there
// when needed: `import { getStorage } from '@/lib/firebaseStorage'`.
