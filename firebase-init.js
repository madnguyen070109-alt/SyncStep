// ============================================================
// SyncStep — shared Firebase initialization
// Imported by every page that needs Auth, Firestore, or Storage.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// TODO: paste your actual config from
// Firebase console -> Project settings -> Your apps -> SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyDojU9F-ObpmXA8wHhyNpVq5yeC2WUsIcw",
  authDomain: "dance-for-change.firebaseapp.com",
  projectId: "dance-for-change",
  storageBucket: "dance-for-change.firebasestorage.app",
  messagingSenderId: "254199824166",
  appId: "1:254199824166:web:2081a16da7f08d56798be7",
  measurementId: "G-DE41P070HX"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
