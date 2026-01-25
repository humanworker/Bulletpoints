

import { initializeApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// ------------------------------------------------------------------
// INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com/
// 2. Select your project -> Project Settings -> General -> Your apps
// 3. Copy the values from the firebaseConfig object
// 4. Paste them below OR use environment variables (VITE_FIREBASE_...)
// ------------------------------------------------------------------

// Type definition for Vite environment variables to avoid TypeScript errors
// when vite/client types are missing.
interface ImportMetaEnv {
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
}

// Cast import.meta to include env
const env = (import.meta as unknown as { env: ImportMetaEnv }).env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyAK1vMHOprdSmVhtCDfC24I1Gz0vmVxUag",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "bulletpoints.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "bulletpoints-c92cb",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "bulletpoints-c92cb.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "648243282636",
  appId: env.VITE_FIREBASE_APP_ID || "1:648243282636:web:0a78fa4dd5e46491a93869"
};

let db: Firestore | null = null;

// Helper to check if a value is a placeholder
const isPlaceholder = (value: string | undefined) => !value || value.includes("PASTE_");

// Check if keys have been replaced before initializing
if (firebaseConfig.apiKey && !isPlaceholder(firebaseConfig.apiKey)) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully");
  } catch (error) {
    console.error("Firebase initialization failed:", error);
  }
} else {
  console.warn("Bulletpoints: Firebase config is missing or using placeholders. Falling back to local storage.");
}

export { db };