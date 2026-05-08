/**
 * AI Web Worker for Mental Chess
 * Handles heavy computation for minimax search and evaluation
 */

importScripts("https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js");

let game = null;

const pieceWeights = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/**
 * Simple evaluation function
 */
function evaluateBoard(chess) {
    let totalEvaluation = 0;
    const board = chess.board();

    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            totalEvaluation += getPieceValue(board[i][j], i, j, chess);
        }
    }
    return totalEvaluation;
}

function getPieceValue(piece, x, y, chess) {
    if (!piece) return 0;

    let absoluteValue = pieceWeights[piece.type] || 0;
    
    // Position-based adjustments (simple)
    if (piece.type === 'p') {
        // Encourage pawn advancement
        absoluteValue += (piece.color === 'w') ? (7 - x) * 10 : x * 10;
    } else if (piece.type === 'n' || piece.type === 'b') {
        // Encourage central development
        const distFromCenter = Math.abs(3.5 - x) + Math.abs(3.5 - y);
        absoluteValue += (6 - distFromCenter) * 10;
    }

    // Endgame adjustment: King activity
    const isEndgame = countPieces(chess) <= 6;
    if (isEndgame && piece.type === 'k') {
        const distFromCenter = Math.abs(3.5 - x) + Math.abs(3.5 - y);
        absoluteValue += (6 - distFromCenter) * 20;
    }

    return piece.color === 'w' ? absoluteValue : -absoluteValue;
}

function countPieces(chess) {
    let count = 0;
    chess.board().forEach(row => {
        row.forEach(sq => { if (sq) count++; });
    });
    return count;
}

/**
 * Minimax with Alpha-Beta Pruning
 */
function minimax(chess, depth, alpha, beta, isMaximizingPlayer) {
    if (depth === 0 || chess.game_over()) {
        return -evaluateBoard(chess);
    }

    const moves = chess.moves();

    if (isMaximizingPlayer) {
        let bestScore = -99999;
        for (let i = 0; i < moves.length; i++) {
            chess.move(moves[i]);
            bestScore = Math.max(bestScore, minimax(chess, depth - 1, alpha, beta, !isMaximizingPlayer));
            chess.undo();
            alpha = Math.max(alpha, bestScore);
            if (beta <= alpha) return bestScore;
        }
        return bestScore;
    } else {
        let bestScore = 99999;
        for (let i = 0; i < moves.length; i++) {
            chess.move(moves[i]);
            bestScore = Math.min(bestScore, minimax(chess, depth - 1, alpha, beta, !isMaximizingPlayer));
            chess.undo();
            beta = Math.min(beta, bestScore);
            if (beta <= alpha) return bestScore;
        }
        return bestScore;
    }
}

/**
 * Iterative Deepening / Best Move Search
 */
function getBestMove(fen, depthLimit, timeLimit) {
    const tempGame = new Chess(fen);
    const moves = tempGame.moves();
    let bestMove = moves[Math.floor(Math.random() * moves.length)];
    let bestScore = -99999;

    const startTime = Date.now();

    // Sort moves for better pruning (captures first)
    const verboseMoves = tempGame.moves({ verbose: true });
    verboseMoves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));

    for (let i = 0; i < verboseMoves.length; i++) {
        const move = verboseMoves[i].san;
        tempGame.move(move);
        const score = minimax(tempGame, depthLimit - 1, -100000, 100000, false);
        tempGame.undo();

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }

        // Time check
        if (Date.now() - startTime > timeLimit) break;
    }

    return { move: bestMove, score: bestScore };
}

onmessage = function(e) {
    const { fen, depth, timeLimit, action } = e.data;
    
    if (action === 'search') {
        const result = getBestMove(fen, depth, timeLimit);
        postMessage({ action: 'searchResult', ...result });
    } else if (action === 'evaluate') {
        const tempGame = new Chess(fen);
        const score = evaluateBoard(tempGame);
        const pieces = countPieces(tempGame);
        postMessage({ action: 'evalResult', score, pieces });
    }
};
