"""
train.py — Mental Chess Model Training

Trains the ChessNet Value-Policy network on the processed dataset.
Saves the best model checkpoint based on validation policy accuracy.
"""

import os
import sys
import time
import argparse
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, random_split

from model import ChessNet, count_parameters
from data_pipeline import NUM_MOVE_CLASSES


class ChessDataset(Dataset):
    """PyTorch Dataset wrapping the .npz processed data."""

    def __init__(self, npz_path):
        data = np.load(npz_path)
        # boards: (N, 8, 8, 12) → need to transpose to (N, 12, 8, 8) for PyTorch
        self.boards = torch.from_numpy(data['boards']).permute(0, 3, 1, 2)
        self.moves = torch.from_numpy(data['moves']).long()
        self.values = torch.from_numpy(data['values']).float()

        print(f"Loaded dataset: {len(self)} positions")
        print(f"  Board shape: {self.boards.shape}")
        print(f"  Unique moves: {len(torch.unique(self.moves))}")
        print(f"  Value distribution: "
              f"white-wins={float((self.values > 0).sum())/len(self)*100:.1f}%, "
              f"black-wins={float((self.values < 0).sum())/len(self)*100:.1f}%, "
              f"draws={float((self.values == 0).sum())/len(self)*100:.1f}%")

    def __len__(self):
        return len(self.boards)

    def __getitem__(self, idx):
        return self.boards[idx], self.moves[idx], self.values[idx]


def train_epoch(model, loader, optimizer, device):
    """Run one training epoch. Returns (avg_loss, policy_acc, value_loss)."""
    model.train()
    total_loss = 0.0
    total_policy_loss = 0.0
    total_value_loss = 0.0
    correct = 0
    total = 0

    for boards, moves, values in loader:
        boards = boards.to(device)
        moves = moves.to(device)
        values = values.to(device).unsqueeze(1)

        optimizer.zero_grad()
        policy_logits, value_pred = model(boards)

        # Policy loss: cross-entropy
        policy_loss = F.cross_entropy(policy_logits, moves)

        # Value loss: MSE
        value_loss = F.mse_loss(value_pred, values)

        # Combined loss (policy is primary objective)
        loss = policy_loss + 0.5 * value_loss

        loss.backward()
        # Gradient clipping for stability
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()

        total_loss += loss.item() * boards.size(0)
        total_policy_loss += policy_loss.item() * boards.size(0)
        total_value_loss += value_loss.item() * boards.size(0)

        # Top-1 accuracy
        _, predicted = policy_logits.max(1)
        correct += predicted.eq(moves).sum().item()
        total += boards.size(0)

    n = total
    return total_loss / n, correct / n, total_policy_loss / n, total_value_loss / n


def evaluate(model, loader, device):
    """Evaluate model. Returns (avg_loss, top1_acc, top5_acc)."""
    model.eval()
    total_loss = 0.0
    correct_1 = 0
    correct_5 = 0
    total = 0

    with torch.no_grad():
        for boards, moves, values in loader:
            boards = boards.to(device)
            moves = moves.to(device)
            values = values.to(device).unsqueeze(1)

            policy_logits, value_pred = model(boards)

            policy_loss = F.cross_entropy(policy_logits, moves)
            value_loss = F.mse_loss(value_pred, values)
            loss = policy_loss + 0.5 * value_loss

            total_loss += loss.item() * boards.size(0)

            # Top-1
            _, pred1 = policy_logits.max(1)
            correct_1 += pred1.eq(moves).sum().item()

            # Top-5
            _, pred5 = policy_logits.topk(5, dim=1)
            correct_5 += pred5.eq(moves.unsqueeze(1)).any(1).sum().item()

            total += boards.size(0)

    n = total
    return total_loss / n, correct_1 / n, correct_5 / n


def main():
    parser = argparse.ArgumentParser(description='Train chess neural network')
    parser.add_argument('--dataset', type=str,
                        default=os.path.join(os.path.dirname(__file__), 'dataset.npz'),
                        help='Path to processed dataset .npz')
    parser.add_argument('--output', type=str,
                        default=os.path.join(os.path.dirname(__file__), 'chess_model.pth'),
                        help='Output path for trained model')
    parser.add_argument('--epochs', type=int, default=30,
                        help='Number of training epochs')
    parser.add_argument('--batch-size', type=int, default=256,
                        help='Training batch size')
    parser.add_argument('--lr', type=float, default=1e-3,
                        help='Initial learning rate')
    parser.add_argument('--filters', type=int, default=128,
                        help='Number of conv filters')
    parser.add_argument('--res-blocks', type=int, default=4,
                        help='Number of residual blocks')
    parser.add_argument('--val-split', type=float, default=0.1,
                        help='Validation split ratio')
    args = parser.parse_args()

    # Device
    if torch.backends.mps.is_available():
        device = torch.device('mps')
        print("Using Apple MPS (Metal) acceleration")
    elif torch.cuda.is_available():
        device = torch.device('cuda')
        print("Using CUDA GPU acceleration")
    else:
        device = torch.device('cpu')
        print("Using CPU (training will be slower)")

    # Load dataset
    print(f"\nLoading dataset from {args.dataset}...")
    dataset = ChessDataset(args.dataset)

    # Train/val split
    val_size = int(len(dataset) * args.val_split)
    train_size = len(dataset) - val_size
    train_dataset, val_dataset = random_split(
        dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42)
    )

    print(f"Train: {train_size} | Val: {val_size}")

    train_loader = DataLoader(
        train_dataset, batch_size=args.batch_size, shuffle=True,
        num_workers=0, pin_memory=True
    )
    val_loader = DataLoader(
        val_dataset, batch_size=args.batch_size, shuffle=False,
        num_workers=0, pin_memory=True
    )

    # Model
    model = ChessNet(
        num_move_classes=NUM_MOVE_CLASSES,
        num_filters=args.filters,
        num_res_blocks=args.res_blocks
    ).to(device)

    print(f"\nModel: {count_parameters(model):,} parameters")
    print(f"Move classes: {NUM_MOVE_CLASSES}\n")

    # Optimizer + scheduler
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    # Training loop
    best_val_acc = 0.0
    print(f"{'Epoch':>5} | {'Train Loss':>10} | {'P-Loss':>7} | {'V-Loss':>7} | "
          f"{'Train Acc':>9} | {'Val Acc@1':>9} | {'Val Acc@5':>9} | {'LR':>8} | {'Time':>6}")
    print("-" * 95)

    for epoch in range(1, args.epochs + 1):
        start = time.time()

        train_loss, train_acc, p_loss, v_loss = train_epoch(
            model, train_loader, optimizer, device
        )
        val_loss, val_acc1, val_acc5 = evaluate(model, val_loader, device)

        lr = optimizer.param_groups[0]['lr']
        elapsed = time.time() - start

        print(f"{epoch:>5} | {train_loss:>10.4f} | {p_loss:>7.4f} | {v_loss:>7.4f} | "
              f"{train_acc:>8.2%} | {val_acc1:>8.2%} | {val_acc5:>8.2%} | "
              f"{lr:>8.6f} | {elapsed:>5.1f}s")

        # Save best model
        if val_acc1 > best_val_acc:
            best_val_acc = val_acc1
            torch.save({
                'model_state_dict': model.state_dict(),
                'num_move_classes': NUM_MOVE_CLASSES,
                'num_filters': args.filters,
                'num_res_blocks': args.res_blocks,
                'epoch': epoch,
                'val_acc': val_acc1,
                'val_acc5': val_acc5,
            }, args.output)
            print(f"       ↑ Saved best model (acc@1: {val_acc1:.2%})")

        scheduler.step()

    print(f"\nTraining complete! Best validation accuracy: {best_val_acc:.2%}")
    print(f"Model saved to: {args.output}")


if __name__ == '__main__':
    main()
