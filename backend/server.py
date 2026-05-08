"""
server.py — Mental Chess FastAPI Backend

REST API that bridges the trained neural network with the voice-based frontend.
Maintains game state via python-chess and uses the ChessNet model for AI moves.

Endpoints:
  POST /new_game     — Start a new game, returns starting FEN
  POST /move         — Submit a player move, get AI response
  GET  /state        — Get current board state and piece summary
  POST /undo         — Undo last pair of moves
  GET  /hint         — Get AI's suggested move for current position
  GET  /health       — Health check
"""

import os
import uuid
from typing import Optional
from contextlib import asynccontextmanager

import chess
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from inference import ChessPredictor


# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------

# In-memory game sessions: session_id → chess.Board
sessions: dict[str, chess.Board] = {}

# Load the neural network predictor once at startup
predictor: Optional[ChessPredictor] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the neural network model at startup."""
    global predictor
    model_path = os.path.join(os.path.dirname(__file__), 'chess_model.pth')
    predictor = ChessPredictor(model_path=model_path)
    yield
    # Cleanup (nothing needed)


app = FastAPI(
    title="Mental Chess API",
    description="Neural-network-powered chess backend for the Mental Chess trainer",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the frontend to connect from any origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class NewGameRequest(BaseModel):
    session_id: Optional[str] = None
    fen: Optional[str] = None  # Optional custom starting position

class NewGameResponse(BaseModel):
    session_id: str
    fen: str
    message: str

class MoveRequest(BaseModel):
    session_id: str
    move: str  # UCI ("e2e4"), SAN ("Nf3"), or natural ("Pawn to E4", "castle")

class MoveResponse(BaseModel):
    fen: str
    player_move_san: str
    ai_move_san: Optional[str] = None
    ai_move_uci: Optional[str] = None
    ai_move_description: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_evaluation: Optional[float] = None
    game_over: bool = False
    game_result: Optional[str] = None
    piece_summary: Optional[dict] = None

class StateResponse(BaseModel):
    fen: str
    turn: str
    move_number: int
    is_check: bool
    is_game_over: bool
    legal_moves: list[str]
    piece_summary: dict
    move_history: list[str]

class HintResponse(BaseModel):
    suggested_move_san: str
    suggested_move_uci: str
    confidence: float
    evaluation: float
    description: str
    top_alternatives: list[dict]

class UndoResponse(BaseModel):
    fen: str
    message: str
    moves_undone: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PIECE_NAMES = {
    chess.PAWN: 'pawn', chess.KNIGHT: 'knight', chess.BISHOP: 'bishop',
    chess.ROOK: 'rook', chess.QUEEN: 'queen', chess.KING: 'king',
}


def get_board(session_id: str) -> chess.Board:
    """Retrieve board for a session, raising 404 if not found."""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Game session not found. Start a new game first.")
    return sessions[session_id]


def get_piece_summary(board: chess.Board) -> dict:
    """Build a human-readable piece summary for both sides."""
    summary = {'white': [], 'black': []}

    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece:
            color = 'white' if piece.color == chess.WHITE else 'black'
            name = PIECE_NAMES.get(piece.piece_type, 'unknown')
            sq_name = chess.square_name(square)
            summary[color].append(f"{name} on {sq_name}")

    return summary


def parse_move(board: chess.Board, move_text: str) -> chess.Move:
    """
    Parse a move from various formats:
    - UCI: "e2e4"
    - SAN: "Nf3", "O-O"
    - Natural: "pawn to e4", "knight f3", "castle", "castle queenside"
    """
    text = move_text.strip()

    # Try UCI first
    try:
        move = chess.Move.from_uci(text)
        if move in board.legal_moves:
            return move
        # Try with queen promotion
        move = chess.Move.from_uci(text + 'q')
        if move in board.legal_moves:
            return move
    except (ValueError, chess.InvalidMoveError):
        pass

    # Try SAN
    try:
        move = board.parse_san(text)
        return move
    except (ValueError, chess.InvalidMoveError, chess.AmbiguousMoveError):
        pass

    # Natural language parsing
    lower = text.lower().strip()

    # Handle castling
    if 'castle' in lower:
        if 'queen' in lower or 'long' in lower:
            try:
                return board.parse_san('O-O-O')
            except:
                pass
        try:
            return board.parse_san('O-O')
        except:
            pass

    # Remove filler words
    fillers = ['move', 'the', 'my', 'please', 'to', 'on', 'at']
    words = lower.split()
    words = [w for w in words if w not in fillers]

    # Piece name mapping
    piece_map = {
        'pawn': '', 'knight': 'N', 'night': 'N', 'bishop': 'B',
        'rook': 'R', 'queen': 'Q', 'king': 'K',
    }

    piece_prefix = ''
    for name, symbol in piece_map.items():
        if name in words:
            piece_prefix = symbol
            words = [w for w in words if w != name]
            break

    # Extract squares (letter + digit)
    import re
    squares = re.findall(r'[a-h][1-8]', ' '.join(words))

    if len(squares) == 2:
        # from-to format: "e2 e4"
        from_sq, to_sq = squares
        try:
            move = chess.Move.from_uci(from_sq + to_sq)
            if move in board.legal_moves:
                return move
        except:
            pass

    elif len(squares) == 1:
        # piece + destination: "knight f3" → "Nf3"
        san = piece_prefix + squares[0]
        try:
            move = board.parse_san(san)
            return move
        except:
            pass

        # Try with capture
        san_capture = piece_prefix + 'x' + squares[0]
        try:
            move = board.parse_san(san_capture)
            return move
        except:
            pass

    # Last resort: try the raw text as-is with various cleanups
    for attempt in [text, text.replace(' ', ''), text.upper(), text.lower()]:
        try:
            move = board.parse_san(attempt)
            return move
        except:
            pass

    raise ValueError(f"Could not understand move: '{move_text}'")


def get_game_result(board: chess.Board) -> Optional[str]:
    """Get game result string if the game is over."""
    if not board.is_game_over():
        return None
    result = board.result()
    if board.is_checkmate():
        winner = "White" if board.turn == chess.BLACK else "Black"
        return f"Checkmate! {winner} wins."
    elif board.is_stalemate():
        return "Stalemate. Game is a draw."
    elif board.is_insufficient_material():
        return "Insufficient material. Game is a draw."
    elif board.is_fifty_moves():
        return "Fifty-move rule. Game is a draw."
    elif board.is_repetition():
        return "Threefold repetition. Game is a draw."
    return f"Game over: {result}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/new_game", response_model=NewGameResponse)
async def new_game(request: NewGameRequest = None):
    """Start a new chess game."""
    session_id = (request and request.session_id) or str(uuid.uuid4())

    board = chess.Board()
    if request and request.fen:
        try:
            board = chess.Board(request.fen)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid FEN string")

    sessions[session_id] = board

    return NewGameResponse(
        session_id=session_id,
        fen=board.fen(),
        message="New game started. White to move.",
    )


@app.post("/move", response_model=MoveResponse)
async def make_move(request: MoveRequest):
    """
    Submit a player move and get the AI's response.

    The move can be in UCI format (e2e4), SAN (Nf3), or natural language
    (pawn to e4, knight f3, castle queenside).
    """
    board = get_board(request.session_id)

    # Check if game is already over
    if board.is_game_over():
        raise HTTPException(status_code=400, detail=get_game_result(board))

    # Parse and validate player move
    try:
        player_move = parse_move(board, request.move)
    except ValueError as e:
        # Build helpful error message
        legal_san = [board.san(m) for m in list(board.legal_moves)[:10]]
        raise HTTPException(
            status_code=400,
            detail=f"Illegal or unrecognized move: '{request.move}'. "
                   f"Some legal moves: {', '.join(legal_san)}"
        )

    if player_move not in board.legal_moves:
        raise HTTPException(status_code=400, detail=f"Move '{request.move}' is not legal in this position.")

    player_san = board.san(player_move)
    board.push(player_move)

    # Check if game is over after player move
    if board.is_game_over():
        return MoveResponse(
            fen=board.fen(),
            player_move_san=player_san,
            game_over=True,
            game_result=get_game_result(board),
            piece_summary=get_piece_summary(board),
        )

    # AI's turn
    result = predictor.predict_move(board.fen(), temperature=0.8, top_k=3)

    if result is None:
        raise HTTPException(status_code=500, detail="AI could not find a move")

    ai_move = chess.Move.from_uci(result['move'])
    ai_san = board.san(ai_move)
    ai_description = predictor.get_move_description(board, ai_san)
    board.push(ai_move)

    game_over = board.is_game_over()
    game_result = get_game_result(board) if game_over else None

    return MoveResponse(
        fen=board.fen(),
        player_move_san=player_san,
        ai_move_san=ai_san,
        ai_move_uci=result['move'],
        ai_move_description=ai_description,
        ai_confidence=result['confidence'],
        ai_evaluation=result['evaluation'],
        game_over=game_over,
        game_result=game_result,
        piece_summary=get_piece_summary(board),
    )


@app.get("/state", response_model=StateResponse)
async def get_state(session_id: str):
    """Get the current game state."""
    board = get_board(session_id)

    return StateResponse(
        fen=board.fen(),
        turn="white" if board.turn == chess.WHITE else "black",
        move_number=board.fullmove_number,
        is_check=board.is_check(),
        is_game_over=board.is_game_over(),
        legal_moves=[board.san(m) for m in board.legal_moves],
        piece_summary=get_piece_summary(board),
        move_history=[m.uci() for m in board.move_stack],
    )


@app.post("/undo", response_model=UndoResponse)
async def undo_move(session_id: str):
    """Undo the last pair of moves (player + AI)."""
    board = get_board(session_id)

    moves_to_undo = min(2, len(board.move_stack))

    if moves_to_undo == 0:
        raise HTTPException(status_code=400, detail="No moves to undo.")

    for _ in range(moves_to_undo):
        board.pop()

    return UndoResponse(
        fen=board.fen(),
        message=f"Undid {moves_to_undo} move(s). Your turn.",
        moves_undone=moves_to_undo,
    )


@app.get("/hint", response_model=HintResponse)
async def get_hint(session_id: str):
    """Get the AI's suggested move for the current position."""
    board = get_board(session_id)

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Game is already over.")

    result = predictor.predict_move(board.fen(), temperature=0, top_k=5)

    if result is None:
        raise HTTPException(status_code=500, detail="Could not generate hint.")

    description = predictor.get_move_description(board, result['san'])

    alternatives = []
    for uci, san, prob in result['top_moves'][1:]:
        alt_desc = predictor.get_move_description(board, san)
        alternatives.append({
            'move_san': san,
            'move_uci': uci,
            'confidence': prob,
            'description': alt_desc,
        })

    return HintResponse(
        suggested_move_san=result['san'],
        suggested_move_uci=result['move'],
        confidence=result['confidence'],
        evaluation=result['evaluation'],
        description=description,
        top_alternatives=alternatives,
    )


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "model_loaded": predictor is not None and predictor.model is not None,
        "active_sessions": len(sessions),
    }


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
