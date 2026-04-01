/* ============================================================
   STUDYVAULT — Gemini AI Agent  (geminiAgent.js)
   ============================================================
   STEP 1: Paste your free Gemini API key below.
   Get one free at: https://aistudio.google.com → Get API Key
   No credit card needed. 500 requests/day on free tier.
   ============================================================ */

// ── GEMINI API KEY LOGIC ──────────────────────────────────────
function getGeminiKey() {
    let key = localStorage.getItem('sv_gemini_api_key');
    if (!key) {
        key = prompt('Please enter your Gemini API Key to use the AI features:\n(Get a free key at https://aistudio.google.com)');
        if (key && key.trim()) {
            localStorage.setItem('sv_gemini_api_key', key.trim());
        } else {
            throw new Error('API key missing. Please provide a Gemini API Key to use StudyVault AI.');
        }
    }
    return key.trim();
}

function promptForGeminiKey() {
    const existing = localStorage.getItem('sv_gemini_api_key') || '';
    const newKey = prompt('Enter your Gemini API Key:', existing);
    if (newKey !== null && newKey.trim() !== '') {
        localStorage.setItem('sv_gemini_api_key', newKey.trim());
        alert('Gemini API Key saved successfully!');
    } else if (newKey === '') {
        localStorage.removeItem('sv_gemini_api_key');
        alert('Gemini API Key removed.');
    }
}

// Attach event listener for the new API KEY button in index.html
document.addEventListener('DOMContentLoaded', () => {
    const setApiKeyBtn = document.getElementById('setApiKeyBtn');
    if (setApiKeyBtn) {
        setApiKeyBtn.addEventListener('click', promptForGeminiKey);
    }
});

function getGeminiUrl() {
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;
}

// In-memory caches so we don't re-extract or re-summarise the same file twice
const _contentCache = new Map(); // noteId → plain text string
const _summaryCache = new Map(); // noteId → summary string

// ── TEXT HELPERS ──────────────────────────────────────────────

// Strips HTML tags from docx content (stored as HTML in Firestore by mammoth)
function _stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
}

// Extracts plain text from a PDF blob using pdf.js (loaded via CDN)
async function _extractPdfText(blob) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('pdf.js is not loaded. Make sure the pdfjs script tag is in index.html.');
    }

    // Point pdf.js worker at the CDN copy
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str || '').join(' ');
        if (text.trim()) pages.push(`[Page ${i}]\n${text.trim()}`);
    }

    return pages.join('\n\n');
}

// ── CONTENT EXTRACTION ────────────────────────────────────────

// Returns the plain text content of a note, cached after first call.
// Handles PDF (Cloudinary URL), DOCX (HTML in Firestore), and plain-text files.
async function extractNoteText(note) {
    if (_contentCache.has(note.id)) return _contentCache.get(note.id);

    let text = '';

    if (note.fileKind === 'pdf' && note.storageRef) {
        // Fetch PDF from Cloudinary and extract text with pdf.js
        const res = await fetch(note.storageRef);
        if (!res.ok) throw new Error(`Could not load PDF file (HTTP ${res.status}). Try refreshing.`);
        const blob = await res.blob();
        text = await _extractPdfText(blob);

    } else if (note.fileKind === 'docx' && note.content) {
        // Docx stored as HTML → strip tags for plain text
        text = _stripHtml(note.content);

    } else if (note.content) {
        // TXT / MD / JSON / code files stored as plain text
        text = String(note.content);

    } else {
        throw new Error('This file has no readable content. It may not have uploaded correctly.');
    }

    const trimmed = text.trim().slice(0, 100000); // cap at ~100k chars to stay within limits
    if (!trimmed) throw new Error('The file appears empty or has no extractable text.');

    _contentCache.set(note.id, trimmed);
    return trimmed;
}

// ── GEMINI API CALL ───────────────────────────────────────────

// Sends a request to the Gemini REST API and returns the response text.
async function _callGemini(systemPrompt, contents) {
    const res = await fetch(getGeminiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
        })
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Gemini API error (status ${res.status})`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned an empty response. Please try again.');
    return text.trim();
}

// Builds the grounding system prompt — constrains Gemini to only use the provided file
function _buildSystemPrompt(noteName, fileText) {
    return [
        'You are StudyVault AI, a focused and friendly study assistant.',
        `The student is asking questions about a file named: "${noteName}"`,
        'IMPORTANT: Answer ONLY using the SOURCE MATERIAL below. Do not use outside knowledge.',
        "If the answer is not in the source, say exactly: \"I couldn't find that in this file.\"",
        'Keep answers clear, concise, and student-friendly. Use bullet points for lists.',
        '',
        '=== SOURCE MATERIAL ===',
        fileText,
        '=== END OF SOURCE MATERIAL ==='
    ].join('\n');
}

// Converts the local chatHistory array into the Gemini API contents format
function _buildContents(chatHistory, newQuestion) {
    const contents = chatHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));
    contents.push({ role: 'user', parts: [{ text: newQuestion }] });
    return contents;
}

// ── GLOBAL AI TOOLS (NEW) ─────────────────────────────────────
const GEMINI_TOOLS = [
    {
        functionDeclarations: [
            {
                name: "searchFiles",
                description: "Search for files in the user's StudyVault by name or keyword. Returns a list of files with their IDs.",
                parameters: {
                    type: "OBJECT",
                    properties: { query: { type: "STRING", description: "The search query" } },
                    required: ["query"]
                }
            },
            {
                name: "readFile",
                description: "Reads a file and returns its raw text content so you can answer questions about it.",
                parameters: {
                    type: "OBJECT",
                    properties: { noteId: { type: "STRING", description: "The ID of the file to read" } },
                    required: ["noteId"]
                }
            },
            {
                name: "openFile",
                description: "Opens a file in the user's screen in the UI.",
                parameters: {
                    type: "OBJECT",
                    properties: { noteId: { type: "STRING", description: "The ID of the file to open" } },
                    required: ["noteId"]
                }
            },
            {
                name: "searchGoogle",
                description: "Searches Google by opening a Google Search tab for the user. Use this when the user explicitly asks you to search the web or google something.",
                parameters: {
                    type: "OBJECT",
                    properties: { query: { type: "STRING", description: "The search query" } },
                    required: ["query"]
                }
            }
        ]
    }
];

async function _handleFunctionCall(fc) {
    const { name, args } = fc;
    try {
        if (name === 'searchFiles') {
            if (typeof db === 'undefined') return { success: false, error: 'Database not available' };
            const results = db.search(args.query);
            const files = results.notes.map(n => ({ id: n.id, name: n.name, type: n.fileKind, size: n.size }));
            return { success: true, files };
        } else if (name === 'readFile') {
            if (typeof db === 'undefined') return { success: false, error: 'Database not available' };
            const note = db.findNoteById(args.noteId);
            if (!note) return { success: false, error: 'File not found' };
            const text = await extractNoteText(note);
            return { success: true, text: text.substring(0, 30000) }; 
        } else if (name === 'openFile') {
            if (typeof db === 'undefined') return { success: false, error: 'Database not available' };
            const note = db.findNoteById(args.noteId);
            if (!note) return { success: false, error: 'File not found' };
            viewFile(note);
            return { success: true, message: `File ${note.name} opened in UI.` };
        } else if (name === 'searchGoogle') {
            if (typeof window !== 'undefined') {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`, '_blank');
            }
            return { success: true, message: `Successfully opened Google Search for "${args.query}" in a new tab.` };
        }
        return { success: false, error: 'Unknown function' };
    } catch(err) {
        return { success: false, error: err.message };
    }
}

async function _callGeminiWithTools(systemPrompt, userContents, statusCallback) {
    let contents = [...userContents];

    // Loop up to 10 times to resolve function calls
    for (let i = 0; i < 10; i++) {
        const payload = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            tools: GEMINI_TOOLS,
            generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
        };

        const res = await fetch(getGeminiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `Gemini API error (status ${res.status})`);
        }

        const data = await res.json();
        const part = data?.candidates?.[0]?.content?.parts?.[0];

        if (!part) throw new Error('Gemini returned an empty response.');

        if (part.functionCall) {
            const fc = part.functionCall;
            if (statusCallback) statusCallback(`Using tool: ${fc.name}...`);
            const funcResult = await _handleFunctionCall(fc);

            // Add model's call & our response to history
            contents.push({ role: 'model', parts: [{ functionCall: fc }] });
            contents.push({ role: 'function', parts: [{ functionResponse: { name: fc.name, response: funcResult } }] });

            if (statusCallback) statusCallback('Thinking...');
        } else if (part.text) {
            return part.text.trim();
        } else {
            return "Done."; // Should not reach here for textual responses
        }
    }
    throw new Error('Gemini reached maximum number of tool calls.');
}

function _buildGlobalSystemPrompt() {
    return [
        'You are StudyVault AI, an advanced, highly capable academic digital assistant.',
        'You have full command over this website and the user\'s vault.',
        'You can use tools to search for files, read their contents, and open files for the user.',
        'If the user asks a question about their files, search for them and read them!',
        'If the user asks you to open a file, use the openFile tool.',
        'If the user explicitly asks you to search the web or Google, use the searchGoogle tool to launch a search tab for them.',
        'Answer general knowledge questions directly using your massive internal knowledge base without searching.',
        'Be extremely friendly, concise, and helpful.'
    ].join('\n');
}

// ── PUBLIC FUNCTIONS ──────────────────────────────────────────

// Generates a structured summary shown when the chat panel first opens.
// Result is cached so Gemini is only called once per file per session.
async function generateSummary(note) {
    if (_summaryCache.has(note.id)) return _summaryCache.get(note.id);

    const fileText = await extractNoteText(note);
    const systemPrompt = _buildSystemPrompt(note.name, fileText);

    const question = [
        'Give me a structured overview of this study file using this exact format:',
        '',
        '📋 WHAT THIS FILE IS ABOUT',
        '(2–3 sentences)',
        '',
        '📌 KEY TOPICS COVERED',
        '• list each topic',
        '',
        '💡 KEY TERMS OR CONCEPTS',
        '• list key definitions or ideas',
        '',
        '❓ WHAT THIS FILE DOES NOT COVER',
        '(1 line)',
        '',
        'Use only the file content. Do not add outside information.'
    ].join('\n');

    const contents = _buildContents([], question);
    const summary = await _callGemini(systemPrompt, contents);

    _summaryCache.set(note.id, summary);
    return summary;
}

// Answers a question about a note, keeping multi-turn memory via chatHistory.
// chatHistory is an array of {role: 'user'|'assistant', content: string} objects.
async function askQuestion(note, chatHistory, question) {
    const fileText = await extractNoteText(note);
    const systemPrompt = _buildSystemPrompt(note.name, fileText);
    const contents = _buildContents(chatHistory, question);
    return await _callGemini(systemPrompt, contents);
}

// Answers a question globally without a specific note tied to it, supports tools.
async function askGlobalQuestion(chatHistory, question, statusCallback) {
    const systemPrompt = _buildGlobalSystemPrompt();
    const contents = _buildContents(chatHistory, question);
    return await _callGeminiWithTools(systemPrompt, contents, statusCallback);
}

// Clears cached content and summary for one note (call if the file is re-uploaded)
function clearNoteCache(noteId) {
    _contentCache.delete(noteId);
    _summaryCache.delete(noteId);
}
