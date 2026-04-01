/* ============================================================
   STUDYVAULT — Firebase Configuration
   ============================================================

   SETUP STEPS (takes ~5 minutes, do this once):

   STEP 1 — Create a Firebase project
   ─────────────────────────────────
   • Go to https://console.firebase.google.com
   • Click "Add project" → give it any name → Continue
   • Disable Google Analytics if you want → Create project

   STEP 2 — Add a Web App & get your config
   ─────────────────────────────────────────
   • On the project homepage click the </> (Web) icon
   • Register app name (e.g. "StudyVault") → Register app
   • Copy the firebaseConfig object → paste it below

   STEP 3 — Enable Google Sign-In
   ───────────────────────────────
   • Left sidebar → Build → Authentication → Get started
   • Sign-in method tab → Google → Enable → Save

   STEP 4 — Create Firestore Database
   ────────────────────────────────────
   • Left sidebar → Build → Firestore Database → Create database
   • Choose "Start in production mode" → Next
   • Pick a region close to you → Enable

   STEP 5 — Set Firestore Security Rules
   ──────────────────────────────────────
   • Inside Firestore → Rules tab
   • Replace ALL the existing content with:

       rules_version = '2';
       service cloud.firestore {
         match /databases/{database}/documents {
           match /users/{userId}/{document=**} {
             allow read, write: if request.auth != null
                                && request.auth.uid == userId;
           }
         }
       }

   • Click "Publish"

   STEP 5b — Add your GitHub Pages domain to Authorized Domains
   ────────────────────────────────────────────────────────────
   • Authentication → Settings → Authorized domains
   • Click "Add domain" → enter:  your-username.github.io
   • Save

   STEP 6 — Paste your config below and deploy!
   ─────────────────────────────────────────────
   Replace every "PASTE_YOUR_..." value with your real values.

   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAZ2Pf-_ByP-djt8Pc1L9kAnv95aJytT6g",
  authDomain: "study-vault-f7b66.firebaseapp.com",
  projectId: "study-vault-f7b66",
  storageBucket: "study-vault-f7b66.firebasestorage.app",
  messagingSenderId: "651041882089",
  appId: "1:651041882089:web:0adaae6b451964e3ce9578",
};
