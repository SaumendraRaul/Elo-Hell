"""Public Elo Hell engine API."""

from __future__ import annotations

from dataclasses import dataclass

import chess

from .search import MATE_SCORE, MATE_THRESHOLD, Searcher


@dataclass(slots=True)
class SearchResult:
    move: chess.Move | None
    score_cp: int
    depth: int
    nodes: int
    elapsed: float
    pv: list[chess.Move]

    @property
    def is_mate_score(self) -> bool:
        return abs(self.score_cp) >= MATE_THRESHOLD

    @property
    def mate_in(self) -> int | None:
        if not self.is_mate_score:
            return None
        plies = MATE_SCORE - abs(self.score_cp)
        moves = (plies + 1) // 2
        return moves if self.score_cp > 0 else -moves


class EloHellEngine:
    """Small chess engine with a stable API for CLI/web integrations."""

    def __init__(self) -> None:
        self.searcher = Searcher()

    def choose_move(
        self,
        board: chess.Board,
        *,
        max_depth: int = 5,
        time_limit: float | None = 2.0,
    ) -> SearchResult:
        info = self.searcher.search(
            board,
            max_depth=max_depth,
            time_limit=time_limit,
        )
        return SearchResult(
            move=info.best_move,
            score_cp=info.score,
            depth=info.depth,
            nodes=info.nodes,
            elapsed=info.elapsed,
            pv=info.pv,
        )

    def new_game(self) -> None:
        self.searcher.clear()
