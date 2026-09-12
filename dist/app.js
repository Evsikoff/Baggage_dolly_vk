const LEVEL_FILES = {
  tutorial: "./examples/tutorial.json",
  easy: "./examples/easy.json",
  medium: "./examples/medium.json",
  hard: "./examples/hard.json",
  expert: "./examples/expert.json",
};

const DIFFICULTIES = ["tutorial", "easy", "medium", "hard", "expert"];
const DIFFICULTY_LABELS = {
  tutorial: "Обучение",
  easy: "Просто",
  medium: "Средне",
  hard: "Сложно",
  expert: "Эксперт",
};

const SHAPE_LABELS = { square: "квадрат", horizontal: "вдоль", vertical: "поперёк" };
const SHAPE_SYMBOLS = { square: "□", horizontal: "↔", vertical: "↕" };
const PALETTE = [
  "#ff6f61", "#56c5d0", "#ffc43d", "#a88bf2", "#54c47d", "#f08bb4",
  "#ff914d", "#52a6e8", "#cfdb55", "#d47ac3", "#71d0a7", "#e7a84f",
];

const board = document.querySelector("#board");
const grid = document.querySelector("#grid");
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
      if (!response.ok) throw new Error(`Не удалось загрузить ${path}`);
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
  saveProgress();
  renderAll();
  setAdvice(
    difficulty === "tutorial" ? "Как грузить" : "Тележка пуста",
    difficulty === "tutorial"
      ? "Начните с цветной бирки и протяните прямоугольник нужного размера. Значок на бирке задаёт форму."
      : "Разместите все чемоданы так, чтобы закрыть 49 клеток без наложений.",
    "info",
  );
}

function renderAll() {
  renderClues();
  renderRegions();
  renderDraft();
  renderStatus();
}

function renderClues() {
  for (const cell of grid.children) cell.replaceChildren();
  state.level.clues.forEach((clue, index) => {
    const cell = grid.children[clue.y * 7 + clue.x];
    const tag = document.createElement("span");
    tag.className = "clue";
    tag.style.setProperty("--clue", PALETTE[index % PALETTE.length]);
    tag.style.setProperty("--tilt", `${index % 2 ? 2 : -2}deg`);
    tag.setAttribute(
      "aria-label",
      clue.shape ? `${clue.area} клеток, форма ${SHAPE_LABELS[clue.shape]}` : `${clue.area} клеток, любая форма`,
    );
    tag.innerHTML = `<span>${clue.area}</span>${clue.shape ? `<span class="clue-shape" aria-hidden="true">${SHAPE_SYMBOLS[clue.shape]}</span>` : ""}`;
    cell.append(tag);
  });
}

function rectStyle(rect) {
  return `left:${(rect.x / 7) * 100}%;top:${(rect.y / 7) * 100}%;width:${(rect.width / 7) * 100}%;height:${(rect.height / 7) * 100}%;`;
}

function renderRegions() {
  regionsLayer.innerHTML = "";
  state.regions.forEach((region) => {
    const el = document.createElement("div");
    el.className = `region ${shapeOf(region)}${region.hinted ? " hinted" : ""}${region.wrong ? " wrong" : ""}`;
    el.style.cssText = `${rectStyle(region)}--case:${PALETTE[region.clueIndex % PALETTE.length]};`;
    regionsLayer.append(el);
  });
}

function renderDraft() {
  draftLayer.innerHTML = "";
  const rect = state.invalidDraft || (state.drag && !state.drag.existing ? rectFromCells(state.drag.start, state.drag.current) : null);
  if (!rect) return;
  const el = document.createElement("div");
  el.className = `draft-region${state.invalidDraft ? " invalid" : ""}`;
  el.style.cssText = rectStyle(rect);
  draftLayer.append(el);
}

function renderStatus() {
  document.querySelector("#difficultyLabel").textContent = DIFFICULTY_LABELS[state.difficulty];
  document.querySelector("#levelLabel").textContent = `${state.levelIndex + 1}/${state.banks[state.difficulty].length}`;
  document.querySelector("#bagCount").textContent = `${state.regions.length}/${state.level.solution.length}`;
  document.querySelector("#errorCount").textContent = String(state.errors);
  undoButton.disabled = state.history.length === 0;
  clearButton.disabled = state.regions.length === 0;
  document.querySelectorAll("[data-route]").forEach((el) => {
    const step = DIFFICULTIES.indexOf(el.dataset.route);
    const current = DIFFICULTIES.indexOf(state.difficulty);
    el.classList.toggle("active", step === current);
    el.classList.toggle("passed", step < current);
  });
}

function setAdvice(title, text, type = "info") {
  const advice = document.querySelector("#advice");
  advice.className = `advice ${type === "info" ? "" : type}`.trim();
  document.querySelector("#adviceTitle").textContent = title;
  document.querySelector("#adviceText").textContent = text;
  document.querySelector(".advice-icon").textContent = type === "error" ? "!" : type === "success" ? "✓" : "i";
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
    return { ok: false, title: "Место уже занято", text: "Чемоданы не могут лежать друг на друге. Нажмите на лишний чемодан, чтобы убрать его." };
  }
  const clues = cluesIn(rect);
  if (clues.length === 0) {
    return { ok: false, title: "Не хватает бирки", text: "Внутри каждого чемодана должна быть ровно одна цветная бирка." };
  }
  if (clues.length > 1) {
    return { ok: false, title: "Слишком много бирок", text: "Этот чемодан захватил несколько заданий. Уменьшите его до одной бирки." };
  }
  const clue = clues[0];
  const area = rect.width * rect.height;
  if (area !== clue.area) {
    const delta = Math.abs(clue.area - area);
    return {
      ok: false,
      title: area < clue.area ? "Чемодан мал" : "Чемодан велик",
      text: `На бирке ${clue.area}, а выделено ${area}. ${area < clue.area ? `Добавьте ${delta}` : `Уберите ${delta}`} ${cellWord(delta)}.`,
    };
  }
  const actualShape = shapeOf(rect);
  if (clue.shape && clue.shape !== actualShape) {
    return {
      ok: false,
      title: "Не та форма",
      text: `Бирка просит форму «${SHAPE_LABELS[clue.shape]}». Сейчас чемодан получился «${SHAPE_LABELS[actualShape]}».`,
    };
  }
  return { ok: true, clueIndex: clue.index };
}

function cellWord(value) {
  const last = value % 10;
  const lastTwo = value % 100;
  if (last === 1 && lastTwo !== 11) return "клетку";
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return "клетки";
  return "клеток";
}

function snapshot() {
  state.history.push(state.regions.map((region) => ({ ...region })));
  if (state.history.length > 40) state.history.shift();
}

function removeRegion(region) {
  snapshot();
  state.regions = state.regions.filter((item) => item.id !== region.id);
  setAdvice("Чемодан снят", "Место снова свободно. Отмена вернёт последний снятый чемодан.", "info");
  renderAll();
}

function addRect(rect) {
  const result = validateRect(rect);
  if (!result.ok) {
    state.errors += 1;
    state.invalidDraft = rect;
    setAdvice(result.title, result.text, "error");
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
  setAdvice("Чемодан принят", `Бирка ${state.level.clues[result.clueIndex].area} закреплена. Продолжайте загрузку.`, "success");
  renderAll();
  checkCompletion();
}

function sameRect(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function checkCompletion() {
  if (state.regions.length !== state.level.solution.length) return;
  const wrong = state.regions.filter((region) => !state.level.solution.some((solution) => sameRect(region, solution)));
  if (wrong.length) {
    state.errors += 1;
    wrong.forEach((region) => { region.wrong = true; });
    setAdvice("Раскладка не сходится", "Размеры верны, но часть чемоданов стоит не на своих местах. Красные чемоданы стоит переставить.", "error");
    renderAll();
    window.setTimeout(() => {
      wrong.forEach((region) => { delete region.wrong; });
      renderRegions();
    }, 1500);
    return;
  }
  const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
  document.querySelector("#completeText").textContent = `Все ${state.regions.length} чемоданов на месте за ${formatTime(seconds)}. Ошибок: ${state.errors}.`;
  completeDialog.showModal();
}

function placeRegionsFromTool(input) {
  if (!state.level) throw new Error("Уровень ещё не загружен");
  if (!input || !Array.isArray(input.regions) || input.regions.length < 1 || input.regions.length > 12) {
    throw new Error("Передайте от 1 до 12 прямоугольных областей");
  }
  const before = state.regions.map((region) => ({ ...region }));
  const prepared = input.regions.map((rect) => {
    const clean = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (Object.values(clean).some((value) => !Number.isInteger(value))) throw new Error("Все координаты и размеры должны быть целыми числами");
    if (clean.x < 0 || clean.y < 0 || clean.width < 1 || clean.height < 1 || clean.x + clean.width > 7 || clean.y + clean.height > 7) {
      throw new Error("Область выходит за границы поля 7×7");
    }
    return clean;
  });

  try {
    prepared.forEach((rect) => {
      const result = validateRect(rect);
      if (!result.ok) throw new Error(`${result.title}: ${result.text}`);
      state.regions.push({ ...rect, clueIndex: result.clueIndex, id: crypto.randomUUID() });
    });
  } catch (error) {
    state.regions = before;
    renderAll();
    throw error;
  }

  state.history.push(before);
  setAdvice("Группа принята", `Добавлено чемоданов: ${prepared.length}.`, "success");
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
      title: "Статус загрузки",
      description: "Возвращает текущую сложность, номер рейса и прогресс заполнения тележки Baggage Dolly.",
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
      title: "Разместить чемоданы",
      description: "Размещает одну или несколько прямоугольных областей на текущем поле по координатам от верхнего левого угла. Применяет те же правила, что и ручное рисование.",
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
  if (!state.level || completeDialog.open) return;
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
  setAdvice("Ход отменён", "Предыдущее состояние тележки восстановлено.", "info");
  renderAll();
});

clearButton.addEventListener("click", () => {
  if (!state.regions.length) return;
  snapshot();
  state.regions = [];
  setAdvice("Тележка очищена", "Можно начать раскладку заново. Отмена вернёт все чемоданы.", "info");
  renderAll();
});

hintButton.addEventListener("click", () => {
  const target = state.level.solution.find((solution) => !state.regions.some((region) => sameRect(region, solution)));
  if (!target) {
    setAdvice("Подсказка не нужна", "Все правильные чемоданы уже на поле.", "success");
    return;
  }
  snapshot();
  state.hints += 1;
  state.regions = state.regions.filter((region) => !overlaps(region, target));
  const clue = cluesIn(target)[0];
  state.regions.push({ ...target, clueIndex: clue.index, id: crypto.randomUUID(), hinted: true });
  setAdvice("Чемодан от диспетчера", `Показана область на ${target.width * target.height} клеток. Остальные найдите сами.`, "success");
  renderAll();
  window.setTimeout(() => {
    state.regions.forEach((region) => { delete region.hinted; });
    renderRegions();
  }, 2100);
  checkCompletion();
});

document.querySelector("#nextButton").addEventListener("click", () => {
  completeDialog.close();
  const [difficulty, index] = getNextLevel();
  beginLevel(difficulty, index);
});

async function start() {
  makeCells();
  loadProgress();
  try {
    await loadBanks();
    beginLevel(state.difficulty, state.levelIndex);
    registerWebMcpTools();
    state.timerId = window.setInterval(() => {
      document.querySelector("#timer").textContent = formatTime(Math.floor((Date.now() - state.startedAt) / 1000));
    }, 1000);
  } catch (error) {
    setAdvice("Не удалось открыть смену", "Обновите страницу: уровни временно не загрузились.", "error");
    console.error(error);
  }
}

start();
