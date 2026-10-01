const PIECES = {
  P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

const boardEl = document.querySelector("#board");
const statusEl = document.querySelector("#status");
const statusDot = document.querySelector("#status-dot");
const sideEl = document.querySelector("#side");
const difficultyEl = document.querySelector("#difficulty");
const newGameEl = document.querySelector("#new-game");
const gameTextEl = document.querySelector("#game-text");
const engineMoveEl = document.querySelector("#engine-move");
const depthEl = document.querySelector("#depth");
const nodesEl = document.querySelector("#nodes");
const evalEl = document.querySelector("#eval");
const pvEl = document.querySelector("#pv");

let pyodide;
let api = {};
let state = null;
let human = "w";
let selected = null;
let targets = [];
let lastMove = [];
let busy = true;

function setStatus(text, mode = "ready") {
  statusEl.textContent = text;
  statusDot.classList.toggle("loading", mode === "loading");
  statusDot.classList.toggle("error", mode === "error");
}

function ownPiece(symbol) {
  if (!symbol) return false;
  return human === "w"
    ? symbol === symbol.toUpperCase()
    : symbol === symbol.toLowerCase();
}

function boardOrder() {
  const files = human === "w"
    ? ["a","b","c","d","e","f","g","h"]
    : ["h","g","f","e","d","c","b","a"];
  const ranks = human === "w"
    ? [8,7,6,5,4,3,2,1]
    : [1,2,3,4,5,6,7,8];
  return { files, ranks };
}

function renderBoard() {
  if (!state) return;
  boardEl.replaceChildren();

  const { files, ranks } = boardOrder();
  for (const rank of ranks) {
    for (const file of files) {
      const square = `${file}${rank}`;
      const fileIndex = file.charCodeAt(0) - 97;
      const isLight = (fileIndex + rank) % 2 === 1;
      const piece = state.pieces[square];

      const button = document.createElement("button");
      button.type = "button";
      button.className = `square ${isLight ? "light" : "dark"}`;
      button.dataset.square = square;
      button.setAttribute("aria-label", square + (piece ? ` ${piece}` : ""));
      button.textContent = piece ? PIECES[piece] : "";

      if (selected === square) button.classList.add("selected");
      if (targets.includes(square)) {
        button.classList.add("target");
        if (piece) button.classList.add("capture");
      }
      if (lastMove.includes(square)) button.classList.add("last");

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = square;
      button.appendChild(coord);

      button.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(button);
    }
  }

  gameTextEl.textContent = state.status;
}

async function onSquareClick(square) {
  if (
    busy ||
    !state ||
    state.game_over ||
    state.turn !== human
  ) return;

  const piece = state.pieces[square];

  if (selected && targets.includes(square)) {
    await playHumanMove(selected, square);
    return;
  }

  if (selected === square) {
    selected = null;
    targets = [];
    renderBoard();
    return;
  }

  if (ownPiece(piece)) {
    selected = square;
    targets = JSON.parse(api.legalTargets(square));
  } else {
    selected = null;
    targets = [];
  }

  renderBoard();
}

function setControls(enabled) {
  sideEl.disabled = !enabled;
  difficultyEl.disabled = !enabled;
  newGameEl.disabled = !enabled;
}

function showEngineStats(data) {
  engineMoveEl.textContent = data.last_san || "—";
  depthEl.textContent = data.depth ?? "—";
  nodesEl.textContent =
    typeof data.nodes === "number"
      ? data.nodes.toLocaleString()
      : "—";

  if (typeof data.mate_in === "number") {
    evalEl.textContent = `M${data.mate_in}`;
  } else if (typeof data.score_cp === "number") {
    evalEl.textContent = (data.score_cp / 100).toFixed(2);
  } else {
    evalEl.textContent = "—";
  }

  pvEl.textContent = data.pv_san?.length
    ? "PV  " + data.pv_san.join(" ")
    : "";
}

async function playHumanMove(from, to) {
  busy = true;
  selected = null;
  targets = [];

  try {
    const next = JSON.parse(api.movePiece(from, to));
    state = next;
    lastMove = next.last_move || [from, to];
    renderBoard();

    if (!state.game_over && state.turn !== human) {
      await engineTurn();
    }
  } catch (error) {
    console.error(error);
    setStatus("Move rejected", "error");
  } finally {
    busy = false;
  }
}

async function engineTurn() {
  if (!state || state.game_over || state.turn === human) return;

  busy = true;
  setStatus("Thinking…", "loading");
  gameTextEl.textContent = "Elo Hell is inspecting your life choices…";

  // Give the browser one paint before the synchronous search begins.
  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  try {
    const [depth, seconds] = difficultyEl.value.split(",").map(Number);
    const result = JSON.parse(api.enginePlay(depth, seconds));

    state = result;
    lastMove = result.last_move || [];
    showEngineStats(result);
    renderBoard();
    setStatus(state.game_over ? "Game over" : "Ready");
  } catch (error) {
    console.error(error);
    setStatus("Engine crashed", "error");
    gameTextEl.textContent = String(error);
  } finally {
    busy = false;
  }
}

async function resetGame() {
  if (!api.resetGame) return;

  busy = true;
  selected = null;
  targets = [];
  lastMove = [];
  human = sideEl.value;

  engineMoveEl.textContent = "—";
  depthEl.textContent = "—";
  nodesEl.textContent = "—";
  evalEl.textContent = "—";
  pvEl.textContent = "";

  state = JSON.parse(api.resetGame());
  renderBoard();
  setStatus("Ready");

  busy = false;
  if (human === "b") {
    await engineTurn();
  }
}

async function loadEngineFiles() {
  const files = ["__init__.py", "evaluation.py", "search.py", "engine.py"];
  pyodide.FS.mkdirTree("/home/pyodide/elohell");

  for (const name of files) {
    const response = await fetch(`./elohell/${name}`);
    if (!response.ok) {
      throw new Error(`Could not load ${name}: HTTP ${response.status}`);
    }
    const source = await response.text();
    pyodide.FS.writeFile(`/home/pyodide/elohell/${name}`, source);
  }
}

async function boot() {
  try {
    setStatus("Loading Python runtime…", "loading");

    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
    });

    setStatus("Installing chess rules…", "loading");
    await pyodide.loadPackage("micropip");
    await pyodide.runPythonAsync(`
import micropip
await micropip.install("python-chess==1.999")
`);

    setStatus("Loading Elo Hell…", "loading");
    await loadEngineFiles();

    await pyodide.runPythonAsync(`
import json
import sys
import chess

sys.path.insert(0, "/home/pyodide")
from elohell import EloHellEngine

board = chess.Board()
engine = EloHellEngine()

def _status_text():
    outcome = board.outcome(claim_draw=True)
    if outcome is not None:
        if board.is_checkmate():
            winner = "Black" if board.turn == chess.WHITE else "White"
            return f"Checkmate. {winner} wins."
        return f"Game over: {outcome.result()} · {outcome.termination.name.replace('_', ' ').title()}"

    side = "White" if board.turn == chess.WHITE else "Black"
    return f"{side} to move" + (" · check" if board.is_check() else "")

def _payload(extra=None):
    data = {
        "fen": board.fen(),
        "turn": "w" if board.turn == chess.WHITE else "b",
        "pieces": {
            chess.square_name(square): piece.symbol()
            for square, piece in board.piece_map().items()
        },
        "check": board.is_check(),
        "game_over": board.is_game_over(claim_draw=True),
        "status": _status_text(),
    }
    if extra:
        data.update(extra)
    return json.dumps(data)

def reset_game():
    global board
    board = chess.Board()
    engine.new_game()
    return _payload()

def legal_targets(origin):
    square = chess.parse_square(origin)
    return json.dumps([
        chess.square_name(move.to_square)
        for move in board.legal_moves
        if move.from_square == square
    ])

def move_piece(origin, destination):
    from_square = chess.parse_square(origin)
    to_square = chess.parse_square(destination)
    candidates = [
        move for move in board.legal_moves
        if move.from_square == from_square and move.to_square == to_square
    ]
    if not candidates:
        raise ValueError("Illegal move")

    move = next(
        (candidate for candidate in candidates if candidate.promotion == chess.QUEEN),
        candidates[0],
    )
    san = board.san(move)
    board.push(move)

    return _payload({
        "last_move": [origin, destination],
        "last_san": san,
    })

def engine_play(depth, time_limit):
    result = engine.choose_move(
        board,
        max_depth=int(depth),
        time_limit=float(time_limit),
    )

    if result.move is None:
        return _payload()

    pv_board = board.copy(stack=False)
    pv_san = []
    for move in result.pv:
        if move not in pv_board.legal_moves:
            break
        pv_san.append(pv_board.san(move))
        pv_board.push(move)

    san = board.san(result.move)
    uci = result.move.uci()
    board.push(result.move)

    return _payload({
        "last_move": [uci[:2], uci[2:4]],
        "last_san": san,
        "score_cp": result.score_cp,
        "mate_in": result.mate_in,
        "depth": result.depth,
        "nodes": result.nodes,
        "elapsed": result.elapsed,
        "pv_san": pv_san,
    })
`);

    api.resetGame = pyodide.globals.get("reset_game");
    api.legalTargets = pyodide.globals.get("legal_targets");
    api.movePiece = pyodide.globals.get("move_piece");
    api.enginePlay = pyodide.globals.get("engine_play");

    state = JSON.parse(api.resetGame());
    busy = false;
    setControls(true);
    setStatus("Ready");
    renderBoard();
  } catch (error) {
    console.error(error);
    busy = true;
    setStatus("Failed to load", "error");
    gameTextEl.textContent =
      "Elo Hell failed to boot. Check the browser console for the tiny demon responsible.";
  }
}

sideEl.addEventListener("change", resetGame);
newGameEl.addEventListener("click", resetGame);

boot();
