  /* ============================================================
   STUDYVAULT  v3.0  —  Firebase Edition
   ============================================================
   SETUP INSTRUCTIONS
   1. Go to https://console.firebase.google.com
   2. "Add project" → name it → Create
   3. Authentication → Get started → Google → Enable → Save
   4. Firestore Database → Create database → Production mode
      Rules tab → paste:
        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /users/{uid}/{document=**} {
              allow read, write: if request.auth != null
                                 && request.auth.uid == uid;
            }
          }
        }
   5. Project Settings (gear icon) → Your apps → Web (</>)
      → Register app → copy firebaseConfig → paste below.
   6. Project Settings → Authorized domains → add your
      GitHub Pages domain  e.g.  yourname.github.io
   ============================================================
   HOW DATA IS STORED
   • Firestore  users/{uid}/vault/tree
       Full folder tree as JSON (text + DOCX HTML content).
   • Cloudinary (PDF storage)
       Raw PDF binary files uploaded via unsigned preset.
   • localStorage  studyVaultCache
       Local cache — makes the app feel instant on reload.
   ============================================================ */

// ── Firebase config is loaded from firebase-config.js (included before this file in index.html) ──
firebase.initializeApp(firebaseConfig);

// ── CLOUDINARY CONFIG (for PDF uploads) ──────────────────────
const CLOUDINARY_CLOUD_NAME  = 'dkoqaqxub';
const CLOUDINARY_UPLOAD_PRESET = 'studyvault_pdf';
const auth      = firebase.auth();
const firestore = firebase.firestore();
// Note: Firebase Storage is not used — PDFs are uploaded to Cloudinary

// ── FOLDER STRUCTURE ─────────────────────────────────────────

class FolderStructure {
    constructor() { this.root = this._emptyRoot(); }

    _emptyRoot() { return { id:'root', name:'Root', subFolders:[], notes:[] }; }

    _uid() { return `n_${Date.now()}_${Math.random().toString(36).slice(2,9)}`; }

    // Cache
    _cacheKey() {
        // Separate storage per Google user + separate guest storage
        if(typeof currentUser !== 'undefined' && currentUser && currentUser.uid) {
            return 'sv_cache_' + currentUser.uid;
        }
        return 'sv_cache_guest';
    }
    _saveCache() {
        try { localStorage.setItem(this._cacheKey(), JSON.stringify(this.root)); } catch(_) {}
    }
    _loadCache() {
        try { const r = localStorage.getItem(this._cacheKey()); if(r){ this.root=JSON.parse(r); return true; } } catch(_) {}
        return false;
    }

    // Cloud
    async saveToCloud(uid) {
        setSyncState('saving');
        try {
            await firestore.collection('users').doc(uid)
                .collection('vault').doc('tree')
                .set({ tree: JSON.stringify(this.root), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            this._saveCache();
            setSyncState('saved');
        } catch(err) {
            console.error('Cloud save failed:', err);
            setSyncState('error');
            showToast('Cloud sync failed — saved locally only', 'error');
        }
    }
    async loadFromCloud(uid) {
        try {
            const doc = await firestore.collection('users').doc(uid)
                .collection('vault').doc('tree').get();
            if (doc.exists && doc.data().tree) {
                this.root = JSON.parse(doc.data().tree);
                this._saveCache(); return true;
            }
        } catch(err) { console.error('Cloud load failed:', err); }
        return false;
    }

    // Tree ops
    findById(id, node = this.root) {
        if (node.id === id) return node;
        for (const sub of node.subFolders) { const h = this.findById(id,sub); if(h) return h; }
        return null;
    }
    findNoteById(noteId, node = this.root) {
        const h = node.notes.find(n => n.id === noteId);
        if (h) return h;
        for (const sub of node.subFolders) { const f = this.findNoteById(noteId,sub); if(f) return f; }
        return null;
    }
    createFolder(parentId, name) {
        const p = this.findById(parentId); if(!p) return null;
        const f = { id:this._uid(), name, subFolders:[], notes:[] };
        p.subFolders.push(f); return f;
    }
    renameFolder(id, name) {
        if(id==='root') return false;
        const f = this.findById(id); if(!f) return false;
        f.name = name; return true;
    }
    deleteFolder(id, parentId) {
        if(id==='root') return false;
        const p = this.findById(parentId); if(!p) return false;
        p.subFolders = p.subFolders.filter(f => f.id !== id); return true;
    }
    addNote(folderId, name, size, fileKind='binary', mimeType=null, sizeBytes=0) {
        const folder = this.findById(folderId); if(!folder) return null;
        const note = { id:this._uid(), name, size, sizeBytes, fileKind, mimeType,
            content:null, storageRef:null,
            lastAccessed: Date.now(),
            addedDate: new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) };
        folder.notes.push(note); return note;
    }

    // ── STORAGE ──────────────────────────────────────────────
    parseSizeBytes(sizeStr) {
        // Parse formatted string like "1.2 MB" back to bytes
        if(!sizeStr) return 0;
        const m = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
        if(!m) return 0;
        const val=parseFloat(m[1]), unit=m[2].toUpperCase();
        return Math.round(val * ({'B':1,'KB':1024,'MB':1048576,'GB':1073741824}[unit]||1));
    }
    getTotalBytes() {
        return this.getAllNotes().reduce((acc,n)=>{
            return acc + (n.sizeBytes || this.parseSizeBytes(n.size) || 0);
        }, 0);
    }
    getStorageByType() {
        const r={pdf:0,docx:0,text:0,binary:0};
        this.getAllNotes().forEach(n=>{
            const b=n.sizeBytes||this.parseSizeBytes(n.size)||0;
            r[n.fileKind in r ? n.fileKind : 'binary']+=b;
        });
        return r;
    }
    getCloudinaryBytes() {
        return this.getAllNotes().reduce((acc, n) => {
            const b = n.sizeBytes || this.parseSizeBytes(n.size) || 0;
            return acc + (n.fileKind === 'pdf' ? b : 0);
        }, 0);
    }
    getFirestoreBytes() {
        return this.getAllNotes().reduce((acc, n) => {
            const b = n.sizeBytes || this.parseSizeBytes(n.size) || 0;
            return acc + (n.fileKind === 'pdf' ? 0 : b);
        }, 0);
    }
    getNotesSortedBySize() {
        return this.getAllNotes()
            .map(n=>({...n, _bytes: n.sizeBytes||this.parseSizeBytes(n.size)||0}))
            .sort((a,b)=>b._bytes-a._bytes);
    }
    deleteNote(noteId, folderId) {
        const folder = this.findById(folderId); if(!folder) return null;
        const note   = folder.notes.find(n => n.id === noteId);
        folder.notes = folder.notes.filter(n => n.id !== noteId);
        return note;
    }
    getContents(folderId) { const f=this.findById(folderId); return f?{subFolders:f.subFolders,notes:f.notes}:null; }
    getAncestors(id, node=this.root, trail=[]) {
        if(node.id===id) return [...trail,node];
        for(const sub of node.subFolders){ const r=this.getAncestors(id,sub,[...trail,node]); if(r.length) return r; }
        return [];
    }
    getStats(folderId) { const c=this.getContents(folderId); return c?{folders:c.subFolders.length,notes:c.notes.length}:null; }

    // ── Collect all notes across every folder (recursive) ──
    getAllNotes(node=this.root, arr=[]) {
        node.notes.forEach(n => { n._folderId = node.id; arr.push(n); });
        node.subFolders.forEach(s => this.getAllNotes(s, arr));
        return arr;
    }
    getAllFolders(node=this.root, arr=[], parentId=null) {
        node.subFolders.forEach(f => {
            f._parentId = parentId || node.id;
            arr.push(f);
            this.getAllFolders(f, arr, f.id);
        });
        return arr;
    }
    getPinnedFolders()  { return this.getAllFolders().filter(f => f.pinned && !f.archived); }
    getArchivedFolders(){ return this.getAllFolders().filter(f => f.archived); }
    getRecentNotes(limit=10) {
        return this.getAllNotes()
            .filter(n => n.lastAccessed && !n.archived)
            .sort((a,b) => (b.lastAccessed||0)-(a.lastAccessed||0))
            .slice(0, limit);
    }
    getPinnedNotes() { return this.getAllNotes().filter(n => n.pinned && !n.archived); }
    getArchivedNotes() { return this.getAllNotes().filter(n => n.archived); }
    findNoteById(noteId, node=this.root) {
        const found = node.notes.find(n => n.id === noteId);
        if(found) return found;
        for(const sub of node.subFolders) { const r = this.findNoteById(noteId, sub); if(r) return r; }
        return null;
    }
    findNoteParentId(noteId, node=this.root) {
        if(node.notes.find(n=>n.id===noteId)) return node.id;
        for(const sub of node.subFolders){ const r=this.findNoteParentId(noteId,sub); if(r) return r; }
        return null;
    }
    findFolderParentId(folderId, node=this.root) {
        if(node.subFolders.find(f=>f.id===folderId)) return node.id;
        for(const sub of node.subFolders){ const r=this.findFolderParentId(folderId,sub); if(r) return r; }
        return null;
    }
    renameNote(noteId, newName) {
        const note = this.findNoteById(noteId);
        if(!note) return false;
        note.name = newName;
        return true;
    }
    moveNote(noteId, fromFolderId, toFolderId) {
        if(fromFolderId === toFolderId) return false;
        const from = this.findById(fromFolderId);
        const to = this.findById(toFolderId);
        if(!from || !to) return false;
        const note = from.notes.find(n => n.id === noteId);
        if(!note) return false;
        from.notes = from.notes.filter(n => n.id !== noteId);
        to.notes.push(note);
        return true;
    }
    moveFolder(folderId, fromParentId, toParentId) {
        if(folderId === toParentId) return false;
        const from = this.findById(fromParentId);
        const to = this.findById(toParentId);
        if(!from || !to) return false;
        const folder = from.subFolders.find(f => f.id === folderId);
        if(!folder) return false;
        // Prevent moving into own subtree
        if(this.findById(toParentId, folder)) return false;
        from.subFolders = from.subFolders.filter(f => f.id !== folderId);
        to.subFolders.push(folder);
        return true;
    }
    search(query) {
        if(!query || !query.trim()) return { folders: [], notes: [] };
        const q = query.toLowerCase().trim();
        const folders = this.getAllFolders().filter(f => f.name.toLowerCase().includes(q));
        const notes = this.getAllNotes().filter(n => n.name.toLowerCase().includes(q));
        return { folders, notes };
    }
    clearAll() { this.root = this._emptyRoot(); }
}

// ── GLOBALS ───────────────────────────────────────────────────

const db          = new FolderStructure();
let currentUser   = null;
let currentFolderId = 'root';
let currentView   = 'library';  // 'library' | 'recent' | 'pinned' | 'archive' | 'classLibrary'
let selectMode    = false;
let selectedNotes = new Set();
let globalUsage = {
    cloudinaryBytes: 0,
    firestoreBytes: 0,
    available: false,
    source: 'none',
    reason: 'Sign in to view shared quota',
    updatedAt: null
};
let globalUsagePromise = null;
let globalUsageUnsubscribe = null;

// ── HELPERS ───────────────────────────────────────────────────

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtSize(b) {
    if(!b || b < 0) return '0 B';
    const u=['B','KB','MB','GB'];
    const i = Math.min(Math.floor(Math.log(b)/Math.log(1024)), u.length - 1);
    return `${(b/Math.pow(1024,i)).toFixed(1)} ${u[i]}`;
}
function readNoteBytes(note) {
    return (note && (note.sizeBytes || db.parseSizeBytes(note.size))) || 0;
}
function setGlobalUsageUnavailable(reason) {
    globalUsage = {
        cloudinaryBytes: 0,
        firestoreBytes: 0,
        available: false,
        source: 'none',
        reason,
        updatedAt: Date.now()
    };
}
function collectFolderNoteIds(folder, acc=[]) {
    if(!folder) return acc;
    (folder.notes || []).forEach(note => acc.push(note.id));
    (folder.subFolders || []).forEach(sub => collectFolderNoteIds(sub, acc));
    return acc;
}
async function deleteNoteArtifacts(noteId) {
    if(typeof clearNoteCache === 'function') clearNoteCache(noteId);
    if(!currentUser || !currentUser.uid) return;
    try {
        await firestore.collection('users').doc(currentUser.uid)
            .collection('aiChats').doc(noteId).delete();
    } catch(err) {
        console.warn('Could not delete AI chat history:', err);
    }
}
async function deleteFolderArtifacts(folderId) {
    const folder = db.findById(folderId);
    if(!folder) return;
    const noteIds = collectFolderNoteIds(folder);
    for(const noteId of noteIds) {
        await deleteNoteArtifacts(noteId);
    }
}
function stopGlobalUsageLiveListener() {
    if(typeof globalUsageUnsubscribe === 'function') {
        globalUsageUnsubscribe();
        globalUsageUnsubscribe = null;
    }
}
function startGlobalUsageLiveListener() {
    stopGlobalUsageLiveListener();
    if(!currentUser) return;

    try {
        globalUsageUnsubscribe = firestore.collection('appMeta').doc('globalUsage')
            .onSnapshot(doc => {
                if(doc.exists) {
                    const d = doc.data() || {};
                    if(typeof d.cloudinaryBytes === 'number' && typeof d.firestoreBytes === 'number') {
                        globalUsage = {
                            cloudinaryBytes: Math.max(0, d.cloudinaryBytes),
                            firestoreBytes: Math.max(0, d.firestoreBytes),
                            available: true,
                            source: 'shared-doc-live',
                            reason: '',
                            updatedAt: Date.now()
                        };
                        renderAll();
                        return;
                    }
                }
                // If shared doc is missing or malformed, fall back to manual refresh strategy.
                refreshGlobalUsage(true).catch(()=>{});
            },
            err => {
                console.warn('Shared usage live listener failed:', err);
                stopGlobalUsageLiveListener();
                setGlobalUsageUnavailable('Shared quota unavailable due Firestore read rules');
                renderAll();
            });
    } catch(err) {
        console.warn('Could not attach shared usage listener:', err);
        setGlobalUsageUnavailable('Shared quota unavailable due Firestore read rules');
    }
}
async function refreshGlobalUsage(force=false) {
    if(!currentUser) {
        setGlobalUsageUnavailable('Sign in to view shared quota');
        return;
    }
    if(globalUsagePromise && !force) return globalUsagePromise;

    globalUsagePromise = (async () => {
        // Preferred: an explicit shared usage document if your rules allow it.
        try {
            const shared = await firestore.collection('appMeta').doc('globalUsage').get();
            if(shared.exists) {
                const d = shared.data() || {};
                if(typeof d.cloudinaryBytes === 'number' && typeof d.firestoreBytes === 'number') {
                    globalUsage = {
                        cloudinaryBytes: Math.max(0, d.cloudinaryBytes),
                        firestoreBytes: Math.max(0, d.firestoreBytes),
                        available: true,
                        source: 'shared-doc',
                        reason: '',
                        updatedAt: Date.now()
                    };
                    return;
                }
                setGlobalUsageUnavailable('Shared quota document is missing required fields');
                return;
            }
            setGlobalUsageUnavailable('Shared quota document not found');
        } catch(err) {
            console.warn('Shared usage unavailable:', err);
            setGlobalUsageUnavailable('Shared quota unavailable due Firestore read rules');
        }
    })();

    try {
        await globalUsagePromise;
    } finally {
        globalUsagePromise = null;
        renderAll();
    }
}

// ── SYNC INDICATOR ────────────────────────────────────────────

function setSyncState(state) {
    const dot=document.getElementById('syncDot'), lbl=document.getElementById('syncLabel');
    if(!dot||!lbl) return;
    dot.className = `sync-dot sync-dot--${state}`;
    if(!currentUser) { dot.className='sync-dot sync-dot--saved'; lbl.textContent='Local only'; return; }
    lbl.textContent = state==='saving'?'Saving…':state==='error'?'Sync error':'Synced';
}

async function saveAndRender() {
    if(currentUser) await db.saveToCloud(currentUser.uid);
    else db._saveCache(); // guest: local only
    renderAll();
    if(currentUser && !globalUsageUnsubscribe) refreshGlobalUsage(true).catch(()=>{});
}

// ── TOAST ─────────────────────────────────────────────────────

let _tt=null;
function showToast(msg, type='success') {
    const t=document.getElementById('toast');
    document.getElementById('toastIcon').textContent = type==='error'?'✕':type==='info'?'ℹ':'✓';
    document.getElementById('toastMessage').textContent = msg;
    t.className = `toast toast-${type} show`;
    if(_tt) clearTimeout(_tt);
    _tt = setTimeout(()=>t.classList.remove('show'), 3500);
}

// ── MODAL ─────────────────────────────────────────────────────

const modal = {
    ctx:{ parentFolderId:'root', targetFolderId:null, targetNoteId:null, moveItemType:null, moveItemId:null, moveTargetFolderId:null },
    open(id)   { document.getElementById(id)?.classList.add('active'); },
    close(id)  { document.getElementById(id)?.classList.remove('active'); },
    closeAll() { document.querySelectorAll('.modal').forEach(m=>m.classList.remove('active')); }
};
document.addEventListener('mousedown', e => {
    if(e.target.classList.contains('modal') || e.target.classList.contains('modal-backdrop')) modal.closeAll();
});

// ── AUTH ──────────────────────────────────────────────────────

function showApp()     { document.getElementById('appLoading').style.display='none'; document.getElementById('loginScreen').style.display='none'; document.getElementById('appContainer').style.display=''; }
function showLogin()   { document.getElementById('appLoading').style.display='none'; document.getElementById('loginScreen').style.display=''; document.getElementById('appContainer').style.display='none'; }

function setUserBadge(user) {
    const avatar = document.getElementById('userAvatar');
    const guestAv = document.getElementById('guestAvatar');
    const displayName = user ? (user.displayName?.split(' ')[0]||user.email) : 'Guest';
    // Update top bar badge name
    const ubName = document.getElementById('userBadgeName');
    if(ubName) ubName.textContent = displayName;
    // Update sidebar identity
    const sbName = document.getElementById('userName');
    if(sbName) sbName.textContent = user ? (user.displayName||user.email) : 'The Archivist';
    // Update mobile user sheet name if open
    const musNameEl = document.getElementById('musName');
    if(musNameEl) musNameEl.textContent = displayName;
    if(user && user.photoURL) {
        if(avatar) {
            avatar.src = user.photoURL;
            avatar.style.display = 'block';
        }
        if(guestAv) guestAv.style.display = 'none';
    } else {
        if(avatar) {
            avatar.style.display = 'none';
            avatar.src = '';
        }
        if(guestAv) guestAv.style.display = 'flex';
    }
}

auth.onAuthStateChanged(async user => {
    if (user) {
        currentUser = user;
        startGlobalUsageLiveListener();
        setUserBadge(user);
        if (db._loadCache()) renderAll();
        showApp();
        setSyncState('saving');
        try {
            await db.loadFromCloud(user.uid);
            await migrateFromLocalStorage(user.uid);
            setSyncState('saved');
        } catch(err) {
            console.error('Cloud sync failed:', err);
            setSyncState('error');
            showToast('Cloud sync failed — showing local data', 'info');
        }
        renderAll();
        refreshGlobalUsage(true).catch(()=>{});
        // Show ClassLibrary nav for signed-in users
        if(typeof toggleClassLibraryNav === 'function') toggleClassLibraryNav(true);
    } else {
        stopGlobalUsageLiveListener();
        // Check if user chose guest mode
        if(localStorage.getItem('studyVaultGuest') === 'true') {
            currentUser = null;
            setGlobalUsageUnavailable('Guest mode has no shared cloud quota view');
            setUserBadge(null);
            db._loadCache();
            showApp();
            setSyncState('saved');
            renderAll();
        } else {
            currentUser = null;
            setGlobalUsageUnavailable('Sign in to view shared quota');
            showLogin();
            if(typeof toggleClassLibraryNav === 'function') toggleClassLibraryNav(false);
        }
    }
});

async function migrateFromLocalStorage(uid) {
    try {
        const raw = localStorage.getItem('studyVaultData');
        if (!raw) return;
        const legacy = JSON.parse(raw);
        const hasCloud  = db.root.subFolders.length>0 || db.root.notes.length>0;
        const hasLegacy = legacy.subFolders?.length>0 || legacy.notes?.length>0;
        if (!hasCloud && hasLegacy) {
            db.root = legacy;
            await db.saveToCloud(uid);
            localStorage.removeItem('studyVaultData');
            showToast('Existing files migrated to the cloud ✓', 'info');
            renderAll();
        }
    } catch(_) {}
}

// ── TOOLBAR STATS ─────────────────────────────────────────────

function updateToolbarInfo() {
    const s=db.getStats(currentFolderId), el=document.getElementById('toolbarInfoText');
    if(!el||!s) return;
    const p=[];
    if(s.folders) p.push(`${s.folders} folder${s.folders!==1?'s':''}`);
    if(s.notes)   p.push(`${s.notes} file${s.notes!==1?'s':''}`);
    el.textContent = p.length?p.join(', '):'Empty folder';
}

// ── BREADCRUMB ────────────────────────────────────────────────

function renderBreadcrumb() {
    const nav=document.getElementById('breadcrumb'), ancestors=db.getAncestors(currentFolderId);
    nav.innerHTML='';
    ancestors.forEach((folder,idx) => {
        const isLast=idx===ancestors.length-1;
        const a=document.createElement('a'); a.href='#';
        a.className='crumb'+(folder.id==='root'?' crumb-root':'')+(isLast?' crumb-current':'');
        a.dataset.folderId=folder.id;
        a.innerHTML = folder.id==='root'
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Root`
            : esc(folder.name);
        if(!isLast) a.addEventListener('click', e=>{ e.preventDefault(); currentFolderId=folder.id; renderAll(); });
        nav.appendChild(a);
        if(!isLast){ const sep=document.createElement('span'); sep.className='crumb-sep'; sep.textContent='›'; nav.appendChild(sep); }
    });

    // Mobile: show back button + current folder name in top bar logo area
    const mobileBack = document.getElementById('mobileBackBtn');
    const mobileFolderName = document.getElementById('mobileFolderName');
    if(mobileBack && mobileFolderName) {
        if(currentFolderId !== 'root') {
            const cur = db.findById(currentFolderId);
            mobileBack.style.display = 'flex';
            mobileFolderName.textContent = cur ? cur.name : '';
            mobileFolderName.style.display = 'block';
            document.getElementById('topBarLogo').style.display = 'none';
        } else {
            mobileBack.style.display = 'none';
            mobileFolderName.style.display = 'none';
            document.getElementById('topBarLogo').style.display = '';
        }
    }
}

// ── FILE KIND META ────────────────────────────────────────────

const FILE_KIND_META = {
    text:   { badge:'TXT',  badgeClass:'badge-text',   icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`, hint:'Click to view', hintClass:'note-hint' },
    pdf:    { badge:'PDF',  badgeClass:'badge-pdf',    icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1a2 2 0 000-4H9v8m5-8v4m0-4h2m-2 4h2"/></svg>`, hint:'Click to view', hintClass:'note-hint note-hint--pdf' },
    docx:   { badge:'DOCX', badgeClass:'badge-docx',   icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`, hint:'Click to view', hintClass:'note-hint note-hint--docx' },
    binary: { badge:'FILE', badgeClass:'badge-binary',  icon:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`, hint:'Binary file', hintClass:'note-hint note-hint--muted' }
};
function getFileMeta(note){ return FILE_KIND_META[note.fileKind]||FILE_KIND_META.binary; }

// ── FOLDER GRID ───────────────────────────────────────────────

function buildFolderCardHtml(folder, showLocation=false) {
    const info = `${folder.subFolders.length} folder${folder.subFolders.length!==1?'s':''} · ${folder.notes.length} file${folder.notes.length!==1?'s':''}`;
    const pinnedCls  = folder.pinned   ? 'folder-pin-btn--active'    : '';
    const archivedCls= folder.archived ? 'folder-archive-btn--active' : '';
    const pinnedTitle   = folder.pinned   ? 'Unpin'      : 'Pin folder';
    const archiveTitle  = folder.archived ? 'Unarchive'  : 'Archive folder';
    const locationBadge = showLocation && folder._parentId
        ? `<span class="note-location">${esc(db.findById(folder._parentId)?.name || 'Root')}</span>` : '';
    return `<div class="folder-card" data-folder-id="${folder.id}" role="button" tabindex="0">
        <div class="folder-card-top">
            <div class="folder-icon-wrap"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div>
            <div class="folder-card-badges">
                ${folder.pinned   ? '<span class="folder-status-badge folder-status-badge--pin">Pinned</span>'    : ''}
                ${folder.archived ? '<span class="folder-status-badge folder-status-badge--archive">Archived</span>' : ''}
            </div>
        </div>
        <div class="folder-name">${esc(folder.name)}${locationBadge}</div>
        <div class="folder-meta">${info}</div>
        <div class="folder-actions">
            <button class="folder-btn rename-btn" data-folder-id="${folder.id}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Rename
            </button>
            <button class="folder-btn folder-pin-btn ${pinnedCls}" data-folder-id="${folder.id}" title="${pinnedTitle}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="${folder.pinned?'currentColor':'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                ${folder.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button class="folder-btn folder-archive-btn ${archivedCls}" data-folder-id="${folder.id}" title="${archiveTitle}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                ${folder.archived ? 'Restore' : 'Archive'}
            </button>
            <button class="folder-btn delete delete-btn" data-folder-id="${folder.id}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                Delete
            </button>
        </div>
    </div>`;
}

function buildNoteCardHtml(note, showLocation=false) {
    const meta=getFileMeta(note), canView=note.content||note.storageRef;
    const clickCls=selectMode?'note-card-selectable':(canView?'note-card-clickable':'');
    const selCls=selectedNotes.has(note.id)?'note-card-selected':'';
    const pinnedIcon=note.pinned?`<button class="note-pin-btn note-pin-btn--active" data-note-id="${note.id}" title="Unpin"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>`:`<button class="note-pin-btn" data-note-id="${note.id}" title="Pin"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>`;
    const archiveIcon=note.archived?`<button class="note-archive-btn note-archive-btn--active" data-note-id="${note.id}" title="Unarchive"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><polyline points="9 11 12 14 15 11"/></svg></button>`:`<button class="note-archive-btn" data-note-id="${note.id}" title="Archive"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></button>`;
    const locationBadge=showLocation&&note._folderId?`<span class="note-location">${db.findById(note._folderId)?.name||'Root'}</span>`:'';
    return `<div class="note-card ${clickCls} ${selCls}" data-note-id="${note.id}">
        <label class="note-checkbox"><input type="checkbox" class="note-check" data-note-id="${note.id}" ${selectedNotes.has(note.id)?'checked':''}><span class="note-check-ui"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></span></label>
        <div class="note-icon-wrap note-icon-${note.fileKind||'binary'}">${meta.icon}</div>
        <div class="note-info">
            <div class="note-name-row"><span class="note-badge ${meta.badgeClass}">${meta.badge}</span><span class="note-name" title="${esc(note.name)}">${esc(note.name)}</span>${locationBadge}</div>
            <div class="note-size">${note.size} · ${note.addedDate}</div>
            <div class="${meta.hintClass}">${selectMode?'Click to select':meta.hint}</div>
        </div>
        <div class="note-card-actions">
            ${pinnedIcon}${archiveIcon}
            <button class="note-delete-btn" data-note-id="${note.id}" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
        </div>
    </div>`;
}

function renderFolderGrid() {
    const grid=document.getElementById('folderGrid');

    // ── Special views ──────────────────────────────────────
    if(currentView==='search') {
        const q = document.getElementById('searchInput')?.value || '';
        const results = db.search(q);
        updateViewHeader('Search Results', `${results.folders.length + results.notes.length} results for "${q}"`);
        if(!results.folders.length && !results.notes.length) {
            grid.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><p class="empty-title">No results found</p><p class="empty-sub">Try a different search term.</p></div>`;
            return;
        }
        grid.innerHTML = results.folders.map(f => buildFolderCardHtml(f, true)).join('') + results.notes.map(n => buildNoteCardHtml(n, true)).join('');
        attachGridListeners(); return;
    }
    if(currentView==='recent') {
        const notes=db.getRecentNotes(10);
        updateViewHeader('Recent Files','Files you accessed lately');
        if(!notes.length){ grid.innerHTML=`<div class="empty-state"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><p class="empty-title">No recent files</p><p class="empty-sub">Files you open will appear here.</p></div>`; return; }
        grid.innerHTML = notes.map(n=>buildNoteCardHtml(n,true)).join('');
        attachGridListeners(); return;
    }
    if(currentView==='pinned') {
        const notes   = db.getPinnedNotes();
        const folders = db.getPinnedFolders();
        updateViewHeader('Pinned','Your bookmarked items');
        if(!notes.length && !folders.length){ grid.innerHTML=`<div class="empty-state"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div><p class="empty-title">No pinned items</p><p class="empty-sub">Pin folders or files using the bookmark icon.</p></div>`; return; }
        grid.innerHTML = folders.map(f=>buildFolderCardHtml(f,true)).join('') + notes.map(n=>buildNoteCardHtml(n,true)).join('');
        attachGridListeners(); return;
    }
    if(currentView==='archive') {
        const notes   = db.getArchivedNotes();
        const folders = db.getArchivedFolders();
        updateViewHeader('Archive','Items hidden from your main library');
        if(!notes.length && !folders.length){ grid.innerHTML=`<div class="empty-state"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></div><p class="empty-title">Archive is empty</p><p class="empty-sub">Archive folders or files to hide them from the main library.</p></div>`; return; }
        grid.innerHTML = folders.map(f=>buildFolderCardHtml(f,true)).join('') + notes.map(n=>buildNoteCardHtml(n,true)).join('');
        attachGridListeners(); return;
    }

    if(currentView==='storage') {
        updateViewHeader('Storage','Your vault storage breakdown');
        renderStorageView();
        return;
    }

    if(currentView==='classLibrary') {
        updateViewHeader('Class Library','Shared files from your classmates');
        if(typeof renderClassLibraryView === 'function') renderClassLibraryView();
        else grid.innerHTML = `<div class="empty-state"><p class="empty-title">Class Library loading…</p></div>`;
        return;
    }

    // ── Library view (default) ─────────────────────────────
    updateViewHeader('Academic Collection','');
    const contents=db.getContents(currentFolderId);
    if(!contents){ grid.innerHTML=`<div class="empty-state"><p class="empty-title">Folder not found</p></div>`; return; }
    let html='';

    contents.subFolders.filter(f => !f.archived).forEach(folder => {
        html += buildFolderCardHtml(folder);
    });

    // Hide archived notes in library view
    contents.notes.filter(n=>!n.archived).forEach(note => { html+=buildNoteCardHtml(note); });

    if(!html) html=`<div class="empty-state"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div><p class="empty-title">This folder is empty</p><p class="empty-sub">Upload notes or create a subfolder.</p></div>`;
    grid.innerHTML = html;
    attachGridListeners();
}

// ── GRID LISTENERS ────────────────────────────────────────────

function attachGridListeners() {
    document.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', e => { if(e.target.closest('.folder-actions')) return; currentFolderId=card.dataset.folderId; setView('library'); });
        card.addEventListener('keydown', e => { if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.folder-actions')){ e.preventDefault(); currentFolderId=card.dataset.folderId; setView('library'); } });
    });

    // ── FOLDER PIN ────────────────────────────────────────
    document.querySelectorAll('.folder-pin-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const folder = db.findById(btn.dataset.folderId); if(!folder) return;
            folder.pinned = !folder.pinned;
            showToast(folder.pinned ? `"${folder.name}" pinned` : `"${folder.name}" unpinned`, 'info');
            saveAndRender();
        });
    });

    // ── FOLDER ARCHIVE ────────────────────────────────────
    document.querySelectorAll('.folder-archive-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const folder = db.findById(btn.dataset.folderId); if(!folder) return;
            folder.archived = !folder.archived;
            if(folder.archived && folder.pinned) folder.pinned = false;
            showToast(folder.archived ? `"${folder.name}" archived` : `"${folder.name}" restored`, 'info');
            saveAndRender();
        });
    });

    document.querySelectorAll('.rename-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const f=db.findById(btn.dataset.folderId); if(!f) return;
            document.getElementById('renameInput').value=f.name;
            modal.ctx.targetFolderId=btn.dataset.folderId;
            modal.open('renameFolderModal');
            setTimeout(()=>document.getElementById('renameInput').focus(),80);
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const f=db.findById(btn.dataset.folderId); if(!f) return;
            if(confirm(`Delete "${f.name}" and all its contents?\nThis cannot be undone.`)){
                await deleteFolderArtifacts(btn.dataset.folderId);
                const actualParentId = db.findFolderParentId(btn.dataset.folderId) || currentFolderId;
                db.deleteFolder(btn.dataset.folderId, actualParentId);
                showToast(`"${f.name}" deleted`); saveAndRender(); }
        });
    });

    document.querySelectorAll('.note-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const note=db.findNoteById(btn.dataset.noteId); if(!note) return;
            if(!confirm(`Delete "${note.name}"?\nThis cannot be undone.`)) return;
            const folderId = db.findNoteParentId(note.id);
            if(!folderId) return;
            db.deleteNote(note.id, folderId);
            await deleteNoteArtifacts(note.id);
            // Note: Cloudinary files remain in cloud (no delete API on free plan from browser)
            showToast(`"${note.name}" deleted`);
            selectedNotes.delete(note.id);
            saveAndRender(); updateBulkBar();
        });
    });

    document.querySelectorAll('.note-check').forEach(chk => {
        chk.addEventListener('change', ()=>{
            const id=chk.dataset.noteId;
            if(chk.checked) selectedNotes.add(id); else selectedNotes.delete(id);
            chk.closest('.note-card')?.classList.toggle('note-card-selected',chk.checked);
            updateBulkBar();
        });
    });

    document.querySelectorAll('.note-card-selectable').forEach(card => {
        card.addEventListener('click', e => {
            if(e.target.closest('.note-checkbox')||e.target.closest('.note-delete-btn')) return;
            const chk=card.querySelector('.note-check'); if(!chk) return;
            chk.checked=!chk.checked; chk.dispatchEvent(new Event('change'));
        });
    });

    document.querySelectorAll('.note-card-clickable').forEach(card => {
        card.addEventListener('click', e => {
            if(e.target.closest('.note-delete-btn')||e.target.closest('.note-pin-btn')||e.target.closest('.note-archive-btn')) return;
            const note=db.findNoteById(card.dataset.noteId); if(note) viewFile(note);
        });
    });

    // ── PIN ────────────────────────────────────────────────
    document.querySelectorAll('.note-pin-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const note=db.findNoteById(btn.dataset.noteId); if(!note) return;
            note.pinned = !note.pinned;
            showToast(note.pinned ? `"${note.name}" pinned` : `"${note.name}" unpinned`, 'info');
            saveAndRender();
        });
    });

    // ── ARCHIVE ────────────────────────────────────────────
    document.querySelectorAll('.note-archive-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const note=db.findNoteById(btn.dataset.noteId); if(!note) return;
            note.archived = !note.archived;
            if(note.archived && note.pinned) note.pinned = false;
            showToast(note.archived ? `"${note.name}" archived` : `"${note.name}" restored to library`, 'info');
            saveAndRender();
        });
    });
}

// ── RENDER ALL ────────────────────────────────────────────────


// ── STORAGE VIEW ──────────────────────────────────────────────
const CLOUDINARY_LIMIT = 25 * 1024 * 1024 * 1024; // 25 GB free
const FIRESTORE_LIMIT  =  1 * 1024 * 1024 * 1024; // 1 GB free

function renderStorageView() {
    const grid = document.getElementById('folderGrid');
    const totalBytes = db.getTotalBytes();
    const cloudinaryBytes = db.getCloudinaryBytes();
    const firestoreBytes = db.getFirestoreBytes();
    const sharedCloudinaryBytes = globalUsage.available ? globalUsage.cloudinaryBytes : null;
    const sharedFirestoreBytes = globalUsage.available ? globalUsage.firestoreBytes : null;
    const byType = db.getStorageByType();
    const allNotes = db.getNotesSortedBySize();
    const cloudinaryPct = Math.min((cloudinaryBytes / CLOUDINARY_LIMIT) * 100, 100);
    const firestorePct = Math.min((firestoreBytes / FIRESTORE_LIMIT) * 100, 100);
    const cloudinaryPctStr = cloudinaryPct < 0.01 ? '<0.01' : cloudinaryPct.toFixed(2);
    const firestorePctStr = firestorePct < 0.01 ? '<0.01' : firestorePct.toFixed(2);
    const sharedCloudinaryPct = globalUsage.available ? Math.min((sharedCloudinaryBytes / CLOUDINARY_LIMIT) * 100, 100) : 0;
    const sharedFirestorePct = globalUsage.available ? Math.min((sharedFirestoreBytes / FIRESTORE_LIMIT) * 100, 100) : 0;
    const sharedCloudinaryLeft = globalUsage.available ? Math.max(0, CLOUDINARY_LIMIT - sharedCloudinaryBytes) : null;
    const sharedFirestoreLeft = globalUsage.available ? Math.max(0, FIRESTORE_LIMIT - sharedFirestoreBytes) : null;
    const sharedCloudinaryPctStr = sharedCloudinaryPct < 0.01 ? '<0.01' : sharedCloudinaryPct.toFixed(2);
    const sharedFirestorePctStr = sharedFirestorePct < 0.01 ? '<0.01' : sharedFirestorePct.toFixed(2);

    // Type breakdown rows
    const typeData = [
        { key:'pdf',    label:'PDF Files',   color:'var(--pdf)',  icon:'📄' },
        { key:'docx',   label:'Word Docs',   color:'var(--docx)', icon:'📝' },
        { key:'text',   label:'Text Files',  color:'var(--txt)',  icon:'💻' },
        { key:'binary', label:'Other Files', color:'var(--bin)',  icon:'📦' },
    ];
    const typeRows = typeData.map(t => {
        const b = byType[t.key] || 0;
        const p = totalBytes > 0 ? Math.min((b/totalBytes)*100,100) : 0;
        return `<div class="sv-type-row">
            <div class="sv-type-label">
                <span class="sv-type-dot" style="background:${t.color}"></span>
                <span>${t.label}</span>
            </div>
            <div class="sv-type-bar-track"><div class="sv-type-bar-fill" style="width:${p.toFixed(1)}%;background:${t.color}"></div></div>
            <span class="sv-type-size">${fmtSize(b)}</span>
        </div>`;
    }).join('');

    // Top files list
    const topFiles = allNotes.slice(0, 12);
    const fileRows = topFiles.length ? topFiles.map(n => {
        const pf = totalBytes>0 ? Math.min((n._bytes/totalBytes)*100,100) : 0;
        const meta = getFileMeta(n);
        return `<div class="sv-file-row" data-note-id="${n.id}">
            <div class="sv-file-icon note-icon-wrap note-icon-${n.fileKind||'binary'}">${meta.icon}</div>
            <div class="sv-file-info">
                <p class="sv-file-name">${esc(n.name)}</p>
                <div class="sv-file-bar-track"><div class="sv-file-bar-fill" style="width:${pf.toFixed(1)}%;background:${meta.barColor||'var(--gold)'}"></div></div>
            </div>
            <span class="sv-file-size">${fmtSize(n._bytes)}</span>
            <button class="sv-file-delete" data-note-id="${n.id}" title="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
        </div>`;
    }).join('') : `<p class="sv-empty-files">No files uploaded yet.</p>`;

    // Status badge
    let statusClass = 'sv-status--safe', statusText = 'Plenty of space available';
    const maxPct = Math.max(cloudinaryPct, firestorePct);
    if(maxPct > 80) { statusClass='sv-status--warn'; statusText='Storage getting full'; }
    if(maxPct > 95) { statusClass='sv-status--danger'; statusText='Almost full — consider deleting files'; }

    grid.innerHTML = `
    <div class="storage-view">

        <!-- Hero card: total usage -->
        <div class="sv-hero-card">
            <div class="sv-hero-left">
                <p class="sv-hero-label">CLOUD STORAGE OVERVIEW</p>
                <p class="sv-hero-value">${fmtSize(totalBytes)}</p>
                <p class="sv-hero-sub">Cloudinary: ${fmtSize(cloudinaryBytes)} / ${fmtSize(CLOUDINARY_LIMIT)} (${cloudinaryPctStr}%)</p>
                <p class="sv-hero-sub">Firebase: ${fmtSize(firestoreBytes)} / ${fmtSize(FIRESTORE_LIMIT)} (${firestorePctStr}%)</p>
                ${globalUsage.available
                    ? `<p class="sv-hero-sub">Shared left: Cloudinary ${fmtSize(sharedCloudinaryLeft)} · Firebase ${fmtSize(sharedFirestoreLeft)}</p>`
                    : `<p class="sv-hero-sub">Shared quota: unavailable (${esc(globalUsage.reason || 'missing permissions')})</p>`
                }
                <span class="sv-status ${statusClass}">${statusText}</span>
            </div>
            <div class="sv-hero-right">
                <div class="sv-donut-wrap">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="48" fill="none" stroke="var(--surface-hi)" stroke-width="14"/>
                        <circle cx="60" cy="60" r="48" fill="none" stroke="url(#sg)" stroke-width="14"
                            stroke-dasharray="${(cloudinaryPct/100*301.6).toFixed(1)} 301.6"
                            stroke-dashoffset="75.4" stroke-linecap="round"/>
                        <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="var(--gold)"/>
                            <stop offset="100%" stop-color="var(--gold-mid)"/>
                        </linearGradient></defs>
                    </svg>
                    <div class="sv-donut-center">
                        <span class="sv-donut-pct">${cloudinaryPctStr}%</span>
                        <span class="sv-donut-label">Cloudinary</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Two column layout -->
        <div class="sv-cols">

            <!-- Left: breakdown + perks -->
            <div class="sv-col">

                <!-- Type breakdown -->
                <div class="sv-card">
                    <h3 class="sv-card-title">By File Type</h3>
                    <div class="sv-type-list">${typeRows}</div>
                </div>

                <!-- Storage perks / limits info -->
                <div class="sv-card sv-card--perks">
                    <h3 class="sv-card-title">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        Free Tier Limits
                    </h3>
                    <div class="sv-perks-list">
                        <div class="sv-perk">
                            <div class="sv-perk-icon sv-perk-icon--pdf">☁️</div>
                            <div class="sv-perk-info">
                                <p class="sv-perk-name">Cloudinary (PDF Storage)</p>
                                <p class="sv-perk-val">${fmtSize(cloudinaryBytes)} used of ${fmtSize(CLOUDINARY_LIMIT)} · 25 GB bandwidth/month</p>
                                ${globalUsage.available ? `<p class="sv-perk-val">Shared project: ${fmtSize(sharedCloudinaryBytes)} used (${sharedCloudinaryPctStr}%)</p>` : ''}
                            </div>
                            <span class="sv-perk-badge sv-perk-badge--free">FREE</span>
                        </div>
                        <div class="sv-perk">
                            <div class="sv-perk-icon sv-perk-icon--db">🔥</div>
                            <div class="sv-perk-info">
                                <p class="sv-perk-name">Firestore (Notes &amp; Data)</p>
                                <p class="sv-perk-val">${fmtSize(firestoreBytes)} used of ${fmtSize(FIRESTORE_LIMIT)} · 50K reads/day · 20K writes/day</p>
                                ${globalUsage.available ? `<p class="sv-perk-val">Shared project: ${fmtSize(sharedFirestoreBytes)} used (${sharedFirestorePctStr}%)</p>` : ''}
                            </div>
                            <span class="sv-perk-badge sv-perk-badge--free">FREE</span>
                        </div>
                        <div class="sv-perk">
                            <div class="sv-perk-icon sv-perk-icon--auth">🔐</div>
                            <div class="sv-perk-info">
                                <p class="sv-perk-name">Firebase Auth</p>
                                <p class="sv-perk-val">Unlimited users · Google Sign-In included</p>
                            </div>
                            <span class="sv-perk-badge sv-perk-badge--free">FREE</span>
                        </div>
                        <div class="sv-perk sv-perk--highlight">
                            <div class="sv-perk-icon sv-perk-icon--total">⭐</div>
                            <div class="sv-perk-info">
                                <p class="sv-perk-name">Your Vault Total</p>
                                <p class="sv-perk-val">${allNotes.length} file${allNotes.length!==1?'s':''} · ${fmtSize(totalBytes)} total across cloud providers</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right: top files by size -->
            <div class="sv-col">
                <div class="sv-card sv-card--files">
                    <div class="sv-card-header">
                        <h3 class="sv-card-title">Largest Files</h3>
                        <span class="sv-card-sub">${allNotes.length} total file${allNotes.length!==1?'s':''}</span>
                    </div>
                    <div class="sv-file-list" id="svFileList">${fileRows}</div>
                </div>
            </div>
        </div>
    </div>`;

    // Wire delete buttons
    grid.querySelectorAll('.sv-file-delete').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const noteId = btn.dataset.noteId;
            const note = db.findNoteById(noteId);
            if(!note) return;
            if(!confirm(`Delete "${note.name}"? This cannot be undone.`)) return;
            const folderId = db.findNoteParentId(noteId);
            if(folderId) {
                db.deleteNote(noteId, folderId);
                await deleteNoteArtifacts(noteId);
                saveAndRender();
            }
        });
    });
}

// ── SIDEBAR STORAGE WIDGET UPDATE ─────────────────────────────
function updateSidebarStorage() {
    const bar  = document.getElementById('sbStorageBarFill');
    const info = document.getElementById('sbStorageInfo');
    if(!bar || !info) return;
    const cloudinaryBytes = db.getCloudinaryBytes();
    const firestoreBytes = db.getFirestoreBytes();
    const cloudinaryPct = Math.min((cloudinaryBytes / CLOUDINARY_LIMIT) * 100, 100);
    const firestorePct = Math.min((firestoreBytes / FIRESTORE_LIMIT) * 100, 100);
    const pct = Math.max(cloudinaryPct, firestorePct);
    bar.style.width = pct.toFixed(2) + '%';
    // Colour: green → amber → red
    if(pct > 80) bar.style.background = 'var(--red)';
    else if(pct > 50) bar.style.background = 'linear-gradient(90deg,var(--gold),var(--gold-mid))';
    else bar.style.background = 'var(--gold-grad)';
    const mine = `You C ${fmtSize(cloudinaryBytes)} · F ${fmtSize(firestoreBytes)}`;
    if(globalUsage.available) {
        info.textContent = `${mine} · All C ${fmtSize(globalUsage.cloudinaryBytes)} · F ${fmtSize(globalUsage.firestoreBytes)}`;
    } else {
        info.textContent = mine;
    }
}


function updateViewHeader(title, sub) {
    const el = document.querySelector('.content-title');
    if(el) el.textContent = title;
    // Show subtitle in toolbar info when in special views
    if(sub) {
        const infoEl = document.getElementById('toolbarInfoText');
        if(infoEl) infoEl.textContent = sub;
    }
}

function setView(view) {
    currentView = view;
    if(view === 'storage') refreshGlobalUsage().catch(()=>{});
    // Update sidebar active state
    document.querySelectorAll('.sb-nav-item').forEach(a => {
        a.classList.remove('sb-nav-item--active');
        const v = a.dataset.view || 'library';
        if(v === view) a.classList.add('sb-nav-item--active');
    });
    // Update bottom nav active state (mobile)
    document.querySelectorAll('.bn-item').forEach(btn => {
        const btnView = btn.dataset.view;
        const isSettingsBtn = btn.id === 'mobileSettingsBtn';
        if(isSettingsBtn) {
            btn.classList.toggle('bn-active', view === 'archive' || view === 'storage' || view === 'recent' || view === 'pinned');
        } else {
            btn.classList.toggle('bn-active', btnView === view);
        }
    });
    // Show/hide toolbar actions (only relevant in library)
    const toolbarActions = document.querySelector('.content-toolbar');
    if(toolbarActions) toolbarActions.style.display = (view==='library') ? '' : 'none';
    // Update page title for mobile
    const title = document.querySelector('.content-title');
    if(title) {
        const titles = {library:'Academic Collection', recent:'Recent', pinned:'Pinned', archive:'Archive', storage:'Storage', classLibrary:'Class Library'};
        title.textContent = titles[view] || 'Academic Collection';
    }
    exitSelectMode();
    renderAll();
}

function renderAll(){ renderFolderGrid(); if(currentView==='library') renderBreadcrumb(); if(currentView!=='classLibrary') updateToolbarInfo(); updateBulkBar(); updateSidebarStorage(); }

// ── SELECT MODE ───────────────────────────────────────────────

function enterSelectMode(){ selectMode=true; selectedNotes.clear(); document.getElementById('selectModeBtn').classList.add('btn--active'); document.getElementById('bulkBar').classList.add('bulk-bar--visible'); document.getElementById('toolbarInfo').style.display='none'; renderFolderGrid(); updateBulkBar(); }
function exitSelectMode(){ selectMode=false; selectedNotes.clear(); document.getElementById('selectModeBtn').classList.remove('btn--active'); document.getElementById('bulkBar').classList.remove('bulk-bar--visible'); document.getElementById('toolbarInfo').style.display=''; renderFolderGrid(); }
function updateBulkBar(){ const n=selectedNotes.size, el=document.getElementById('bulkCount'), btn=document.getElementById('bulkDeleteBtn'); if(!el||!btn) return; el.textContent=n===0?'None selected':`${n} file${n!==1?'s':''} selected`; btn.disabled=n===0; }

// ── FILE VIEWER ───────────────────────────────────────────────

const ALL_PANELS=['panelText','panelMarkdown','panelPdf','panelDocx','panelLoading','panelUnsupported'];
function showPanel(id){ ALL_PANELS.forEach(p=>document.getElementById(p).style.display='none'); document.getElementById(id).style.display='flex'; }

async function viewFile(note) {
    const meta=getFileMeta(note);
    const badge=document.getElementById('fileViewBadge');
    badge.textContent=meta.badge; badge.className=`file-type-badge ${meta.badgeClass}`;
    document.getElementById('fileViewTitle').textContent=note.name;
    document.getElementById('downloadFileBtn').dataset.noteId=note.id;
    // Track last accessed for Recent view
    note.lastAccessed = Date.now();
    if(currentUser) db.saveToCloud(currentUser.uid).catch(()=>{});
    else db._saveCache();
    modal.open('viewFileModal');

    switch(note.fileKind) {
        case 'text': {
            const isMarkdown = /\.(md|markdown)$/i.test(note.name);
            if(isMarkdown && typeof marked !== 'undefined') {
                showPanel('panelMarkdown');
                const rawMd = note.content || '';
                const html = marked.parse(rawMd);
                document.getElementById('markdownContent').innerHTML =
                    typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
            } else {
                showPanel('panelText');
                document.getElementById('fileContent').textContent=note.content||'';
            }
            break;
        }
        case 'docx':
            showPanel('panelDocx');
            // Sanitize HTML to prevent XSS from malicious DOCX files
            const rawHtml = note.content||'<p style="color:var(--text-3)">No content.</p>';
            if(typeof DOMPurify !== 'undefined') {
                document.getElementById('docxContent').innerHTML = DOMPurify.sanitize(rawHtml);
            } else {
                document.getElementById('docxContent').innerHTML = rawHtml;
            }
            break;
        case 'pdf':
            showPanel('panelLoading');
            try {
                const url = note.storageRef;
                if(!url) throw new Error('No URL');
                const frame = document.getElementById('pdfFrame');
                frame.src = url;
                showPanel('panelPdf');
                // Fallback: if iframe doesn't load within 8 seconds, show download option
                const pdfTimeout = setTimeout(() => {
                    // Check if the iframe body is empty (CORS blocked)
                    try {
                        const iframeDoc = frame.contentDocument || frame.contentWindow?.document;
                        if(!iframeDoc || !iframeDoc.body || !iframeDoc.body.innerHTML) {
                            showPanel('panelUnsupported');
                            document.getElementById('unsupportedMsg').textContent = 'PDF preview blocked — click Download to open';
                        }
                    } catch(_) {
                        // Cross-origin — iframe loaded something, so it's probably fine
                    }
                }, 8000);
                frame.addEventListener('load', () => clearTimeout(pdfTimeout), { once: true });
            } catch(err) {
                console.error('PDF load error:',err);
                document.getElementById('unsupportedMsg').textContent='Could not load PDF.';
                showPanel('panelUnsupported');
            }
            break;
        default:
            document.getElementById('unsupportedMsg').textContent=`"${note.name}" is a binary file — download it to open locally.`;
            showPanel('panelUnsupported');
    }
}

async function downloadFile(note) {
    if(!note){ showToast('File not found','error'); return; }
    try {
        if(note.storageRef) {
            try {
                // Fetch as blob to bypass cross-origin header issues and guarantee exact MIME type/bytes
                const res = await fetch(note.storageRef);
                const blob = await res.blob();
                // Ensure Word correctly identifies the file by applying the original mimeType
                const typedBlob = new Blob([blob], { type: note.mimeType || 'application/octet-stream' });
                const url = URL.createObjectURL(typedBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = note.name;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (err) {
                // Fallback to direct navigation if fetch fails (e.g. CORS not configured properly)
                const a = document.createElement('a');
                a.href = note.storageRef;
                a.download = note.name;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }
        } else if(note.content) {
            let downloadName = note.name;
            let mimeType = note.mimeType || 'text/plain';
            if (note.fileKind === 'docx') {
                downloadName = downloadName.replace(/\.docx$/i, '.html');
                mimeType = 'text/html';
            }
            const blob=new Blob([note.content],{type:mimeType});
            const url=URL.createObjectURL(blob);
            const a=Object.assign(document.createElement('a'),{href:url,download:downloadName});
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else { showToast('No content to download','error'); return; }
        showToast(`Downloading ${note.name}`,'info');
    } catch(err){ console.error('Download error:',err); showToast('Download failed','error'); }
}

// ── UPLOADER ──────────────────────────────────────────────────

const uploader = {
    files: [],

    init() {
        const zone=document.getElementById('dropZone'), input=document.getElementById('fileInput');
        zone.addEventListener('click',()=>input.click());
        ['dragenter','dragover','dragleave','drop'].forEach(ev=>{
            zone.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();});
            // Only prevent body drag events when upload modal is open
            document.body.addEventListener(ev,e=>{
                const uploadModal = document.getElementById('uploadNotesModal');
                if(uploadModal && uploadModal.classList.contains('active')) {
                    e.preventDefault(); e.stopPropagation();
                }
            });
        });
        ['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,()=>zone.classList.add('drag-over')));
        ['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,()=>zone.classList.remove('drag-over')));
        zone.addEventListener('drop',e=>this.addFiles(e.dataTransfer.files));
        input.addEventListener('change',e=>this.addFiles(e.target.files));
    },

    addFiles(list){ this.files=Array.from(list); this.renderList(); },

    classify(file) {
        const name=file.name.toLowerCase(), mime=file.type.toLowerCase();
        if(mime==='application/pdf'||name.endsWith('.pdf')) return 'pdf';
        if(name.endsWith('.docx')) return 'docx';
        if(name.endsWith('.doc'))  return 'doc';
        const tm=['text/','application/json','application/xml','application/javascript'];
        if(tm.some(t=>mime.startsWith(t))) return 'text';
        const te=['.txt','.md','.markdown','.html','.htm','.css','.js','.mjs','.json','.xml','.csv','.yaml','.yml','.ini','.log','.ts'];
        if(te.some(e=>name.endsWith(e))) return 'text';
        return 'binary';
    },

    renderList() {
        const list=document.getElementById('fileList');
        if(!this.files.length){ list.innerHTML=''; return; }
        const lbl={pdf:'PDF',docx:'Word',doc:'Old Word (no preview)',text:'Text',binary:'Binary'};
        list.innerHTML=this.files.map((f,i)=>`
        <div class="file-item">
            <div class="file-item-info">
                <div class="file-item-icon file-item-icon--${this.classify(f)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
                <div class="file-item-details">
                    <div class="file-item-name" title="${esc(f.name)}">${esc(f.name)}</div>
                    <div class="file-item-meta">${fmtSize(f.size)} · <span class="file-item-kind">${lbl[this.classify(f)]||'File'}</span></div>
                </div>
            </div>
            <button class="file-item-remove" data-file-name="${esc(f.name)}" data-file-size="${f.size}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>`).join('');
        list.querySelectorAll('.file-item-remove').forEach(btn=>btn.addEventListener('click',()=>{
            const fname=btn.dataset.fileName, fsize=parseInt(btn.dataset.fileSize);
            const idx=this.files.findIndex(f=>f.name===fname && f.size===fsize);
            if(idx!==-1) this.files.splice(idx,1);
            this.renderList();
        }));
    },

    setProgress(pct, label) {
        const bar=document.getElementById('uploadProgressBar'), lbl=document.getElementById('uploadProgressLabel'), wrap=document.getElementById('uploadProgress');
        wrap.style.display=pct>0&&pct<100?'block':'none';
        bar.style.width=`${pct}%`; lbl.textContent=label;
    },

    async upload() {
        if(!this.files.length){ showToast('No files selected','error'); return; }
        const uploadFolderId = currentFolderId;
        const shareToClassLib = !!(document.getElementById('shareToClassLibrary')?.checked);
        const total=this.files.length; let done=0, errs=0;
        const advance=(ok=true)=>{ if(!ok) errs++; done++; this.setProgress(Math.round(done/total*100),`Uploading ${done} of ${total}…`); if(done<total) return; this.setProgress(100,''); const msg=errs?`${total-errs} uploaded, ${errs} failed`:`${total} file${total!==1?'s':''} uploaded`; showToast(msg,errs?'info':'success'); this.files=[]; this.renderList(); saveAndRender(); modal.close('uploadNotesModal'); };
        this.setProgress(1,`Uploading 0 of ${total}…`);

        for(const file of this.files) {
            const size=fmtSize(file.size), sizeB=file.size, kind=this.classify(file);

            if(kind==='pdf') {
                const note=db.addNote(uploadFolderId,file.name,size,'pdf','application/pdf',sizeB);
                if(!note){ advance(false); continue; }
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
                    this.setProgress(Math.round(done/total*100)+Math.round(1/total*100),`Uploading ${file.name}…`);
                    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, { method:'POST', body:formData });
                    if(!res.ok) {
                        const errData = await res.json();
                        throw new Error('Cloudinary upload failed: ' + (errData.error?.message || res.status));
                    }
                    const data = await res.json();
                    // Prefer API-returned URL; manual URL construction can break for transformed IDs.
                    note.storageRef = data.secure_url || data.url || '';
                    if(!note.storageRef) throw new Error('Cloudinary upload did not return a usable URL');
                    note.cloudinaryId = data.public_id;
                    // Share to Class Library if toggle is on
                    if(shareToClassLib && typeof shareFileToClassLibrary === 'function') {
                        await shareFileToClassLibrary(file, note.storageRef, 'pdf', 'application/pdf');
                    }
                    advance();
                } catch(err){ console.error('PDF upload error:',err); showToast(`Failed: "${file.name}"`,'error'); db.deleteNote(note.id,uploadFolderId); advance(false); }
                continue;
            }

            if(kind==='docx') {
                if(typeof mammoth==='undefined'){ showToast('mammoth.js not loaded','error'); db.addNote(uploadFolderId,file.name,size,'binary',file.type,sizeB); advance(false); continue; }
                try {
                    const buf=await file.arrayBuffer(), result=await mammoth.convertToHtml({arrayBuffer:buf});
                    const note=db.addNote(uploadFolderId,file.name,size,'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeB);
                    if(!note){ advance(false); continue; }
                    note.content=result.value; 
                    
                    // Upload to Cloudinary to preserve the original binary for downloading
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
                    this.setProgress(Math.round(done/total*100)+Math.round(1/total*100),`Uploading ${file.name}…`);
                    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, { method:'POST', body:formData });
                    if(res.ok) {
                        const data = await res.json();
                        note.storageRef = data.secure_url || data.url || '';
                        note.cloudinaryId = data.public_id;
                        // Share to Class Library if toggle is on
                        if(shareToClassLib && note.storageRef && typeof shareFileToClassLibrary === 'function') {
                            await shareFileToClassLibrary(file, note.storageRef, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                        }
                    }
                    advance();
                } catch(err){ console.error('DOCX error:',err); showToast(`Could not convert "${file.name}"`,'error'); db.addNote(uploadFolderId,file.name,size,'binary',file.type,sizeB); advance(false); }
                continue;
            }

            if(kind==='doc' || kind==='binary') {
                const note = db.addNote(uploadFolderId,file.name,size,'binary',file.type,sizeB);
                if(!note) { advance(false); continue; }
                if(kind === 'doc') showToast(`"${file.name}" is old .doc format — stored and uploaded`,'info');
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
                    this.setProgress(Math.round(done/total*100)+Math.round(1/total*100),`Uploading ${file.name}…`);
                    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, { method:'POST', body:formData });
                    if(res.ok) {
                        const data = await res.json();
                        note.storageRef = data.secure_url || data.url || '';
                        note.cloudinaryId = data.public_id;
                        // Share to Class Library if toggle is on
                        if(shareToClassLib && note.storageRef && typeof shareFileToClassLibrary === 'function') {
                            await shareFileToClassLibrary(file, note.storageRef, kind === 'doc' ? 'doc' : 'binary', file.type);
                        }
                    }
                    advance();
                } catch(err) {
                    console.error('Binary upload error:', err);
                    showToast(`Failed to backup ${file.name} to Cloud`, 'warning');
                    advance(false);
                }
                continue;
            }

            if(kind==='text') {
                try {
                    const text=await file.text();
                    const note=db.addNote(uploadFolderId,file.name,size,'text',file.type||'text/plain',sizeB);
                    if(note) note.content=text;
                    // For text files shared to Class Library, upload to Cloudinary first so we have a URL
                    if(shareToClassLib && note && typeof shareFileToClassLibrary === 'function') {
                        try {
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
                            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, { method:'POST', body:formData });
                            if(res.ok) {
                                const data = await res.json();
                                const textUrl = data.secure_url || data.url || '';
                                if(textUrl) {
                                    note.storageRef = textUrl;
                                    note.cloudinaryId = data.public_id;
                                    await shareFileToClassLibrary(file, textUrl, 'text', file.type||'text/plain');
                                }
                            }
                        } catch(clErr) { console.warn('Text file class library share failed:', clErr); }
                    }
                    advance();
                }
                catch(err){ db.addNote(uploadFolderId,file.name,size,'binary',file.type,sizeB); advance(false); }
                continue;
            }

            advance();
        }
    }
};

// ── INIT ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // ── THEME TOGGLE ───────────────────────────────────────────
    function toggleTheme() {
        const cur = document.documentElement.getAttribute('data-theme') || 'light';
        const next = cur === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('sv_theme', next);
    }
    const themeBtn = document.getElementById('themeToggleBtn');
    const loginThemeBtn = document.getElementById('loginThemeBtn');
    if(themeBtn) themeBtn.addEventListener('click', toggleTheme);
    if(loginThemeBtn) loginThemeBtn.addEventListener('click', toggleTheme);

    // ── FONT PICKER ────────────────────────────────────────────
    // ── FONT PICKER MODAL ─────────────────────────────────────
    const fontPickerBtn = document.getElementById('fontPickerBtn');
    const fontPickerModal = document.getElementById('fontPickerModal');
    const fontPickerClose = document.getElementById('fontPickerClose');

    function openFontPicker() {
        fontPickerModal.style.display = 'flex';
        // Mark active font
        const curFont = localStorage.getItem('sv_font') || 'jakarta';
        document.querySelectorAll('.fp-modal-opt').forEach(b => {
            b.classList.toggle('fp-modal-active', b.dataset.font === curFont);
        });
    }
    function closeFontPicker() { fontPickerModal.style.display = 'none'; }

    if(fontPickerBtn) fontPickerBtn.addEventListener('click', openFontPicker);
    if(fontPickerClose) fontPickerClose.addEventListener('click', closeFontPicker);
    if(fontPickerModal) fontPickerModal.addEventListener('click', (e) => {
        if(e.target === fontPickerModal) closeFontPicker();
    });
    document.querySelectorAll('.fp-modal-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const font = btn.dataset.font;
            document.documentElement.setAttribute('data-font', font);
            localStorage.setItem('sv_font', font);
            document.querySelectorAll('.fp-modal-opt').forEach(b => b.classList.remove('fp-modal-active'));
            btn.classList.add('fp-modal-active');
            closeFontPicker();
        });
    });

    uploader.init();

    // ── SIDEBAR NAV ─────────────────────────────────────────
    document.querySelectorAll('.sb-nav-item').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            const view = a.dataset.view || 'library';
            if(view === 'library') currentFolderId = 'root';
            setView(view);
        });
    });
    // Sidebar storage manage button
    const sbManageBtn = document.querySelector('.sb-storage-manage');
    if(sbManageBtn) sbManageBtn.addEventListener('click', () => setView('storage'));

    // ── BOTTOM NAV (mobile) ────────────────────────────────
    document.querySelectorAll('.bn-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if(view === 'library') currentFolderId = 'root';
            setView(view);
        });
    });

    // ── MOBILE SETTINGS PANEL ──────────────────────────────
    const msSettingsBtn = document.getElementById('mobileSettingsBtn');
    const msOverlay = document.getElementById('mobileSettingsOverlay');
    const msCloseBtn = document.getElementById('mobileSettingsClose');

    function openMobileSettings() {
        if(!msOverlay) return;
        msOverlay.style.display = 'flex';
        // Update theme label
        const label = document.getElementById('msThemeLabel');
        if(label) {
            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            label.textContent = cur === 'dark' ? 'Dark mode' : 'Light mode';
        }
    }
    function closeMobileSettings() {
        if(msOverlay) msOverlay.style.display = 'none';
    }

    if(msSettingsBtn) {
        msSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const isOpen = msOverlay && msOverlay.style.display === 'flex';
            if(isOpen) closeMobileSettings(); else openMobileSettings();
        });
    }
    if(msCloseBtn) msCloseBtn.addEventListener('click', closeMobileSettings);
    if(msOverlay) {
        msOverlay.addEventListener('click', (e) => {
            if(e.target === msOverlay) closeMobileSettings();
        });
    }

    // Navigation items in settings
    document.querySelectorAll('.ms-nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if(view === 'library') currentFolderId = 'root';
            closeMobileSettings();
            setView(view);
        });
    });

    // API Key button
    const msApiKeyBtn = document.getElementById('msApiKeyBtn');
    if(msApiKeyBtn) {
        msApiKeyBtn.addEventListener('click', () => {
            closeMobileSettings();
            // Trigger the existing API key button
            const apiBtn = document.getElementById('setApiKeyBtn');
            if(apiBtn) apiBtn.click();
        });
    }

    // Font button
    const msFontBtn = document.getElementById('msFontBtn');
    if(msFontBtn) {
        msFontBtn.addEventListener('click', () => {
            closeMobileSettings();
            // Trigger the existing font picker
            const fpBtn = document.getElementById('fontPickerBtn');
            if(fpBtn) fpBtn.click();
        });
    }

    // Theme toggle in settings
    const msThemeToggle = document.getElementById('msThemeToggle');
    if(msThemeToggle) {
        msThemeToggle.addEventListener('click', () => {
            toggleTheme();
            const label = document.getElementById('msThemeLabel');
            if(label) {
                const cur = document.documentElement.getAttribute('data-theme') || 'light';
                label.textContent = cur === 'dark' ? 'Dark mode' : 'Light mode';
            }
        });
    }

    // Logout button in settings
    const msLogoutBtn = document.getElementById('msLogoutBtn');
    if(msLogoutBtn) {
        msLogoutBtn.addEventListener('click', () => {
            closeMobileSettings();
            document.getElementById('signOutBtn').click();
        });
    }
    const mobileFab = document.getElementById('mobileFabBtn');
    if(mobileFab) mobileFab.addEventListener('click', () => {
        document.getElementById('folderNameInput').value = '';
        modal.ctx.parentFolderId = currentFolderId;
        modal.open('createFolderModal');
        setTimeout(() => document.getElementById('folderNameInput').focus(), 80);
    });

    // Mobile back button
    // Mobile sign out sheet — tap avatar to open
    const userBadge = document.getElementById('userBadge');
    if(userBadge) {
        userBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            // Only show sheet on mobile
            if(window.innerWidth > 768) return;
            let sheet = document.getElementById('mobileUserSheet');
            if(!sheet) {
                sheet = document.createElement('div');
                sheet.id = 'mobileUserSheet';
                sheet.className = 'mobile-user-sheet';
                sheet.innerHTML = `
                    <div class="mus-header">
                        <p class="mus-name" id="musName">Guest</p>
                        <p class="mus-role">RESEARCHER</p>
                    </div>
                    <div class="mus-actions">
                        <button class="mus-btn" id="musSignOut">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                            Sign Out
                        </button>
                        <button class="mus-btn mus-btn--danger" id="musClear">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                            Clear All Data
                        </button>
                    </div>`;
                document.body.appendChild(sheet);
                document.getElementById('musSignOut').addEventListener('click', () => {
                    sheet.classList.remove('mus-open');
                    document.getElementById('signOutBtn').click();
                });
                document.getElementById('musClear').addEventListener('click', () => {
                    sheet.classList.remove('mus-open');
                    document.getElementById('clearDataBtn').click();
                });
                document.addEventListener('click', (ev) => {
                    if(!sheet.contains(ev.target) && !userBadge.contains(ev.target)) {
                        sheet.classList.remove('mus-open');
                    }
                });
            }
            // Update name
            const musName = document.getElementById('musName');
            if(musName) musName.textContent = document.getElementById('userBadgeName')?.textContent || 'Guest';
            sheet.classList.toggle('mus-open');
        });
    }

    const mobileBack = document.getElementById('mobileBackBtn');
    if(mobileBack) mobileBack.addEventListener('click', () => {
        const ancestors = db.getAncestors(currentFolderId);
        if(ancestors.length >= 2) {
            currentFolderId = ancestors[ancestors.length - 2].id;
        } else {
            currentFolderId = 'root';
        }
        renderAll();
    });

    document.getElementById('googleSignInBtn').addEventListener('click', ()=>{
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
            .catch(err=>{ console.error('Sign-in error:',err); showToast('Sign-in failed — please try again','error'); });
    });

    document.getElementById('guestSignInBtn').addEventListener('click', ()=>{
        localStorage.setItem('studyVaultGuest', 'true');
        currentUser = null;
        setUserBadge(null);
        db._loadCache();
        showApp();
        setSyncState('saved');
        document.getElementById('syncLabel').textContent = 'Local only';
        renderAll();
        showToast('Using local mode — data stays on this device', 'info');
    });

    document.getElementById('signOutBtn').addEventListener('click', ()=>{
        localStorage.removeItem('studyVaultGuest');
        if(currentUser) auth.signOut();
        else showLogin();
    });

    document.getElementById('createFolderBtn').addEventListener('click', ()=>{
        document.getElementById('folderNameInput').value=''; modal.ctx.parentFolderId=currentFolderId;
        modal.open('createFolderModal'); setTimeout(()=>document.getElementById('folderNameInput').focus(),80);
    });
    document.getElementById('confirmFolderBtn').addEventListener('click', ()=>{
        const name=document.getElementById('folderNameInput').value.trim();
        if(!name){ showToast('Please enter a folder name','error'); return; }
        db.createFolder(modal.ctx.parentFolderId,name); showToast(`"${name}" created`);
        modal.close('createFolderModal'); saveAndRender();
    });
    document.getElementById('folderNameInput').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('confirmFolderBtn').click(); if(e.key==='Escape') modal.close('createFolderModal'); });
    document.getElementById('closeFolderModalBtn').addEventListener('click', ()=>modal.close('createFolderModal'));
    document.getElementById('cancelFolderBtn').addEventListener('click',      ()=>modal.close('createFolderModal'));

    document.getElementById('uploadNotesBtn').addEventListener('click', ()=>{
        document.getElementById('fileInput').value=''; uploader.files=[]; uploader.renderList(); modal.open('uploadNotesModal');
    });
    document.getElementById('confirmUploadBtn').addEventListener('click',  ()=>uploader.upload());
    document.getElementById('closeUploadModalBtn').addEventListener('click', ()=>modal.close('uploadNotesModal'));
    document.getElementById('cancelUploadBtn').addEventListener('click',     ()=>modal.close('uploadNotesModal'));

    document.getElementById('confirmRenameBtn').addEventListener('click', ()=>{
        const name=document.getElementById('renameInput').value.trim();
        if(!name){ showToast('Please enter a name','error'); return; }
        db.renameFolder(modal.ctx.targetFolderId,name); showToast(`Renamed to "${name}"`);
        modal.close('renameFolderModal'); saveAndRender();
    });
    document.getElementById('renameInput').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('confirmRenameBtn').click(); if(e.key==='Escape') modal.close('renameFolderModal'); });
    document.getElementById('closeRenameModalBtn').addEventListener('click', ()=>modal.close('renameFolderModal'));
    document.getElementById('cancelRenameBtn').addEventListener('click',     ()=>modal.close('renameFolderModal'));

    document.getElementById('closeViewModalBtn').addEventListener('click', ()=>modal.close('viewFileModal'));
    document.getElementById('closeViewBtn').addEventListener('click',       ()=>modal.close('viewFileModal'));
    document.getElementById('downloadFileBtn').addEventListener('click', function(){ downloadFile(db.findNoteById(this.dataset.noteId)); });

    document.getElementById('clearDataBtn').addEventListener('click', async ()=>{
        if(!confirm('⚠ Delete ALL folders and files permanently?\nThis cannot be undone.')) return;
        const allNoteIds = db.getAllNotes().map(n => n.id);
        for(const noteId of allNoteIds) {
            await deleteNoteArtifacts(noteId);
        }
        db.clearAll(); showToast('All data cleared','info'); saveAndRender();
    });

    document.getElementById('selectModeBtn').addEventListener('click',   ()=>selectMode?exitSelectMode():enterSelectMode());
    document.getElementById('cancelSelectBtn').addEventListener('click',  exitSelectMode);
    document.getElementById('selectAllBtn').addEventListener('click', ()=>{
        if(currentView === 'library') {
            const c = db.getContents(currentFolderId);
            if(c) c.notes.filter(n=>!n.archived).forEach(n=>selectedNotes.add(n.id));
        } else if(currentView === 'recent') {
            db.getRecentNotes(10).forEach(n=>selectedNotes.add(n.id));
        } else if(currentView === 'pinned') {
            db.getPinnedNotes().forEach(n=>selectedNotes.add(n.id));
        } else if(currentView === 'archive') {
            db.getArchivedNotes().forEach(n=>selectedNotes.add(n.id));
        }
        renderFolderGrid(); updateBulkBar();
    });
    document.getElementById('deselectAllBtn').addEventListener('click', ()=>{ selectedNotes.clear(); renderFolderGrid(); updateBulkBar(); });
    document.getElementById('bulkDeleteBtn').addEventListener('click', async ()=>{
        const count=selectedNotes.size;
        if(!count||!confirm(`Delete ${count} file${count!==1?'s':''}?\nThis cannot be undone.`)) return;
        for(const id of selectedNotes){
            const folderId = db.findNoteParentId(id);
            if(folderId) {
                db.deleteNote(id, folderId);
                await deleteNoteArtifacts(id);
            }
        }
        showToast(`${count} file${count!==1?'s':''} deleted`); exitSelectMode(); saveAndRender();
    });

    // ── SEARCH BAR ──────────────────────────────────────────
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClearBtn');
    let searchDebounce = null;
    if(searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const q = searchInput.value.trim();
            searchClear.style.display = q ? 'flex' : 'none';
            document.querySelector('.search-bar-kbd')?.style && (document.querySelector('.search-bar-kbd').style.display = q ? 'none' : '');
            searchDebounce = setTimeout(() => {
                if(q) {
                    currentView = 'search';
                    renderAll();
                } else {
                    if(currentView === 'search') { currentView = 'library'; renderAll(); }
                }
            }, 200);
        });
        searchInput.addEventListener('keydown', e => {
            if(e.key === 'Escape') {
                searchInput.value = '';
                searchClear.style.display = 'none';
                searchInput.blur();
                if(currentView === 'search') { currentView = 'library'; renderAll(); }
            }
        });
        // Mobile: click icon to expand
        document.querySelector('.search-bar-icon')?.addEventListener('click', () => {
            document.getElementById('searchBarWrap').classList.add('search-active');
            searchInput.style.display = 'block';
            searchInput.focus();
        });
    }
    if(searchClear) {
        searchClear.addEventListener('click', () => {
            searchInput.value = ''; searchClear.style.display = 'none';
            searchInput.focus();
            if(currentView === 'search') { currentView = 'library'; renderAll(); }
        });
    }

    // ── RENAME NOTE MODAL ────────────────────────────────────
    document.getElementById('confirmRenameNoteBtn').addEventListener('click', () => {
        const name = document.getElementById('renameNoteInput').value.trim();
        if(!name) { showToast('Please enter a name', 'error'); return; }
        if(modal.ctx.targetNoteId) {
            db.renameNote(modal.ctx.targetNoteId, name);
            showToast(`Renamed to "${name}"`);
            modal.close('renameNoteModal');
            saveAndRender();
        }
    });
    document.getElementById('renameNoteInput').addEventListener('keydown', e => {
        if(e.key === 'Enter') document.getElementById('confirmRenameNoteBtn').click();
        if(e.key === 'Escape') modal.close('renameNoteModal');
    });
    document.getElementById('closeRenameNoteModalBtn').addEventListener('click', () => modal.close('renameNoteModal'));
    document.getElementById('cancelRenameNoteBtn').addEventListener('click', () => modal.close('renameNoteModal'));

    // ── MOVE TO FOLDER MODAL ────────────────────────────────
    function openMoveModal(itemType, itemId, itemName) {
        modal.ctx.moveItemType = itemType; // 'note' or 'folder'
        modal.ctx.moveItemId = itemId;
        modal.ctx.moveTargetFolderId = null;
        document.getElementById('moveItemName').textContent = `Moving: ${itemName}`;
        document.getElementById('confirmMoveBtn').disabled = true;
        renderMoveTree(itemType, itemId);
        modal.open('moveToFolderModal');
    }
    function renderMoveTree(itemType, itemId, node = db.root, depth = 0) {
        const tree = document.getElementById('moveFolderTree');
        if(depth === 0) tree.innerHTML = '';
        // Determine the current parent
        const currentParentId = itemType === 'note' ? db.findNoteParentId(itemId) : db.findFolderParentId(itemId);
        const isSelf = (itemType === 'folder' && node.id === itemId);
        const isCurrentParent = (node.id === currentParentId);
        const depthCls = depth > 0 ? ` mft-depth-${Math.min(depth, 3)}` : '';
        const disabledCls = isSelf ? ' mft-disabled' : '';
        const div = document.createElement('div');
        div.className = `mft-item${depthCls}${disabledCls}`;
        div.dataset.folderId = node.id;
        div.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> ${esc(node.name)}${isCurrentParent ? ' <span style="font-size:0.65rem;color:var(--ink-3);">(current)</span>' : ''}`;
        div.addEventListener('click', () => {
            tree.querySelectorAll('.mft-item').forEach(i => i.classList.remove('mft-selected'));
            div.classList.add('mft-selected');
            modal.ctx.moveTargetFolderId = node.id;
            document.getElementById('confirmMoveBtn').disabled = (node.id === currentParentId);
        });
        tree.appendChild(div);
        node.subFolders.forEach(sub => renderMoveTree(itemType, itemId, sub, depth + 1));
    }
    document.getElementById('confirmMoveBtn').addEventListener('click', () => {
        const { moveItemType, moveItemId, moveTargetFolderId } = modal.ctx;
        if(!moveTargetFolderId) return;
        if(moveItemType === 'note') {
            const fromId = db.findNoteParentId(moveItemId);
            if(fromId && db.moveNote(moveItemId, fromId, moveTargetFolderId)) {
                showToast('File moved successfully');
            } else { showToast('Move failed', 'error'); }
        } else {
            const fromId = db.findFolderParentId(moveItemId);
            if(fromId && db.moveFolder(moveItemId, fromId, moveTargetFolderId)) {
                showToast('Folder moved successfully');
            } else { showToast('Move failed', 'error'); }
        }
        modal.close('moveToFolderModal');
        saveAndRender();
    });
    document.getElementById('closeMoveModalBtn').addEventListener('click', () => modal.close('moveToFolderModal'));
    document.getElementById('cancelMoveBtn').addEventListener('click', () => modal.close('moveToFolderModal'));

    // ── RIGHT-CLICK CONTEXT MENU ─────────────────────────────
    const ctxMenu = document.getElementById('contextMenu');
    function showContextMenu(e, items) {
        e.preventDefault();
        ctxMenu.innerHTML = items.map(item => {
            if(item.sep) return '<div class="ctx-sep"></div>';
            const dangerCls = item.danger ? ' ctx-item--danger' : '';
            return `<button class="ctx-item${dangerCls}" data-action="${item.action}">${item.icon || ''}<span>${item.label}</span>${item.shortcut ? `<span class="ctx-shortcut">${item.shortcut}</span>` : ''}</button>`;
        }).join('');
        // Position
        const x = Math.min(e.clientX, window.innerWidth - 220);
        const y = Math.min(e.clientY, window.innerHeight - (items.length * 40));
        ctxMenu.style.left = x + 'px';
        ctxMenu.style.top = y + 'px';
        ctxMenu.classList.add('active');
        // Wire actions
        ctxMenu.querySelectorAll('.ctx-item').forEach(btn => {
            btn.addEventListener('click', () => {
                ctxMenu.classList.remove('active');
                const action = btn.dataset.action;
                if(typeof ctxMenu._handler === 'function') ctxMenu._handler(action);
            });
        });
    }
    document.addEventListener('click', (e) => {
        if(!ctxMenu.contains(e.target)) ctxMenu.classList.remove('active');
    });
    document.addEventListener('scroll', () => ctxMenu.classList.remove('active'), true);

    // Right-click on note cards
    document.getElementById('folderGrid').addEventListener('contextmenu', e => {
        const noteCard = e.target.closest('.note-card');
        const folderCard = e.target.closest('.folder-card');
        const svgIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">`;
        if(noteCard) {
            const noteId = noteCard.dataset.noteId;
            const note = db.findNoteById(noteId);
            if(!note) return;
            const items = [
                { action:'open', label:'Open', icon: svgIcon + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' },
                { action:'rename', label:'Rename', icon: svgIcon + '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', shortcut:'F2' },
                { action:'move', label:'Move to…', icon: svgIcon + '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' },
                { sep: true },
                { action:'pin', label: note.pinned ? 'Unpin' : 'Pin', icon: svgIcon + `<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="${note.pinned ? 'currentColor' : 'none'}"/></svg>` },
                { action:'archive', label: note.archived ? 'Restore' : 'Archive', icon: svgIcon + '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' },
                { sep: true },
                { action:'delete', label:'Delete', icon: svgIcon + '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>', danger: true }
            ];
            ctxMenu._handler = async (action) => {
                if(action === 'open') { viewFile(note); }
                else if(action === 'rename') {
                    document.getElementById('renameNoteInput').value = note.name;
                    modal.ctx.targetNoteId = note.id;
                    modal.open('renameNoteModal');
                    setTimeout(() => document.getElementById('renameNoteInput').focus(), 80);
                }
                else if(action === 'move') { openMoveModal('note', note.id, note.name); }
                else if(action === 'pin') { note.pinned = !note.pinned; showToast(note.pinned ? `"${note.name}" pinned` : `"${note.name}" unpinned`, 'info'); saveAndRender(); }
                else if(action === 'archive') { note.archived = !note.archived; if(note.archived && note.pinned) note.pinned = false; showToast(note.archived ? `"${note.name}" archived` : `"${note.name}" restored`, 'info'); saveAndRender(); }
                else if(action === 'delete') {
                    if(!confirm(`Delete "${note.name}"?\nThis cannot be undone.`)) return;
                    const fId = db.findNoteParentId(note.id);
                    if(fId) { db.deleteNote(note.id, fId); await deleteNoteArtifacts(note.id); showToast(`"${note.name}" deleted`); saveAndRender(); }
                }
            };
            showContextMenu(e, items);
        } else if(folderCard) {
            const folderId = folderCard.dataset.folderId;
            const folder = db.findById(folderId);
            if(!folder || folder.id === 'root') return;
            const items = [
                { action:'open', label:'Open', icon: svgIcon + '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' },
                { action:'rename', label:'Rename', icon: svgIcon + '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' },
                { action:'move', label:'Move to…', icon: svgIcon + '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' },
                { sep: true },
                { action:'pin', label: folder.pinned ? 'Unpin' : 'Pin', icon: svgIcon + `<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="${folder.pinned ? 'currentColor' : 'none'}"/></svg>` },
                { action:'archive', label: folder.archived ? 'Restore' : 'Archive', icon: svgIcon + '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' },
                { sep: true },
                { action:'delete', label:'Delete', icon: svgIcon + '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>', danger: true }
            ];
            ctxMenu._handler = async (action) => {
                if(action === 'open') { currentFolderId = folderId; setView('library'); }
                else if(action === 'rename') {
                    document.getElementById('renameInput').value = folder.name;
                    modal.ctx.targetFolderId = folderId;
                    modal.open('renameFolderModal');
                    setTimeout(() => document.getElementById('renameInput').focus(), 80);
                }
                else if(action === 'move') { openMoveModal('folder', folderId, folder.name); }
                else if(action === 'pin') { folder.pinned = !folder.pinned; showToast(folder.pinned ? `"${folder.name}" pinned` : `"${folder.name}" unpinned`, 'info'); saveAndRender(); }
                else if(action === 'archive') { folder.archived = !folder.archived; if(folder.archived && folder.pinned) folder.pinned = false; showToast(folder.archived ? `"${folder.name}" archived` : `"${folder.name}" restored`, 'info'); saveAndRender(); }
                else if(action === 'delete') {
                    if(!confirm(`Delete "${folder.name}" and all its contents?\nThis cannot be undone.`)) return;
                    await deleteFolderArtifacts(folderId);
                    const actualParentId = db.findFolderParentId(folderId) || currentFolderId;
                    db.deleteFolder(folderId, actualParentId);
                    showToast(`"${folder.name}" deleted`); saveAndRender();
                }
            };
            showContextMenu(e, items);
        }
    });

    // ── KEYBOARD SHORTCUTS ───────────────────────────────────
    document.addEventListener('keydown', e => {
        const activeEl = document.activeElement;
        const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

        // Ctrl+K — Focus search
        if((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            const si = document.getElementById('searchInput');
            if(si) { document.getElementById('searchBarWrap')?.classList.add('search-active'); si.style.display = 'block'; si.focus(); si.select(); }
        }
        // Ctrl+N — New folder
        if((e.ctrlKey || e.metaKey) && e.key === 'n' && !isInput) {
            e.preventDefault();
            document.getElementById('folderNameInput').value = '';
            modal.ctx.parentFolderId = currentFolderId;
            modal.open('createFolderModal');
            setTimeout(() => document.getElementById('folderNameInput').focus(), 80);
        }
        // Escape — close modals, clear search
        if(e.key === 'Escape') {
            ctxMenu.classList.remove('active');
            // If search is active, clear it first
            const si = document.getElementById('searchInput');
            if(si && document.activeElement === si && si.value) {
                si.value = ''; searchClear.style.display = 'none'; si.blur();
                if(currentView === 'search') { currentView = 'library'; renderAll(); }
                return;
            }
            const uploadOpen = document.getElementById('uploadNotesModal').classList.contains('active');
            if(uploadOpen && uploader.files && uploader.files.length > 0) {
                if(!confirm('You have files ready to upload. Close anyway?')) return;
                uploader.files = [];
                uploader.renderList();
            }
            modal.closeAll();
        }
    });
});
