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
   5. Storage → Get started → Production mode
      Rules tab → paste:
        rules_version = '2';
        service firebase.storage {
          match /b/{bucket}/o {
            match /users/{uid}/{allPaths=**} {
              allow read, write: if request.auth != null
                                 && request.auth.uid == uid;
            }
          }
        }
   6. Project Settings (gear icon) → Your apps → Web (</>)
      → Register app → copy firebaseConfig → paste below.
   7. Project Settings → Authorized domains → add your
      GitHub Pages domain  e.g.  yourname.github.io
   ============================================================
   HOW DATA IS STORED
   • Firestore  users/{uid}/vault/tree
       Full folder tree as JSON (text + DOCX HTML content).
   • Storage    users/{uid}/{noteId}
       Raw PDF binary files.
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
// Note: Firebase Storage not used — PDFs are handled by Cloudinary

// ── FOLDER STRUCTURE ─────────────────────────────────────────

class FolderStructure {
    constructor() { this.root = this._emptyRoot(); }

    _emptyRoot() { return { id:'root', name:'Root', subFolders:[], notes:[] }; }

    _uid() { return `n_${Date.now()}_${Math.random().toString(36).slice(2,9)}`; }

    // Cache
    _saveCache() {
        try { localStorage.setItem('studyVaultCache', JSON.stringify(this.root)); } catch(_) {}
    }
    _loadCache() {
        try { const r = localStorage.getItem('studyVaultCache'); if(r){ this.root=JSON.parse(r); return true; } } catch(_) {}
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
    addNote(folderId, name, size, fileKind='binary', mimeType=null) {
        const folder = this.findById(folderId); if(!folder) return null;
        const note = { id:this._uid(), name, size, fileKind, mimeType,
            content:null, storageRef:null,
            addedDate: new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) };
        folder.notes.push(note); return note;
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
    clearAll() { this.root = this._emptyRoot(); }
}

// ── GLOBALS ───────────────────────────────────────────────────

const db          = new FolderStructure();
let currentUser   = null;
let currentFolderId = 'root';
let selectMode    = false;
let selectedNotes = new Set();

// ── HELPERS ───────────────────────────────────────────────────

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtSize(b) {
    if(!b) return '0 B';
    const u=['B','KB','MB','GB'], i=Math.floor(Math.log(b)/Math.log(1024));
    return `${(b/Math.pow(1024,i)).toFixed(1)} ${u[i]}`;
}

// ── SYNC INDICATOR ────────────────────────────────────────────

function setSyncState(state) {
    const dot=document.getElementById('syncDot'), lbl=document.getElementById('syncLabel');
    if(!dot||!lbl) return;
    dot.className = `sync-dot sync-dot--${state}`;
    if(!currentUser) { lbl.textContent='Local only'; return; }
    lbl.textContent = state==='saving'?'Saving…':state==='error'?'Sync error':'Synced';
}

async function saveAndRender() {
    if(currentUser) await db.saveToCloud(currentUser.uid);
    else db._saveCache(); // guest: local only
    renderAll();
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
    ctx:{ parentFolderId:'root', targetFolderId:null },
    open(id)   { document.getElementById(id)?.classList.add('active'); },
    close(id)  { document.getElementById(id)?.classList.remove('active'); },
    closeAll() { document.querySelectorAll('.modal').forEach(m=>m.classList.remove('active')); }
};
document.addEventListener('mousedown', e => { if(e.target.classList.contains('modal')) modal.closeAll(); });

// ── AUTH ──────────────────────────────────────────────────────

function showApp()     { document.getElementById('appLoading').style.display='none'; document.getElementById('loginScreen').style.display='none'; document.getElementById('appContainer').style.display=''; }
function showLogin()   { document.getElementById('appLoading').style.display='none'; document.getElementById('loginScreen').style.display=''; document.getElementById('appContainer').style.display='none'; }

function setUserBadge(user) {
    const avatar = document.getElementById('userAvatar');
    const guestAv = document.getElementById('guestAvatar');
    if(user) {
        avatar.src = user.photoURL||'';
        avatar.style.display = '';
        guestAv.style.display = 'none';
        document.getElementById('userName').textContent = user.displayName?.split(' ')[0]||user.email;
        document.getElementById('userBadge').style.display = '';
        document.getElementById('signOutBtn').style.display = '';
    } else {
        avatar.style.display = 'none';
        guestAv.style.display = 'flex';
        document.getElementById('userName').textContent = 'Guest';
        document.getElementById('userBadge').style.display = '';
        document.getElementById('signOutBtn').style.display = '';
    }
}

auth.onAuthStateChanged(async user => {
    if (user) {
        currentUser = user;
        setUserBadge(user);
        if (db._loadCache()) renderAll();
        showApp();
        setSyncState('saving');
        await db.loadFromCloud(user.uid);
        await migrateFromLocalStorage(user.uid);
        setSyncState('saved');
        renderAll();
    } else {
        // Check if user chose guest mode
        if(localStorage.getItem('studyVaultGuest') === 'true') {
            currentUser = null;
            setUserBadge(null);
            db._loadCache();
            showApp();
            setSyncState('saved');
            renderAll();
        } else {
            currentUser = null;
            showLogin();
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

function renderFolderGrid() {
    const grid=document.getElementById('folderGrid'), contents=db.getContents(currentFolderId);
    if(!contents){ grid.innerHTML=`<div class="empty-state"><p class="empty-title">Folder not found</p></div>`; return; }
    let html='';

    contents.subFolders.forEach(folder => {
        const info=`${folder.subFolders.length} folder${folder.subFolders.length!==1?'s':''} · ${folder.notes.length} file${folder.notes.length!==1?'s':''}`;
        html+=`<div class="folder-card" data-folder-id="${folder.id}" role="button" tabindex="0">
            <div class="folder-icon-wrap"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div>
            <div class="folder-name">${esc(folder.name)}</div>
            <div class="folder-meta">${info}</div>
            <div class="folder-actions">
                <button class="folder-btn rename-btn" data-folder-id="${folder.id}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Rename</button>
                <button class="folder-btn delete delete-btn" data-folder-id="${folder.id}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>Delete</button>
            </div>
        </div>`;
    });

    contents.notes.forEach(note => {
        const meta=getFileMeta(note), canView=note.content||note.storageRef;
        const clickCls=selectMode?'note-card-selectable':(canView?'note-card-clickable':'');
        const selCls=selectedNotes.has(note.id)?'note-card-selected':'';
        html+=`<div class="note-card ${clickCls} ${selCls}" data-note-id="${note.id}">
            <label class="note-checkbox"><input type="checkbox" class="note-check" data-note-id="${note.id}" ${selectedNotes.has(note.id)?'checked':''}><span class="note-check-ui"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></span></label>
            <div class="note-icon-wrap note-icon-${note.fileKind||'binary'}">${meta.icon}</div>
            <div class="note-info">
                <div class="note-name-row"><span class="note-badge ${meta.badgeClass}">${meta.badge}</span><span class="note-name" title="${esc(note.name)}">${esc(note.name)}</span></div>
                <div class="note-size">${note.size} · ${note.addedDate}</div>
                <div class="${meta.hintClass}">${selectMode?'Click to select':meta.hint}</div>
            </div>
            <button class="note-delete-btn" data-note-id="${note.id}" title="Delete file"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
        </div>`;
    });

    if(!html) html=`<div class="empty-state"><div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div><p class="empty-title">This folder is empty</p><p class="empty-sub">Upload notes or create a subfolder.</p></div>`;
    grid.innerHTML = html;
    attachGridListeners();
}

// ── GRID LISTENERS ────────────────────────────────────────────

function attachGridListeners() {
    document.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', e => { if(e.target.closest('.folder-actions')) return; currentFolderId=card.dataset.folderId; renderAll(); });
        card.addEventListener('keydown', e => { if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.folder-actions')){ e.preventDefault(); currentFolderId=card.dataset.folderId; renderAll(); } });
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
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const f=db.findById(btn.dataset.folderId); if(!f) return;
            if(confirm(`Delete "${f.name}" and all its contents?\nThis cannot be undone.`)){ db.deleteFolder(btn.dataset.folderId,currentFolderId); showToast(`"${f.name}" deleted`); saveAndRender(); }
        });
    });

    document.querySelectorAll('.note-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const note=db.findNoteById(btn.dataset.noteId); if(!note) return;
            if(!confirm(`Delete "${note.name}"?\nThis cannot be undone.`)) return;
            const deleted=db.deleteNote(note.id,currentFolderId);
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
            if(e.target.closest('.note-delete-btn')) return;
            const note=db.findNoteById(card.dataset.noteId); if(note) viewFile(note);
        });
    });
}

// ── RENDER ALL ────────────────────────────────────────────────

function renderAll(){ renderFolderGrid(); renderBreadcrumb(); updateToolbarInfo(); updateBulkBar(); }

// ── SELECT MODE ───────────────────────────────────────────────

function enterSelectMode(){ selectMode=true; selectedNotes.clear(); document.getElementById('selectModeBtn').classList.add('btn--active'); document.getElementById('bulkBar').classList.add('bulk-bar--visible'); document.getElementById('toolbarInfo').style.display='none'; renderFolderGrid(); updateBulkBar(); }
function exitSelectMode(){ selectMode=false; selectedNotes.clear(); document.getElementById('selectModeBtn').classList.remove('btn--active'); document.getElementById('bulkBar').classList.remove('bulk-bar--visible'); document.getElementById('toolbarInfo').style.display=''; renderFolderGrid(); }
function updateBulkBar(){ const n=selectedNotes.size, el=document.getElementById('bulkCount'), btn=document.getElementById('bulkDeleteBtn'); if(!el||!btn) return; el.textContent=n===0?'None selected':`${n} file${n!==1?'s':''} selected`; btn.disabled=n===0; }

// ── FILE VIEWER ───────────────────────────────────────────────

const ALL_PANELS=['panelText','panelPdf','panelDocx','panelLoading','panelUnsupported'];
function showPanel(id){ ALL_PANELS.forEach(p=>document.getElementById(p).style.display='none'); document.getElementById(id).style.display='flex'; }

async function viewFile(note) {
    const meta=getFileMeta(note);
    const badge=document.getElementById('fileViewBadge');
    badge.textContent=meta.badge; badge.className=`file-type-badge ${meta.badgeClass}`;
    document.getElementById('fileViewTitle').textContent=note.name;
    document.getElementById('downloadFileBtn').dataset.noteId=note.id;
    modal.open('viewFileModal');

    switch(note.fileKind) {
        case 'text':
            showPanel('panelText');
            document.getElementById('fileContent').textContent=note.content||'';
            break;
        case 'docx':
            showPanel('panelDocx');
            document.getElementById('docxContent').innerHTML=note.content||'<p style="color:var(--text-3)">No content.</p>';
            break;
        case 'pdf':
            showPanel('panelLoading');
            try {
                const url = note.storageRef;
                if(!url) throw new Error('No URL');
                // Open PDF in new tab for best compatibility
                window.open(url, '_blank');
                modal.close('viewFileModal');
                showToast('PDF opened in new tab', 'info');
                showPanel('panelUnsupported');
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
            // storageRef is now a full Cloudinary URL
            const a=Object.assign(document.createElement('a'),{href:note.storageRef,download:note.name,target:'_blank'});
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        } else if(note.content) {
            const blob=new Blob([note.content],{type:note.mimeType||'text/plain'});
            const url=URL.createObjectURL(blob);
            const a=Object.assign(document.createElement('a'),{href:url,download:note.name});
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
            document.body.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();});
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
            <button class="file-item-remove" data-index="${i}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>`).join('');
        list.querySelectorAll('.file-item-remove').forEach(btn=>btn.addEventListener('click',()=>{ this.files.splice(parseInt(btn.dataset.index),1); this.renderList(); }));
    },

    setProgress(pct, label) {
        const bar=document.getElementById('uploadProgressBar'), lbl=document.getElementById('uploadProgressLabel'), wrap=document.getElementById('uploadProgress');
        wrap.style.display=pct>0&&pct<100?'block':'none';
        bar.style.width=`${pct}%`; lbl.textContent=label;
    },

    async upload() {
        if(!this.files.length){ showToast('No files selected','error'); return; }
        const total=this.files.length; let done=0, errs=0;
        const advance=(ok=true)=>{ if(!ok) errs++; done++; this.setProgress(Math.round(done/total*100),`Uploading ${done} of ${total}…`); if(done<total) return; this.setProgress(100,''); const msg=errs?`${total-errs} uploaded, ${errs} failed`:`${total} file${total!==1?'s':''} uploaded`; showToast(msg,errs?'info':'success'); this.files=[]; this.renderList(); saveAndRender(); modal.close('uploadNotesModal'); };
        this.setProgress(1,`Uploading 0 of ${total}…`);

        for(const file of this.files) {
            const size=fmtSize(file.size), kind=this.classify(file);

            if(kind==='pdf') {
                const note=db.addNote(currentFolderId,file.name,size,'pdf','application/pdf');
                if(!note){ advance(false); continue; }
                try {
                    const userFolder = currentUser ? currentUser.uid : 'guest';
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
                    // Build correct public URL
                    const publicUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/raw/upload/${data.public_id}`;
                    note.storageRef = publicUrl;
                    note.cloudinaryId = data.public_id;
                    advance();
                } catch(err){ console.error('PDF upload error:',err); showToast(`Failed: "${file.name}"`,'error'); db.deleteNote(note.id,currentFolderId); advance(false); }
                continue;
            }

            if(kind==='docx') {
                if(typeof mammoth==='undefined'){ showToast('mammoth.js not loaded','error'); db.addNote(currentFolderId,file.name,size,'binary',file.type); advance(false); continue; }
                try {
                    const buf=await file.arrayBuffer(), result=await mammoth.convertToHtml({arrayBuffer:buf});
                    const note=db.addNote(currentFolderId,file.name,size,'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                    if(note) note.content=result.value; advance();
                } catch(err){ console.error('DOCX error:',err); showToast(`Could not convert "${file.name}"`,'error'); db.addNote(currentFolderId,file.name,size,'binary',file.type); advance(false); }
                continue;
            }

            if(kind==='doc'){ showToast(`"${file.name}" is old .doc format — stored as reference`,'info'); db.addNote(currentFolderId,file.name,size,'binary',file.type); advance(false); continue; }

            if(kind==='text') {
                try { const text=await file.text(); const note=db.addNote(currentFolderId,file.name,size,'text',file.type||'text/plain'); if(note) note.content=text; advance(); }
                catch(err){ db.addNote(currentFolderId,file.name,size,'binary',file.type); advance(false); }
                continue;
            }

            db.addNote(currentFolderId,file.name,size,'binary',file.type); advance();
        }
    }
};

// ── INIT ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // ── THEME TOGGLE ──────────────────────────────────────────
    const themeBtn = document.getElementById('themeToggleBtn');
    const loginThemeBtn = document.getElementById('loginThemeBtn');
    const savedTheme = localStorage.getItem('studyVaultTheme') || 'dark';
    const isLightOnLoad = savedTheme === 'light';
    if(isLightOnLoad) {
        document.body.classList.add('light-theme');
        themeBtn.textContent = '☀️';
        loginThemeBtn.textContent = '☀️';
    }
    function toggleTheme() {
        const isLight = document.body.classList.toggle('light-theme');
        const icon = isLight ? '☀️' : '🌙';
        themeBtn.textContent = icon;
        loginThemeBtn.textContent = icon;
        localStorage.setItem('studyVaultTheme', isLight ? 'light' : 'dark');
    }
    themeBtn.addEventListener('click', toggleTheme);
    loginThemeBtn.addEventListener('click', toggleTheme);

    uploader.init();

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
        db.clearAll(); showToast('All data cleared','info'); saveAndRender();
    });

    document.getElementById('selectModeBtn').addEventListener('click',   ()=>selectMode?exitSelectMode():enterSelectMode());
    document.getElementById('cancelSelectBtn').addEventListener('click',  exitSelectMode);
    document.getElementById('selectAllBtn').addEventListener('click', ()=>{ const c=db.getContents(currentFolderId); if(c) c.notes.forEach(n=>selectedNotes.add(n.id)); renderFolderGrid(); updateBulkBar(); });
    document.getElementById('deselectAllBtn').addEventListener('click', ()=>{ selectedNotes.clear(); renderFolderGrid(); updateBulkBar(); });
    document.getElementById('bulkDeleteBtn').addEventListener('click', async ()=>{
        const count=selectedNotes.size;
        if(!count||!confirm(`Delete ${count} file${count!==1?'s':''}?\nThis cannot be undone.`)) return;
        for(const id of selectedNotes){ db.deleteNote(id,currentFolderId); }
        showToast(`${count} file${count!==1?'s':''} deleted`); exitSelectMode(); saveAndRender();
    });

    document.addEventListener('contextmenu', e=>e.preventDefault());
    document.addEventListener('click', ()=>document.getElementById('contextMenu').classList.remove('active'));
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') modal.closeAll(); });
});
