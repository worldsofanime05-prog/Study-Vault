/* ============================================================
   STUDYVAULT — Class Library Module
   ============================================================
   Shared file collection accessible by all signed-in users.
   Files are stored in the Firestore /shared/ collection.
   ============================================================ */

// ── ADMIN UID ────────────────────────────────────────────────
const CLASS_LIBRARY_ADMIN_UID = 'eQFOXOalIuWOGjS1U2HGoK0SzQo2';

// ── STATE ────────────────────────────────────────────────────
let clFiles = [];                // Current snapshot of shared files
let clUnsubscribe = null;        // Firestore onSnapshot unsubscribe
let clSearchQuery = '';          // Local search filter
let clTypeFilter = 'all';       // File type filter
let clLoading = true;            // Loading state
let clError = null;              // Error message, if any

// ── NAV VISIBILITY ───────────────────────────────────────────
function toggleClassLibraryNav(show) {
    const sbNav = document.getElementById('sbClassLibraryNav');
    const bnNav = document.getElementById('bnClassLibraryBtn');
    const moreItem = document.getElementById('moreSheetClassLibrary');
    const shareToggle = document.getElementById('shareToggleWrap');

    if (sbNav) sbNav.style.display = show ? '' : 'none';
    if (bnNav) bnNav.style.display = show ? '' : 'none';
    if (moreItem) moreItem.style.display = show ? '' : 'none';
    if (shareToggle) shareToggle.style.display = show ? '' : 'none';
}

// ── REAL-TIME LISTENER ───────────────────────────────────────
function startClassLibraryListener() {
    if (clUnsubscribe) return; // Already listening
    if (!currentUser) return;

    clLoading = true;
    clError = null;

    try {
        clUnsubscribe = firestore.collection('shared')
            .orderBy('uploadedAt', 'desc')
            .onSnapshot(
                snapshot => {
                    clFiles = snapshot.docs.map(doc => {
                        const d = doc.data();
                        return {
                            docId: doc.id,
                            fileId: d.fileId || doc.id,
                            fileName: d.fileName || 'Untitled',
                            fileUrl: d.fileUrl || '',
                            fileType: d.fileType || 'binary',
                            uploadedBy: d.uploadedBy || 'Unknown',
                            uploadedByUid: d.uploadedByUid || '',
                            uploadedAt: d.uploadedAt ? d.uploadedAt.toDate() : new Date(),
                            folderId: d.folderId || null,
                            folderName: d.folderName || null,
                            size: d.size || 0,
                            pinned: d.pinned || false,
                            mimeType: d.mimeType || ''
                        };
                    });
                    clLoading = false;
                    clError = null;
                    if (currentView === 'classLibrary') renderClassLibraryView();
                },
                err => {
                    console.error('Class Library listener error:', err);
                    clLoading = false;
                    clError = 'Could not load shared files. Please try again later.';
                    if (currentView === 'classLibrary') renderClassLibraryView();
                }
            );
    } catch (err) {
        console.error('Class Library listener setup failed:', err);
        clLoading = false;
        clError = 'Failed to connect to the Class Library.';
    }
}

function stopClassLibraryListener() {
    if (typeof clUnsubscribe === 'function') {
        clUnsubscribe();
        clUnsubscribe = null;
    }
}

// ── FILE TYPE HELPERS ────────────────────────────────────────
function clGetFileTypeIcon(fileType) {
    const icons = {
        pdf: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1a2 2 0 000-4H9v8m5-8v4m0-4h2m-2 4h2"/></svg>`,
        docx: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        txt: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        text: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`
    };
    return icons[fileType] || `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

function clGetBadgeClass(fileType) {
    const map = { pdf: 'badge-pdf', docx: 'badge-docx', txt: 'badge-text', text: 'badge-text' };
    return map[fileType] || 'badge-binary';
}

function clGetBadgeLabel(fileType) {
    return (fileType || 'FILE').toUpperCase();
}

function clFormatDate(date) {
    if (!date) return '';
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function clFormatSize(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

// ── RENDER ───────────────────────────────────────────────────
function renderClassLibraryView() {
    const grid = document.getElementById('folderGrid');
    if (!grid) return;

    // Loading state
    if (clLoading) {
        grid.innerHTML = `
        <div class="cl-view">
            <div class="cl-loading">
                <div class="vp-spin"></div>
                <p class="cl-loading-text">Loading shared files…</p>
            </div>
        </div>`;
        return;
    }

    // Error state
    if (clError) {
        grid.innerHTML = `
        <div class="cl-view">
            <div class="cl-error">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p class="cl-error-title">${esc(clError)}</p>
                <button class="btn-ghost" id="clRetryBtn">Retry</button>
            </div>
        </div>`;
        document.getElementById('clRetryBtn')?.addEventListener('click', () => {
            stopClassLibraryListener();
            startClassLibraryListener();
        });
        return;
    }

    // Filter files
    let filtered = [...clFiles];

    if (clTypeFilter !== 'all') {
        filtered = filtered.filter(f => f.fileType === clTypeFilter);
    }

    if (clSearchQuery.trim()) {
        const q = clSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(f =>
            f.fileName.toLowerCase().includes(q) ||
            f.uploadedBy.toLowerCase().includes(q)
        );
    }

    // Gather distinct types for filter pills
    const typeSet = new Set(clFiles.map(f => f.fileType));
    const types = ['all', ...Array.from(typeSet).sort()];

    const canDelete = (f) => {
        if (!currentUser) return false;
        return currentUser.uid === f.uploadedByUid || currentUser.uid === CLASS_LIBRARY_ADMIN_UID;
    };

    // Build HTML
    let html = `<div class="cl-view">`;

    // Header bar with search + filter
    html += `
    <div class="cl-toolbar">
        <div class="cl-search-bar">
            <svg class="cl-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="cl-search-input" id="clSearchInput" placeholder="Search shared files…" value="${esc(clSearchQuery)}" autocomplete="off">
        </div>
        <div class="cl-filters" id="clFilters">
            ${types.map(t => `<button class="cl-filter-pill ${clTypeFilter === t ? 'cl-filter-active' : ''}" data-type="${t}">${t === 'all' ? 'All' : clGetBadgeLabel(t)}</button>`).join('')}
        </div>
        <div class="cl-stats">
            <span class="cl-stats-count">${filtered.length} file${filtered.length !== 1 ? 's' : ''} shared</span>
            <span class="cl-stats-total">${clFiles.length} total</span>
        </div>
    </div>`;

    // Files grid
    if (!filtered.length) {
        html += `
        <div class="cl-empty">
            <div class="cl-empty-icon">
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
            </div>
            <p class="cl-empty-title">No shared files${clSearchQuery ? ' matching your search' : ' yet'}</p>
            <p class="cl-empty-sub">${clSearchQuery ? 'Try a different search term.' : 'Upload a file and toggle "Share to Class Library" to get started.'}</p>
        </div>`;
    } else {
        html += `<div class="cl-file-grid">`;
        filtered.forEach(f => {
            const isOwner = canDelete(f);
            html += `
            <div class="cl-file-card" data-doc-id="${f.docId}">
                <div class="cl-card-top">
                    <div class="cl-card-icon cl-icon-${f.fileType || 'binary'}">
                        ${clGetFileTypeIcon(f.fileType)}
                    </div>
                    <span class="cl-card-badge ${clGetBadgeClass(f.fileType)}">${clGetBadgeLabel(f.fileType)}</span>
                </div>
                <div class="cl-card-body">
                    <p class="cl-card-name" title="${esc(f.fileName)}">${esc(f.fileName)}</p>
                    <div class="cl-card-meta">
                        <span class="cl-card-uploader">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            ${esc(f.uploadedBy)}
                        </span>
                        <span class="cl-card-date">${clFormatDate(f.uploadedAt)}</span>
                        <span class="cl-card-size">${clFormatSize(f.size)}</span>
                    </div>
                </div>
                <div class="cl-card-actions">
                    <button class="cl-action-btn cl-preview-btn" data-doc-id="${f.docId}" title="Preview">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="cl-action-btn cl-download-btn" data-doc-id="${f.docId}" title="Download">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    ${isOwner ? `
                    <button class="cl-action-btn cl-delete-btn" data-doc-id="${f.docId}" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>` : ''}
                </div>
            </div>`;
        });
        html += `</div>`;
    }

    html += `</div>`;
    grid.innerHTML = html;

    // Wire event listeners
    clAttachListeners();
}

// ── EVENT LISTENERS ──────────────────────────────────────────
function clAttachListeners() {
    // Search
    const searchInput = document.getElementById('clSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clSearchQuery = searchInput.value;
            renderClassLibraryView();
        });
    }

    // Filter pills
    document.querySelectorAll('.cl-filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            clTypeFilter = btn.dataset.type;
            renderClassLibraryView();
        });
    });

    // Preview
    document.querySelectorAll('.cl-preview-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const file = clFiles.find(f => f.docId === btn.dataset.docId);
            if (file) clPreviewFile(file);
        });
    });

    // Download
    document.querySelectorAll('.cl-download-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const file = clFiles.find(f => f.docId === btn.dataset.docId);
            if (file) clDownloadFile(file);
        });
    });

    // Delete
    document.querySelectorAll('.cl-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const file = clFiles.find(f => f.docId === btn.dataset.docId);
            if (!file) return;
            if (!confirm(`Delete "${file.fileName}" from the Class Library?\nThis cannot be undone.`)) return;
            try {
                await firestore.collection('shared').doc(file.docId).delete();
                showToast(`"${file.fileName}" removed from Class Library`);
            } catch (err) {
                console.error('Delete shared file error:', err);
                showToast('Failed to delete — you may not have permission', 'error');
            }
        });
    });

    // Card click → preview
    document.querySelectorAll('.cl-file-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.cl-action-btn')) return;
            const file = clFiles.find(f => f.docId === card.dataset.docId);
            if (file) clPreviewFile(file);
        });
    });
}

// ── PREVIEW ──────────────────────────────────────────────────
function clPreviewFile(file) {
    // Reuse the existing file viewer modal
    const badge = document.getElementById('fileViewBadge');
    if (badge) {
        badge.textContent = clGetBadgeLabel(file.fileType);
        badge.className = `file-type-badge ${clGetBadgeClass(file.fileType)}`;
    }
    document.getElementById('fileViewTitle').textContent = file.fileName;

    // Set download button to use this file URL
    const dlBtn = document.getElementById('downloadFileBtn');
    if (dlBtn) {
        dlBtn.dataset.noteId = '';
        dlBtn.dataset.clUrl = file.fileUrl;
        dlBtn.dataset.clName = file.fileName;
        dlBtn.dataset.clMime = file.mimeType || '';
    }

    modal.open('viewFileModal');

    const ft = file.fileType;
    if (ft === 'pdf' && file.fileUrl) {
        showPanel('panelLoading');
        const frame = document.getElementById('pdfFrame');
        frame.src = file.fileUrl;
        showPanel('panelPdf');
    } else if ((ft === 'txt' || ft === 'text') && file.fileUrl) {
        showPanel('panelLoading');
        fetch(file.fileUrl)
            .then(r => r.text())
            .then(text => {
                const isMarkdown = /\.(md|markdown)$/i.test(file.fileName);
                if (isMarkdown && typeof marked !== 'undefined') {
                    showPanel('panelMarkdown');
                    const html = marked.parse(text);
                    document.getElementById('markdownContent').innerHTML =
                        typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
                } else {
                    showPanel('panelText');
                    document.getElementById('fileContent').textContent = text;
                }
            })
            .catch(() => {
                document.getElementById('unsupportedMsg').textContent = 'Could not load file preview.';
                showPanel('panelUnsupported');
            });
    } else if (ft === 'docx' && file.fileUrl) {
        showPanel('panelLoading');
        fetch(file.fileUrl)
            .then(r => r.arrayBuffer())
            .then(buf => {
                if (typeof mammoth !== 'undefined') {
                    return mammoth.convertToHtml({ arrayBuffer: buf });
                }
                throw new Error('mammoth.js not loaded');
            })
            .then(result => {
                showPanel('panelDocx');
                const html = result.value;
                document.getElementById('docxContent').innerHTML =
                    typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
            })
            .catch(() => {
                document.getElementById('unsupportedMsg').textContent = 'Could not preview DOCX — click Download instead.';
                showPanel('panelUnsupported');
            });
    } else {
        document.getElementById('unsupportedMsg').textContent = `"${file.fileName}" — download to open locally.`;
        showPanel('panelUnsupported');
    }
}

// ── DOWNLOAD ─────────────────────────────────────────────────
async function clDownloadFile(file) {
    if (!file || !file.fileUrl) {
        showToast('No file URL available', 'error');
        return;
    }
    try {
        const res = await fetch(file.fileUrl);
        const blob = await res.blob();
        const typedBlob = new Blob([blob], { type: file.mimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(typedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast(`Downloading ${file.fileName}`, 'info');
    } catch (err) {
        // Fallback to direct link
        const a = document.createElement('a');
        a.href = file.fileUrl;
        a.download = file.fileName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

// ── SHARE TO CLASS LIBRARY (called during upload) ────────────
async function shareFileToClassLibrary(file, cloudinaryUrl, fileKind, mimeType) {
    if (!currentUser) return;

    const docData = {
        fileId: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        fileName: file.name,
        fileUrl: cloudinaryUrl,
        fileType: fileKind,
        mimeType: mimeType || file.type || 'application/octet-stream',
        uploadedBy: currentUser.displayName || currentUser.email || 'Anonymous',
        uploadedByUid: currentUser.uid,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
        folderId: null,
        folderName: null,
        size: file.size || 0,
        pinned: false
    };

    try {
        await firestore.collection('shared').add(docData);
    } catch (err) {
        console.error('Failed to share to Class Library:', err);
        showToast('File uploaded but sharing to Class Library failed', 'error');
    }
}

// ── DOWNLOAD FROM VIEWER (override for class library files) ──
// Patch the existing download button to handle class library files
(function patchDownloadBtn() {
    // Wait for DOM ready
    const patchIt = () => {
        const dlBtn = document.getElementById('downloadFileBtn');
        if (!dlBtn) return;

        const origHandler = dlBtn.onclick;
        dlBtn.addEventListener('click', function (e) {
            // If this is a class library file (no noteId but has clUrl)
            const clUrl = this.dataset.clUrl;
            const clName = this.dataset.clName;
            if (clUrl && !this.dataset.noteId) {
                e.stopImmediatePropagation();
                const file = { fileUrl: clUrl, fileName: clName, mimeType: this.dataset.clMime };
                clDownloadFile(file);
                return false;
            }
        }, true); // capture phase to run before existing handler
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchIt);
    } else {
        setTimeout(patchIt, 100);
    }
})();

// ── INIT ─────────────────────────────────────────────────────
(function initClassLibrary() {
    // Start listener when auth state changes (handled via toggleClassLibraryNav)
    // Also hook into the view changes
    const origSetView = window.setView;
    if (typeof origSetView === 'function') {
        window.setView = function (view) {
            origSetView(view);
            if (view === 'classLibrary' && currentUser && !clUnsubscribe) {
                startClassLibraryListener();
            }
        };
    }

    // Hook into auth state to start/stop listener
    auth.onAuthStateChanged(user => {
        if (user) {
            toggleClassLibraryNav(true);
            startClassLibraryListener();
        } else {
            toggleClassLibraryNav(false);
            stopClassLibraryListener();
            clFiles = [];
            clLoading = true;
            clError = null;
        }
    });
})();
