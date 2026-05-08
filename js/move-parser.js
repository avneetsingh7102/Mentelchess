class MoveParser {
    constructor(game) {
        this.game = game;
        
        // Piece name variations
        this.pieceMap = {
            'pawn': '',
            'knight': 'N',
            'night': 'N',  // common speech recognition error
            'bishop': 'B',
            'rook': 'R',
            'queen': 'Q',
            'king': 'K'
        };
        
        // Filler words to remove
        this.fillers = ['um', 'uh', 'please', 'i want to', 'i would like to', 'move', 'the'];
    }
    
    parse(speechText) {
        let text = speechText.toLowerCase().trim();
        
        // Remove filler words
        this.fillers.forEach(filler => {
            text = text.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
        });
        
        text = text.trim();
        
        // Handle castling
        if (text.includes('castle')) {
            if (text.includes('queen') || text.includes('long')) {
                return this.tryMove('O-O-O');
            }
            return this.tryMove('O-O');
        }
        
        // Handle "undo" command
        if (text.includes('undo') || text.includes('take back')) {
            return { type: 'command', command: 'undo' };
        }
        
        // Handle position queries
        if (text.includes('where is')) {
            const piece = this.extractPieceFromQuery(text);
            return { type: 'query', query: 'where', piece: piece };
        }
        
        // Handle "read the board"
        if (text.includes('read') && text.includes('board')) {
            return { type: 'query', query: 'read_board' };
        }
        
        // Handle "show board" / "hide board"
        if (text.includes('show') && text.includes('board')) {
            return { type: 'command', command: 'show_board' };
        }
        if (text.includes('hide') && text.includes('board')) {
            return { type: 'command', command: 'hide_board' };
        }
        
        // Handle "move history"
        if (text.includes('history') || text.includes('moves')) {
            return { type: 'query', query: 'history' };
        }
        
        // Handle "hint"
        if (text.includes('hint') || text.includes('help')) {
            return { type: 'query', query: 'hint' };
        }
        
        // Handle "resign"
        if (text.includes('resign') || text.includes('give up')) {
            return { type: 'command', command: 'resign' };
        }
        
        // Try standard algebraic notation first (e.g., "e4", "Nf3")
        const algebraicMove = this.tryMove(text);
        if (algebraicMove) return algebraicMove;
        
        // Try parsing verbose format: "knight to f3", "pawn to e4"
        const verboseMove = this.parseVerboseMove(text);
        if (verboseMove) return verboseMove;
        
        // Try square-to-square: "e2 to e4", "g1 to f3"
        const squareMove = this.parseSquareToSquare(text);
        if (squareMove) return squareMove;
        
        return { type: 'error', message: 'Could not understand move' };
    }
    
    tryMove(moveString) {
        try {
            const move = this.game.move(moveString);
            if (move) {
                this.game.undo(); // Undo so we can apply it officially later
                return { type: 'move', move: moveString, san: move.san };
            }
        } catch (e) {
            // Invalid move
        }
        return null;
    }
    
    parseVerboseMove(text) {
        // Extract piece and destination
        // Examples: "knight to f3", "pawn takes e5", "queen to d5"
        
        let piece = '';
        let destination = '';
        let isCapture = text.includes('take');
        
        // Find piece
        for (let [name, symbol] of Object.entries(this.pieceMap)) {
            if (text.includes(name)) {
                piece = symbol;
                break;
            }
        }
        
        // Extract destination square (two characters: letter + number)
        const squareMatch = text.match(/\b([a-h][1-8])\b/);
        if (squareMatch) {
            destination = squareMatch[1];
        }
        
        if (destination) {
            const moveStr = piece + (isCapture ? 'x' : '') + destination;
            return this.tryMove(moveStr);
        }
        
        return null;
    }
    
    parseSquareToSquare(text) {
        // Extract "from" and "to" squares
        // Example: "e2 to e4", "g1 f3"
        
        const squares = text.match(/\b([a-h][1-8])\b/g);
        if (squares && squares.length >= 2) {
            const from = squares[0];
            const to = squares[1];
            
            // Try to make move
            const moves = this.game.moves({ verbose: true });
            const validMove = moves.find(m => m.from === from && m.to === to);
            
            if (validMove) {
                return { type: 'move', move: validMove.san, san: validMove.san };
            }
        }
        
        return null;
    }
    
    extractPieceFromQuery(text) {
        // Extract piece name from "where is my queen" etc.
        for (let name of Object.keys(this.pieceMap)) {
            if (text.includes(name)) {
                return name;
            }
        }
        return null;
    }
}