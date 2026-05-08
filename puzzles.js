/**
 * Tactical Puzzles for Mental Chess
 */
const CHESS_PUZZLES = [
    {
        fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1",
        instruction: "White to move and win immediately.",
        solution: "Qxf7#",
        hint: "Look at the square f7."
    },
    {
        fen: "6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1",
        instruction: "White to move. This is a basic endgame.",
        solution: "Kf1",
        hint: "Activate your king."
    },
    {
        fen: "r1b1k2r/pp1n1ppp/2p1p3/q2p2B1/2PP4/2P1PN2/P1Q2PPP/R3KB1R w KQkq - 1 10",
        instruction: "White to move. Improve your position.",
        solution: "cxd5",
        hint: "The tension in the center is high."
    }
];
