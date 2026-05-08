"""
data_pipeline.py — Mental Chess Data Pipeline

Parses Kaggle OpenSpiel chess JSON game files from archive/, extracts
(FEN, move) pairs by replaying games through OpenSpiel's action decoder,
encodes boards as 8x8x12 bitboard tensors and moves as classification
indices, then saves the processed dataset.

Requires: open_spiel (pip install open_spiel)
"""

import json
import os
import glob
import numpy as np
import chess
import sys
from pathlib import Path

try:
    import pyspiel
    HAS_OPENSPIEL = True
except ImportError:
    HAS_OPENSPIEL = False
    print("WARNING: open_spiel not installed. Run: pip install open_spiel")
    print("Cannot decode action indices without it.")


# ---------------------------------------------------------------------------
# Board Encoding: FEN → 8×8×12 bitboard tensor
# ---------------------------------------------------------------------------

# Channel indices for each piece type
PIECE_TO_CHANNEL = {
    'P': 0,  'N': 1,  'B': 2,  'R': 3,  'Q': 4,  'K': 5,   # white
    'p': 6,  'n': 7,  'b': 8,  'r': 9,  'q': 10, 'k': 11,  # black
}


def fen_to_bitboard(fen):
    """
    Convert a FEN string to an 8×8×12 numpy array (float32).
    Row 0 = rank 8 (black's back rank), Row 7 = rank 1 (white's back rank).
    """
    board = np.zeros((8, 8, 12), dtype=np.float32)
    piece_placement = fen.split()[0]
    rows = piece_placement.split('/')

    for rank_idx, row in enumerate(rows):
        file_idx = 0
        for char in row:
            if char.isdigit():
                file_idx += int(char)
            else:
                channel = PIECE_TO_CHANNEL.get(char)
                if channel is not None:
                    board[rank_idx, file_idx, channel] = 1.0
                file_idx += 1

    return board


def fen_to_side_to_move(fen):
    """Return +1.0 if white to move, -1.0 if black to move."""
    return 1.0 if fen.split()[1] == 'w' else -1.0


# ---------------------------------------------------------------------------
# Move Encoding: UCI → move index (for neural network classification head)
# ---------------------------------------------------------------------------

def _build_all_possible_uci_moves():
    """
    Build a comprehensive mapping of all possible UCI move strings to indices.
    This covers all from-to square pairs plus promotions.
    """
    uci_to_idx = {}
    idx_to_uci = {}
    idx = 0

    files = 'abcdefgh'
    ranks = '12345678'

    # All non-promotion moves: from any square to any square
    for from_f in files:
        for from_r in ranks:
            for to_f in files:
                for to_r in ranks:
                    from_sq = from_f + from_r
                    to_sq = to_f + to_r
                    if from_sq == to_sq:
                        continue
                    uci = from_sq + to_sq
                    if uci not in uci_to_idx:
                        uci_to_idx[uci] = idx
                        idx_to_uci[idx] = uci
                        idx += 1

    # Promotion moves: pawn reaches 8th/1st rank
    for from_f in files:
        for to_f in files:
            # Only allow same file or adjacent files (valid pawn moves)
            if abs(ord(from_f) - ord(to_f)) > 1:
                continue
            for promo in ['q', 'r', 'b', 'n']:
                # White promotes: from rank 7 to rank 8
                uci = from_f + '7' + to_f + '8' + promo
                if uci not in uci_to_idx:
                    uci_to_idx[uci] = idx
                    idx_to_uci[idx] = uci
                    idx += 1
                # Black promotes: from rank 2 to rank 1
                uci = from_f + '2' + to_f + '1' + promo
                if uci not in uci_to_idx:
                    uci_to_idx[uci] = idx
                    idx_to_uci[idx] = uci
                    idx += 1

    return uci_to_idx, idx_to_uci


# Precompute at module load
UCI_TO_IDX, IDX_TO_UCI = _build_all_possible_uci_moves()
NUM_MOVE_CLASSES = len(UCI_TO_IDX)


def uci_to_move_index(uci_move):
    """Convert a UCI move string to a classification index."""
    return UCI_TO_IDX.get(uci_move)


def move_index_to_uci(idx):
    """Convert a classification index back to UCI string."""
    return IDX_TO_UCI.get(idx)


# ---------------------------------------------------------------------------
# Dataset Extraction from Kaggle JSON files using OpenSpiel
# ---------------------------------------------------------------------------

def process_game_file(filepath):
    """
    Process a single Kaggle OpenSpiel JSON file.
    Replays the game through OpenSpiel to decode each action in context,
    then validates with python-chess.

    Yields (fen, uci_move, result) tuples.
    """
    if not HAS_OPENSPIEL:
        return

    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return

    info = data.get('info', {})
    state_history = info.get('stateHistory', [])
    action_history = info.get('actionHistory', [])

    if not state_history or not action_history:
        return

    # Determine game result from rewards if available
    rewards = data.get('rewards', [])
    if rewards and len(rewards) >= 2:
        result = float(rewards[0])  # white's reward
    else:
        result = 0.0

    # Replay the game through OpenSpiel
    game = pyspiel.load_game('chess')
    os_state = game.new_initial_state()

    num_pairs = min(len(state_history) - 1, len(action_history))

    for i in range(num_pairs):
        fen = state_history[i]

        try:
            action_idx = int(action_history[i])
        except (ValueError, TypeError):
            break

        # Check if action is legal in current OpenSpiel state
        if action_idx not in os_state.legal_actions():
            break

        # Get the move string from OpenSpiel (SAN-like: "e4", "Nf3", etc.)
        san_move = os_state.action_to_string(action_idx)

        # Convert SAN to UCI using python-chess
        try:
            board = chess.Board(fen)
            move = board.parse_san(san_move)
            uci_move = move.uci()
        except (ValueError, chess.InvalidMoveError, chess.AmbiguousMoveError):
            # Try interpreting as UCI directly
            try:
                move = chess.Move.from_uci(san_move)
                if move in chess.Board(fen).legal_moves:
                    uci_move = move.uci()
                else:
                    break
            except:
                break

        # Advance OpenSpiel state
        try:
            os_state.apply_action(action_idx)
        except:
            break

        yield fen, uci_move, result


def build_dataset(archive_dir, max_files=None, verbose=True):
    """
    Process all JSON game files in archive_dir.
    Returns (boards, moves, values) numpy arrays ready for training.
    """
    json_files = sorted(glob.glob(os.path.join(archive_dir, '*.json')))

    if max_files:
        json_files = json_files[:max_files]

    all_boards = []
    all_moves = []
    all_values = []

    processed = 0
    skipped = 0

    for file_idx, filepath in enumerate(json_files):
        for fen, uci_move, result in process_game_file(filepath):
            board = fen_to_bitboard(fen)
            move_idx = uci_to_move_index(uci_move)

            if move_idx is None:
                skipped += 1
                continue

            # Adjust value based on side to move
            side = fen_to_side_to_move(fen)
            value = result * side  # +1 if current side winning

            all_boards.append(board)
            all_moves.append(move_idx)
            all_values.append(value)
            processed += 1

        if verbose and (file_idx + 1) % 100 == 0:
            print(f"  Processed {file_idx + 1}/{len(json_files)} files, "
                  f"{processed} positions collected, {skipped} skipped")

    if verbose:
        print(f"\nDone! {processed} total positions from {len(json_files)} files")
        print(f"Move classes used: {len(set(all_moves))} / {NUM_MOVE_CLASSES}")

    boards = np.array(all_boards, dtype=np.float32)
    moves = np.array(all_moves, dtype=np.int64)
    values = np.array(all_values, dtype=np.float32)

    return boards, moves, values


def save_dataset(boards, moves, values, output_path):
    """Save the processed dataset as a compressed .npz file."""
    np.savez_compressed(
        output_path,
        boards=boards,
        moves=moves,
        values=values
    )
    fpath = output_path if output_path.endswith('.npz') else output_path + '.npz'
    size_mb = os.path.getsize(fpath) / (1024 * 1024)
    print(f"Saved dataset to {fpath} ({size_mb:.1f} MB)")
    print(f"  Boards: {boards.shape}")
    print(f"  Moves:  {moves.shape}")
    print(f"  Values: {values.shape}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Process chess game data')
    parser.add_argument('--archive', type=str,
                        default=os.path.join(os.path.dirname(__file__), '..', 'archive'),
                        help='Path to archive directory with JSON files')
    parser.add_argument('--output', type=str,
                        default=os.path.join(os.path.dirname(__file__), 'dataset'),
                        help='Output path for .npz file (without extension)')
    parser.add_argument('--max-files', type=int, default=None,
                        help='Max number of JSON files to process (None = all)')
    args = parser.parse_args()

    print(f"Processing games from: {args.archive}")
    print(f"Move index table size: {NUM_MOVE_CLASSES} unique moves\n")

    boards, moves, values = build_dataset(
        args.archive,
        max_files=args.max_files,
        verbose=True
    )

    if len(boards) > 0:
        save_dataset(boards, moves, values, args.output)
    else:
        print("No data extracted! Check your JSON files and archive path.")
