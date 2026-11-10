import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  Firestore,
} from 'firebase/firestore';
import { LOCAL_ONLY } from './flags';

// The same Firebase project and document as the main Bulletpoints app.
const firebaseConfig = {
  apiKey: 'AIzaSyAK1vMHOprdSmVhtCDfC24I1Gz0vmVxUag',
  authDomain: 'bulletpoints.firebaseapp.com',
  projectId: 'bulletpoints-c92cb',
  storageBucket: 'bulletpoints-c92cb.firebasestorage.app',
  messagingSenderId: '648243282636',
  appId: '1:648243282636:web:0a78fa4dd5e46491a93869',
};

export const COLLECTION = 'bulletpoints-data';
export const DOC_ID = 'bulletpoints-shared-workspace';

let db: Firestore | null = null;

if (!LOCAL_ONLY) {
  try {
    const app = initializeApp(firebaseConfig);
    try {
      // On-device cache: edits made offline are queued and survive the app being killed
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }),
        ignoreUndefinedProperties: true,
      });
    } catch (cacheError) {
      console.warn('Persistent cache unavailable, using memory cache', cacheError);
      db = getFirestore(app);
    }
  } catch (error) {
    console.error('Firebase initialization failed', error);
  }
}

export { db };
