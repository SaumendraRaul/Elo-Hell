"""Static position evaluation for Elo Hell."""

from __future__ import annotations

import chess

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}

# Tables are written rank 8 -> rank 1 (a8 -> h1), matching common PST notation.
PAWN_TABLE = [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
]

KNIGHT_TABLE = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
]

BISHOP_TABLE = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
]

ROOK_TABLE = [
      0,   0,   5,  10,  10,   5,   0,   0,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      5,  10,  10,  10,  10,  10,  10,   5,
      0,   0,   0,   5,   5,   0,   0,   0,
]

QUEEN_TABLE = [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -10,   5,   5,   5,   5,   5,   0, -10,
      0,   0,   5,   5,   5,   5,   0,  -5,
     -5,   0,   5,   5,   5,   5,   0,  -5,
    -10,   0,   5,   5,   5,   5,   0, -10,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
]

KING_MID_TABLE = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
]

TABLES = {
    chess.PAWN: PAWN_TABLE,
    chess.KNIGHT: KNIGHT_TABLE,
    chess.BISHOP: BISHOP_TABLE,
    chess.ROOK: ROOK_TABLE,
    chess.QUEEN: QUEEN_TABLE,
    chess.KING: KING_MID_TABLE,
}


def _square_for_color(square: chess.Square, color: chess.Color) -> chess.Square:
    # python-chess indexes a1 as 0, while these tables begin at a8.
    # Mirror White squares into table coordinates; Black already lines up.
    return chess.square_mirror(square) if color == chess.WHITE else square


def _pawn_structure(board: chess.Board, color: chess.Color) -> int:
    pawns = list(board.pieces(chess.PAWN, color))
    if not pawns:
        return 0

    score = 0
    files = [chess.square_file(sq) for sq in pawns]

    # Doubled and isolated pawns.
    for file_idx in range(8):
        count = files.count(file_idx)
        if count > 1:
            score -= 12 * (count - 1)

    for sq in pawns:
        file_idx = chess.square_file(sq)
        neighbors = {file_idx - 1, file_idx + 1}
        if not any(f in files for f in neighbors if 0 <= f <= 7):
            score -= 10

        # Passed pawn bonus grows as it approaches promotion.
        rank = chess.square_rank(sq)
        enemy_pawns = board.pieces(chess.PAWN, not color)
        blocked = False
        for enemy_sq in enemy_pawns:
            enemy_file = chess.square_file(enemy_sq)
            if abs(enemy_file - file_idx) > 1:
                continue
            enemy_rank = chess.square_rank(enemy_sq)
            if (color == chess.WHITE and enemy_rank > rank) or (
                color == chess.BLACK and enemy_rank < rank
            ):
                blocked = True
                break

        if not blocked:
            progress = rank if color == chess.WHITE else 7 - rank
            score += 10 + progress * 7

    return score


def _activity(board: chess.Board, color: chess.Color) -> int:
    score = 0
    weights = {
        chess.KNIGHT: 2,
        chess.BISHOP: 2,
        chess.ROOK: 1,
        chess.QUEEN: 1,
    }
    for piece_type, weight in weights.items():
        for square in board.pieces(piece_type, color):
            score += len(board.attacks(square)) * weight
    return score


def evaluate_white(board: chess.Board) -> int:
    """Return a centipawn score from White's point of view."""
    if board.is_checkmate():
        return -100_000 if board.turn == chess.WHITE else 100_000
    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    score = 0

    for color, sign in ((chess.WHITE, 1), (chess.BLACK, -1)):
        bishops = len(board.pieces(chess.BISHOP, color))
        if bishops >= 2:
            score += sign * 25

        for piece_type, value in PIECE_VALUES.items():
            table = TABLES[piece_type]
            for square in board.pieces(piece_type, color):
                pst_square = _square_for_color(square, color)
                score += sign * (value + table[pst_square])

        score += sign * _pawn_structure(board, color)
        score += sign * _activity(board, color)

    # A tiny tempo bonus keeps equal positions from being perfectly flat.
    score += 8 if board.turn == chess.WHITE else -8
    return score


def evaluate(board: chess.Board) -> int:
    """Return a centipawn score from the side-to-move's point of view."""
    score = evaluate_white(board)
    return score if board.turn == chess.WHITE else -score
