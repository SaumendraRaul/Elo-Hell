# Elo Hell ♟️🔥

A tiny chess engine with an unnecessarily dramatic name.

**Elo Hell** is a from-scratch search engine built in Python on top of `python-chess` for rules and move legality. The engine itself handles evaluation, move ordering, iterative deepening, alpha-beta/negamax search, quiescence search, and a transposition table.

> Because every blunder deserves a search tree.

## Current engine

- Legal move generation via `python-chess`
- Negamax with alpha-beta pruning
- Iterative deepening
- Quiescence search
- Transposition table using Zobrist hashes
- Capture/check/promotion move ordering
- Material + piece-square + mobility evaluation
- Checkmate-aware scoring
- Time-limited search
- Simple CLI
- Regression test for BilliDaaku's `Qxg2#` checkmate

## Install

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

On Linux/macOS:

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

## Play against it

```bash
python main.py
```

Moves are entered in SAN, for example `e4`, `Nf3`, `O-O`.

## Run tests

```bash
pytest -q
```

## Roadmap

The fun stuff comes next: stronger evaluation, killer/history heuristics, aspiration windows, opening book support, proper UCI support, endgame tuning, and eventually a web board.

Built for the lower circles of the rating ladder.
