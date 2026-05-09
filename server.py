"""
server.py — Mental Chess Backend (Render-compatible)

Lightweight Flask server for the Mental Chess trainer.
Uses python-chess for move generation with difficulty-based AI.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import chess
import chess.pgn
import random
import uuid
import os

# Serve static files from the repo root
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# In-memory game sessions: session_id → chess.Board
sessions = {}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PIECE_NAMES = {
    chess.PAWN: 'pawn', chess.KNIGHT: 'knight', chess.BISHOP: 'bishop',
    chess.ROOK: 'rook', chess.QUEEN: 'queen', chess.KING: 'king',
}

PIECE_VALUES = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
}


def get_piece_summary(board):
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


def evaluate_board(board):
    """Simple material-based board evaluation."""
    if board.is_checkmate():
        return -9999 if board.turn == chess.WHITE else 9999
    if board.is_game_over():
        return 0

    score = 0
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece:
            value = PIECE_VALUES.get(piece.piece_type, 0)
            if piece.color == chess.WHITE:
                score += value
            else:
                score -= value

    # Bonus for center control
    center_squares = [chess.D4, chess.D5, chess.E4, chess.E5]
    for sq in center_squares:
        piece = board.piece_at(sq)
        if piece:
            bonus = 0.3
            score += bonus if piece.color == chess.WHITE else -bonus

    return score


def get_ai_move(board, difficulty='medium'):
    """Pick an AI move based on difficulty level."""
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return None

    if difficulty == 'easy':
        # Mostly random, occasionally makes a decent move
        if random.random() < 0.3:
            return _best_move(board, depth=1)
        return random.choice(legal_moves)

    elif difficulty == 'medium':
        # Mix of random and evaluated moves
        if random.random() < 0.7:
            return _best_move(board, depth=2)
        return random.choice(legal_moves)

    else:  # hard
        return _best_move(board, depth=3)


def _best_move(board, depth=2):
    """Simple minimax to find a reasonable move."""
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return None

    best_move = None
    best_score = float('-inf') if board.turn == chess.WHITE else float('inf')

    for move in legal_moves:
        board.push(move)
        score = _minimax(board, depth - 1, float('-inf'), float('inf'), board.turn == chess.WHITE)
        board.pop()

        if board.turn == chess.WHITE:
            if score > best_score:
                best_score = score
                best_move = move
        else:
            if score < best_score:
                best_score = score
                best_move = move

    return best_move or random.choice(legal_moves)


def _minimax(board, depth, alpha, beta, maximizing):
    """Minimax with alpha-beta pruning."""
    if depth == 0 or board.is_game_over():
        return evaluate_board(board)

    legal_moves = list(board.legal_moves)

    if maximizing:
        max_eval = float('-inf')
        for move in legal_moves:
            board.push(move)
            eval_score = _minimax(board, depth - 1, alpha, beta, False)
            board.pop()
            max_eval = max(max_eval, eval_score)
            alpha = max(alpha, eval_score)
            if beta <= alpha:
                break
        return max_eval
    else:
        min_eval = float('inf')
        for move in legal_moves:
            board.push(move)
            eval_score = _minimax(board, depth - 1, alpha, beta, True)
            board.pop()
            min_eval = min(min_eval, eval_score)
            beta = min(beta, eval_score)
            if beta <= alpha:
                break
        return min_eval


def get_game_result(board):
    """Get game result string if the game is over."""
    if not board.is_game_over():
        return None
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
    return f"Game over: {board.result()}"


def get_move_description(board, san):
    """Generate a human-readable description of a move."""
    descriptions = {
        'O-O': 'castles kingside',
        'O-O-O': 'castles queenside',
    }
    if san in descriptions:
        return descriptions[san]

    if 'x' in san:
        return f"captures with {san}"
    if '+' in san:
        return f"{san} — check!"
    if '#' in san:
        return f"{san} — checkmate!"
    return san


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def home():
    """Serve the main chess game UI."""
    return send_file('index.html')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'active_sessions': len(sessions),
    })


@app.route('/new_game', methods=['POST'])
def new_game():
    data = request.json or {}
    session_id = data.get('session_id') or str(uuid.uuid4())
    fen = data.get('fen')

    board = chess.Board()
    if fen:
        try:
            board = chess.Board(fen)
        except ValueError:
            return jsonify({'error': 'Invalid FEN string'}), 400

    sessions[session_id] = board

    return jsonify({
        'session_id': session_id,
        'fen': board.fen(),
        'message': 'New game started. White to move.',
    })


@app.route('/move', methods=['POST'])
def make_move():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    session_id = data.get('session_id')
    move_text = data.get('move')
    difficulty = data.get('difficulty', 'medium')

    if not session_id or session_id not in sessions:
        return jsonify({'error': 'Game session not found. Start a new game first.'}), 404

    board = sessions[session_id]

    if board.is_game_over():
        return jsonify({'error': get_game_result(board)}), 400

    # Parse player move — try UCI, then SAN
    player_move = None
    try:
        player_move = chess.Move.from_uci(move_text)
        if player_move not in board.legal_moves:
            player_move = None
    except (ValueError, chess.InvalidMoveError):
        pass

    if player_move is None:
        try:
            player_move = board.parse_san(move_text)
        except (ValueError, chess.InvalidMoveError, chess.AmbiguousMoveError):
            pass

    if player_move is None or player_move not in board.legal_moves:
        legal_san = [board.san(m) for m in list(board.legal_moves)[:10]]
        return jsonify({
            'error': f"Illegal or unrecognized move: '{move_text}'. Some legal moves: {', '.join(legal_san)}"
        }), 400

    player_san = board.san(player_move)
    board.push(player_move)

    # Check if game is over after player move
    if board.is_game_over():
        return jsonify({
            'fen': board.fen(),
            'player_move_san': player_san,
            'game_over': True,
            'game_result': get_game_result(board),
            'piece_summary': get_piece_summary(board),
        })

    # AI's turn
    ai_move = get_ai_move(board, difficulty)
    if ai_move is None:
        return jsonify({'error': 'AI could not find a move'}), 500

    ai_san = board.san(ai_move)
    ai_desc = get_move_description(board, ai_san)
    board.push(ai_move)

    game_over = board.is_game_over()
    game_result = get_game_result(board) if game_over else None

    return jsonify({
        'fen': board.fen(),
        'player_move_san': player_san,
        'ai_move_san': ai_san,
        'ai_move_uci': ai_move.uci(),
        'ai_move_description': ai_desc,
        'game_over': game_over,
        'game_result': game_result,
        'piece_summary': get_piece_summary(board),
    })


@app.route('/get-move', methods=['POST'])
def get_move():
    """Simple endpoint — takes FEN, returns a move."""
    data = request.json
    fen = data.get('fen')
    difficulty = data.get('difficulty', 'medium')

    board = chess.Board(fen)
    legal_moves = list(board.legal_moves)

    if not legal_moves:
        return jsonify({'error': 'No legal moves'}), 400

    move = get_ai_move(board, difficulty)
    return jsonify({'move': move.uci()})


@app.route('/state', methods=['GET'])
def get_state():
    session_id = request.args.get('session_id')
    if not session_id or session_id not in sessions:
        return jsonify({'error': 'Game session not found'}), 404

    board = sessions[session_id]
    return jsonify({
        'fen': board.fen(),
        'turn': 'white' if board.turn == chess.WHITE else 'black',
        'move_number': board.fullmove_number,
        'is_check': board.is_check(),
        'is_game_over': board.is_game_over(),
        'legal_moves': [board.san(m) for m in board.legal_moves],
        'piece_summary': get_piece_summary(board),
        'move_history': [m.uci() for m in board.move_stack],
    })


@app.route('/undo', methods=['POST'])
def undo_move():
    data = request.json or {}
    session_id = data.get('session_id')
    if not session_id or session_id not in sessions:
        return jsonify({'error': 'Game session not found'}), 404

    board = sessions[session_id]
    moves_to_undo = min(2, len(board.move_stack))

    if moves_to_undo == 0:
        return jsonify({'error': 'No moves to undo'}), 400

    for _ in range(moves_to_undo):
        board.pop()

    return jsonify({
        'fen': board.fen(),
        'message': f'Undid {moves_to_undo} move(s). Your turn.',
        'moves_undone': moves_to_undo,
    })


@app.route('/hint', methods=['GET'])
def get_hint():
    session_id = request.args.get('session_id')
    if not session_id or session_id not in sessions:
        return jsonify({'error': 'Game session not found'}), 404

    board = sessions[session_id]
    if board.is_game_over():
        return jsonify({'error': 'Game is already over'}), 400

    move = _best_move(board, depth=3)
    san = board.san(move)
    desc = get_move_description(board, san)

    return jsonify({
        'suggested_move_san': san,
        'suggested_move_uci': move.uci(),
        'description': desc,
    })


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)
