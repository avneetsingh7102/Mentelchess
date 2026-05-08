class ChessEngine {
    constructor(difficulty = 'intermediate') {
        this.difficulty = difficulty;
        this.game = new Chess();
        
        // Difficulty settings
        this.config = {
            beginner: { depth: 1, randomness: 0.7 },
            intermediate: { depth: 2, randomness: 0.3 },
            advanced: { depth: 3, randomness: 0.1 },
            master: { depth: 4, randomness: 0 }
        };
        
        // Piece values for evaluation
        this.pieceValues = {
            p: 1,
            n: 3,
            b: 3,
            r: 5,
            q: 9,
            k: 0
        };
        
        // Position bonuses
        this.positionBonus = {
            // Center squares get bonus
            center: ['d4', 'e4', 'd5', 'e5'],
            extended: ['c3', 'c4', 'c5', 'c6', 'd3', 'd6', 'e3', 'e6', 'f3', 'f4', 'f5', 'f6']
        };
    }
    
    getBestMove() {
        const depth = this.config[this.difficulty].depth;
        const randomness = this.config[this.difficulty].randomness;
        
        // Get all legal moves
        const moves = this.game.moves({ verbose: true });
        
        if (moves.length === 0) return null;
        
        // Evaluate each move
        const evaluatedMoves = moves.map(move => {
            this.game.move(move);
            const score = -this.minimax(depth - 1, -10000, 10000, false);
            this.game.undo();
            return { move, score };
        });
        
        // Sort by score (best first)
        evaluatedMoves.sort((a, b) => b.score - a.score);
        
        // Apply randomness based on difficulty
        if (Math.random() < randomness && evaluatedMoves.length > 1) {
            // Pick from top 3 moves randomly
            const topMoves = evaluatedMoves.slice(0, Math.min(3, evaluatedMoves.length));
            return topMoves[Math.floor(Math.random() * topMoves.length)].move;
        }
        
        return evaluatedMoves[0].move;
    }
    
    minimax(depth, alpha, beta, isMaximizing) {
        if (depth === 0) {
            return this.evaluatePosition();
        }
        
        const moves = this.game.moves({ verbose: true });
        
        // Checkmate or stalemate
        if (moves.length === 0) {
            if (this.game.in_checkmate()) {
                return isMaximizing ? -9999 : 9999;
            }
            return 0; // Stalemate
        }
        
        if (isMaximizing) {
            let maxEval = -10000;
            for (let move of moves) {
                this.game.move(move);
                const evaluation = this.minimax(depth - 1, alpha, beta, false);
                this.game.undo();
                maxEval = Math.max(maxEval, evaluation);
                alpha = Math.max(alpha, evaluation);
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            return maxEval;
        } else {
            let minEval = 10000;
            for (let move of moves) {
                this.game.move(move);
                const evaluation = this.minimax(depth - 1, alpha, beta, true);
                this.game.undo();
                minEval = Math.min(minEval, evaluation);
                beta = Math.min(beta, evaluation);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }
    
    evaluatePosition() {
        let score = 0;
        const board = this.game.board();
        
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const piece = board[i][j];
                if (piece) {
                    const value = this.pieceValues[piece.type];
                    const square = String.fromCharCode(97 + j) + (8 - i);
                    
                    let pieceScore = value;
                    
                    // Position bonuses
                    if (this.positionBonus.center.includes(square)) {
                        pieceScore += 0.3;
                    } else if (this.positionBonus.extended.includes(square)) {
                        pieceScore += 0.1;
                    }
                    
                    // Development bonus (knights and bishops off back rank)
                    if ((piece.type === 'n' || piece.type === 'b') && 
                        (square[1] !== '1' && square[1] !== '8')) {
                        pieceScore += 0.2;
                    }
                    
                    score += piece.color === 'w' ? pieceScore : -pieceScore;
                }
            }
        }
        
        // Adjust for current turn
        return this.game.turn() === 'w' ? score : -score;
    }
    
    getHint() {
        const move = this.getBestMove();
        return move ? move.san : null;
    }
}