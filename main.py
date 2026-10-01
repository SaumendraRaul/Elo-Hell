"""Play a terminal game against Elo Hell."""

from __future__ import annotations

import chess

from elohell import EloHellEngine


def score_text(score_cp: int, mate_in: int | None) -> str:
    if mate_in is not None:
        return f"mate {mate_in:+d}"
    return f"{score_cp / 100:+.2f}"


def main() -> None:
    board = chess.Board()
    engine = EloHellEngine()

    answer = input("Play as [w/b] (default w): ").strip().lower()
    human = chess.BLACK if answer.startswith("b") else chess.WHITE

    print("\nWelcome to Elo Hell. Bad moves enter. Search trees leave.\n")

    while not board.is_game_over(claim_draw=True):
        print(board)
        print()

        if board.turn == human:
            raw = input("Your move (SAN, or 'quit'): ").strip()
            if raw.lower() in {"quit", "exit"}:
                return
            try:
                board.push_san(raw)
            except ValueError:
                print("Illegal/unknown move. Try SAN such as e4, Nf3, Qxd5, O-O.\n")
                continue
        else:
            result = engine.choose_move(board, max_depth=6, time_limit=2.0)
            if result.move is None:
                break

            san = board.san(result.move)
            pv_board = board.copy(stack=False)
            pv_san: list[str] = []
            for move in result.pv:
                if move not in pv_board.legal_moves:
                    break
                pv_san.append(pv_board.san(move))
                pv_board.push(move)

            print(
                f"Elo Hell: {san}  "
                f"[depth {result.depth}, "
                f"score {score_text(result.score_cp, result.mate_in)}, "
                f"nodes {result.nodes:,}, "
                f"{result.elapsed:.2f}s]"
            )
            if pv_san:
                print("PV:", " ".join(pv_san))
            print()
            board.push(result.move)

    print(board)
    print()
    outcome = board.outcome(claim_draw=True)
    if outcome is not None:
        print("Game over:", outcome.result(), "-", outcome.termination.name.replace("_", " ").title())
    else:
        print("Game over.")


if __name__ == "__main__":
    main()
