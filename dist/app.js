const LEVEL_FILES = {
  tutorial: "./examples/tutorial.json",
  easy: "./examples/easy.json",
  medium: "./examples/medium.json",
  hard: "./examples/hard.json",
  expert: "./examples/expert.json",
};

const DIFFICULTIES = ["tutorial", "easy", "medium", "hard", "expert"];
const SHAPE_SYMBOLS = { square: "□", horizontal: "↔", vertical: "↕" };
const PALETTE = [
  "#2f72b5", "#c78b92", "#397b86", "#8c705e", "#4f5875", "#b84c49",
  "#454c53", "#4387b8", "#7d8993", "#b0784c", "#6c4a6e", "#4c7d70",
];

const t = (key, params) => I18N.t(key, params);

const board = document.querySelector("#board");
const grid = document.querySelector("#grid");
const apron = document.querySelector("#apron");
const dollyStack = document.querySelector(".dolly-stack");
const dollyScene = document.querySelector(".dolly-scene");
const regionsLayer = document.querySelector("#regionsLayer");
const draftLayer = document.querySelector("#draftLayer");
const undoButton = document.querySelector("#undoButton");
const clearButton = document.querySelector("#clearButton");
const hintButton = document.querySelector("#hintButton");
const completeDialog = document.querySelector("#completeDialog");

const state = {
  banks: {},
  difficulty: "tutorial",
  levelIndex: 0,
  level: null,
  regions: [],
  history: [],
  drag: null,
  invalidDraft: null,
  errors: 0,
  hints: 0,
  startedAt: Date.now(),
  timerId: null,
  advice: { title: "advice.start.title", text: "advice.start.text", type: "info", params: {}, terms: {} },
  completion: null,
  travelling: false,
};

function makeCells() {
  grid.innerHTML = "";
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      grid.append(cell);
    }
  }
}

/* Ten columns of square patches cover the apron the vehicles drive over;
   fourteen rows reach past the bottom of the stack, which clips them. */
function makeApron() {
  apron.replaceChildren(...Array.from({ length: 140 }, () => document.createElement("i")));
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem("baggage-dolly-progress"));
    if (saved && DIFFICULTIES.includes(saved.difficulty)) {
      state.difficulty = saved.difficulty;
      state.levelIndex = Math.max(0, Math.min(4, Number(saved.levelIndex) || 0));
    }
  } catch (_) {}
}

function saveProgress() {
  localStorage.setItem("baggage-dolly-progress", JSON.stringify({
    difficulty: state.difficulty,
    levelIndex: state.levelIndex,
  }));
}

async function loadBanks() {
  const entries = await Promise.all(
    Object.entries(LEVEL_FILES).map(async ([name, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(t("error.levelFetch", { path }));
      const payload = await response.json();
      return [name, payload.levels];
    }),
  );
  state.banks = Object.fromEntries(entries);
}

function beginLevel(difficulty, index) {
  state.difficulty = difficulty;
  state.levelIndex = index % state.banks[difficulty].length;
  state.level = state.banks[difficulty][state.levelIndex];
  state.regions = [];
  state.history = [];
  state.drag = null;
  state.invalidDraft = null;
  state.errors = 0;
  state.hints = 0;
  state.startedAt = Date.now();
  state.completion = null;
  saveProgress();
  renderAll();
  if (difficulty === "tutorial") {
    setAdvice("advice.howTo.title", "advice.howTo.text");
  } else {
    setAdvice("advice.empty.title", "advice.empty.text");
  }
}

function renderAll() {
  renderClues();
  renderRegions();
  renderDraft();
  renderStatus();
  renderAdvice();
  renderCompletion();
}

function renderClues() {
  for (const cell of grid.children) {
    cell.replaceChildren();
    cell.classList.toggle("occupied", state.regions.some((region) => contains(region, {
      x: Number(cell.dataset.x), y: Number(cell.dataset.y),
    })));
  }
  state.level.clues.forEach((clue, index) => {
    const cell = grid.children[clue.y * 7 + clue.x];
    const tag = document.createElement("span");
    tag.className = `clue${cell.classList.contains("occupied") ? " attached" : ""}`;
    tag.style.setProperty("--clue", PALETTE[index % PALETTE.length]);
    tag.style.setProperty("--tilt", `${index % 2 ? 2 : -2}deg`);
    const cells = I18N.unit("units.cells", clue.area);
    tag.setAttribute(
      "aria-label",
      clue.shape
        ? t("clue.ariaShape", { area: clue.area, cells, shape: t(`shape.${clue.shape}`) })
        : t("clue.ariaAny", { area: clue.area, cells }),
    );
    tag.innerHTML = `<span>${clue.area}</span>${clue.shape ? `<span class="clue-shape" aria-hidden="true">${SHAPE_SYMBOLS[clue.shape]}</span>` : ""}`;
    cell.append(tag);
  });
}

function rectStyle(rect) {
  return `left:${(rect.x / 7) * 100}%;top:${(rect.y / 7) * 100}%;width:${(rect.width / 7) * 100}%;height:${(rect.height / 7) * 100}%;`;
}

function renderRegions() {
  const existing = new Map(Array.from(regionsLayer.children, (el) => [el.dataset.id, el]));
  state.regions.forEach((region) => {
    let el = existing.get(region.id);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = region.id;
      el.innerHTML = '<canvas class="case-art"></canvas>';
      regionsLayer.append(el);
    }
    existing.delete(region.id);
    el.className = `region ${shapeOf(region)}${region.hinted ? " hinted" : ""}${region.wrong ? " wrong" : ""}`;
    el.style.cssText = `${rectStyle(region)}--case:${PALETTE[region.clueIndex % PALETTE.length]};`;
    LuggageRenderer.paint(el.firstElementChild, region.clueIndex, PALETTE[region.clueIndex % PALETTE.length]);
  });
  existing.forEach((el) => el.remove());
}

function renderDraft() {
  draftLayer.innerHTML = "";
  const rect = state.invalidDraft || (state.drag && !state.drag.existing ? rectFromCells(state.drag.start, state.drag.current) : null);
  if (!rect) return;
  const currentArea = rect.width * rect.height;
  const clues = cluesIn(rect);
  const requiredArea = clues.length === 1 ? clues[0].area : null;
  const counterState = requiredArea === null
    ? "unknown"
    : currentArea === requiredArea
      ? "matched"
      : currentArea > requiredArea ? "over" : "under";
  const el = document.createElement("div");
  el.className = `draft-region${state.invalidDraft ? " invalid" : ""}`;
  el.style.cssText = rectStyle(rect);
  el.innerHTML = `<span class="draft-counter ${counterState}"><b>${currentArea}</b><i>/</i><b>${requiredArea ?? "?"}</b></span>`;
  draftLayer.append(el);
}

function renderStatus() {
  document.querySelector("#difficultyLabel").textContent = t(`difficulty.${state.difficulty}`);
  document.querySelector("#levelLabel").textContent = `${state.levelIndex + 1}/${state.banks[state.difficulty].length}`;
  document.querySelector("#bagCount").textContent = `${state.regions.length}/${state.level.solution.length}`;
  document.querySelector("#errorCount").textContent = String(state.errors);
  undoButton.disabled = state.travelling || state.history.length === 0;
  clearButton.disabled = state.travelling || state.regions.length === 0;
  hintButton.disabled = state.travelling || !state.level;
  document.querySelectorAll("[data-route]").forEach((el) => {
    const step = DIFFICULTIES.indexOf(el.dataset.route);
    const current = DIFFICULTIES.indexOf(state.difficulty);
    el.classList.toggle("active", step === current);
    el.classList.toggle("passed", step < current);
  });
}

/* Words are looked up at render time, so switching the language also
   re-translates — and re-declines — the advice already on screen.
   A term is either a plain key or [key, count] for a counted noun. */
function resolveParams({ params = {}, terms = {} }) {
  const resolved = { ...params };
  Object.entries(terms).forEach(([name, term]) => {
    resolved[name] = Array.isArray(term) ? I18N.unit(term[0], term[1]) : t(term);
  });
  return resolved;
}

function setAdvice(title, text, type = "info", params = {}, terms = {}) {
  state.advice = { title, text, type, params, terms };
  renderAdvice();
}

function renderAdvice() {
  const { title, text, type } = state.advice;
  const params = resolveParams(state.advice);
  const advice = document.querySelector("#advice");
  advice.className = `advice ${type === "info" ? "" : type}`.trim();
  document.querySelector("#adviceTitle").textContent = t(title, params);
  document.querySelector("#adviceText").textContent = t(text, params);
  document.querySelector(".advice-icon").textContent = type === "error" ? "!" : type === "success" ? "✓" : "i";
}

function renderCompletion() {
  if (!state.completion) return;
  document.querySelector("#completeText").textContent = t("dialog.summary", state.completion);
}

function cellFromPointer(event) {
  const bounds = board.getBoundingClientRect();
  const x = Math.min(6, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * 7)));
  const y = Math.min(6, Math.max(0, Math.floor(((event.clientY - bounds.top) / bounds.height) * 7)));
  return { x, y };
}

function rectFromCells(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x) + 1,
    height: Math.abs(a.y - b.y) + 1,
  };
}

function shapeOf(rect) {
  if (rect.width === rect.height) return "square";
  return rect.width > rect.height ? "horizontal" : "vertical";
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(rect, point) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function cluesIn(rect) {
  return state.level.clues
    .map((clue, index) => ({ ...clue, index }))
    .filter((clue) => contains(rect, clue));
}

function validateRect(rect) {
  if (state.regions.some((region) => overlaps(rect, region))) {
    return { ok: false, title: "advice.occupied.title", text: "advice.occupied.text" };
  }
  const clues = cluesIn(rect);
  if (clues.length === 0) {
    return { ok: false, title: "advice.noTag.title", text: "advice.noTag.text" };
  }
  if (clues.length > 1) {
    return { ok: false, title: "advice.manyTags.title", text: "advice.manyTags.text" };
  }
  const clue = clues[0];
  const area = rect.width * rect.height;
  if (area !== clue.area) {
    const delta = Math.abs(clue.area - area);
    const kind = area < clue.area ? "tooSmall" : "tooBig";
    return {
      ok: false,
      title: `advice.${kind}.title`,
      text: `advice.${kind}.text`,
      params: { required: clue.area, actual: area, delta },
      terms: { cells: ["units.cellsAcc", delta] },
    };
  }
  const actualShape = shapeOf(rect);
  if (clue.shape && clue.shape !== actualShape) {
    return {
      ok: false,
      title: "advice.wrongShape.title",
      text: "advice.wrongShape.text",
      terms: { expected: `shape.${clue.shape}`, actual: `shape.${actualShape}` },
    };
  }
  return { ok: true, clueIndex: clue.index };
}

function snapshot() {
  state.history.push(state.regions.map((region) => ({ ...region })));
  if (state.history.length > 40) state.history.shift();
}

function removeRegion(region) {
  snapshot();
  state.regions = state.regions.filter((item) => item.id !== region.id);
  setAdvice("advice.removed.title", "advice.removed.text");
  renderAll();
}

function addRect(rect) {
  const result = validateRect(rect);
  if (!result.ok) {
    state.errors += 1;
    state.invalidDraft = rect;
    setAdvice(result.title, result.text, "error", result.params, result.terms);
    renderAll();
    window.setTimeout(() => {
      if (state.invalidDraft === rect) {
        state.invalidDraft = null;
        renderDraft();
      }
    }, 850);
    return;
  }
  snapshot();
  state.regions.push({ ...rect, clueIndex: result.clueIndex, id: crypto.randomUUID() });
  setAdvice("advice.accepted.title", "advice.accepted.text", "success", { area: state.level.clues[result.clueIndex].area });
  renderAll();
  checkCompletion();
}

function sameRect(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/* The loaded dolly is towed off the apron and the next one rolls into its
   place. Both moves run downwards, the direction the tug faces, and the
   stack clips them, so the pavement underneath never moves. */
const DEPARTURE = { duration: 780, easing: "cubic-bezier(.5, 0, .82, .36)" };
const ARRIVAL = { duration: 860, easing: "cubic-bezier(.18, .74, .3, 1)" };
const SETTLE_MS = 420;

let sceneMotion = null;

function motionWanted() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/* One stack height clears the frame in either direction, hitch included. */
function travelDistance() {
  return dollyStack.getBoundingClientRect().height + 12;
}

async function moveScene(from, to, timing) {
  sceneMotion?.cancel();
  const motion = dollyScene.animate(
    [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }],
    { ...timing, fill: "forwards" },
  );
  sceneMotion = motion;
  /* A hidden tab suspends animations, so the shift must never wait on one:
     if the move has not played by its own deadline, jump to the end. */
  await Promise.race([motion.finished.catch(() => {}), wait(timing.duration + 600)]);
  if (sceneMotion === motion && motion.playState === "running") motion.finish();
}

async function towAway() {
  state.travelling = true;
  renderStatus();
  if (!motionWanted()) return;
  await wait(SETTLE_MS);
  await moveScene(0, travelDistance(), DEPARTURE);
}

async function rollIn() {
  state.travelling = true;
  renderStatus();
  if (motionWanted()) await moveScene(-travelDistance(), 0, ARRIVAL);
  sceneMotion?.cancel();
  sceneMotion = null;
  state.travelling = false;
  state.startedAt = Date.now();
  renderStatus();
}

function checkCompletion() {
  if (state.regions.length !== state.level.solution.length) return;
  const wrong = state.regions.filter((region) => !state.level.solution.some((solution) => sameRect(region, solution)));
  if (wrong.length) {
    state.errors += 1;
    wrong.forEach((region) => { region.wrong = true; });
    setAdvice("advice.mismatch.title", "advice.mismatch.text", "error");
    renderAll();
    window.setTimeout(() => {
      wrong.forEach((region) => { delete region.wrong; });
      renderRegions();
    }, 1500);
    return;
  }
  const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
  state.completion = { count: state.regions.length, time: formatTime(seconds), errors: state.errors };
  renderCompletion();
  /* The report only makes sense while it is still the current one. */
  towAway().then(() => { if (state.completion) completeDialog.showModal(); });
}

function placeRegionsFromTool(input) {
  if (!state.level) throw new Error(t("error.noLevel"));
  if (!input || !Array.isArray(input.regions) || input.regions.length < 1 || input.regions.length > 12) {
    throw new Error(t("error.regionCount"));
  }
  const before = state.regions.map((region) => ({ ...region }));
  const prepared = input.regions.map((rect) => {
    const clean = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (Object.values(clean).some((value) => !Number.isInteger(value))) throw new Error(t("error.integers"));
    if (clean.x < 0 || clean.y < 0 || clean.width < 1 || clean.height < 1 || clean.x + clean.width > 7 || clean.y + clean.height > 7) {
      throw new Error(t("error.outOfBounds"));
    }
    return clean;
  });

  try {
    prepared.forEach((rect) => {
      const result = validateRect(rect);
      if (!result.ok) {
        const params = resolveParams(result);
        throw new Error(`${t(result.title, params)}: ${t(result.text, params)}`);
      }
      state.regions.push({ ...rect, clueIndex: result.clueIndex, id: crypto.randomUUID() });
    });
  } catch (error) {
    state.regions = before;
    renderAll();
    throw error;
  }

  state.history.push(before);
  setAdvice("advice.group.title", "advice.group.text", "success", { count: prepared.length });
  renderAll();
  checkCompletion();
  return { added: prepared.length, placed: state.regions.length, required: state.level.solution.length };
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const report = (error) => console.warn("WebMCP tool registration failed", error);

  const tools = [
    {
      name: "read_baggage_status",
      title: t("tool.status.title"),
      description: t("tool.status.description"),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        return {
          difficulty: state.difficulty,
          level: state.levelIndex + 1,
          placed: state.regions.length,
          required: state.level?.solution.length || 0,
          errors: state.errors,
        };
      },
    },
    {
      name: "place_baggage_regions",
      title: t("tool.place.title"),
      description: t("tool.place.description"),
      inputSchema: {
        type: "object",
        properties: {
          regions: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                x: { type: "integer", minimum: 0, maximum: 6 },
                y: { type: "integer", minimum: 0, maximum: 6 },
                width: { type: "integer", minimum: 1, maximum: 7 },
                height: { type: "integer", minimum: 1, maximum: 7 },
              },
              required: ["x", "y", "width", "height"],
              additionalProperties: false,
            },
          },
        },
        required: ["regions"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: placeRegionsFromTool,
    },
  ];

  tools.forEach((tool) => {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(report);
    } catch (error) {
      report(error);
    }
  });
}

function getNextLevel() {
  const elapsed = (Date.now() - state.startedAt) / 1000;
  const fast = state.errors === 0 && state.hints === 0 && elapsed <= (state.difficulty === "easy" ? 90 : 150);
  let fastEasy = Number(localStorage.getItem("baggage-dolly-fast-easy") || 0);

  if (state.difficulty === "tutorial") {
    if (state.levelIndex < state.banks.tutorial.length - 1) return ["tutorial", state.levelIndex + 1];
    return ["easy", 0];
  }

  if (state.difficulty === "easy") {
    fastEasy = fast ? fastEasy + 1 : 0;
    localStorage.setItem("baggage-dolly-fast-easy", String(fastEasy));
    if (fastEasy >= 2) return ["hard", 0];
    if (state.levelIndex < state.banks.easy.length - 1) return ["easy", state.levelIndex + 1];
    return ["medium", 0];
  }

  if (state.difficulty === "medium") {
    if (state.levelIndex < state.banks.medium.length - 1) return ["medium", state.levelIndex + 1];
    return ["hard", 0];
  }

  if (state.difficulty === "hard") {
    if (fast) return ["expert", 0];
    if (state.levelIndex < state.banks.hard.length - 1) return ["hard", state.levelIndex + 1];
    return ["expert", 0];
  }

  return ["expert", (state.levelIndex + 1) % state.banks.expert.length];
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

board.addEventListener("pointerdown", (event) => {
  if (!state.level || state.travelling || completeDialog.open) return;
  event.preventDefault();
  board.setPointerCapture(event.pointerId);
  const start = cellFromPointer(event);
  const existing = state.regions.find((region) => contains(region, start));
  state.drag = { start, current: start, existing, pointerId: event.pointerId, moved: false };
  renderDraft();
});

board.addEventListener("pointermove", (event) => {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const next = cellFromPointer(event);
  if (next.x !== state.drag.start.x || next.y !== state.drag.start.y) state.drag.moved = true;
  state.drag.current = next;
  renderDraft();
});

board.addEventListener("pointerup", (event) => {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const drag = state.drag;
  state.drag = null;
  renderDraft();
  if (drag.existing) {
    if (!drag.moved) removeRegion(drag.existing);
    return;
  }
  addRect(rectFromCells(drag.start, drag.current));
});

board.addEventListener("pointercancel", () => {
  state.drag = null;
  renderDraft();
});

undoButton.addEventListener("click", () => {
  if (!state.history.length) return;
  state.regions = state.history.pop();
  setAdvice("advice.undone.title", "advice.undone.text");
  renderAll();
});

clearButton.addEventListener("click", () => {
  if (!state.regions.length) return;
  snapshot();
  state.regions = [];
  setAdvice("advice.cleared.title", "advice.cleared.text");
  renderAll();
});

hintButton.addEventListener("click", () => {
  const target = state.level.solution.find((solution) => !state.regions.some((region) => sameRect(region, solution)));
  if (!target) {
    setAdvice("advice.hintUseless.title", "advice.hintUseless.text", "success");
    return;
  }
  snapshot();
  state.hints += 1;
  state.regions = state.regions.filter((region) => !overlaps(region, target));
  const clue = cluesIn(target)[0];
  state.regions.push({ ...target, clueIndex: clue.index, id: crypto.randomUUID(), hinted: true });
  const area = target.width * target.height;
  setAdvice("advice.hint.title", "advice.hint.text", "success", { area }, { cells: ["units.cellsAcc", area] });
  renderAll();
  window.setTimeout(() => {
    state.regions.forEach((region) => { delete region.hinted; });
    renderRegions();
  }, 2100);
  checkCompletion();
});

/* Called from the button and from the dialog's own close event, which also
   covers Escape; the finished report is the token that makes it run once. */
function callNextFlight() {
  if (!state.completion) return;
  state.completion = null;
  const [difficulty, index] = getNextLevel();
  beginLevel(difficulty, index);
  rollIn();
}

document.querySelector("#nextButton").addEventListener("click", () => {
  completeDialog.close();
  callNextFlight();
});

completeDialog.addEventListener("close", callNextFlight);

/* A new language redraws every string that JavaScript owns; the static
   markup is handled by the translator itself. */
I18N.onChange(() => {
  if (state.level) renderAll();
  else renderAdvice();
});

async function start() {
  makeCells();
  makeApron();
  loadProgress();
  I18N.mountPicker(document.querySelector("#langSelect"));
  renderAdvice();
  try {
    await Promise.all([loadBanks(), LuggageRenderer.ready]);
    beginLevel(state.difficulty, state.levelIndex);
    rollIn();
    registerWebMcpTools();
    state.timerId = window.setInterval(() => {
      document.querySelector("#timer").textContent = formatTime(Math.floor((Date.now() - state.startedAt) / 1000));
    }, 1000);
  } catch (error) {
    setAdvice("advice.loadError.title", "advice.loadError.text", "error");
    console.error(error);
  }
}

start();

// Repaint at the actual displayed size, including orientation changes.
new ResizeObserver(() => {
  if (state.level) renderRegions();
}).observe(board);
