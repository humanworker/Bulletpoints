import { initializeApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// ------------------------------------------------------------------
// INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com/
// 2. Select your project -> Project Settings -> General -> Your apps
// 3. Copy the values from the firebaseConfig object and paste them below
// ------------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyAK1vMHOprdSmVhtCDfC24I1Gz0vmVxUag",
  authDomain: "bulletpoints-c92cb.firebaseapp.com",
  projectId: "bulletpoints-c92cb",
  storageBucket: "bulletpoints-c92cb.firebasestorage.app",
  messagingSenderId: "648243282636",
  appId: "1:648243282636:web:0a78fa4dd5e46491a93869"
};




let db: Firestore | null = null;

// Check if keys have been replaced before initializing
if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY_HERE") {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully");
  } catch (error) {
    console.error("Firebase initialization failed:", error);
  }
} else {
  console.warn("MinFlow: Firebase config is missing or using placeholders. Falling back to local storage.");
}

export { db };