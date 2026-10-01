"""Search algorithms for Elo Hell."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Optional

import chess
import chess.polyglot

from .evaluation import PIECE_VALUES, evaluate

MATE_SCORE = 100_000
MATE_THRESHOLD = 99_000
INFINITY = 1_000_000

EXACT = 0
LOWER_BOUND = 1
UPPER_BOUND = 2


class SearchTimeout(Exception):
    """Raised internally when the current search exceeds its time budget."""


@dataclass(slots=True)
class TTEntry:
    depth: int
    score: int
    flag: int
    best_move: Optional[chess.Move]


@dataclass(slots=True)
class SearchInfo:
    depth: int
    score: int
    best_move: Optional[chess.Move]
    nodes: int
    elapsed: float
    pv: list[chess.Move]


class Searcher:
    def __init__(self) -> None:
        self.tt: dict[int, TTEntry] = {}
        self.nodes = 0
        self.deadline: Optional[float] = None

    def clear(self) -> None:
        self.tt.clear()

    def search(
        self,
        board: chess.Board,
        *,
        max_depth: int = 5,
        time_limit: Optional[float] = 2.0,
    ) -> SearchInfo:
        """Iteratively deepen and return the best fully-searched result."""
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return SearchInfo(
                depth=0,
                score=self._terminal_score(board, 0),
                best_move=None,
                nodes=0,
                elapsed=0.0,
                pv=[],
            )

        started = time.perf_counter()
        self.deadline = (
            started + max(0.001, time_limit)
            if time_limit is not None
            else None
        )
        self.nodes = 0

        # Always have a legal fallback in case the clock expires immediately.
        completed = SearchInfo(
            depth=0,
            score=0,
            best_move=legal_moves[0],
            nodes=0,
            elapsed=0.0,
            pv=[legal_moves[0]],
        )

        for depth in range(1, max(1, max_depth) + 1):
            try:
                score, move = self._search_root(board, depth)
            except SearchTimeout:
                break

            if move is None:
                break

            elapsed = time.perf_counter() - started
            completed = SearchInfo(
                depth=depth,
                score=score,
                best_move=move,
                nodes=self.nodes,
                elapsed=elapsed,
                pv=self._extract_pv(board, depth),
            )

            if abs(score) >= MATE_THRESHOLD:
                break

        completed.nodes = self.nodes
        completed.elapsed = time.perf_counter() - started
        return completed

    def _search_root(self, board: chess.Board, depth: int) -> tuple[int, Optional[chess.Move]]:
        self._check_time(force=True)

        alpha = -INFINITY
        beta = INFINITY
        best_score = -INFINITY
        best_move: Optional[chess.Move] = None

        key = chess.polyglot.zobrist_hash(board)
        tt_move = self.tt.get(key).best_move if key in self.tt else None

        for move in self._ordered_moves(board, tt_move):
            self._check_time()
            board.push(move)
            score = -self._negamax(board, depth - 1, -beta, -alpha, 1)
            board.pop()

            if score > best_score:
                best_score = score
                best_move = move
            if score > alpha:
                alpha = score

        self.tt[key] = TTEntry(
            depth=depth,
            score=best_score,
            flag=EXACT,
            best_move=best_move,
        )
        return best_score, best_move

    def _negamax(
        self,
        board: chess.Board,
        depth: int,
        alpha: int,
        beta: int,
        ply: int,
    ) -> int:
        self.nodes += 1
        self._check_time()

        if board.is_checkmate():
            return -MATE_SCORE + ply
        if self._is_draw(board):
            return 0
        if depth <= 0:
            return self._quiescence(board, alpha, beta, ply, qdepth=0)

        key = chess.polyglot.zobrist_hash(board)
        original_alpha = alpha
        entry = self.tt.get(key)
        tt_move: Optional[chess.Move] = None

        if entry is not None:
            tt_move = entry.best_move
            if entry.depth >= depth:
                if entry.flag == EXACT:
                    return entry.score
                if entry.flag == LOWER_BOUND:
                    alpha = max(alpha, entry.score)
                elif entry.flag == UPPER_BOUND:
                    beta = min(beta, entry.score)
                if alpha >= beta:
                    return entry.score

        best_score = -INFINITY
        best_move: Optional[chess.Move] = None

        for move in self._ordered_moves(board, tt_move):
            board.push(move)
            score = -self._negamax(board, depth - 1, -beta, -alpha, ply + 1)
            board.pop()

            if score > best_score:
                best_score = score
                best_move = move

            if score > alpha:
                alpha = score
            if alpha >= beta:
                break

        if best_move is None:
            return self._terminal_score(board, ply)

        if best_score <= original_alpha:
            flag = UPPER_BOUND
        elif best_score >= beta:
            flag = LOWER_BOUND
        else:
            flag = EXACT

        self.tt[key] = TTEntry(
            depth=depth,
            score=best_score,
            flag=flag,
            best_move=best_move,
        )
        return best_score

    def _quiescence(
        self,
        board: chess.Board,
        alpha: int,
        beta: int,
        ply: int,
        qdepth: int,
    ) -> int:
        self.nodes += 1
        self._check_time()

        if board.is_checkmate():
            return -MATE_SCORE + ply
        if self._is_draw(board):
            return 0

        # Hard guard against pathological capture/check sequences.
        if qdepth >= 10:
            return evaluate(board)

        if board.is_check():
            # In check, "stand pat" is illegal. Search every evasion.
            moves = list(board.legal_moves)
            if not moves:
                return -MATE_SCORE + ply

            best = -INFINITY
            for move in self._ordered_moves(board, None, moves):
                board.push(move)
                score = -self._quiescence(
                    board, -beta, -alpha, ply + 1, qdepth + 1
                )
                board.pop()

                best = max(best, score)
                alpha = max(alpha, score)
                if alpha >= beta:
                    break
            return best

        stand_pat = evaluate(board)
        if stand_pat >= beta:
            return beta
        if stand_pat > alpha:
            alpha = stand_pat

        tactical_moves = [
            move
            for move in board.legal_moves
            if board.is_capture(move) or move.promotion is not None
        ]

        for move in self._ordered_moves(board, None, tactical_moves):
            board.push(move)
            score = -self._quiescence(
                board, -beta, -alpha, ply + 1, qdepth + 1
            )
            board.pop()

            if score >= beta:
                return beta
            if score > alpha:
                alpha = score

        return alpha

    def _ordered_moves(
        self,
        board: chess.Board,
        tt_move: Optional[chess.Move],
        moves: Optional[list[chess.Move]] = None,
    ) -> list[chess.Move]:
        if moves is None:
            moves = list(board.legal_moves)

        def score_move(move: chess.Move) -> int:
            score = 0

            if tt_move is not None and move == tt_move:
                score += 2_000_000

            if move.promotion is not None:
                score += 900_000 + PIECE_VALUES.get(move.promotion, 0)

            if board.is_capture(move):
                attacker = board.piece_at(move.from_square)
                if board.is_en_passant(move):
                    victim_value = PIECE_VALUES[chess.PAWN]
                else:
                    victim = board.piece_at(move.to_square)
                    victim_value = PIECE_VALUES.get(victim.piece_type, 0) if victim else 0
                attacker_value = (
                    PIECE_VALUES.get(attacker.piece_type, 0) if attacker else 0
                )
                score += 500_000 + (10 * victim_value) - attacker_value

            if board.gives_check(move):
                score += 50_000

            return score

        return sorted(moves, key=score_move, reverse=True)

    def _extract_pv(self, board: chess.Board, max_length: int) -> list[chess.Move]:
        line: list[chess.Move] = []
        probe = board.copy(stack=False)

        for _ in range(max_length):
            key = chess.polyglot.zobrist_hash(probe)
            entry = self.tt.get(key)
            if entry is None or entry.best_move is None:
                break
            move = entry.best_move
            if move not in probe.legal_moves:
                break
            line.append(move)
            probe.push(move)

        return line

    def _check_time(self, *, force: bool = False) -> None:
        if self.deadline is None:
            return
        if not force and (self.nodes & 2047) != 0:
            return
        if time.perf_counter() >= self.deadline:
            raise SearchTimeout

    @staticmethod
    def _is_draw(board: chess.Board) -> bool:
        return (
            board.is_stalemate()
            or board.is_insufficient_material()
            or board.is_seventyfive_moves()
            or board.is_fivefold_repetition()
        )

    @staticmethod
    def _terminal_score(board: chess.Board, ply: int) -> int:
        if board.is_checkmate():
            return -MATE_SCORE + ply
        return 0
