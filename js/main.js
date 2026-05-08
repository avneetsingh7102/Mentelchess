// ===================================================================
// main.js — Mental Chess Frontend Controller
// Neural Network Edition
//
// Integrates with FastAPI backend for AI moves, with local fallback.
// ===================================================================

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_BASE = 'http://localhost:8000';
let backendAvailable = false;

// Supabase Configuration
// TODO: Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize Supabase only if credentials are provided (not placeholders)
let supabase = null;
if (SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let currentUser = null;

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------
let game = null;          // chess.js instance (local state mirror)
let engine = null;        // local ChessEngine fallback
let voice = null;         // VoiceController
let moveParser = null;    // MoveParser
let currentDifficulty = 'intermediate';
let moveHistory = [];
let sessionId = null;
let isVoiceMuted = false;

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------
const els = {
    diffScreen: () => document.getElementById('difficulty-screen'),
    gameScreen: () => document.getElementById('game-screen'),
    currentDifficulty: () => document.getElementById('current-difficulty'),
    modeBadge: () => document.getElementById('mode-badge'),
    statusDot: () => document.getElementById('listening-status'),
    statusText: () => document.getElementById('status-text'),
    recognizedText: () => document.getElementById('recognized-text'),
    lastSpoken: () => document.getElementById('last-spoken'),
    aiFeedback: () => document.getElementById('ai-feedback'),
    aiMessage: () => document.getElementById('ai-message'),
    aiConfidence: () => document.getElementById('ai-confidence'),
    boardContainer: () => document.getElementById('board-container'),
    chessBoard: () => document.getElementById('chess-board'),
    moveHistoryDiv: () => document.getElementById('move-history'),
    pttBtn: () => document.getElementById('ptt-btn'),
    startBtn: () => document.getElementById('start-btn'),
    stopBtn: () => document.getElementById('stop-btn'),
    showBoardBtn: () => document.getElementById('show-board-btn'),
    newGameBtn: () => document.getElementById('new-game-btn'),
    waveform: () => document.getElementById('voice-waveform'),
    backendDot: () => document.getElementById('backend-dot'),
    backendStatusText: () => document.getElementById('backend-status-text'),
    // Auth Elements
    btnLogin: () => document.getElementById('btn-login'),
    btnLogout: () => document.getElementById('btn-logout'),
    userProfile: () => document.getElementById('user-profile'),
    userName: () => document.getElementById('user-name')
};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    checkBackendHealth();
    setupDifficultySelection();
    setupVoiceToggles();
    setupAuth();
});

function setupAuth() {
    if (!supabase) return; // Skip if Supabase is not configured

    const btnLogin = els.btnLogin();
    const btnLogout = els.btnLogout();

    if (btnLogin) {
        btnLogin.addEventListener('click', async () => {
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
            });
            if (error) console.error("Error signing in:", error.message);
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            const { error } = await supabase.auth.signOut();
            if (error) console.error("Error signing out:", error.message);
        });
    }

    // Listen for auth state changes
    supabase.auth.onAuthStateChange((event, session) => {
        currentUser = session ? session.user : null;
        updateAuthUI();
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
        currentUser = session ? session.user : null;
        updateAuthUI();
    });
}

function updateAuthUI() {
    const btnLogin = els.btnLogin();
    const userProfile = els.userProfile();
    const userName = els.userName();

    if (currentUser) {
        if (btnLogin) btnLogin.classList.add('hidden');
        if (userProfile) userProfile.classList.remove('hidden');
        if (userName) userName.textContent = currentUser.user_metadata.full_name || currentUser.email.split('@')[0];
    } else {
        if (btnLogin) btnLogin.classList.remove('hidden');
        if (userProfile) userProfile.classList.add('hidden');
    }
}

function setupVoiceToggles() {
    const toggleVoice = () => {
        isVoiceMuted = !isVoiceMuted;
        const iconStr = isVoiceMuted ? 'volume_off' : 'volume_up';
        
        const diffBtn = document.querySelector('#voice-toggle-diff .material-symbols-outlined');
        if (diffBtn) diffBtn.textContent = iconStr;
        
        const gameBtn = document.querySelector('#voice-toggle-game .material-symbols-outlined');
        if (gameBtn) gameBtn.textContent = iconStr;
        
        if (voice) {
            voice.isMuted = isVoiceMuted;
            if (isVoiceMuted) voice.synthesis.cancel();
        }
    };
    
    document.getElementById('voice-toggle-diff')?.addEventListener('click', toggleVoice);
    document.getElementById('voice-toggle-game')?.addEventListener('click', toggleVoice);
}

async function checkBackendHealth() {
    try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        backendAvailable = data.status === 'ok';

        const dot = els.backendDot();
        const text = els.backendStatusText();
        if (backendAvailable) {
            dot.classList.add('connected');
            dot.classList.remove('disconnected');
            text.textContent = data.model_loaded
                ? 'Neural engine connected'
                : 'Backend connected (no model — using fallback AI)';
        } else {
            throw new Error('bad status');
        }
    } catch (e) {
        backendAvailable = false;
        const dot = els.backendDot();
        const text = els.backendStatusText();
        if (dot) {
            dot.classList.add('disconnected');
            dot.classList.remove('connected');
        }
        if (text) text.textContent = 'Neural engine offline — using local AI';
    }
}

function setupDifficultySelection() {
    document.querySelectorAll('.difficulty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDifficulty = btn.dataset.level;
            startNewGame();
        });
    });
}

async function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (currentUser && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    return headers;
}

// ---------------------------------------------------------------------------
// Game Lifecycle
// ---------------------------------------------------------------------------

async function startNewGame() {
    // Init local chess.js
    game = new Chess();
    engine = new ChessEngine(currentDifficulty);
    engine.game = game;
    moveParser = new MoveParser(game);
    window.moveParser = moveParser;
    moveHistory = [];

    // Init voice controller
    voice = new VoiceController();
    voice.isMuted = isVoiceMuted;
    voice.setMoveCallback(handleMove);
    voice.setCommandCallback(handleCommand);
    voice.setQueryCallback(handleQuery);

    // Try to start a backend session
    if (backendAvailable) {
        try {
            const headers = await getAuthHeaders();
            
            const res = await fetch(`${API_BASE}/new_game`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({}),
            });
            const data = await res.json();
            sessionId = data.session_id;
        } catch (e) {
            console.warn('Backend session failed, using local AI:', e);
            backendAvailable = false;
            sessionId = null;
        }
    }


    // Switch screens
    els.diffScreen().classList.remove('active');
    els.gameScreen().classList.add('active');

    // Update UI
    els.currentDifficulty().textContent = currentDifficulty.toUpperCase();
    updateBoard();

    // Button handlers
    els.startBtn().onclick = startListening;
    els.stopBtn().onclick = stopListening;
    els.showBoardBtn().onclick = toggleBoard;
    els.newGameBtn().onclick = () => {
        if (confirm('Start a new game?')) {
            els.gameScreen().classList.remove('active');
            els.diffScreen().classList.add('active');
            if (voice) voice.stopListening();
        }
    };

    // Push-to-talk
    setupPushToTalk();

    // Welcome
    voice.speak(
        `Welcome to Mental Chess. You are playing as White at ${currentDifficulty} level. ` +
        (backendAvailable ? 'Neural engine active.' : 'Using local AI.') +
        ' Press Start or hold the microphone to speak.'
    );
}

function startListening() {
    els.startBtn().disabled = true;
    els.stopBtn().disabled = false;
    voice.startListening();
    updateStatus('Listening...', true);
    els.waveform().classList.add('active');
    voice.speak('Listening. Make your move.');
}

function stopListening() {
    els.startBtn().disabled = false;
    els.stopBtn().disabled = true;
    voice.stopListening();
    updateStatus('Stopped', false);
    els.waveform().classList.remove('active');
}

function setupPushToTalk() {
    const pttBtn = els.pttBtn();
    if (!pttBtn) return;

    let pttActive = false;

    const startPTT = (e) => {
        e.preventDefault();
        if (!pttActive) {
            pttActive = true;
            pttBtn.classList.add('active');
            els.waveform().classList.add('active');
            voice.startListening();
            updateStatus('Listening...', true);
        }
    };

    const stopPTT = (e) => {
        e.preventDefault();
        if (pttActive) {
            pttActive = false;
            pttBtn.classList.remove('active');
            els.waveform().classList.remove('active');
            // Small delay to capture last recognition result
            setTimeout(() => {
                voice.stopListening();
                updateStatus('Ready', false);
            }, 300);
        }
    };

    pttBtn.addEventListener('mousedown', startPTT);
    pttBtn.addEventListener('mouseup', stopPTT);
    pttBtn.addEventListener('mouseleave', stopPTT);
    pttBtn.addEventListener('touchstart', startPTT, { passive: false });
    pttBtn.addEventListener('touchend', stopPTT, { passive: false });

    // Spacebar push-to-talk
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            startPTT(e);
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            stopPTT(e);
        }
    });
}

// ---------------------------------------------------------------------------
// Move Handling
// ---------------------------------------------------------------------------

async function handleMove(parsed) {
    const moveStr = parsed.move || parsed.san;

    if (backendAvailable && sessionId) {
        await handleMoveViaBackend(moveStr);
    } else {
        handleMoveLocally(moveStr);
    }
}

async function handleMoveViaBackend(moveStr) {
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_BASE}/move`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ session_id: sessionId, move: moveStr }),
        });

        if (!res.ok) {
            const err = await res.json();
            voice.speak(err.detail || 'That move is illegal. Try again.');
            addMoveToHistory(moveStr, 'invalid');
            return;
        }

        const data = await res.json();

        // Sync local game state
        game.load(data.fen);

        // Player move feedback
        addMoveToHistory(data.player_move_san, 'valid');
        voice.speak(`You played ${data.player_move_san}`);
        updateBoard();

        if (data.game_over) {
            handleGameOver(data.game_result);
            return;
        }

        // AI response
        if (data.ai_move_san) {
            addMoveToHistory(data.ai_move_san, 'valid', true);
            showAIFeedback(data.ai_move_description || data.ai_move_san, data.ai_confidence);
            voice.speak(`I played ${data.ai_move_description || data.ai_move_san}`);
            updateBoard();

            if (data.game_over) {
                handleGameOver(data.game_result);
            }
        }
    } catch (e) {
        console.error('Backend move error:', e);
        voice.speak('Connection error. Falling back to local AI.');
        backendAvailable = false;
        handleMoveLocally(moveStr);
    }
}

function handleMoveLocally(moveStr) {
    try {
        const move = game.move(moveStr);
        if (move) {
            addMoveToHistory(move.san, 'valid');
            voice.speak(`You played ${move.san}`);
            updateBoard();

            if (game.game_over()) {
                handleGameOver();
                return;
            }

            setTimeout(() => makeLocalAIMove(), 500);
        }
    } catch (e) {
        voice.speak('That move is illegal. Try again.');
        addMoveToHistory(moveStr, 'invalid');
    }
}

function makeLocalAIMove() {
    const aiMove = engine.getBestMove();
    if (aiMove) {
        const move = game.move(aiMove);
        addMoveToHistory(move.san, 'valid', true);
        voice.speak(`I played ${move.san}`);
        updateBoard();

        if (game.game_over()) {
            handleGameOver();
        }
    }
}

// ---------------------------------------------------------------------------
// Commands & Queries
// ---------------------------------------------------------------------------

async function handleCommand(parsed) {
    const cmd = parsed.command;

    if (cmd === 'undo') {
        if (backendAvailable && sessionId) {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/undo?session_id=${sessionId}`, { 
                    method: 'POST',
                    headers: headers
                });
                const data = await res.json();
                game.load(data.fen);
                moveHistory = moveHistory.slice(0, -data.moves_undone);
                updateMoveHistory();
                updateBoard();
                voice.speak(data.message);
            } catch (e) {
                // Local fallback
                if (game.history().length >= 2) {
                    game.undo(); game.undo();
                    moveHistory = moveHistory.slice(0, -2);
                    updateMoveHistory();
                    updateBoard();
                    voice.speak('Last move undone.');
                }
            }
        } else {
            if (game.history().length >= 2) {
                game.undo(); game.undo();
                moveHistory = moveHistory.slice(0, -2);
                updateMoveHistory();
                updateBoard();
                voice.speak('Last move undone.');
            } else {
                voice.speak('No moves to undo.');
            }
        }
    } else if (cmd === 'show_board') {
        showBoard();
    } else if (cmd === 'hide_board') {
        hideBoard();
    } else if (cmd === 'resign') {
        voice.speak('You resigned. Black wins.');
        stopListening();
    }
}

async function handleQuery(parsed) {
    const query = parsed.query;

    if (query === 'where') {
        if (backendAvailable && sessionId) {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/state?session_id=${sessionId}`, { headers });
                const data = await res.json();
                const whitePieces = data.piece_summary.white.join(', ');
                voice.speak(`Your pieces: ${whitePieces}`);
                return;
            } catch (e) { /* fallback below */ }
        }
        speakPieceLocation(parsed.piece);
    } else if (query === 'read_board') {
        if (backendAvailable && sessionId) {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/state?session_id=${sessionId}`, { headers });
                const data = await res.json();
                voice.speak(`White: ${data.piece_summary.white.join(', ')}. Black: ${data.piece_summary.black.join(', ')}.`);
                return;
            } catch (e) { /* fallback below */ }
        }
        readBoard();
    } else if (query === 'history') {
        speakMoveHistory();
    } else if (query === 'hint') {
        if (backendAvailable && sessionId) {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/hint?session_id=${sessionId}`, { headers });
                const data = await res.json();
                voice.speak(`I suggest ${data.description}. Confidence: ${Math.round(data.confidence * 100)}%.`);
                showAIFeedback(`Hint: ${data.description}`, data.confidence);
                return;
            } catch (e) { /* fallback below */ }
        }
        const hint = engine.getHint();
        voice.speak(hint ? `I suggest ${hint}` : 'No hints available.');
    }
}

// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------

function showAIFeedback(message, confidence) {
    const fb = els.aiFeedback();
    if (!fb) return;
    fb.style.display = 'flex';
    fb.style.animation = 'none';
    fb.offsetHeight; // trigger reflow
    fb.style.animation = '';
    els.aiMessage().textContent = message;
    if (confidence != null) {
        els.aiConfidence().textContent = `${Math.round(confidence * 100)}%`;
    } else {
        els.aiConfidence().textContent = '';
    }
}

function toggleBoard() {
    const container = els.boardContainer();
    const btn = els.showBoardBtn();
    if (container.classList.contains('board-hidden')) {
        showBoard();
        btn.innerHTML = '🙈 Hide Board';
    } else {
        hideBoard();
        btn.innerHTML = '👁 Show Board';
    }
}

function showBoard() {
    els.boardContainer().classList.remove('board-hidden');
    const badge = els.modeBadge();
    if (badge) badge.innerHTML = '<span class="mode-icon">👁</span> Visual Mode';
    voice.speak('Board revealed.');
}

function hideBoard() {
    els.boardContainer().classList.add('board-hidden');
    const badge = els.modeBadge();
    if (badge) badge.innerHTML = '<span class="mode-icon">🧠</span> Mental Mode';
    voice.speak('Board hidden.');
}

function handleGameOver(resultText) {
    stopListening();

    if (resultText) {
        voice.speak(resultText);
    } else if (game.in_checkmate()) {
        const winner = game.turn() === 'w' ? 'Black' : 'White';
        voice.speak(`Checkmate! ${winner} wins!`);
    } else if (game.in_draw()) {
        voice.speak('Game drawn.');
    } else if (game.in_stalemate()) {
        voice.speak('Stalemate. Game is a draw.');
    }
}

function updateBoard() {
    const boardDiv = els.chessBoard();
    if (!boardDiv) return;
    boardDiv.innerHTML = '';

    const board = game.board();
    const pieceUnicode = {
        'wp': '♙', 'wn': '♘', 'wb': '♗', 'wr': '♖', 'wq': '♕', 'wk': '♔',
        'bp': '♟', 'bn': '♞', 'bb': '♝', 'br': '♜', 'bq': '♛', 'bk': '♚'
    };

    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const square = document.createElement('div');
            square.className = 'square ' + ((i + j) % 2 === 0 ? 'light' : 'dark');
            
            const piece = board[i][j];
            if (piece) {
                const pieceSpan = document.createElement('span');
                pieceSpan.className = 'piece';
                pieceSpan.textContent = pieceUnicode[piece.color + piece.type];
                square.appendChild(pieceSpan);
            }

            // Square coordinate overlay (e.g., A8, E4)
            const coordSpan = document.createElement('span');
            coordSpan.className = 'square-coord';
            coordSpan.textContent = String.fromCharCode(97 + j) + (8 - i);
            square.appendChild(coordSpan);

            boardDiv.appendChild(square);
        }
    }
}

function addMoveToHistory(move, status, isAI = false) {
    moveHistory.push({ move, status, isAI });
    updateMoveHistory();
}

function updateMoveHistory() {
    const historyDiv = els.moveHistoryDiv();
    if (!historyDiv) return;
    historyDiv.innerHTML = '';

    moveHistory.forEach((entry, index) => {
        const moveDiv = document.createElement('div');
        moveDiv.className = `move-entry ${entry.status}`;
        const player = entry.isAI ? '♚ AI' : '♔ You';
        moveDiv.innerHTML = `
            <span>${Math.floor(index / 2) + 1}. ${player}:</span>
            <span>${entry.move}</span>
        `;
        historyDiv.appendChild(moveDiv);
    });

    historyDiv.scrollTop = historyDiv.scrollHeight;
}

function updateStatus(text, listening) {
    const statusText = els.statusText();
    const dot = els.statusDot();
    if (statusText) statusText.textContent = text;
    if (dot) {
        if (listening) dot.classList.add('listening');
        else dot.classList.remove('listening');
    }
}

// Legacy piece queries (fallback when backend is unavailable)
function speakPieceLocation(pieceName) {
    const board = game.board();
    const locations = [];
    const pieceSymbol = {
        'pawn': 'p', 'knight': 'n', 'night': 'n',
        'bishop': 'b', 'rook': 'r', 'queen': 'q', 'king': 'k'
    }[pieceName];

    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const piece = board[i][j];
            if (piece && piece.type === pieceSymbol && piece.color === 'w') {
                locations.push(String.fromCharCode(97 + j) + (8 - i));
            }
        }
    }

    if (locations.length === 0) {
        voice.speak(`You don't have a ${pieceName}.`);
    } else if (locations.length === 1) {
        voice.speak(`Your ${pieceName} is on ${locations[0]}`);
    } else {
        voice.speak(`You have ${pieceName}s on ${locations.join(' and ')}`);
    }
}

function readBoard() {
    const board = game.board();
    const whitePieces = [], blackPieces = [];
    const pieceNames = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const piece = board[i][j];
            if (piece) {
                const square = String.fromCharCode(97 + j) + (8 - i);
                const name = pieceNames[piece.type];
                if (piece.color === 'w') whitePieces.push(`${name} ${square}`);
                else blackPieces.push(`${name} ${square}`);
            }
        }
    }

    voice.speak(`White pieces: ${whitePieces.join(', ')}. Black pieces: ${blackPieces.join(', ')}.`);
}

function speakMoveHistory() {
    const history = game.history();
    const last5 = history.slice(-5);
    if (last5.length === 0) voice.speak('No moves yet.');
    else voice.speak(`Last moves: ${last5.join(', ')}`);
}

// Expose to global scope for voice controller
function updateRecognizedText(text) {
    const el = els.recognizedText();
    if (el) el.textContent = text;
}

function updateLastSpoken(text) {
    const el = els.lastSpoken();
    if (el) el.textContent = `🔊 ${text}`;
}

window.updateRecognizedText = updateRecognizedText;
window.updateLastSpoken = updateLastSpoken;
window.moveParser = null; // Set after game init
