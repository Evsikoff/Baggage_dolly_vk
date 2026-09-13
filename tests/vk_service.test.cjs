const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "dist", "vkService.js"), "utf8");

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function loadService({ search = "", bridge, local = {} } = {}) {
  const window = {
    location: { search },
    setTimeout,
    clearTimeout,
  };
  window.parent = window;
  if (bridge) window.vkBridge = bridge;
  const muteCalls = [];
  const context = {
    window,
    localStorage: makeStorage(local),
    sessionStorage: makeStorage(),
    URLSearchParams,
    console,
    Date,
    GameAudio: {
      async withMuted(task) {
        muteCalls.push("mute");
        try { return await task(); } finally { muteCalls.push("unmute"); }
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__service = VKService;`, context);
  return { service: context.__service, localStorage: context.localStorage, muteCalls };
}

const valid = (data) => data && data.difficulty === "tutorial";
const defaults = { version: 1, difficulty: "tutorial", levelIndex: 0 };

test("loads VK Cloud first and refreshes the local cache", async () => {
  const cloud = { version: 1, difficulty: "tutorial", levelIndex: 3 };
  const calls = [];
  const bridge = {
    async send(method) {
      calls.push(method);
      if (method === "VKWebAppStorageGet") {
        return { keys: [{ key: "game_progress_save", value: JSON.stringify(cloud) }] };
      }
      return { result: true };
    },
  };
  const { service, localStorage } = loadService({ search: "?vk_app_id=42", bridge });
  const loaded = await service.loadGameProgress(defaults, valid);
  assert.equal(loaded.source, "vk");
  assert.equal(loaded.data.levelIndex, 3);
  assert.deepEqual(calls.slice(0, 2), ["VKWebAppInit", "VKWebAppStorageGet"]);
  assert.equal(JSON.parse(localStorage.getItem(service.STORAGE_KEY)).levelIndex, 3);
});

test("falls back to local storage and syncs it to VK Cloud", async () => {
  const local = { version: 1, difficulty: "tutorial", levelIndex: 2 };
  const calls = [];
  const bridge = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === "VKWebAppStorageGet") return { keys: [{ key: "game_progress_save", value: "" }] };
      return { result: true };
    },
  };
  const { service } = loadService({
    search: "?vk_app_id=42",
    bridge,
    local: { game_progress_save: JSON.stringify(local) },
  });
  const loaded = await service.loadGameProgress(defaults, valid);
  assert.equal(loaded.source, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some(({ method }) => method === "VKWebAppStorageSet"));
});

test("returns first-run defaults when neither storage has progress", async () => {
  const { service } = loadService();
  const loaded = await service.loadGameProgress(defaults, valid);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.isFirstRun, true);
  assert.equal(loaded.data.isFirstRun, true);
});

test("mutes audio around rewarded video", async () => {
  const calls = [];
  const bridge = {
    async send(method, params) {
      calls.push({ method, params });
      return { result: true };
    },
  };
  const { service, muteCalls } = loadService({ search: "?vk_app_id=42", bridge });
  const result = await service.showRewardedAd();
  assert.equal(result.result, true);
  assert.deepEqual(muteCalls, ["mute", "unmute"]);
  assert.ok(calls.some(({ method, params }) => method === "VKWebAppShowNativeAds" && params.ad_format === "reward"));
});

test("applies an interstitial cooldown", async () => {
  let adCalls = 0;
  const bridge = {
    async send(method) {
      if (method === "VKWebAppShowNativeAds") adCalls += 1;
      return { result: true };
    },
  };
  const { service } = loadService({ search: "?vk_app_id=42", bridge });
  await service.showInterstitial();
  const second = await service.showInterstitial();
  assert.equal(adCalls, 1);
  assert.equal(second.skipped, "cooldown");
});

