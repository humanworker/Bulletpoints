import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// ------------------------------------------------------------------
// TODO: REPLACE WITH YOUR FIREBASE CONFIGURATION
// 1. Go to console.firebase.google.com
// 2. Create a new project
// 3. Add a Web App
// 4. Copy the config object below
// 5. Enable Cloud Firestore in "Test Mode" (allow read/write for testing)
// ------------------------------------------------------------------

const firebaseConfig = {
  // apiKey: "AIzaSy...",
  // authDomain: "your-project.firebaseapp.com",
  // projectId: "your-project",
  // storageBucket: "your-project.firebasestorage.app",
  // messagingSenderId: "...",
  // appId: "..."
};

// Fallback to avoid crash if config is missing during review
const app = initializeApp(Object.keys(firebaseConfig).length > 0 ? firebaseConfig : {
   apiKey: "demo-key",
   projectId: "demo-project"
});

export const db = getFirestore(app);