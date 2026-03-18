# StudyVault — GitHub Pages Deployment Guide

## Files in this repo
```
index.html          ← Main app
style.css           ← Styles
script.js           ← App logic
firebase-config.js  ← Your Firebase credentials (fill this in)
.nojekyll           ← Prevents GitHub Pages from breaking the site
```

---

## Step 1 — Fill in firebase-config.js

Open `firebase-config.js` and replace every `PASTE_YOUR_..._HERE` placeholder with your real Firebase values. Follow the detailed comments inside that file for how to get them (takes ~5 minutes on console.firebase.google.com).

---

## Step 2 — Create the GitHub repository

1. Go to https://github.com/new
2. Name it anything — e.g. `studyvault`
3. Set it to **Public** (required for free GitHub Pages)
4. Do **not** check "Initialize repository" — click **Create repository**

---

## Step 3 — Push your files

In your project folder, run:

```bash
git init
git add .
git commit -m "Initial StudyVault deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/studyvault.git
git push -u origin main
```

---

## Step 4 — Enable GitHub Pages

1. On your repo page → **Settings** → **Pages** (left sidebar)
2. Under **Source**, select **Deploy from a branch**
3. Branch: `main` | Folder: `/ (root)` → **Save**
4. Wait ~1 minute → your site will be live at:
   ```
   https://YOUR-USERNAME.github.io/studyvault/
   ```

---

## Step 5 — Add your Pages domain to Firebase

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain** → enter: `your-username.github.io`
3. Save

> ⚠️ Google Sign-In will be blocked until you do this step.

---

## Updating the site

Whenever you change files, just push again:

```bash
git add .
git commit -m "Update"
git push
```

GitHub Pages redeploys automatically within ~1 minute.
