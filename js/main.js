// ===================================================================
// main.js — Mental Chess Frontend Controller
// ===================================================================

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '';

let backendAvailable = false;

// Supabase (disabled until credentials are provided)
let supabase = null;
let currentUser = null;

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------
var currentDifficulty = 'intermediate';
var game = null;
var engine = null;
var voice = null;
var moveParser = null;
var moveHistory = [];
var sessionId = null;
var isVoiceMuted = false;

// ---------------------------------------------------------------------------
// DOM Helpers
// ---------------------------------------------------------------------------
const els = {
    diffScreen:       () => document.getElementById('difficulty-screen'),
    gameScreen:       () => document.getElementById('game-screen'),
    currentDifficulty:() => document.getElementById('current-difficulty'),
    modeBadge:        () => document.getElementById('mode-badge'),
    statusDot:        () => document.getElementById('listening-status'),
    statusText:       () => document.getElementById('status-text'),
    recognizedText:   () => document.getElementById('recognized-text'),
    lastSpoken:       () => document.getElementById('last-spoken'),
    aiFeedback:       () => document.getElementById('ai-feedback'),
    aiMessage:        () => document.getElementById('ai-message'),
    aiConfidence:     () => document.getElementById('ai-confidence'),
    boardContainer:   () => document.getElementById('board-container'),
    chessBoard:       () => document.getElementById('chess-board'),
    moveHistoryDiv:   () => document.getElementById('move-history'),
    pttBtn:           () => document.getElementById('ptt-btn'),
    startBtn:         () => document.getElementById('start-btn'),
    stopBtn:          () => document.getElementById('stop-btn'),
    showBoardBtn:     () => document.getElementById('show-board-btn'),
    newGameBtn:       () => document.getElementById('new-game-btn'),
    waveform:         () => document.getElementById('voice-waveform'),
    backendDot:       () => document.getElementById('backend-dot'),
    backendStatusText:() => document.getElementById('backend-status-text'),
    btnLogin:         () => document.getElementById('btn-login'),
    btnLogout:        () => document.getElementById('btn-logout'),
    userProfile:      () => document.getElementById('user-profile'),
    userName:         () => document.getElementById('user-name')
};

// ---------------------------------------------------------------------------
// GLOBAL entry point called from HTML buttons via onclick="selectDifficulty(...)"
// ---------------------------------------------------------------------------
window.selectDifficulty = function(level) {
    currentDifficulty = level;
    startNewGame();
};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
function initApp() {
    checkBackendHealth();
    setupDifficultySelection();
    setupVoiceToggles();
}

// Run init as soon as DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// ---------------------------------------------------------------------------
// Backend Health
// ---------------------------------------------------------------------------
async function checkBackendHealth() {
    const dot = els.backendDot();
    const text = els.backendStatusText();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(API_BASE + '/health', { signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json();
        backendAvailable = data.status === 'ok';
        if (dot) { dot.classList.add('connected'); dot.classList.remove('disconnected'); }
        if (text) text.textContent = data.model_loaded
            ? 'Neural engine connected'
            : 'Backend connected (no model — using fallback AI)';
    } catch (e) {
        backendAvailable = false;
        if (dot) { dot.classList.add('disconnected'); dot.classList.remove('connected'); }
        if (text) text.textContent = 'Neural engine offline — using local AI';
    }
}

// ---------------------------------------------------------------------------
// Difficulty Selection
// ---------------------------------------------------------------------------
function setupDifficultySelection() {
    document.querySelectorAll('.difficulty-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            currentDifficulty = btn.dataset.level;
            startNewGame();
        });
    });
}

// ---------------------------------------------------------------------------
// Voice Toggles
// ---------------------------------------------------------------------------
function setupVoiceToggles() {
    function toggleVoice() {
        isVoiceMuted = !isVoiceMuted;
        var iconStr = isVoiceMuted ? 'volume_off' : 'volume_up';
        var diffBtn = document.querySelector('#voice-toggle-diff .material-symbols-outlined');
        if (diffBtn) diffBtn.textContent = iconStr;
        var gameBtn = document.querySelector('#voice-toggle-game .material-symbols-outlined');
        if (gameBtn) gameBtn.textContent = iconStr;
        if (voice) {
            voice.isMuted = isVoiceMuted;
            if (isVoiceMuted) voice.synthesis.cancel();
        }
    }
    var d = document.getElementById('voice-toggle-diff');
    if (d) d.addEventListener('click', toggleVoice);
    var g = document.getElementById('voice-toggle-game');
    if (g) g.addEventListener('click', toggleVoice);
}

// ---------------------------------------------------------------------------
// Game Lifecycle
// ---------------------------------------------------------------------------
async function startNewGame() {
    game = new Chess();
    engine = new ChessEngine(currentDifficulty);
    engine.game = game;
    moveParser = new MoveParser(game);
    window.moveParser = moveParser;
    moveHistory = [];

    voice = new VoiceController();
    voice.isMuted = isVoiceMuted;
    voice.setMoveCallback(handleMove);
    voice.setCommandCallback(handleCommand);
    voice.setQueryCallback(handleQuery);

    if (backendAvailable) {
        try {
            const res = await fetch(API_BASE + '/new_game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
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
    var diffScreen = els.diffScreen();
    var gameScreen = els.gameScreen();
    if (diffScreen) diffScreen.classList.remove('active');
    if (gameScreen) gameScreen.classList.add('active');

    var diffEl = els.currentDifficulty();
    if (diffEl) diffEl.textContent = currentDifficulty.toUpperCase();
    updateBoard();

    var startBtn = els.startBtn();
    var stopBtn = els.stopBtn();
    var showBoardBtn = els.showBoardBtn();
    var newGameBtn = els.newGameBtn();

    if (startBtn) startBtn.onclick = startListening;
    if (stopBtn) stopBtn.onclick = stopListening;
    if (showBoardBtn) showBoardBtn.onclick = toggleBoard;
    if (newGameBtn) newGameBtn.onclick = function() {
        if (confirm('Start a new game?')) {
            if (gameScreen) gameScreen.classList.remove('active');
            if (diffScreen) diffScreen.classList.add('active');
            if (voice) voice.stopListening();
        }
    };

    setupPushToTalk();

    voice.speak(
        'Welcome to Mental Chess. You are playing as White at ' + currentDifficulty + ' level. ' +
        (backendAvailable ? 'Neural engine active.' : 'Using local AI.') +
        ' Press Start or hold the microphone to speak.'
    );
}

function startListening() {
    var startBtn = els.startBtn(); if (startBtn) startBtn.disabled = true;
    var stopBtn = els.stopBtn(); if (stopBtn) stopBtn.disabled = false;
    voice.startListening();
    updateStatus('Listening...', true);
    var waveform = els.waveform(); if (waveform) waveform.classList.add('active');
    voice.speak('Listening. Make your move.');
}

function stopListening() {
    var startBtn = els.startBtn(); if (startBtn) startBtn.disabled = false;
    var stopBtn = els.stopBtn(); if (stopBtn) stopBtn.disabled = true;
    voice.stopListening();
    updateStatus('Stopped', false);
    var waveform = els.waveform(); if (waveform) waveform.classList.remove('active');
}

function setupPushToTalk() {
    var pttBtn = els.pttBtn();
    if (!pttBtn) return;
    var pttActive = false;

    function startPTT(e) {
        e.preventDefault();
        if (!pttActive) {
            pttActive = true;
            pttBtn.classList.add('active');
            var waveform = els.waveform(); if (waveform) waveform.classList.add('active');
            voice.startListening();
            updateStatus('Listening...', true);
        }
    }
    function stopPTT(e) {
        e.preventDefault();
        if (pttActive) {
            pttActive = false;
            pttBtn.classList.remove('active');
            var waveform = els.waveform(); if (waveform) waveform.classList.remove('active');
            setTimeout(function() { voice.stopListening(); updateStatus('Ready', false); }, 300);
        }
    }

    pttBtn.addEventListener('mousedown', startPTT);
    pttBtn.addEventListener('mouseup', stopPTT);
    pttBtn.addEventListener('mouseleave', stopPTT);
    pttBtn.addEventListener('touchstart', startPTT, { passive: false });
    pttBtn.addEventListener('touchend', stopPTT, { passive: false });

    document.addEventListener('keydown', function(e) {
        if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault(); startPTT(e);
        }
    });
    document.addEventListener('keyup', function(e) {
        if (e.code === 'Space') { e.preventDefault(); stopPTT(e); }
    });
}

// ---------------------------------------------------------------------------
// Move Handling
// ---------------------------------------------------------------------------
async function handleMove(parsed) {
    var moveStr = parsed.move || parsed.san;
    if (backendAvailable && sessionId) {
        await handleMoveViaBackend(moveStr);
    } else {
        handleMoveLocally(moveStr);
    }
}

async function handleMoveViaBackend(moveStr) {
    try {
        const res = await fetch(API_BASE + '/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, move: moveStr })
        });
        if (!res.ok) {
            const err = await res.json();
            voice.speak(err.detail || 'That move is illegal. Try again.');
            addMoveToHistory(moveStr, 'invalid');
            return;
        }
        const data = await res.json();
        game.load(data.fen);
        addMoveToHistory(data.player_move_san, 'valid');
        voice.speak('You played ' + data.player_move_san);
        updateBoard();

        if (data.game_over) { handleGameOver(data.result_text); return; }

        if (data.ai_move_san) {
            addMoveToHistory(data.ai_move_san, 'valid', true);
            showAIFeedback(data.ai_message || ('AI played ' + data.ai_move_san), data.ai_confidence);
            voice.speak('AI plays ' + data.ai_move_san + (data.ai_message ? '. ' + data.ai_message : ''));
            updateBoard();
            if (data.game_over_after_ai) handleGameOver(data.result_text_after_ai);
        }
    } catch (e) {
        console.error('Backend move error:', e);
        handleMoveLocally(moveStr);
    }
}

function handleMoveLocally(moveStr) {
    var result = game.move(moveStr) || game.move({ from: moveStr.slice(0,2), to: moveStr.slice(2,4), promotion: 'q' });
    if (!result) {
        voice.speak('That move is illegal. Try again.');
        addMoveToHistory(moveStr, 'invalid');
        return;
    }
    addMoveToHistory(result.san, 'valid');
    voice.speak('You played ' + result.san);
    updateBoard();

    if (game.game_over()) { handleGameOver(null); return; }

    var aiMove = engine.getBestMove();
    if (aiMove) {
        var aiResult = game.move(aiMove);
        if (aiResult) {
            addMoveToHistory(aiResult.san, 'valid', true);
            voice.speak('AI plays ' + aiResult.san);
            showAIFeedback('AI played ' + aiResult.san, null);
            updateBoard();
            if (game.game_over()) handleGameOver(null);
        }
    }
}

// ---------------------------------------------------------------------------
// Command & Query Handling
// ---------------------------------------------------------------------------
async function handleCommand(command) {
    if (command === 'new game') {
        var diffScreen = els.diffScreen();
        var gameScreen = els.gameScreen();
        if (gameScreen) gameScreen.classList.remove('active');
        if (diffScreen) diffScreen.classList.add('active');
        if (voice) voice.stopListening();
    } else if (command === 'show board') {
        showBoard();
    } else if (command === 'hide board') {
        hideBoard();
    } else if (command === 'resign') {
        voice.speak('You resigned. Game over.');
        handleGameOver('You resigned.');
    }
}

async function handleQuery(query) {
    if (query === 'board' || query === 'position') {
        if (backendAvailable && sessionId) {
            try {
                const res = await fetch(API_BASE + '/board?session_id=' + sessionId);
                const data = await res.json();
                voice.speak(data.description);
                return;
            } catch(e) { /* fallback */ }
        }
        readBoard();
    } else if (query === 'history') {
        speakMoveHistory();
    } else if (query === 'hint') {
        if (backendAvailable && sessionId) {
            try {
                const res = await fetch(API_BASE + '/hint?session_id=' + sessionId);
                const data = await res.json();
                voice.speak('I suggest ' + data.description + '. Confidence: ' + Math.round(data.confidence * 100) + '%.');
                showAIFeedback('Hint: ' + data.description, data.confidence);
                return;
            } catch(e) { /* fallback */ }
        }
        var hint = engine.getHint();
        voice.speak(hint ? 'I suggest ' + hint : 'No hints available.');
    }
}

// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------
function showAIFeedback(message, confidence) {
    var fb = els.aiFeedback(); if (!fb) return;
    fb.style.display = 'flex';
    fb.style.animation = 'none';
    fb.offsetHeight;
    fb.style.animation = '';
    var aiMsg = els.aiMessage(); if (aiMsg) aiMsg.textContent = message;
    var aiConf = els.aiConfidence();
    if (aiConf) aiConf.textContent = confidence != null ? Math.round(confidence * 100) + '%' : '';
}

function toggleBoard() {
    var container = els.boardContainer();
    var btn = els.showBoardBtn();
    if (container.classList.contains('board-hidden')) {
        showBoard(); if (btn) btn.innerHTML = '🙈 Hide Board';
    } else {
        hideBoard(); if (btn) btn.innerHTML = '👁 Show Board';
    }
}

function showBoard() {
    var bc = els.boardContainer(); if (bc) bc.classList.remove('board-hidden');
    var badge = els.modeBadge(); if (badge) badge.innerHTML = '<span class="mode-icon">👁</span> Visual Mode';
    if (voice) voice.speak('Board revealed.');
}

function hideBoard() {
    var bc = els.boardContainer(); if (bc) bc.classList.add('board-hidden');
    var badge = els.modeBadge(); if (badge) badge.innerHTML = '<span class="mode-icon">🧠</span> Mental Mode';
    if (voice) voice.speak('Board hidden.');
}

function handleGameOver(resultText) {
    stopListening();
    if (resultText) {
        voice.speak(resultText);
    } else if (game.in_checkmate()) {
        var winner = game.turn() === 'w' ? 'Black' : 'White';
        voice.speak('Checkmate! ' + winner + ' wins!');
    } else if (game.in_draw()) {
        voice.speak('Game drawn.');
    } else if (game.in_stalemate()) {
        voice.speak('Stalemate. Game is a draw.');
    }
}

function updateBoard() {
    var boardDiv = els.chessBoard(); if (!boardDiv) return;
    boardDiv.innerHTML = '';
    var board = game.board();
    var pieceUnicode = {
        'wp':'♙','wn':'♘','wb':'♗','wr':'♖','wq':'♕','wk':'♔',
        'bp':'♟','bn':'♞','bb':'♝','br':'♜','bq':'♛','bk':'♚'
    };
    for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
            var square = document.createElement('div');
            square.className = 'square ' + ((i + j) % 2 === 0 ? 'light' : 'dark');
            var piece = board[i][j];
            if (piece) {
                var pieceSpan = document.createElement('span');
                pieceSpan.className = 'piece';
                pieceSpan.textContent = pieceUnicode[piece.color + piece.type];
                square.appendChild(pieceSpan);
            }
            var coordSpan = document.createElement('span');
            coordSpan.className = 'square-coord';
            coordSpan.textContent = String.fromCharCode(97 + j) + (8 - i);
            square.appendChild(coordSpan);
            boardDiv.appendChild(square);
        }
    }
}

function addMoveToHistory(move, status, isAI) {
    isAI = isAI || false;
    moveHistory.push({ move: move, status: status, isAI: isAI });
    updateMoveHistory();
}

function updateMoveHistory() {
    var historyDiv = els.moveHistoryDiv(); if (!historyDiv) return;
    historyDiv.innerHTML = '';
    moveHistory.forEach(function(entry, index) {
        var moveDiv = document.createElement('div');
        moveDiv.className = 'move-entry ' + entry.status;
        var player = entry.isAI ? '♚ AI' : '♔ You';
        moveDiv.innerHTML = '<span>' + (Math.floor(index/2)+1) + '. ' + player + ':</span><span>' + entry.move + '</span>';
        historyDiv.appendChild(moveDiv);
    });
    historyDiv.scrollTop = historyDiv.scrollHeight;
}

function updateStatus(text, listening) {
    var statusText = els.statusText(); if (statusText) statusText.textContent = text;
    var dot = els.statusDot();
    if (dot) { if (listening) dot.classList.add('listening'); else dot.classList.remove('listening'); }
}

function speakPieceLocation(pieceName) {
    var board = game.board();
    var locations = [];
    var pieceSymbol = { 'pawn':'p','knight':'n','night':'n','bishop':'b','rook':'r','queen':'q','king':'k' }[pieceName];
    for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
            var piece = board[i][j];
            if (piece && piece.type === pieceSymbol && piece.color === 'w')
                locations.push(String.fromCharCode(97+j)+(8-i));
        }
    }
    if (locations.length === 0) voice.speak("You don't have a " + pieceName + '.');
    else if (locations.length === 1) voice.speak('Your ' + pieceName + ' is on ' + locations[0]);
    else voice.speak('You have ' + pieceName + 's on ' + locations.join(' and '));
}

function readBoard() {
    var board = game.board();
    var whitePieces = [], blackPieces = [];
    var pieceNames = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' };
    for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
            var piece = board[i][j];
            if (piece) {
                var sq = String.fromCharCode(97+j)+(8-i);
                var name = pieceNames[piece.type];
                if (piece.color === 'w') whitePieces.push(name+' '+sq);
                else blackPieces.push(name+' '+sq);
            }
        }
    }
    voice.speak('White pieces: ' + whitePieces.join(', ') + '. Black pieces: ' + blackPieces.join(', ') + '.');
}

function speakMoveHistory() {
    var history = game.history();
    var last5 = history.slice(-5);
    if (last5.length === 0) voice.speak('No moves yet.');
    else voice.speak('Last moves: ' + last5.join(', '));
}

// Expose helpers for voice controller
window.updateRecognizedText = function(text) {
    var el = els.recognizedText(); if (el) el.textContent = text;
};
window.updateLastSpoken = function(text) {
    var el = els.lastSpoken(); if (el) el.textContent = '🔊 ' + text;
};
window.moveParser = null;
