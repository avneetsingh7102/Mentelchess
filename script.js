/**
 * Mental Chess - Master Edition v2
 * Final Features: Accessibility, Training (Puzzle, Notation, Setup), Social, Analytics
 */

// --- Initialization ---
const game = new Chess();
const synth = window.speechSynthesis;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
const aiWorker = new Worker('ai-worker.js');

// UI Elements
const els = {
    root: document.getElementById('app-root'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnSettings: document.getElementById('btn-settings'),
    btnShare: document.getElementById('btn-share'),
    settingsPanel: document.getElementById('settings-panel'),
    shareModal: document.getElementById('share-modal'),
    closeSettings: document.getElementById('close-settings'),
    closeShare: document.getElementById('close-share'),
    moveHistory: document.getElementById('move-history'),
    statusDisplay: document.getElementById('status-display'),
    subtitleContainer: document.getElementById('subtitle-container'),
    micIndicator: document.getElementById('mic-indicator'),
    debugText: document.getElementById('debug-text'),
    board: document.getElementById('board'),
    thinking: document.getElementById('thinking-indicator'),
    qrContainer: document.getElementById('qrcode-container'),
    btnExport: document.getElementById('btn-export'),
    btnShareLink: document.getElementById('btn-share-link'),
    modeSelect: document.getElementById('mode-select')
};

// Settings Elements
const sets = {
    voice: document.getElementById('voice-select'),
    rate: document.getElementById('rate-range'),
    rateVal: document.getElementById('rate-value'),
    confirm: document.getElementById('confirm-moves'),
    autoBoard: document.getElementById('auto-show-board'),
    difficulty: document.getElementById('difficulty-select'),
    highContrast: document.getElementById('high-contrast'),
    dyslexia: document.getElementById('dyslexia-font'),
    subtitles: document.getElementById('show-subtitles')
};

// Stats & Analytics
const statsEl = {
    played: document.getElementById('stats-played'),
    wins: document.getElementById('stats-wins'),
    losses: document.getElementById('stats-losses')
};

const audio = {
    move: document.getElementById('sound-move'),
    capture: document.getElementById('sound-capture'),
    check: document.getElementById('sound-check'),
    end: document.getElementById('sound-end')
};

// State
let isGameActive = false;
let sessionState = 'idle'; // idle, playing, setup, puzzle, notation
let pendingMove = null;
let voices = [];
let userSettings = {
    voiceIndex: 0, rate: 1.0, confirmMoves: false, autoShowBoard: true,
    difficulty: 2, highContrast: false, dyslexia: false, subtitles: true, mode: 'standard'
};
let gameStats = { played: 0, wins: 0, losses: 0, illegalMoves: 0, totalMoves: 0, moveTimes: [] };
let moveStartTime = 0;
let isAIBookPhase = true;
let currentPuzzle = null;
let notationTarget = "";

// --- Core Helpers ---

function speak(text, callback) {
    synth.cancel();
    if (userSettings.subtitles) {
        els.subtitleContainer.textContent = text;
        els.subtitleContainer.style.display = 'block';
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (voices[userSettings.voiceIndex]) utterance.voice = voices[userSettings.voiceIndex];
    utterance.rate = userSettings.rate;
    if (callback) utterance.onend = callback;
    synth.speak(utterance);
}

function playSound(type) {
    if (audio[type]) {
        audio[type].currentTime = 0;
        audio[type].play().catch(() => {});
    }
}

// --- Accessibility & Settings ---

function applyAccessibility() {
    document.body.classList.toggle('high-contrast', userSettings.highContrast);
    document.body.classList.toggle('dyslexic', userSettings.dyslexia);
    document.body.classList.toggle('show-subs', userSettings.subtitles);
}

function saveSettings() {
    userSettings.rate = parseFloat(sets.rate.value);
    userSettings.confirmMoves = sets.confirm.checked;
    userSettings.autoShowBoard = sets.autoBoard.checked;
    userSettings.difficulty = parseInt(sets.difficulty.value);
    userSettings.highContrast = sets.highContrast.checked;
    userSettings.dyslexia = sets.dyslexia.checked;
    userSettings.subtitles = sets.subtitles.checked;
    userSettings.mode = els.modeSelect.value;
    localStorage.setItem('mentalChessMasterSettings', JSON.stringify(userSettings));
    applyAccessibility();
}

function loadAll() {
    const s = localStorage.getItem('mentalChessMasterSettings');
    if (s) {
        Object.assign(userSettings, JSON.parse(s));
        sets.rate.value = userSettings.rate;
        sets.rateVal.textContent = userSettings.rate.toFixed(1);
        sets.confirm.checked = userSettings.confirmMoves;
        sets.autoBoard.checked = userSettings.autoShowBoard;
        sets.difficulty.value = userSettings.difficulty;
        sets.highContrast.checked = userSettings.highContrast;
        sets.dyslexia.checked = userSettings.dyslexia;
        sets.subtitles.checked = userSettings.subtitles;
        els.modeSelect.value = userSettings.mode;
        applyAccessibility();
    }
    const st = localStorage.getItem('mentalChessStats');
    if (st) {
        Object.assign(gameStats, JSON.parse(st));
        statsEl.played.textContent = gameStats.played;
        statsEl.wins.textContent = gameStats.wins;
        statsEl.losses.textContent = gameStats.losses;
    }
}

// --- UI & Rendering ---

function renderBoard(highlightSq = null) {
    els.board.innerHTML = '';
    const board = game.board();
    const pieces = {
        'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
        'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
    };
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const sqId = String.fromCharCode(97 + j) + (8 - i);
            const sq = document.createElement('div');
            sq.className = `square ${(i + j) % 2 === 0 ? 'white' : 'black'}`;
            if (sqId === highlightSq) sq.style.boxShadow = "inset 0 0 20px #e74c3c";
            const p = board[i][j];
            if (p) sq.textContent = pieces[p.color === 'w' ? p.type.toUpperCase() : p.type];
            els.board.appendChild(sq);
        }
    }
}

function updateHistoryUI() {
    els.moveHistory.innerHTML = '';
    game.history().forEach((m, i) => {
        const d = document.createElement('div');
        d.className = 'move-entry';
        d.innerHTML = `<strong>${i % 2 === 0 ? 'W' : 'B'}:</strong> ${m}`;
        els.moveHistory.appendChild(d);
    });
    els.moveHistory.scrollTop = els.moveHistory.scrollHeight;
}

// --- Training Modes ---

function startPuzzle() {
    currentPuzzle = CHESS_PUZZLES[Math.floor(Math.random() * CHESS_PUZZLES.length)];
    game.load(currentPuzzle.fen);
    renderBoard();
    updateHistoryUI();
    speak(currentPuzzle.instruction);
    els.statusDisplay.textContent = "Puzzle Mode: " + currentPuzzle.instruction;
    sessionState = 'puzzle';
    isGameActive = true;
    try { recognition.start(); } catch (e) {}
}

function startNotationTrainer() {
    game.clear();
    const files = ['a','b','c','d','e','f','g','h'];
    const ranks = ['1','2','3','4','5','6','7','8'];
    notationTarget = files[Math.floor(Math.random()*8)] + ranks[Math.floor(Math.random()*8)];
    els.board.style.display = 'grid';
    renderBoard(notationTarget);
    speak("Speak the coordinates of the highlighted square.");
    els.statusDisplay.textContent = "Notation Trainer: Speak the square!";
    sessionState = 'notation';
    isGameActive = true;
    try { recognition.start(); } catch (e) {}
}

function handlePositionSetup(text) {
    // Format: "white king e1, black king e8, white rook a1"
    const parts = text.split(',');
    game.clear();
    let success = true;
    parts.forEach(p => {
        const match = p.trim().match(/(white|black)\s*(king|queen|rook|bishop|knight|pawn)\s*([a-h][1-8])/i);
        if (match) {
            const color = match[1].toLowerCase() === 'white' ? 'w' : 'b';
            const type = match[2].toLowerCase() === 'knight' ? 'n' : match[2].toLowerCase()[0];
            const sq = match[3];
            if (!game.put({ type, color }, sq)) success = false;
        }
    });
    if (success && game.validate_fen(game.fen()).valid) {
        speak("Position set. Let's play.");
        renderBoard();
        sessionState = 'playing';
    } else {
        speak("Invalid position setup. Try again.");
    }
}

// --- Game Logic ---

function makeAIMove() {
    if (game.game_over()) return;
    els.thinking.style.display = 'inline';
    if (isAIBookPhase && userSettings.difficulty > 1) {
        const hist = game.history().join(' ');
        const book = CHESS_OPENINGS[hist];
        if (book) {
            const m = book[Math.floor(Math.random() * book.length)];
            const app = game.move(m);
            if (app) { finishAIMove(app); return; }
        }
        isAIBookPhase = false;
    }
    aiWorker.postMessage({
        action: 'search',
        fen: game.fen(),
        depth: { 1: 1, 2: 2, 3: 3, 4: 4 }[userSettings.difficulty],
        timeLimit: 3000
    });
}

aiWorker.onmessage = (e) => {
    if (e.data.action === 'searchResult') {
        const m = game.move(e.data.move);
        finishAIMove(m);
    } else if (e.data.action === 'evalResult') {
        speak(e.data.pieces <= 5 ? (Math.abs(e.data.score) < 50 ? "Drawn." : (e.data.score > 0 ? "White wins." : "Black wins.")) : "Think deeper.");
    }
};

function finishAIMove(move) {
    els.thinking.style.display = 'none';
    if (move.san.includes('+')) { playSound('check'); speak("Check!"); }
    else if (move.captured) playSound('capture');
    else playSound('move');
    updateHistoryUI(); renderBoard();
    if (game.game_over()) handleGameOver();
    else {
        const diff = userSettings.difficulty;
        const total = game.history().length;
        const freq = { 1: 1, 2: 2, 3: 5, 4: 999 }[diff];
        if (total % (freq * 2) === 0 || diff === 1) speak(`Black plays ${move.san}`);
        else speak("Black has moved.");
    }
}

function handleGameOver(res = false) {
    isGameActive = false; sessionState = 'idle';
    els.micIndicator.classList.remove('active');
    playSound('end');
    gameStats.played++;
    if (res || (game.in_checkmate() && game.turn() === 'w')) gameStats.losses++;
    else if (game.in_checkmate()) gameStats.wins++;
    saveStats();
    speak((res ? "Resigned. Black wins." : (game.in_checkmate() ? "Checkmate!" : "Draw.")) + " New game?");
    recognition.stop();
}

function saveStats() {
    localStorage.setItem('mentalChessStats', JSON.stringify(gameStats));
    statsEl.played.textContent = gameStats.played;
    statsEl.wins.textContent = gameStats.wins;
    statsEl.losses.textContent = gameStats.losses;
}

// --- Commands ---

function handleCommand(t) {
    const text = t.toLowerCase().trim();
    if (sessionState === 'puzzle') {
        if (text === currentPuzzle.solution.toLowerCase() || text === sanitize(currentPuzzle.solution).toLowerCase()) {
            speak("Correct! Well done."); sessionState = 'idle'; return true;
        } else if (text === 'hint') { speak(currentPuzzle.hint); return true; }
        else if (text === 'give up') { speak("The solution was " + currentPuzzle.solution); sessionState = 'idle'; return true; }
    }
    if (sessionState === 'notation') {
        if (text === notationTarget) { speak("Correct!"); setTimeout(startNotationTrainer, 1000); return true; }
        else { speak("Wrong. That was " + notationTarget); setTimeout(startNotationTrainer, 1500); return true; }
    }
    if (text.startsWith('set up position')) { handlePositionSetup(text.replace('set up position', '').trim()); return true; }
    if (text === 'hint' || text === 'h') { aiWorker.postMessage({ action: 'evaluate', fen: game.fen() }); return true; }
    if (text === 'show board' || text === 's') { els.board.style.display = 'grid'; speak("Shown."); return true; }
    if (text === 'hide board') { els.board.style.display = 'none'; speak("Hidden."); return true; }
    if (text === 'undo') { game.undo(); game.undo(); updateHistoryUI(); renderBoard(); speak("Undone."); return true; }
    if (text === 'new game' || text === 'n') { start(); return true; }
    if (text === 'i resign' || text === 'resign') { handleGameOver(true); return true; }
    if (text === 'stats' || text === 'weekly report') {
        const avg = gameStats.moveTimes.length ? (gameStats.moveTimes.reduce((a,b)=>a+b)/gameStats.moveTimes.length/1000).toFixed(1) : 0;
        speak(`Stats: ${gameStats.wins} wins. Average move time: ${avg} seconds. Illegal move rate: ${((gameStats.illegalMoves/Math.max(1, gameStats.totalMoves))*100).toFixed(1)} percent.`);
        return true;
    }
    return false;
}

function sanitize(t) {
    let m = t.toLowerCase().replace(/knight/g,'N').replace(/bishop/g,'B').replace(/rook/g,'R').replace(/queen/g,'Q').replace(/king/g,'K').replace(/\s/g,'');
    const maps = { 'for':'4','tea':'d','see':'c','sea':'c','eight':'8','one':'1','two':'2','three':'3' };
    for (const [k, v] of Object.entries(maps)) m = m.replace(new RegExp(k, 'g'), v);
    return m;
}

function apply(m) {
    const timeTaken = Date.now() - moveStartTime;
    gameStats.moveTimes.push(timeTaken);
    gameStats.totalMoves++;
    game.move(m.san);
    processMoveEffect(m);
    updateHistoryUI(); renderBoard();
    if (game.game_over()) handleGameOver();
    else { speak(`Played ${m.san}`); setTimeout(makeAIMove, 1000); }
}

function processMoveEffect(m) {
    if (m.captured) playSound('capture');
    else if (m.san.includes('+')) playSound('check');
    else playSound('move');
}

// --- Interaction ---

function start() {
    if (userSettings.mode === 'puzzle') { startPuzzle(); return; }
    if (userSettings.mode === 'notation') { startNotationTrainer(); return; }
    game.reset(); isGameActive = true; sessionState = 'playing'; isAIBookPhase = true;
    els.micIndicator.classList.add('active');
    updateHistoryUI(); renderBoard();
    speak("Welcome. White to move.");
    try { recognition.start(); } catch (e) {}
}

els.btnStart.onclick = () => start();
els.btnStop.onclick = () => { isGameActive = false; recognition.stop(); synth.cancel(); els.micIndicator.classList.remove('active'); sessionState = 'idle'; };
els.btnSettings.onclick = () => els.settingsPanel.style.display = 'flex';
els.closeSettings.onclick = () => { els.settingsPanel.style.display = 'none'; saveSettings(); };

els.btnShare.onclick = () => {
    els.shareModal.style.display = 'flex';
    const url = window.location.href.split('#')[0] + '#' + btoa(game.fen());
    QRCode.toCanvas(els.qrContainer, url, { width: 150 });
};
els.closeShare.onclick = () => els.shareModal.style.display = 'none';
els.btnShareLink.onclick = () => {
    const url = window.location.href.split('#')[0] + '#' + btoa(game.fen());
    navigator.clipboard.writeText(url);
    alert("Link copied!");
};

window.onkeydown = (e) => {
    if (e.code === 'Space') { e.preventDefault(); isGameActive ? els.btnStop.click() : els.btnStart.click(); }
    if (e.code === 'Escape') { synth.cancel(); }
    if (e.key === 's' || e.key === 'S') { handleCommand('show board'); }
    if (e.key === 'h' || e.key === 'H') { handleCommand('hint'); }
    if (e.key === 'n' || e.key === 'N') { start(); }
};

recognition.onresult = (e) => {
    const t = e.results[e.results.length - 1][0].transcript;
    els.debugText.textContent = t;
    if (handleCommand(t)) return;
    if (sessionState !== 'playing') return;
    const s = sanitize(t);
    const m = game.moves({ verbose: true }).find(x => x.san.toLowerCase() === s || x.from + x.to === s);
    if (m) {
        if (userSettings.confirmMoves) { pendingMove = m; speak(`Confirm ${m.san}?`); }
        else apply(m);
    } else {
        gameStats.illegalMoves++;
        speak("Invalid.");
    }
};

recognition.onstart = () => { moveStartTime = Date.now(); };
recognition.onend = () => { if (isGameActive) recognition.start(); };

loadAll();
renderBoard();
if (window.location.hash) {
    try {
        const fen = atob(window.location.hash.substring(1));
        if (game.load(fen)) { renderBoard(); updateHistoryUI(); }
    } catch (e) {}
}
