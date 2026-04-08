# StudyVault — Complete Deployment Guide

## Files in This Repo
```
index.html          ← Main app (includes AI panel script tags)
style.css           ← All styles
script.js           ← App logic (Firebase, file management, UI)
firebase-config.js  ← Your Firebase credentials ← FILL THIS IN
geminiAgent.js      ← AI brain (Gemini 2.5 Flash) ← PASTE API KEY
chatPanel.js        ← AI chat panel UI (no edits needed)
.nojekyll           ← Prevents GitHub Pages from breaking the site
README.md           ← This file
```

---

## Step 1 — Fill in firebase-config.js

Open `firebase-config.js` and replace the placeholder values with your real Firebase project config.

Follow the detailed comments inside that file (takes ~5 minutes at console.firebase.google.com).

---

## Step 2 — Add Your Gemini API Key

1. Go to **https://aistudio.google.com**
2. Click **Get API Key** → Create API Key (free, no credit card needed)
3. Open `geminiAgent.js` and replace line 9:
   ```js
   const GEMINI_API_KEY = 'PASTE_YOUR_GEMINI_API_KEY_HERE';
   ```
   with your actual key.

Free tier gives you **500 requests/day** — more than enough for personal study use.

---

## Step 3 — Create the GitHub Repository

1. Go to https://github.com/new
2. Name it anything — e.g. `study-vault`
3. Set it to **Public** (required for free GitHub Pages)
4. Do **NOT** check "Initialize repository" → click **Create repository**

---

## Step 4 — Push All Files

In your project folder, run:

```bash
git init
git add .
git commit -m "StudyVault with AI agent"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/study-vault.git
git push -u origin main
```

---

## Step 5 — Enable GitHub Pages

1. On your repo page → **Settings** → **Pages** (left sidebar)
2. Under **Source** → select **Deploy from a branch**
3. Branch: `main` | Folder: `/ (root)` → **Save**
4. Wait ~1 minute → your site will be live at:
   ```
   https://YOUR-USERNAME.github.io/study-vault/
   ```

---

## Step 6 — Add Your Pages Domain to Firebase

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain** → enter: `your-username.github.io`
3. Save

> ⚠️ Google Sign-In will be blocked until you complete this step.

---

## Step 7 — Check Firestore Rules

Make sure your Firestore rules look like this (the `{document=**}` wildcard covers AI chat history too):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

---

## How the AI Agent Works

1. Upload any file (PDF, DOCX, TXT, MD, JSON)
2. Hover over a file card → click the gold **✦ Ask AI** button
3. The chat panel slides in from the right
4. An auto-summary of your file is generated immediately
5. Type any question about the file — the AI answers using only that file's content
6. Chat history is saved to Firestore and reloads next time you open the same file

**Supported file types for AI:** PDF, DOCX, TXT, MD, JSON

---

## Updating the Site

Whenever you change files, push again:

```bash
git add .
git commit -m "Update"
git push
```

GitHub Pages redeploys automatically within ~1 minute.

---

## Free Tier Limits

| Service | Free Limit |
|---|---|
| Gemini 2.5 Flash API | 500 requests/day |
| Firestore reads | 50,000/day |
| Firestore writes | 20,000/day |
| Cloudinary (PDF storage) | 25 GB bandwidth/month |

All comfortably within limits for personal study use.
