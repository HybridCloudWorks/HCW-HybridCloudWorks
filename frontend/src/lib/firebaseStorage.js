// F10 — Storage SDK isolation.
//
// Only admin pages (ImageGalleryPage, SubmitUrlsPage) need Firebase Storage.
// By keeping the `firebase/storage` import out of `firebaseConfig.js`, the
// public-page bundle stops paying for the Storage SDK code. Admin consumers
// pull it in via a single import here; Vite still splits this module into
// the route-level chunk where it's used.
//
// Memoized so repeated calls inside a single session don't re-instantiate.
import { getStorage as fbGetStorage } from 'firebase/storage';
import { app } from '@/lib/firebaseConfig';

let storageInstance = null;

export function getStorage() {
  if (!storageInstance) {
    storageInstance = fbGetStorage(app);
  }
  return storageInstance;
}

// Convenience export for sites that prefer a value-import. Calls into the
// memoized getStorage on first read.
export const storage = new Proxy(
  {},
  {
    get(_target, prop) {
      const inst = getStorage();
      const value = inst[prop];
      return typeof value === 'function' ? value.bind(inst) : value;
    },
  }
);
