/**
 * Common Chess Openings for Mental Chess
 * Mapping: Space-separated PGN history -> Array of theoretical next moves
 */
const CHESS_OPENINGS = {
    // 1. e4
    "e4": ["e5", "c5", "e6", "c6", "d6"],
    
    // Ruy Lopez / Italian
    "e4 e5 Nf3": ["Nc6", "d6"],
    "e4 e5 Nf3 Nc6": ["Bb5", "Bc4", "d4"],
    "e4 e5 Nf3 Nc6 Bb5": ["a6", "Nf6"],
    "e4 e5 Nf3 Nc6 Bb5 a6": ["Ba4"],
    "e4 e5 Nf3 Nc6 Bc4": ["Bc5", "Nf6"],
    "e4 e5 Nf3 Nc6 Bc4 Bc5": ["c3", "d3", "O-O"],
    
    // Sicilian Defense
    "e4 c5": ["Nf3", "Nc3", "d4"],
    "e4 c5 Nf3": ["d6", "Nc6", "e6"],
    "e4 c5 Nf3 d6": ["d4"],
    "e4 c5 Nf3 d6 d4": ["cxd4"],
    "e4 c5 Nf3 d6 d4 cxd4": ["Nxd4"],
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4": ["Nf6"],
    
    // French Defense
    "e4 e6": ["d4"],
    "e4 e6 d4": ["d5"],
    "e4 e6 d4 d5": ["Nc3", "Nd2", "e5"],
    
    // Caro-Kann
    "e4 c6": ["d4"],
    "e4 c6 d4": ["d5"],
    "e4 c6 d4 d5": ["Nc3", "Nd2", "e5"],
    
    // 1. d4
    "d4": ["d5", "Nf6", "f5"],
    "d4 d5": ["c4"],
    "d4 d5 c4": ["e6", "c6", "dxc4"],
    "d4 Nf6": ["c4"],
    "d4 Nf6 c4": ["e6", "g6", "c5"],
    
    // King's Indian
    "d4 Nf6 c4 g6": ["Nc3"],
    "d4 Nf6 c4 g6 Nc3": ["Bg7"],
    "d4 Nf6 c4 g6 Nc3 Bg7": ["e4"],
    
    // Queen's Gambit
    "d4 d5 c4 e6": ["Nc3"],
    "d4 d5 c4 e6 Nc3": ["Nf6"],
    "d4 d5 c4 e6 Nc3 Nf6": ["Bg5", "Nf3", "cxd5"]
};
