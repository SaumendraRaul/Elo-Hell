import chess

from elohell import EloHellEngine
from elohell.evaluation import evaluate_white


def test_starting_position_is_roughly_equal():
    score = evaluate_white(chess.Board())
    assert abs(score) < 50


def test_engine_returns_legal_move():
    board = chess.Board()
    engine = EloHellEngine()
    result = engine.choose_move(board, max_depth=2, time_limit=None)

    assert result.move is not None
    assert result.move in board.legal_moves


def test_billidaaku_qxg2_checkmate():
    """Regression test from BilliDaaku vs piedro1990, Chess.com, 2026-10-02."""
    board = chess.Board()
    moves = [
        "e4", "e5",
        "Nf3", "Nc6",
        "Bb5", "f6",
        "d4", "Nxd4",
        "Nxd4", "exd4",
        "Qxd4", "a6",
        "Bc4", "Nh6",
        "Qd5", "c6",
        "Qd4", "b5",
        "Bd3", "Bb7",
        "Bxh6", "gxh6",
        "e5", "Qe7",
        "O-O", "fxe5",
        "Qc3", "b4",
        "Qd2", "Qg7",
        "Re1", "Bd6",
        "f4", "c5",
        "fxe5", "Bc7",
        "e6", "O-O-O",
        "e7", "Rde8",
        "Qe3",
    ]

    for san in moves:
        board.push_san(san)

    assert board.turn == chess.BLACK

    engine = EloHellEngine()
    result = engine.choose_move(board, max_depth=3, time_limit=None)

    expected = chess.Move.from_uci("g7g2")
    assert result.move == expected

    board.push(result.move)
    assert board.is_checkmate()
