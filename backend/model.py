"""
model.py — Mental Chess Neural Network

Dual-head Value-Policy convolutional network for chess move prediction.

Architecture:
  Input: 8×8×12 bitboard (batch, 12, 8, 8)
  → 3 convolutional blocks with residual connections
  → Policy head: predicts move probabilities over all legal moves
  → Value head: estimates position evaluation (-1 to +1)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class ConvBlock(nn.Module):
    """Convolutional block: Conv2D → BatchNorm → ReLU."""

    def __init__(self, in_channels, out_channels, kernel_size=3, padding=1):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size, padding=padding)
        self.bn = nn.BatchNorm2d(out_channels)

    def forward(self, x):
        return F.relu(self.bn(self.conv(x)))


class ResBlock(nn.Module):
    """Residual block: two conv layers with skip connection."""

    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = F.relu(out + residual)
        return out


class ChessNet(nn.Module):
    """
    Value-Policy network for chess.

    Args:
        num_move_classes: Number of possible move classifications.
        num_filters: Number of convolutional filters.
        num_res_blocks: Number of residual blocks.
    """

    def __init__(self, num_move_classes, num_filters=128, num_res_blocks=4):
        super().__init__()
        self.num_move_classes = num_move_classes

        # --- Shared Trunk ---
        # Initial projection from 12 input channels
        self.input_block = ConvBlock(12, num_filters)

        # Residual tower
        self.res_blocks = nn.ModuleList([
            ResBlock(num_filters) for _ in range(num_res_blocks)
        ])

        # --- Policy Head ---
        self.policy_conv = ConvBlock(num_filters, 32, kernel_size=1, padding=0)
        self.policy_fc = nn.Linear(32 * 8 * 8, num_move_classes)

        # --- Value Head ---
        self.value_conv = ConvBlock(num_filters, 1, kernel_size=1, padding=0)
        self.value_fc1 = nn.Linear(1 * 8 * 8, 256)
        self.value_fc2 = nn.Linear(256, 1)

    def forward(self, x):
        """
        Args:
            x: Tensor of shape (batch, 12, 8, 8) — bitboard encoding.

        Returns:
            policy_logits: (batch, num_move_classes) — raw logits for moves
            value: (batch, 1) — position evaluation in [-1, 1]
        """
        # Shared trunk
        out = self.input_block(x)
        for block in self.res_blocks:
            out = block(out)

        # Policy head
        p = self.policy_conv(out)
        p = p.view(p.size(0), -1)
        policy_logits = self.policy_fc(p)

        # Value head
        v = self.value_conv(out)
        v = v.view(v.size(0), -1)
        v = F.relu(self.value_fc1(v))
        value = torch.tanh(self.value_fc2(v))

        return policy_logits, value


def count_parameters(model):
    """Count total trainable parameters."""
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == '__main__':
    # Quick architecture test
    from data_pipeline import NUM_MOVE_CLASSES

    model = ChessNet(num_move_classes=NUM_MOVE_CLASSES)
    print(f"ChessNet architecture:")
    print(f"  Move classes: {NUM_MOVE_CLASSES}")
    print(f"  Parameters:   {count_parameters(model):,}")
    print()

    # Test forward pass
    dummy_input = torch.randn(4, 12, 8, 8)
    policy, value = model(dummy_input)
    print(f"  Input shape:  {dummy_input.shape}")
    print(f"  Policy shape: {policy.shape}")
    print(f"  Value shape:  {value.shape}")
    print(f"  Policy sum (softmax): {F.softmax(policy[0], dim=0).sum():.4f}")
    print(f"  Value range: [{value.min():.3f}, {value.max():.3f}]")
