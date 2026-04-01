/* ============================================================
   STUDYVAULT — AI Chat Panel  (chatPanel.js)
   ============================================================
   Injects the "Ask AI" button onto every file card and manages
   the sliding chat panel UI. No existing files are modified.
   Requires: geminiAgent.js loaded before this file.
   ============================================================ */

(function () {
    'use strict';

    // ── STATE ─────────────────────────────────────────────────
    let activeNote    = null;          // the note currently open in the panel
    let chatHistory   = [];            // [{role, content}] for current session
    let isBusy        = false;         // prevents double-sends
    let panelInjected = false;         // panel DOM created only once

    // ── CSS ───────────────────────────────────────────────────

    // Injects all panel styles once into <head>
    function injectStyles() {
        if (document.getElementById('sv-ai-styles')) return;

        const css = `
        /* ── Ask AI Button ─────────────────────────────────── */
        .sv-ask-ai-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.04em;
            border: 1px solid rgba(201,168,76,0.45);
            border-radius: 7px;
            background: rgba(201,168,76,0.10);
            color: #c9a84c;
            cursor: pointer;
            transition: background 0.18s, border-color 0.18s, transform 0.12s;
            white-space: nowrap;
            line-height: 1;
        }
        .sv-ask-ai-btn:hover {
            background: rgba(201,168,76,0.20);
            border-color: rgba(201,168,76,0.75);
            transform: translateY(-1px);
        }
        .sv-ask-ai-btn:active { transform: translateY(0); }
        .sv-ask-ai-btn svg { flex-shrink: 0; }

        /* ── Panel Backdrop ────────────────────────────────── */
        #sv-ai-backdrop {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 1200;
            backdrop-filter: blur(1px);
            animation: svFadeIn 0.2s ease;
        }
        #sv-ai-backdrop.open { display: block; }

        /* ── Panel Shell ────────────────────────────────────── */
        #sv-ai-panel {
            position: fixed;
            top: 0; right: 0;
            width: min(480px, 100vw);
            height: 100vh;
            background: var(--surface, #111009);
            border-left: 1px solid rgba(201,168,76,0.15);
            box-shadow: -8px 0 40px rgba(0,0,0,0.5);
            z-index: 1201;
            display: flex;
            flex-direction: column;
            transform: translateX(100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
            font-family: inherit;
        }
        #sv-ai-panel.open { transform: translateX(0); }

        /* ── Panel Header ───────────────────────────────────── */
        #sv-ai-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            padding: 18px 20px 14px;
            border-bottom: 1px solid rgba(201,168,76,0.12);
            flex-shrink: 0;
        }
        #sv-ai-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .sv-ai-agent-icon {
            width: 32px; height: 32px;
            background: linear-gradient(135deg, #c9a84c, #755b00);
            border-radius: 9px;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        .sv-ai-header-text { min-width: 0; }
        .sv-ai-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.14em;
            color: #c9a84c;
            text-transform: uppercase;
            margin-bottom: 2px;
        }
        #sv-ai-filename {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary, #e8dfc4);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 280px;
        }
        #sv-ai-close-btn {
            background: none;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 7px;
            width: 30px; height: 30px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            color: var(--text-secondary, #8a7a5a);
            flex-shrink: 0;
            transition: background 0.15s, color 0.15s;
        }
        #sv-ai-close-btn:hover { background: rgba(255,255,255,0.06); color: #e8dfc4; }

        /* ── Messages Area ──────────────────────────────────── */
        #sv-ai-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px 16px 8px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            scroll-behavior: smooth;
        }
        #sv-ai-messages::-webkit-scrollbar { width: 4px; }
        #sv-ai-messages::-webkit-scrollbar-track { background: transparent; }
        #sv-ai-messages::-webkit-scrollbar-thumb { background: rgba(201,168,76,0.2); border-radius: 4px; }

        /* ── Message Bubbles ────────────────────────────────── */
        .sv-msg { display: flex; flex-direction: column; max-width: 90%; animation: svSlideUp 0.18s ease; }
        .sv-msg--user { align-self: flex-end; align-items: flex-end; }
        .sv-msg--ai   { align-self: flex-start; align-items: flex-start; }

        .sv-msg-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            margin-bottom: 5px;
            color: var(--text-secondary, #8a7a5a);
        }
        .sv-msg--user .sv-msg-label { color: #c9a84c; }

        .sv-msg-bubble {
            padding: 11px 15px;
            border-radius: 14px;
            font-size: 13.5px;
            line-height: 1.65;
            color: var(--text-primary, #e8dfc4);
            white-space: pre-wrap;
            word-break: break-word;
        }
        .sv-msg--user .sv-msg-bubble {
            background: rgba(201,168,76,0.14);
            border: 1px solid rgba(201,168,76,0.3);
            border-bottom-right-radius: 4px;
        }
        .sv-msg--ai .sv-msg-bubble {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-bottom-left-radius: 4px;
        }
        .sv-msg--summary .sv-msg-bubble {
            background: rgba(201,168,76,0.06);
            border-color: rgba(201,168,76,0.2);
        }

        /* ── Typing Indicator ───────────────────────────────── */
        .sv-typing-indicator {
            display: flex; align-items: center; gap: 5px;
            padding: 12px 15px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            border-bottom-left-radius: 4px;
        }
        .sv-typing-dot {
            width: 6px; height: 6px;
            border-radius: 50%;
            background: #c9a84c;
            animation: svBounce 1.2s infinite;
        }
        .sv-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .sv-typing-dot:nth-child(3) { animation-delay: 0.4s; }

        /* ── Error Banner ───────────────────────────────────── */
        .sv-ai-error {
            padding: 10px 14px;
            background: rgba(220,50,50,0.1);
            border: 1px solid rgba(220,50,50,0.3);
            border-radius: 10px;
            font-size: 12.5px;
            color: #f08080;
            line-height: 1.5;
        }

        /* ── Input Footer ───────────────────────────────────── */
        #sv-ai-footer {
            padding: 14px 16px;
            border-top: 1px solid rgba(201,168,76,0.12);
            flex-shrink: 0;
        }
        .sv-ai-input-row {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }
        #sv-ai-input {
            flex: 1;
            min-height: 42px;
            max-height: 120px;
            resize: none;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(201,168,76,0.2);
            border-radius: 10px;
            padding: 10px 13px;
            font-size: 13.5px;
            font-family: inherit;
            color: var(--text-primary, #e8dfc4);
            outline: none;
            transition: border-color 0.18s;
            line-height: 1.5;
        }
        #sv-ai-input::placeholder { color: rgba(138,122,90,0.6); }
        #sv-ai-input:focus { border-color: rgba(201,168,76,0.55); }
        #sv-ai-input:disabled { opacity: 0.4; cursor: not-allowed; }

        #sv-ai-send-btn {
            width: 42px; height: 42px;
            border-radius: 10px;
            border: 1px solid rgba(201,168,76,0.4);
            background: rgba(201,168,76,0.12);
            color: #c9a84c;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
            transition: background 0.15s, transform 0.12s;
        }
        #sv-ai-send-btn:hover:not(:disabled) { background: rgba(201,168,76,0.25); }
        #sv-ai-send-btn:active:not(:disabled) { transform: scale(0.94); }
        #sv-ai-send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        .sv-ai-footer-note {
            margin-top: 7px;
            font-size: 10.5px;
            color: rgba(138,122,90,0.5);
            text-align: center;
            letter-spacing: 0.04em;
        }

        /* Light-theme overrides */
        [data-theme="light"] #sv-ai-panel {
            background: #faf8f2;
            border-left-color: rgba(117,91,0,0.15);
        }
        [data-theme="light"] .sv-msg--ai .sv-msg-bubble {
            background: #f0ece0;
            border-color: rgba(117,91,0,0.12);
        }
        [data-theme="light"] .sv-msg--user .sv-msg-bubble {
            background: rgba(201,168,76,0.12);
        }
        [data-theme="light"] #sv-ai-input {
            background: #fff;
            color: #2a2000;
            border-color: rgba(117,91,0,0.2);
        }
        [data-theme="light"] #sv-ai-filename,
        [data-theme="light"] .sv-msg-bubble { color: #2a2000; }

        /* ── Global AI FAB ──────────────────────────────────── */
        #sv-global-ai-fab {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, #c9a84c, #755b00);
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            border: 2px solid rgba(255,255,255,0.1);
            color: #1a1200;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1100;
            transition: transform 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s;
        }
        #sv-global-ai-fab:hover {
            transform: scale(1.08) translateY(-3px);
            box-shadow: 0 8px 25px rgba(201,168,76,0.4);
        }
        #sv-global-ai-fab:active {
            transform: scale(0.95);
        }
        .sv-fab-hidden {
            display: none !important;
        }

        /* ── Typing Status Text ─────────────────────────────── */
        .sv-typing-status-text {
            font-size: 11px;
            color: rgba(201,168,76,0.8);
            margin-top: 4px;
            margin-left: 4px;
            font-style: italic;
        }

        /* ── Animations ─────────────────────────────────────── */
        @keyframes svFadeIn   { from { opacity: 0; } to { opacity: 1; } }
        @keyframes svSlideUp  { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
        @keyframes svBounce   {
            0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
            40%            { transform: scale(1.1); opacity: 1; }
        }
        `;

        const style = document.createElement('style');
        style.id = 'sv-ai-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ── PANEL DOM ─────────────────────────────────────────────

    // Creates the panel HTML and appends it to <body> (only called once)
    function createPanel() {
        if (panelInjected) return;
        panelInjected = true;

        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'sv-ai-backdrop';
        backdrop.addEventListener('click', closePanel);

        // Panel
        const panel = document.createElement('div');
        panel.id = 'sv-ai-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'AI Study Assistant');

        panel.innerHTML = `
        <div id="sv-ai-header">
            <div id="sv-ai-header-left">
                <div class="sv-ai-agent-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1200" stroke-width="2.5" stroke-linecap="round">
                        <path d="M12 2l2 5.5L19 9l-5 2.5L12 17l-2-5.5L5 9l5-2.5L12 2z"/>
                        <path d="M5 17l1 2.5 2.5 1L6 21.5 5 24l-1-2.5L1.5 20.5 4 19.5 5 17z"/>
                        <path d="M19 17l1 2.5 2.5 1-2.5 1L19 24l-1-2.5-2.5-1 2.5-1L19 17z"/>
                    </svg>
                </div>
                <div class="sv-ai-header-text">
                    <div class="sv-ai-label">Study Agent</div>
                    <div id="sv-ai-filename">Select a file</div>
                </div>
            </div>
            <button id="sv-ai-close-btn" aria-label="Close AI panel" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>

        <div id="sv-ai-messages"></div>

        <div id="sv-ai-footer">
            <div class="sv-ai-input-row">
                <textarea
                    id="sv-ai-input"
                    rows="1"
                    placeholder="Ask about this file…"
                    disabled
                ></textarea>
                <button id="sv-ai-send-btn" disabled aria-label="Send">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                </button>
            </div>
            <p class="sv-ai-footer-note">Powered by Gemini 2.5 Flash · System Controls Active</p>
        </div>`;

        // Create the Global FAB as well
        const fab = document.createElement('button');
        fab.id = 'sv-global-ai-fab';
        fab.title = 'Ask StudyVault Assistant';
        fab.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 2l2 5.5L19 9l-5 2.5L12 17l-2-5.5L5 9l5-2.5L12 2z"/>
                <path d="M5 17l1 2.5 2.5 1L6 21.5 5 24l-1-2.5L1.5 20.5 4 19.5 5 17z"/>
            </svg>
        `;
        fab.addEventListener('click', () => openPanel(null)); 

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        document.body.appendChild(fab);

        // Wire up close button
        document.getElementById('sv-ai-close-btn').addEventListener('click', closePanel);

        // Wire up send button
        document.getElementById('sv-ai-send-btn').addEventListener('click', handleSend);

        // Wire up Enter key (Shift+Enter for newline)
        document.getElementById('sv-ai-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        // Auto-resize textarea as user types
        document.getElementById('sv-ai-input').addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // Close on Escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && document.getElementById('sv-ai-panel').classList.contains('open')) {
                closePanel();
            }
        });
    }

    // ── PANEL OPEN / CLOSE ────────────────────────────────────

    // Opens the chat panel for a specific note, or global chat if note is null
    async function openPanel(note = null) {
        createPanel();
        injectStyles();

        activeNote  = note;
        chatHistory = [];
        isBusy      = false;

        // Update header
        const filenameEl = document.getElementById('sv-ai-filename');
        if (note) {
            filenameEl.textContent = note.name || 'Untitled';
        } else {
            filenameEl.textContent = 'Global Vault Assistant';
        }

        // Clear messages and show panel
        const messagesEl = document.getElementById('sv-ai-messages');
        messagesEl.innerHTML = '';

        document.getElementById('sv-ai-backdrop').classList.add('open');
        document.getElementById('sv-ai-panel').classList.add('open');
        document.body.style.overflow = 'hidden';
        
        // Hide FAB while panel is open
        const fab = document.getElementById('sv-global-ai-fab');
        if (fab) fab.classList.add('sv-fab-hidden');

        // Disable input while loading
        setInputEnabled(false);

        const historyId = note ? note.id : 'global_chat';
        const historyName = note ? note.name : 'Global Chat';

        // Try to load saved chat history from Firestore first
        const saved = await loadChatHistory(historyId);
        if (saved && saved.messages && saved.messages.length > 0) {
            chatHistory = saved.messages;
            chatHistory.forEach(msg => {
                appendBubble(msg.role, msg.content, msg.isSummary || false);
            });
            setInputEnabled(true);
            scrollToBottom();
            return;
        }

        // No saved history
        if (note) {
            appendTypingIndicator('Reading file...');
            try {
                const summary = await generateSummary(note); // from geminiAgent.js
                removeTypingIndicator();
                appendBubble('assistant', summary, true);
                chatHistory.push({ role: 'assistant', content: summary, isSummary: true });
                await saveChatHistory(historyId, historyName, chatHistory);
            } catch (err) {
                removeTypingIndicator();
                appendError(err.message);
            }
        } else {
            // Global chat opening message
            const greeting = "Hello! I am your StudyVault Assistant. I have full command over your website. I can search for your files, open them, read their contents, or answer any general questions via Google. How can I help you today?";
            appendBubble('assistant', greeting, true);
            chatHistory.push({ role: 'assistant', content: greeting, isSummary: true });
        }

        // Setup input correctly for global
        const inputEl = document.getElementById('sv-ai-input');
        if (inputEl) {
            inputEl.placeholder = note ? "Ask about this file..." : "Ask me to search files, open them, or read them...";
        }

        setInputEnabled(true);
        scrollToBottom();
    }

    // Closes the panel and resets state
    function closePanel() {
        const panel    = document.getElementById('sv-ai-panel');
        const backdrop = document.getElementById('sv-ai-backdrop');
        const fab      = document.getElementById('sv-global-ai-fab');
        if (!panel) return;
        panel.classList.remove('open');
        backdrop.classList.remove('open');
        if (fab) fab.classList.remove('sv-fab-hidden');
        document.body.style.overflow = '';
        activeNote  = null;
        chatHistory = [];
        isBusy      = false;
    }

    // ── SEND MESSAGE ──────────────────────────────────────────

    // Handles sending a user message and displaying the AI response
    async function handleSend() {
        if (isBusy) return;

        const inputEl  = document.getElementById('sv-ai-input');
        const question = inputEl.value.trim();
        if (!question) return;

        isBusy = true;
        inputEl.value = '';
        inputEl.style.height = 'auto';
        setInputEnabled(false);

        // Show user bubble
        appendBubble('user', question);
        scrollToBottom();

        // Add to history
        chatHistory.push({ role: 'user', content: question });

        // Show typing indicator
        appendTypingIndicator('Thinking...');
        scrollToBottom();

        const historyId = activeNote ? activeNote.id : 'global_chat';
        const historyName = activeNote ? activeNote.name : 'Global Chat';

        try {
            // Only pass non-summary messages as conversation history to Gemini
            const conversationHistory = chatHistory
                .filter(m => !m.isSummary)
                .slice(0, -1); // exclude the message we just added

            const statusCallback = (msg) => updateTypingLabel(msg);

            let answer = '';
            if (activeNote) {
                answer = await askQuestion(activeNote, conversationHistory, question); // specific file scope
            } else {
                answer = await askGlobalQuestion(conversationHistory, question, statusCallback); // global scope + tools
            }
            
            removeTypingIndicator();
            appendBubble('assistant', answer);
            chatHistory.push({ role: 'assistant', content: answer });
            await saveChatHistory(historyId, historyName, chatHistory);
        } catch (err) {
            removeTypingIndicator();
            appendError(err.message);
            // Remove the failed user message from history
            chatHistory.pop();
        }

        isBusy = false;
        setInputEnabled(true);
        document.getElementById('sv-ai-input').focus();
        scrollToBottom();
    }

    // ── UI HELPERS ────────────────────────────────────────────

    // Appends a chat bubble to the messages container
    function appendBubble(role, content, isSummary = false) {
        const messagesEl = document.getElementById('sv-ai-messages');
        const div        = document.createElement('div');

        div.className = `sv-msg sv-msg--${role === 'user' ? 'user' : 'ai'}${isSummary ? ' sv-msg--summary' : ''}`;

        const label  = role === 'user' ? 'You' : (isSummary ? 'Auto Summary' : 'Study Agent');
        div.innerHTML = `
            <div class="sv-msg-label">${label}</div>
            <div class="sv-msg-bubble">${escapeHtml(content)}</div>`;

        messagesEl.appendChild(div);
    }

    // Appends a red error message
    function appendError(message) {
        const messagesEl = document.getElementById('sv-ai-messages');
        const div        = document.createElement('div');
        div.className    = 'sv-ai-error';
        div.textContent  = '⚠ ' + message;
        messagesEl.appendChild(div);
    }

    // Appends the three-dot typing animation
    function appendTypingIndicator(statusMsg = 'Thinking...') {
        removeTypingIndicator();
        const messagesEl = document.getElementById('sv-ai-messages');
        const div        = document.createElement('div');
        div.id           = 'sv-typing';
        div.className    = 'sv-msg sv-msg--ai';
        div.innerHTML    = `
            <div class="sv-msg-label">Study Agent</div>
            <div class="sv-typing-wrapper" style="display:flex; flex-direction:column;">
                <div class="sv-typing-indicator" style="align-self: flex-start; margin-bottom: 2px;">
                    <div class="sv-typing-dot"></div>
                    <div class="sv-typing-dot"></div>
                    <div class="sv-typing-dot"></div>
                </div>
                <div id="sv-typing-status" class="sv-typing-status-text">${escapeHtml(statusMsg)}</div>
            </div>`;
        messagesEl.appendChild(div);
    }

    function updateTypingLabel(statusMsg) {
        const el = document.getElementById('sv-typing-status');
        if (el) el.textContent = statusMsg;
    }

    // Removes the typing indicator if present
    function removeTypingIndicator() {
        const el = document.getElementById('sv-typing');
        if (el) el.remove();
    }

    // Enables or disables the input field and send button
    function setInputEnabled(enabled) {
        const input   = document.getElementById('sv-ai-input');
        const sendBtn = document.getElementById('sv-ai-send-btn');
        if (!input || !sendBtn) return;
        input.disabled   = !enabled;
        sendBtn.disabled = !enabled;
        if (enabled) input.focus();
    }

    // Scrolls the messages area to the bottom
    function scrollToBottom() {
        const el = document.getElementById('sv-ai-messages');
        if (el) el.scrollTop = el.scrollHeight;
    }

    // Escapes HTML for safe text display in bubbles
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '<br>');
    }

    // ── FIRESTORE PERSISTENCE ─────────────────────────────────

    // Saves chat history to Firestore under users/{uid}/aiChats/{noteId}
    // Silently skips if user is not signed in (guest mode)
    async function saveChatHistory(noteId, noteName, history) {
        try {
            if (typeof currentUser === 'undefined' || !currentUser || !currentUser.uid) return;
            if (typeof firestore === 'undefined') return;

            await firestore
                .collection('users').doc(currentUser.uid)
                .collection('aiChats').doc(noteId)
                .set({
                    noteId,
                    noteName: noteName || '',
                    messages: history.slice(-60), // keep last 60 messages
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
        } catch (err) {
            console.warn('StudyVault AI: Could not save chat history —', err.message);
        }
    }

    // Loads saved chat history from Firestore for a note
    // Returns null if no history found or user is not signed in
    async function loadChatHistory(noteId) {
        try {
            if (typeof currentUser === 'undefined' || !currentUser || !currentUser.uid) return null;
            if (typeof firestore === 'undefined') return null;

            const doc = await firestore
                .collection('users').doc(currentUser.uid)
                .collection('aiChats').doc(noteId)
                .get();

            if (doc.exists && doc.data().messages) return doc.data();
        } catch (err) {
            console.warn('StudyVault AI: Could not load chat history —', err.message);
        }
        return null;
    }

    // ── ASK AI BUTTON INJECTION ───────────────────────────────

    // Creates the "Ask AI" button element for a note card
    function createAskAIButton(noteId) {
        const btn = document.createElement('button');
        btn.className          = 'sv-ask-ai-btn';
        btn.dataset.svAiNoteId = noteId;
        btn.title              = 'Ask AI about this file';
        btn.setAttribute('aria-label', 'Ask AI about this file');
        btn.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M12 2l1.8 4.5L18.5 8l-4.7 2.2L12 15l-1.8-4.8L5.5 8l4.7-2.5L12 2z"/>
                <path d="M5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8L5 15z"/>
                <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8L19 15z"/>
            </svg>
            Ask AI`;

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();

            // Look up the note from the global db object (defined in script.js)
            if (typeof db === 'undefined') {
                alert('StudyVault: Could not find the file database. Please refresh the page.');
                return;
            }
            const note = db.findNoteById(noteId);
            if (!note) {
                alert('StudyVault: File not found. It may have been deleted.');
                return;
            }
            openPanel(note);
        });

        return btn;
    }

    // Injects Ask AI buttons into all note cards that don't already have one
    function injectAskAIButtons() {
        document.querySelectorAll('.note-card').forEach(function (card) {
            const noteId = card.dataset.noteId;
            if (!noteId) return;
            if (card.querySelector('.sv-ask-ai-btn')) return; // already injected

            const actionsEl = card.querySelector('.note-card-actions');
            if (!actionsEl) return;

            const btn = createAskAIButton(noteId);
            // Insert as first child of actions so it appears on the left
            actionsEl.insertBefore(btn, actionsEl.firstChild);
        });
    }

    // ── OBSERVER ──────────────────────────────────────────────

    // Watches for grid re-renders and re-injects Ask AI buttons each time
    function startObserver() {
        const grid = document.getElementById('folderGrid');
        if (!grid) {
            // folderGrid might not exist yet — retry in 500ms
            setTimeout(startObserver, 500);
            return;
        }

        const observer = new MutationObserver(function () {
            injectAskAIButtons();
        });

        observer.observe(grid, { childList: true, subtree: true });

        // Also run once immediately in case cards are already rendered
        injectAskAIButtons();
    }

    // ── BOOT ──────────────────────────────────────────────────

    // Wait for the DOM to be ready before doing anything
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            injectStyles();
            createPanel(); // Instantly create panel to show global FAB
            startObserver();
        });
    } else {
        injectStyles();
        createPanel(); // Instantly create panel to show global FAB
        startObserver();
    }

})();
