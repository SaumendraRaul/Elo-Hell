const PIECES = {
  P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

const $ = (selector) => document.querySelector(selector);

const reviewBoardEl = $("#review-board");
const playBoardEl = $("#play-board");
const statusEl = $("#status");
const statusDot = $("#status-dot");
const sideEl = $("#side");
const difficultyEl = $("#difficulty");
const newGameEl = $("#new-game");
const gameTextEl = $("#game-text");
const engineMoveEl = $("#engine-move");
const depthEl = $("#depth");
const nodesEl = $("#nodes");
const evalEl = $("#eval");
const pvEl = $("#pv");

const pgnFileEl = $("#pgn-file");
const pgnTextEl = $("#pgn-text");
const loadPastedEl = $("#load-pasted");
const analyzeGameEl = $("#analyze-game");
const reviewStrengthEl = $("#review-strength");
const dropZoneEl = $("#drop-zone");
const reviewProgressEl = $("#review-progress");
const progressFillEl = $("#progress-fill");
const progressTextEl = $("#progress-text");
const gameTitleEl = $("#game-title");
const gameSubtitleEl = $("#game-subtitle");
const moveCountEl = $("#move-count");
const movesListEl = $("#moves-list");
const summaryCardEl = $("#summary-card");
const resultLineEl = $("#result-line");
const reviewStatusEl = $("#review-status");
const classCountsEl = $("#class-counts");
const reviewPvEl = $("#review-pv");
const selectedMoveEl = $("#selected-move");
const selectedClassEl = $("#selected-class");
const selectedBestEl = $("#selected-best");
const selectedLossEl = $("#selected-loss");
const enginePillEl = $("#engine-pill");

let pyodide;
let api = {};

let playState = null;
let human = "w";
let selected = null;
let targets = [];
let lastMove = [];
let busy = true;

let loadedGame = null;
let reviewResults = [];
let selectedReviewIndex = -1;
let reviewBusy = false;

function setStatus(text, mode = "ready") {
  statusEl.textContent = text;
  statusDot.classList.toggle("loading", mode === "loading");
  statusDot.classList.toggle("error", mode === "error");
}

function setEnginePill(text, mode = "ready") {
  enginePillEl.textContent = text;
  enginePillEl.classList.toggle("loading", mode === "loading");
  enginePillEl.classList.toggle("ready", mode === "ready");
}

function ownPiece(symbol) {
  if (!symbol) return false;
  return human === "w"
    ? symbol === symbol.toUpperCase()
    : symbol === symbol.toLowerCase();
}

function boardOrder(orientation = "w") {
  const files = orientation === "w"
    ? ["a","b","c","d","e","f","g","h"]
    : ["h","g","f","e","d","c","b","a"];
  const ranks = orientation === "w"
    ? [8,7,6,5,4,3,2,1]
    : [1,2,3,4,5,6,7,8];
  return { files, ranks };
}

function renderBoard({
  element,
  state,
  orientation = "w",
  interactive = false,
  selectedSquare = null,
  legalTargets = [],
  lastSquares = [],
}) {
  if (!state) return;
  element.replaceChildren();

  const { files, ranks } = boardOrder(orientation);
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
      if (!interactive) button.style.cursor = "default";

      if (selectedSquare === square) button.classList.add("selected");
      if (legalTargets.includes(square)) {
        button.classList.add("target");
        if (piece) button.classList.add("capture");
      }
      if (lastSquares.includes(square)) button.classList.add("last");

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = square;
      button.appendChild(coord);

      if (interactive) {
        button.addEventListener("click", () => onPlaySquareClick(square));
      }
      element.appendChild(button);
    }
  }
}

function renderPlayBoard() {
  renderBoard({
    element: playBoardEl,
    state: playState,
    orientation: human,
    interactive: true,
    selectedSquare: selected,
    legalTargets: targets,
    lastSquares: lastMove,
  });
  if (playState) gameTextEl.textContent = playState.status;
}

function setEvalBar(prefix, analysis) {
  const fill = prefix === "review" ? $("#eval-white") : $("#play-eval-white");
  const label = prefix === "review" ? $("#eval-bar-label") : $("#play-eval-label");

  if (!analysis) {
    fill.style.height = "50%";
    label.textContent = "0.0";
    return;
  }

  let cp = Number(analysis.white_score_cp ?? 0);
  const mate = analysis.white_mate_in;

  let pct;
  if (typeof mate === "number" && mate !== 0) {
    pct = mate > 0 ? 98 : 2;
    label.textContent = mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  } else {
    pct = 50 + 50 * Math.tanh(cp / 450);
    pct = Math.max(2, Math.min(98, pct));
    label.textContent = `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
  }

  fill.style.height = `${pct}%`;
}

async function onPlaySquareClick(square) {
  if (
    busy ||
    !playState ||
    playState.game_over ||
    playState.turn !== human
  ) return;

  const piece = playState.pieces[square];

  if (selected && targets.includes(square)) {
    await playHumanMove(selected, square);
    return;
  }

  if (selected === square) {
    selected = null;
    targets = [];
    renderPlayBoard();
    return;
  }

  if (ownPiece(piece)) {
    selected = square;
    targets = JSON.parse(api.legalTargets(square));
  } else {
    selected = null;
    targets = [];
  }

  renderPlayBoard();
}

function setPlayControls(enabled) {
  sideEl.disabled = !enabled;
  difficultyEl.disabled = !enabled;
  newGameEl.disabled = !enabled;
}

function showEngineStats(data) {
  engineMoveEl.textContent = data.last_san || "—";
  depthEl.textContent = data.depth ?? "—";
  nodesEl.textContent =
    typeof data.nodes === "number" ? data.nodes.toLocaleString() : "—";

  if (typeof data.white_mate_in === "number" && data.white_mate_in !== 0) {
    evalEl.textContent =
      data.white_mate_in > 0
        ? `M${data.white_mate_in}`
        : `-M${Math.abs(data.white_mate_in)}`;
  } else if (typeof data.white_score_cp === "number") {
    evalEl.textContent = `${data.white_score_cp >= 0 ? "+" : ""}${(data.white_score_cp / 100).toFixed(2)}`;
  } else {
    evalEl.textContent = "—";
  }

  pvEl.textContent = data.pv_san?.length
    ? "PV  " + data.pv_san.join(" ")
    : "";

  setEvalBar("play", data);
}

async function playHumanMove(from, to) {
  busy = true;
  selected = null;
  targets = [];

  try {
    const next = JSON.parse(api.movePiece(from, to));
    playState = next;
    lastMove = next.last_move || [from, to];
    renderPlayBoard();

    if (!playState.game_over && playState.turn !== human) {
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
  if (!playState || playState.game_over || playState.turn === human) return;

  busy = true;
  setStatus("Thinking…", "loading");
  gameTextEl.textContent = "Elo Hell is inspecting your life choices…";
  await new Promise(resolve => requestAnimationFrame(resolve));

  try {
    const [depth, seconds] = difficultyEl.value.split(",").map(Number);
    const result = JSON.parse(api.enginePlay(depth, seconds));

    playState = result;
    lastMove = result.last_move || [];
    showEngineStats(result);
    renderPlayBoard();
    setStatus(playState.game_over ? "Game over" : "Ready");
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
  setEvalBar("play", null);

  playState = JSON.parse(api.resetGame());
  renderPlayBoard();
  setStatus("Ready");

  busy = false;
  if (human === "b") await engineTurn();
}

function classificationFor(loss, actualUci, bestUci) {
  if (bestUci && actualUci === bestUci) return "Best";
  if (loss <= 15) return "Excellent";
  if (loss <= 50) return "Good";
  if (loss <= 110) return "Inaccuracy";
  if (loss <= 250) return "Mistake";
  return "Blunder";
}

function classSlug(name) {
  return name.toLowerCase();
}

function normalizedScore(cp) {
  return Math.max(-10000, Math.min(10000, Number(cp || 0)));
}

function calcLoss(move, before, after) {
  const best = normalizedScore(before.white_score_cp);
  const played = normalizedScore(after.white_score_cp);
  const raw = move.mover === "w" ? best - played : played - best;
  return Math.max(0, Math.round(raw));
}

function formatLoss(cp) {
  if (cp == null) return "—";
  if (cp >= 1000) return "10.0+";
  return (cp / 100).toFixed(2);
}

function moveDisplayTitle(headers) {
  const white = headers.White || "White";
  const black = headers.Black || "Black";
  return `${white} vs ${black}`;
}

async function loadPGNText(text, sourceName = "PGN") {
  if (!api.parsePgn || !text.trim()) return;

  try {
    const parsed = JSON.parse(api.parsePgn(text));
    loadedGame = parsed;
    reviewResults = [];
    selectedReviewIndex = -1;

    const headers = parsed.headers || {};
    gameTitleEl.textContent = moveDisplayTitle(headers);
    const bits = [
      headers.Event,
      headers.Date,
      headers.Result,
    ].filter(Boolean);
    gameSubtitleEl.textContent = bits.join(" · ") || sourceName;
    moveCountEl.textContent = `${parsed.moves.length} plies`;

    const startState = JSON.parse(api.positionState(parsed.positions[0]));
    renderBoard({
      element: reviewBoardEl,
      state: startState,
      orientation: "w",
      interactive: false,
    });

    movesListEl.className = "moves-list empty-state";
    movesListEl.textContent = "PGN loaded. Hit Analyze game.";
    summaryCardEl.classList.add("hidden");
    analyzeGameEl.disabled = false;
    selectedMoveEl.textContent = "Start position";
    selectedClassEl.textContent = "—";
    selectedBestEl.textContent = "—";
    selectedLossEl.textContent = "—";
    reviewPvEl.textContent = "Run the review to see Elo Hell's preferred lines.";
    setEvalBar("review", null);
  } catch (error) {
    console.error(error);
    gameTitleEl.textContent = "Could not read PGN";
    gameSubtitleEl.textContent = String(error);
    analyzeGameEl.disabled = true;
  }
}

async function analyzeLoadedGame() {
  if (!loadedGame || reviewBusy) return;

  reviewBusy = true;
  analyzeGameEl.disabled = true;
  reviewStrengthEl.disabled = true;
  reviewProgressEl.classList.remove("hidden");
  summaryCardEl.classList.add("hidden");
  reviewStatusEl.textContent = "Analyzing";
  reviewStatusEl.classList.add("loading");

  const [depth, seconds] = reviewStrengthEl.value.split(",").map(Number);
  const analyses = [];
  const total = loadedGame.positions.length;

  try {
    for (let i = 0; i < total; i++) {
      const analysis = JSON.parse(api.analyzeFen(loadedGame.positions[i], depth, seconds));
      analyses.push(analysis);

      const pct = Math.round(((i + 1) / total) * 100);
      progressFillEl.style.width = `${pct}%`;
      progressTextEl.textContent = `${pct}%`;
      gameSubtitleEl.textContent = `Analyzing position ${i + 1} of ${total}…`;

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    reviewResults = loadedGame.moves.map((move, i) => {
      const before = analyses[i];
      const after = analyses[i + 1];
      const loss = calcLoss(move, before, after);
      const classification = classificationFor(loss, move.uci, before.best_uci);
      return { ...move, before, after, loss, classification };
    });

    renderReviewResults();
    gameSubtitleEl.textContent = [
      loadedGame.headers.Event,
      loadedGame.headers.Date,
      loadedGame.headers.Result,
    ].filter(Boolean).join(" · ") || "Review complete";

    reviewStatusEl.textContent = "Complete";
    reviewStatusEl.classList.remove("loading");
    reviewStatusEl.classList.add("ready");
    summaryCardEl.classList.remove("hidden");

    if (reviewResults.length) selectReviewMove(0);
  } catch (error) {
    console.error(error);
    reviewStatusEl.textContent = "Failed";
    gameSubtitleEl.textContent = String(error);
  } finally {
    reviewBusy = false;
    analyzeGameEl.disabled = false;
    reviewStrengthEl.disabled = false;
  }
}

function renderReviewResults() {
  const counts = {
    Best: 0,
    Excellent: 0,
    Good: 0,
    Inaccuracy: 0,
    Mistake: 0,
    Blunder: 0,
  };

  for (const item of reviewResults) counts[item.classification]++;

  classCountsEl.replaceChildren();
  for (const [name, count] of Object.entries(counts)) {
    const chip = document.createElement("div");
    chip.className = "class-chip";
    chip.innerHTML = `<span class="c-${classSlug(name)}">${name}</span><strong>${count}</strong>`;
    classCountsEl.appendChild(chip);
  }

  const headers = loadedGame.headers || {};
  resultLineEl.textContent = headers.Result || "Review complete";

  movesListEl.className = "moves-list";
  movesListEl.replaceChildren();

  for (let i = 0; i < reviewResults.length; i += 2) {
    const row = document.createElement("div");
    row.className = "move-row";

    const moveNo = document.createElement("span");
    moveNo.className = "move-no";
    moveNo.textContent = `${Math.floor(i / 2) + 1}.`;
    row.appendChild(moveNo);

    for (let offset = 0; offset < 2; offset++) {
      const index = i + offset;
      const item = reviewResults[index];

      if (!item) {
        row.appendChild(document.createElement("span"));
        continue;
      }

      const button = document.createElement("button");
      button.className = "move-btn";
      button.dataset.reviewIndex = String(index);
      button.innerHTML = `
        <span>${item.san}</span>
        <span class="badge c-${classSlug(item.classification)}">${item.classification}</span>
      `;
      button.addEventListener("click", () => selectReviewMove(index));
      row.appendChild(button);
    }

    movesListEl.appendChild(row);
  }
}

function selectReviewMove(index) {
  if (!reviewResults[index]) return;

  selectedReviewIndex = index;
  const item = reviewResults[index];
  const state = JSON.parse(api.positionState(item.after_fen));

  renderBoard({
    element: reviewBoardEl,
    state,
    orientation: "w",
    interactive: false,
    lastSquares: [item.uci.slice(0, 2), item.uci.slice(2, 4)],
  });

  document.querySelectorAll(".move-btn").forEach(button => {
    button.classList.toggle(
      "active",
      Number(button.dataset.reviewIndex) === index
    );
  });

  selectedMoveEl.textContent = `${item.move_no}${item.mover === "w" ? "." : "..."} ${item.san}`;
  selectedClassEl.textContent = item.classification;
  selectedClassEl.className = `c-${classSlug(item.classification)}`;
  selectedBestEl.textContent = item.before.best_san || "—";
  selectedLossEl.textContent = formatLoss(item.loss);
  reviewPvEl.textContent = item.before.pv_san?.length
    ? item.before.pv_san.join(" ")
    : "No principal variation available.";

  setEvalBar("review", item.after);
}

function switchView(name) {
  document.querySelectorAll(".mode-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", view.id === `${name}-view`);
  });
}

async function loadEngineFiles() {
  const files = ["__init__.py", "evaluation.py", "search.py", "engine.py"];
  pyodide.FS.mkdirTree("/home/pyodide/elohell");

  for (const name of files) {
    const response = await fetch(`./elohell/${name}`);
    if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`);
    pyodide.FS.writeFile(
      `/home/pyodide/elohell/${name}`,
      await response.text()
    );
  }
}

async function boot() {
  try {
    setStatus("Loading Python runtime…", "loading");
    setEnginePill("Loading engine…", "loading");

    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
    });

    await pyodide.loadPackage("micropip");
    await pyodide.runPythonAsync(`
import micropip
await micropip.install("python-chess==1.999")
`);

    await loadEngineFiles();

    await pyodide.runPythonAsync(`
import io
import json
import sys
import chess
import chess.pgn

sys.path.insert(0, "/home/pyodide")
from elohell import EloHellEngine

board = chess.Board()
play_engine = EloHellEngine()
review_engine = EloHellEngine()

def _status_text(target):
    outcome = target.outcome(claim_draw=True)
    if outcome is not None:
        if target.is_checkmate():
            winner = "Black" if target.turn == chess.WHITE else "White"
            return f"Checkmate. {winner} wins."
        return f"Game over: {outcome.result()} · {outcome.termination.name.replace('_', ' ').title()}"
    side = "White" if target.turn == chess.WHITE else "Black"
    return f"{side} to move" + (" · check" if target.is_check() else "")

def _payload(target, extra=None):
    data = {
        "fen": target.fen(),
        "turn": "w" if target.turn == chess.WHITE else "b",
        "pieces": {
            chess.square_name(square): piece.symbol()
            for square, piece in target.piece_map().items()
        },
        "check": target.is_check(),
        "game_over": target.is_game_over(claim_draw=True),
        "status": _status_text(target),
    }
    if extra:
        data.update(extra)
    return json.dumps(data)

def reset_game():
    global board
    board = chess.Board()
    play_engine.new_game()
    return _payload(board)

def position_state(fen):
    return _payload(chess.Board(fen))

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
    return _payload(board, {
        "last_move": [origin, destination],
        "last_san": san,
    })

def _analysis_for(target, depth, time_limit, engine_instance):
    result = engine_instance.choose_move(
        target,
        max_depth=int(depth),
        time_limit=float(time_limit),
    )

    if target.turn == chess.WHITE:
        white_score = result.score_cp
        white_mate = result.mate_in
    else:
        white_score = -result.score_cp
        white_mate = -result.mate_in if result.mate_in is not None else None

    best_san = None
    best_uci = None
    if result.move is not None:
        best_san = target.san(result.move)
        best_uci = result.move.uci()

    pv_board = target.copy(stack=False)
    pv_san = []
    for move in result.pv:
        if move not in pv_board.legal_moves:
            break
        pv_san.append(pv_board.san(move))
        pv_board.push(move)

    return {
        "white_score_cp": white_score,
        "white_mate_in": white_mate,
        "best_san": best_san,
        "best_uci": best_uci,
        "depth": result.depth,
        "nodes": result.nodes,
        "elapsed": result.elapsed,
        "pv_san": pv_san,
    }

def analyze_fen(fen, depth, time_limit):
    target = chess.Board(fen)
    review_engine.new_game()
    return json.dumps(_analysis_for(target, depth, time_limit, review_engine))

def engine_play(depth, time_limit):
    result = play_engine.choose_move(
        board,
        max_depth=int(depth),
        time_limit=float(time_limit),
    )

    if board.turn == chess.WHITE:
        white_score = result.score_cp
        white_mate = result.mate_in
    else:
        white_score = -result.score_cp
        white_mate = -result.mate_in if result.mate_in is not None else None

    pv_board = board.copy(stack=False)
    pv_san = []
    for pv_move in result.pv:
        if pv_move not in pv_board.legal_moves:
            break
        pv_san.append(pv_board.san(pv_move))
        pv_board.push(pv_move)

    analysis = {
        "white_score_cp": white_score,
        "white_mate_in": white_mate,
        "depth": result.depth,
        "nodes": result.nodes,
        "elapsed": result.elapsed,
        "pv_san": pv_san,
    }

    if result.move is None:
        return _payload(board, analysis)

    san = board.san(result.move)
    uci = result.move.uci()
    board.push(result.move)
    analysis.update({
        "last_move": [uci[:2], uci[2:4]],
        "last_san": san,
    })
    return _payload(board, analysis)

def parse_pgn(text):
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        raise ValueError("No chess game found in this PGN.")

    start = game.board()
    replay = start.copy(stack=False)
    positions = [replay.fen()]
    moves = []

    for ply, move in enumerate(game.mainline_moves(), start=1):
        mover = "w" if replay.turn == chess.WHITE else "b"
        san = replay.san(move)
        uci = move.uci()
        replay.push(move)
        positions.append(replay.fen())
        moves.append({
            "ply": ply,
            "move_no": (ply + 1) // 2,
            "mover": mover,
            "san": san,
            "uci": uci,
            "after_fen": replay.fen(),
        })

    return json.dumps({
        "headers": dict(game.headers),
        "positions": positions,
        "moves": moves,
    })
`);

    api.resetGame = pyodide.globals.get("reset_game");
    api.positionState = pyodide.globals.get("position_state");
    api.legalTargets = pyodide.globals.get("legal_targets");
    api.movePiece = pyodide.globals.get("move_piece");
    api.enginePlay = pyodide.globals.get("engine_play");
    api.parsePgn = pyodide.globals.get("parse_pgn");
    api.analyzeFen = pyodide.globals.get("analyze_fen");

    playState = JSON.parse(api.resetGame());
    busy = false;
    setPlayControls(true);
    setStatus("Ready");
    setEnginePill("Engine ready", "ready");
    renderPlayBoard();

    const startState = JSON.parse(api.positionState(playState.fen));
    renderBoard({
      element: reviewBoardEl,
      state: startState,
      orientation: "w",
      interactive: false,
    });
  } catch (error) {
    console.error(error);
    busy = true;
    setStatus("Failed to load", "error");
    setEnginePill("Engine failed", "loading");
    gameTextEl.textContent =
      "Elo Hell failed to boot. Check the browser console for the tiny demon responsible.";
  }
}

document.querySelectorAll(".mode-btn").forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

sideEl.addEventListener("change", resetGame);
newGameEl.addEventListener("click", resetGame);

pgnFileEl.addEventListener("change", async () => {
  const file = pgnFileEl.files?.[0];
  if (!file) return;
  await loadPGNText(await file.text(), file.name);
});

loadPastedEl.addEventListener("click", () => {
  loadPGNText(pgnTextEl.value, "Pasted PGN");
});

analyzeGameEl.addEventListener("click", analyzeLoadedGame);

for (const eventName of ["dragenter", "dragover"]) {
  dropZoneEl.addEventListener(eventName, event => {
    event.preventDefault();
    dropZoneEl.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZoneEl.addEventListener(eventName, event => {
    event.preventDefault();
    dropZoneEl.classList.remove("dragging");
  });
}
dropZoneEl.addEventListener("drop", async event => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await loadPGNText(await file.text(), file.name);
});

setEvalBar("review", null);
setEvalBar("play", null);
boot();
