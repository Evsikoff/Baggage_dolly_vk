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
const DEFAULT_PROGRESS = {
  version: 1,
  difficulty: "tutorial",
  levelIndex: 0,
  fastEasy: 0,
  completedLevels: 0,
  totalHints: 0,
  totalErrors: 0,
  isFirstRun: true,
};

const t = (key, params) => I18N.t(key, params);

const board = document.querySelector("#board");
const grid = document.querySelector("#grid");
const dollyStack = document.querySelector(".dolly-stack");
const dollyScene = document.querySelector(".dolly-scene");
const regionsLayer = document.querySelector("#regionsLayer");
const draftLayer = document.querySelector("#draftLayer");
const undoButton = document.querySelector("#undoButton");
const clearButton = document.querySelector("#clearButton");
const hintButton = document.querySelector("#hintButton");
const completeDialog = document.querySelector("#completeDialog");
const nextButton = document.querySelector("#nextButton");
const toast = document.querySelector("#toast");
const splash = document.querySelector("#splash");
const gameShell = document.querySelector(".game-shell");
const menuDialog = document.querySelector("#menuDialog");
const menuButton = document.querySelector("#menuButton");
const menuPlayButton = document.querySelector("#menuPlayButton");
const dialogMenuButton = document.querySelector("#dialogMenuButton");
const soundButton = document.querySelector("#soundButton");
const soundToggle = document.querySelector("#soundToggle");
const volumeRange = document.querySelector("#volumeRange");
const volumeOutput = document.querySelector("#volumeOutput");
const motionToggle = document.querySelector("#motionToggle");
const qualityInputs = document.querySelectorAll('input[name="quality"]');
const resetButton = document.querySelector("#resetButton");

/* Long enough to read the studio logo even when everything is cached. */
const SPLASH_MIN_MS = 1800;
const SPLASH_FADE_MS = 500;

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
  fastEasy: 0,
  completedLevels: 0,
  totalHints: 0,
  totalErrors: 0,
  isFirstRun: true,
  startedAt: Date.now(),
  pausedAt: null,
  timerId: null,
  advice: { title: "advice.start.title", text: "advice.start.text", type: "info", params: {}, terms: {} },
  completion: null,
  reportReady: false,
  travelling: false,
  advertising: false,
};

/* The menu doubles as the pause screen, so the flight clock stops while it
   is open and the time spent there never counts against the player. */
function elapsedMs() {
  return (state.pausedAt ?? Date.now()) - state.startedAt;
}

function pauseClock() {
  if (state.pausedAt === null) state.pausedAt = Date.now();
}

function resumeClock() {
  if (state.pausedAt === null) return;
  state.startedAt += Date.now() - state.pausedAt;
  state.pausedAt = null;
}

function restartClock() {
  state.startedAt = Date.now();
  if (state.pausedAt !== null) state.pausedAt = state.startedAt;
}

function renderTimer() {
  document.querySelector("#timer").textContent = formatTime(Math.floor(elapsedMs() / 1000));
}

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

function isValidProgress(saved) {
  return Boolean(saved)
    && typeof saved === "object"
    && DIFFICULTIES.includes(saved.difficulty)
    && Number.isInteger(Number(saved.levelIndex))
    && Number(saved.levelIndex) >= 0;
}

function migrateLegacyProgress() {
  try {
    if (localStorage.getItem(VKService.STORAGE_KEY)) return;
    const legacy = JSON.parse(localStorage.getItem("baggage-dolly-progress"));
    if (!isValidProgress(legacy)) return;
    const migrated = {
      ...DEFAULT_PROGRESS,
      difficulty: legacy.difficulty,
      levelIndex: Number(legacy.levelIndex),
      fastEasy: Number(localStorage.getItem("baggage-dolly-fast-easy") || 0),
      isFirstRun: false,
    };
    localStorage.setItem(VKService.STORAGE_KEY, JSON.stringify(migrated));
  } catch (_) {}
}

function applyProgress(saved, isFirstRun = false) {
  state.difficulty = saved.difficulty;
  state.levelIndex = Math.max(0, Number(saved.levelIndex) || 0);
  state.fastEasy = Math.max(0, Number(saved.fastEasy) || 0);
  state.completedLevels = Math.max(0, Number(saved.completedLevels) || 0);
  state.totalHints = Math.max(0, Number(saved.totalHints) || 0);
  state.totalErrors = Math.max(0, Number(saved.totalErrors) || 0);
  state.isFirstRun = isFirstRun;
}

function currentProgress() {
  return {
    version: 1,
    difficulty: state.difficulty,
    levelIndex: state.levelIndex,
    fastEasy: state.fastEasy,
    completedLevels: state.completedLevels,
    totalHints: state.totalHints,
    totalErrors: state.totalErrors,
    isFirstRun: state.isFirstRun,
  };
}

function saveProgress() {
  void VKService.saveGameProgress(currentProgress());
}

let toastTimer = null;
function showToast(message) {
  window.clearTimeout(toastTimer);
  /* The menu sits in the top layer, above anything on the page. */
  const host = menuDialog.open ? menuDialog : document.body;
  if (toast.parentElement !== host) host.append(toast);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3600);
}

async function loadBank(name, path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(t("error.levelFetch", { path }));
  const payload = await response.json();
  state.banks[name] = payload.levels;
}

/* Load events rather than decode(), which a hidden tab never settles. */
function imageReady(source) {
  const image = typeof source === "string" ? Object.assign(new Image(), { src: source }) : source;
  return new Promise((resolve) => {
    if (image.complete) resolve();
    else image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  });
}

/* Every file the first flight needs moves the splash bar one step, so the
   bar tells the truth about a slow connection instead of looping. */
function trackLoading(tasks) {
  const bar = splash.querySelector(".splash-progress");
  let done = 0;
  const show = () => {
    const share = tasks.length ? done / tasks.length : 1;
    bar.style.setProperty("--progress", share.toFixed(3));
    bar.setAttribute("aria-valuenow", String(Math.round(share * 100)));
  };
  show();
  return Promise.all(tasks.map((task) => task.finally(() => {
    done += 1;
    show();
  })));
}

function liftSplash() {
  gameShell.inert = false;
  splash.classList.add("is-leaving");
  window.setTimeout(() => splash.remove(), SPLASH_FADE_MS + 100);
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
  restartClock();
  state.completion = null;
  state.reportReady = false;
  state.isFirstRun = false;
  saveProgress();
  renderAll();
  renderTimer();
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
  hintButton.disabled = state.travelling || state.advertising || !state.level || Boolean(state.completion);
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
  GameSound.play("lift");
  setAdvice("advice.removed.title", "advice.removed.text");
  renderAll();
}

function addRect(rect) {
  const result = validateRect(rect);
  if (!result.ok) {
    state.errors += 1;
    state.invalidDraft = rect;
    GameSound.play("error");
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
  GameSound.play("place");
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

/* Follows the menu setting, which starts from the system's reduced-motion
   preference. */
function motionWanted() {
  return GameSettings.get("motion");
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
  /* Filling both ways parks the scene at its starting point through any
     delay, so a delayed move never shows the scene where it will end up. */
  const motion = dollyScene.animate(
    [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }],
    { ...timing, fill: "both" },
  );
  sceneMotion = motion;
  /* A hidden tab suspends animations, so the shift must never wait on one:
     if the move has not played by its own deadline, jump to the end. */
  await Promise.race([motion.finished.catch(() => {}), wait((timing.delay || 0) + timing.duration + 600)]);
  if (sceneMotion === motion && motion.playState === "running") motion.finish();
}

async function towAway() {
  state.travelling = true;
  renderStatus();
  if (!motionWanted()) return;
  await wait(SETTLE_MS);
  GameSound.play("depart");
  await moveScene(0, travelDistance(), DEPARTURE);
}

async function rollIn(delay = 0) {
  state.travelling = true;
  sceneParked = false;
  renderStatus();
  const arrival = motionWanted() ? moveScene(-travelDistance(), 0, { ...ARRIVAL, delay }) : null;
  /* Unhidden only once the move holds it above the frame. */
  dollyScene.classList.remove("is-parked");
  await arrival;
  sceneMotion?.cancel();
  sceneMotion = null;
  state.travelling = false;
  restartClock();
  renderStatus();
}

/* Between the title screen and the first flight, or when the player heads
   for the menu from the report, the next dolly waits out of sight and only
   drives in once the menu closes. */
let sceneParked = false;

function parkScene() {
  sceneMotion?.cancel();
  sceneMotion = null;
  sceneParked = true;
  dollyScene.classList.add("is-parked");
}

function checkCompletion() {
  if (state.completion) return;
  if (state.regions.length !== state.level.solution.length) return;
  const wrong = state.regions.filter((region) => !state.level.solution.some((solution) => sameRect(region, solution)));
  if (wrong.length) {
    state.errors += 1;
    wrong.forEach((region) => { region.wrong = true; });
    GameSound.play("error");
    setAdvice("advice.mismatch.title", "advice.mismatch.text", "error");
    renderAll();
    window.setTimeout(() => {
      wrong.forEach((region) => { delete region.wrong; });
      renderRegions();
    }, 1500);
    return;
  }
  const seconds = Math.floor(elapsedMs() / 1000);
  state.completion = { count: state.regions.length, time: formatTime(seconds), errors: state.errors };
  state.completedLevels += 1;
  state.totalErrors += state.errors;
  saveProgress();
  renderCompletion();
  GameSound.play("complete");
  const report = state.completion;
  towAway().then(() => {
    /* The report only makes sense while it is still the current one. */
    if (state.completion !== report) return;
    state.reportReady = true;
    presentCompletion();
  });
}

/* A player who opened the menu while the dolly drove off sees the report
   once they leave it. */
function presentCompletion() {
  if (!state.completion || !state.reportReady || menuDialog.open || completeDialog.open) return;
  completeDialog.showModal();
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
  const elapsed = elapsedMs() / 1000;
  const fast = state.errors === 0 && state.hints === 0 && elapsed <= (state.difficulty === "easy" ? 90 : 150);
  let fastEasy = state.fastEasy;

  if (state.difficulty === "tutorial") {
    if (state.levelIndex < state.banks.tutorial.length - 1) return ["tutorial", state.levelIndex + 1];
    return ["easy", 0];
  }

  if (state.difficulty === "easy") {
    fastEasy = fast ? fastEasy + 1 : 0;
    state.fastEasy = fastEasy;
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
  if (!state.level || state.travelling || completeDialog.open || menuDialog.open) return;
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
  GameSound.play("lift");
  setAdvice("advice.undone.title", "advice.undone.text");
  renderAll();
});

clearButton.addEventListener("click", () => {
  if (!state.regions.length) return;
  snapshot();
  state.regions = [];
  GameSound.play("lift");
  setAdvice("advice.cleared.title", "advice.cleared.text");
  renderAll();
});

function applyHint(target) {
  snapshot();
  state.hints += 1;
  state.totalHints += 1;
  state.regions = state.regions.filter((region) => !overlaps(region, target));
  const clue = cluesIn(target)[0];
  state.regions.push({ ...target, clueIndex: clue.index, id: crypto.randomUUID(), hinted: true });
  GameSound.play("hint");
  const area = target.width * target.height;
  setAdvice("advice.hint.title", "advice.hint.text", "success", { area }, { cells: ["units.cellsAcc", area] });
  saveProgress();
  renderAll();
  window.setTimeout(() => {
    state.regions.forEach((region) => { delete region.hinted; });
    renderRegions();
  }, 2100);
  checkCompletion();
}

hintButton.addEventListener("click", async () => {
  const target = state.level.solution.find((solution) => !state.regions.some((region) => sameRect(region, solution)));
  if (!target) {
    setAdvice("advice.hintUseless.title", "advice.hintUseless.text", "success");
    return;
  }
  if (state.advertising) return;
  state.advertising = true;
  renderStatus();
  try {
    const data = await VKService.showRewardedAd();
    if (data?.result) {
      applyHint(target);
    } else {
      showToast("Посмотрите рекламу до конца, чтобы получить подсказку");
    }
  } catch (error) {
    console.error("Ошибка при показе видеорекламы:", error);
    showToast("Реклама временно недоступна, попробуйте позже");
  } finally {
    state.advertising = false;
    renderStatus();
  }
});

/* Called from the button and from the dialog's own close event, which also
   covers Escape; the finished report is the token that makes it run once. */
let nextFlightPending = false;
let menuAfterFlight = false;
async function callNextFlight() {
  if (!state.completion || nextFlightPending) return;
  nextFlightPending = true;
  nextButton.disabled = true;
  const [difficulty, index] = getNextLevel();
  if (completeDialog.open) completeDialog.close();
  try {
    const ad = await VKService.showInterstitial();
    if (ad.skipped === "cooldown") console.info("Межстраничная реклама пропущена: действует кулдаун");
    else console.info("Межстраничная реклама показана:", Boolean(ad.result));
  } finally {
    state.completion = null;
    beginLevel(difficulty, index);
    if (menuAfterFlight) {
      menuAfterFlight = false;
      parkScene();
      openMenu();
    } else {
      void rollIn();
    }
    nextFlightPending = false;
    nextButton.disabled = false;
  }
}

nextButton.addEventListener("click", callNextFlight);

/* The flight is banked either way; the next one waits behind the menu. */
dialogMenuButton.addEventListener("click", () => {
  menuAfterFlight = true;
  completeDialog.close();
});

completeDialog.addEventListener("close", callNextFlight);

/* ---- Menu: the title screen and the pause screen ---- */

function isFreshShift() {
  return state.completedLevels === 0 && state.difficulty === "tutorial" && state.levelIndex === 0;
}

function renderMenu() {
  const playKey = !sceneParked ? "menu.resume" : isFreshShift() ? "menu.play" : "menu.continueShift";
  document.querySelector("#menuPlayLabel").textContent = t(playKey);
  document.querySelector("#menuEyebrow").textContent = t(sceneParked ? "menu.eyebrowStart" : "menu.eyebrowPause");
  document.querySelector("#menuRoute").textContent = t("menu.stats.routeValue", {
    difficulty: t(`difficulty.${state.difficulty}`),
    flight: state.levelIndex + 1,
    total: state.banks[state.difficulty]?.length || 1,
  });
  document.querySelector("#menuFlights").textContent = String(state.completedLevels);
  document.querySelector("#menuHints").textContent = String(state.totalHints);
  document.querySelector("#menuErrors").textContent = String(state.totalErrors);
}

function showMenuView(name) {
  const previous = menuDialog.dataset.view;
  menuDialog.dataset.view = name;
  menuDialog.querySelectorAll("[data-menu-view]").forEach((view) => {
    view.hidden = view.dataset.menuView !== name;
  });
  disarmReset();
  /* Keyboard focus follows the player into a page and back to the button
     that led there. */
  const target = name === "main"
    ? menuDialog.querySelector(`[data-menu-open="${previous}"]`) || menuPlayButton
    : menuDialog.querySelector(`[data-menu-view="${name}"] .menu-back`);
  target?.focus({ preventScroll: true });
}

function openMenu(view = "main") {
  if (!state.level) return;
  if (!menuDialog.open) {
    pauseClock();
    /* A half-drawn case is dropped rather than finished behind the menu. */
    state.drag = null;
    renderDraft();
    renderMenu();
    delete menuDialog.dataset.view;
    menuDialog.showModal();
  }
  showMenuView(view);
}

menuDialog.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-menu-open]");
  if (!opener) return;
  GameSound.play("click");
  showMenuView(opener.dataset.menuOpen);
});

/* Escape steps back out of a page before it leaves the menu. It is caught
   on keydown: browsers stop honouring a cancelled dialog "cancel" after the
   first time. */
menuDialog.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || menuDialog.dataset.view === "main") return;
  event.preventDefault();
  showMenuView("main");
});

menuPlayButton.addEventListener("click", () => menuDialog.close());

/* Every way out of the menu lands here, Escape included. */
menuDialog.addEventListener("close", () => {
  GameSound.unlock();
  GameSound.play("click");
  resumeClock();
  renderTimer();
  if (sceneParked) void rollIn();
  presentCompletion();
});

menuButton.addEventListener("click", () => {
  GameSound.play("click");
  openMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (menuDialog.open || completeDialog.open || splash.isConnected) return;
  event.preventDefault();
  openMenu();
});

/* ---- Settings ---- */

let appliedQuality = null;

function applySettings(settings) {
  GameSound.configure(settings);
  document.documentElement.classList.toggle("reduce-motion", !settings.motion);
  if (settings.quality !== appliedQuality) {
    appliedQuality = settings.quality;
    document.documentElement.classList.toggle("economy-graphics", settings.quality === "economy");
    LuggageRenderer.setDensityCap(settings.quality === "economy" ? 1 : 2);
    if (state.level) renderRegions();
  }

  const audible = settings.sound && settings.volume > 0;
  soundButton.setAttribute("aria-pressed", String(audible));
  soundButton.classList.toggle("is-muted", !audible);
  soundToggle.checked = settings.sound;
  volumeRange.value = String(settings.volume);
  volumeRange.disabled = !settings.sound;
  volumeOutput.textContent = `${settings.volume}%`;
  motionToggle.checked = settings.motion;
  qualityInputs.forEach((input) => { input.checked = input.value === settings.quality; });
}

GameSettings.subscribe(applySettings);

/* The quick toggle brings back a volume someone dragged down to zero. */
soundButton.addEventListener("click", () => {
  const audible = GameSettings.get("sound") && GameSettings.get("volume") > 0;
  if (!audible && GameSettings.get("volume") === 0) GameSettings.set("volume", 70);
  GameSettings.set("sound", !audible);
  GameSound.play("click");
});

soundToggle.addEventListener("change", () => {
  GameSettings.set("sound", soundToggle.checked);
  GameSound.play("click");
});

volumeRange.addEventListener("input", () => GameSettings.set("volume", Number(volumeRange.value)));
volumeRange.addEventListener("change", () => GameSound.play("place"));

motionToggle.addEventListener("change", () => {
  GameSettings.set("motion", motionToggle.checked);
  GameSound.play("click");
});

qualityInputs.forEach((input) => input.addEventListener("change", () => {
  if (input.checked) GameSettings.set("quality", input.value);
  GameSound.play("click");
}));

/* Starting over wipes the whole shift, so the button asks twice. */
let resetTimer = null;

function disarmReset() {
  window.clearTimeout(resetTimer);
  resetTimer = null;
  resetButton.classList.remove("is-armed");
  resetButton.textContent = t("settings.reset");
}

function resetShift() {
  applyProgress(DEFAULT_PROGRESS);
  state.completion = null;
  menuAfterFlight = false;
  beginLevel("tutorial", 0);
  parkScene();
  renderMenu();
  showToast(t("settings.resetDone"));
}

resetButton.addEventListener("click", () => {
  GameSound.play("click");
  if (!resetTimer) {
    resetButton.classList.add("is-armed");
    resetButton.textContent = t("settings.resetConfirm");
    resetTimer = window.setTimeout(disarmReset, 4000);
    return;
  }
  disarmReset();
  resetShift();
});

async function start() {
  makeCells();
  migrateLegacyProgress();
  renderAdvice();
  const logoShown = wait(SPLASH_MIN_MS);
  try {
    const progressTask = VKService.initialize()
      .then(() => VKService.loadGameProgress(DEFAULT_PROGRESS, isValidProgress));
    const [loadedProgress] = await trackLoading([
      progressTask,
      ...Object.entries(LEVEL_FILES).map(([name, path]) => loadBank(name, path)),
      ...LuggageRenderer.loads,
      ...Array.from(document.querySelectorAll(".dolly-art, .baggage-tug"), imageReady),
      imageReady("./assets/apron-ground.jpg"),
    ]);
    applyProgress(loadedProgress.data, loadedProgress.isFirstRun);
    state.levelIndex = Math.min(state.levelIndex, state.banks[state.difficulty].length - 1);
    await logoShown;
    beginLevel(state.difficulty, state.levelIndex);
    /* The logo dissolves into the main menu; the first cart waits
       off-screen and drives in when the player leaves it. */
    parkScene();
    liftSplash();
    openMenu();
    registerWebMcpTools();
    state.timerId = window.setInterval(renderTimer, 1000);
  } catch (error) {
    liftSplash();
    setAdvice("advice.loadError.title", "advice.loadError.text", "error");
    console.error(error);
  }
}

start();

window.addEventListener("pagehide", saveProgress);

// Repaint at the actual displayed size, including orientation changes.
new ResizeObserver(() => {
  if (state.level) renderRegions();
}).observe(board);
