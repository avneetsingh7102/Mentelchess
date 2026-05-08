"""
inference.py — Mental Chess Model Inference

Loads the trained ChessNet model and provides move prediction for a given
board position (FEN). Filters predictions to only legal moves and supports
temperature-based sampling for human-like play.
"""

import os
import torch
import torch.nn.functional as F
import chess
import numpy as np

from model import ChessNet
from data_pipeline import (
    fen_to_bitboard,
    NUM_MOVE_CLASSES,
    UCI_TO_IDX,
    IDX_TO_UCI,
)


class ChessPredictor:
    """
    Wraps the trained ChessNet for inference.

    Loads the model once, then provides `predict_move(fen)` to get
    the best move for any position.
    """

    def __init__(self, model_path=None, device=None):
        if model_path is None:
            model_path = os.path.join(os.path.dirname(__file__), 'chess_model.pth')

        if device is None:
            if torch.backends.mps.is_available():
                self.device = torch.device('mps')
            elif torch.cuda.is_available():
                self.device = torch.device('cuda')
            else:
                self.device = torch.device('cpu')
        else:
            self.device = torch.device(device)

        self.model = None
        self.model_path = model_path
        self._load_model()

    def _load_model(self):
        """Load the trained model from disk."""
        if not os.path.exists(self.model_path):
            print(f"Warning: Model file not found at {self.model_path}")
            print("Using random move fallback.")
            return

        checkpoint = torch.load(self.model_path, map_location=self.device, weights_only=True)

        self.model = ChessNet(
            num_move_classes=checkpoint.get('num_move_classes', NUM_MOVE_CLASSES),
            num_filters=checkpoint.get('num_filters', 128),
            num_res_blocks=checkpoint.get('num_res_blocks', 4),
        ).to(self.device)

        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()

        epoch = checkpoint.get('epoch', '?')
        acc = checkpoint.get('val_acc', 0)
        print(f"Loaded model from epoch {epoch} (val acc: {acc:.2%})")

    def predict_move(self, fen, temperature=1.0, top_k=5):
        """
        Predict the best move for a given FEN position.

        Args:
            fen: FEN string of the current position.
            temperature: Sampling temperature. Lower = more deterministic.
                        0 = always pick the top move.
            top_k: Number of top moves to consider for sampling.

        Returns:
            dict with keys:
                'move': UCI string of the chosen move
                'san': SAN notation of the move
                'confidence': Probability of the chosen move
                'top_moves': List of (uci, san, probability) for top-k moves
                'evaluation': Position evaluation from value head (-1 to +1)
        """
        board = chess.Board(fen)
        legal_moves = list(board.legal_moves)

        if not legal_moves:
            return None

        # If no model loaded, use random legal move
        if self.model is None:
            move = np.random.choice(legal_moves)
            return {
                'move': move.uci(),
                'san': board.san(move),
                'confidence': 1.0 / len(legal_moves),
                'top_moves': [(move.uci(), board.san(move), 1.0 / len(legal_moves))],
                'evaluation': 0.0,
            }

        # Encode the board
        bitboard = fen_to_bitboard(fen)
        # (8, 8, 12) → (1, 12, 8, 8)
        tensor = torch.from_numpy(bitboard).permute(2, 0, 1).unsqueeze(0).to(self.device)

        # Forward pass
        with torch.no_grad():
            policy_logits, value = self.model(tensor)

        policy_logits = policy_logits.squeeze(0).cpu()
        evaluation = value.squeeze().item()

        # Build legal move mask
        legal_indices = []
        legal_uci_moves = []
        for move in legal_moves:
            uci = move.uci()
            idx = UCI_TO_IDX.get(uci)
            if idx is not None:
                legal_indices.append(idx)
                legal_uci_moves.append(uci)

        if not legal_indices:
            # Fallback: model doesn't know any of the legal moves
            move = np.random.choice(legal_moves)
            return {
                'move': move.uci(),
                'san': board.san(move),
                'confidence': 0.0,
                'top_moves': [(move.uci(), board.san(move), 0.0)],
                'evaluation': evaluation,
            }

        # Extract logits for legal moves only
        legal_logits = policy_logits[legal_indices]

        # Apply temperature
        if temperature > 0:
            legal_logits = legal_logits / temperature

        # Softmax over legal moves
        probs = F.softmax(legal_logits, dim=0).numpy()

        # Sort by probability
        sorted_indices = np.argsort(-probs)
        top_moves = []
        for i in sorted_indices[:top_k]:
            uci = legal_uci_moves[i]
            move_obj = chess.Move.from_uci(uci)
            san = board.san(move_obj)
            top_moves.append((uci, san, float(probs[i])))

        # Select move
        if temperature == 0:
            # Greedy: pick the best
            chosen_idx = sorted_indices[0]
        else:
            # Sample from top-k with temperature-adjusted probabilities
            top_k_indices = sorted_indices[:top_k]
            top_k_probs = probs[top_k_indices]
            top_k_probs = top_k_probs / top_k_probs.sum()  # renormalize
            chosen_idx = top_k_indices[np.random.choice(len(top_k_indices), p=top_k_probs)]

        chosen_uci = legal_uci_moves[chosen_idx]
        chosen_move = chess.Move.from_uci(chosen_uci)
        chosen_san = board.san(chosen_move)
        chosen_prob = float(probs[chosen_idx])

        return {
            'move': chosen_uci,
            'san': chosen_san,
            'confidence': chosen_prob,
            'top_moves': top_moves,
            'evaluation': evaluation,
        }

    def get_move_description(self, board, move_san):
        """Generate a human-readable description of a move for TTS."""
        piece_names = {
            'N': 'knight', 'B': 'bishop', 'R': 'rook',
            'Q': 'queen', 'K': 'king'
        }

        san = move_san

        if san in ('O-O', '0-0'):
            return "castles kingside"
        if san in ('O-O-O', '0-0-0'):
            return "castles queenside"

        desc_parts = []

        # Check for piece
        if san[0] in piece_names:
            desc_parts.append(piece_names[san[0]])
            san = san[1:]
        else:
            desc_parts.append("pawn")

        # Check for capture
        if 'x' in san:
            desc_parts.append("takes on")
            san = san.replace('x', '')
        else:
            desc_parts.append("to")

        # Extract destination square
        # Remove check/mate symbols
        destination = san.rstrip('+#')
        # Remove disambiguation (file or rank before destination)
        if len(destination) > 2:
            destination = destination[-2:]

        desc_parts.append(destination)

        # Promotion
        if '=' in move_san:
            promo_piece = move_san.split('=')[1][0]
            if promo_piece in piece_names:
                desc_parts.append(f"promoting to {piece_names[promo_piece]}")

        # Check
        if '+' in move_san:
            desc_parts.append(", check")
        elif '#' in move_san:
            desc_parts.append(", checkmate")

        return " ".join(desc_parts)


if __name__ == '__main__':
    # Quick test
    predictor = ChessPredictor()

    test_fens = [
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",  # starting pos
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",  # after 1.e4
        "r1bqkbnr/pppppppp/2n5/8/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 2",  # Sicilian
    ]

    for fen in test_fens:
        print(f"\nFEN: {fen}")
        result = predictor.predict_move(fen)
        if result:
            print(f"  Best move: {result['san']} ({result['move']})")
            print(f"  Confidence: {result['confidence']:.1%}")
            print(f"  Evaluation: {result['evaluation']:+.3f}")
            board = chess.Board(fen)
            desc = predictor.get_move_description(board, result['san'])
            print(f"  Description: \"{desc}\"")
            print(f"  Top moves: {result['top_moves'][:3]}")
