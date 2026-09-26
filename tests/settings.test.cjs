const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "dist", "settings.js"), "utf8");

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function loadSettings({ stored, reducedMotion = false } = {}) {
  const localStorage = makeStorage(stored === undefined ? {} : { "baggage-dolly-settings": stored });
  const context = {
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    localStorage,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__settings = GameSettings;`, context);
  return { settings: context.__settings, localStorage };
}

test("starts from defaults and follows the system motion preference", () => {
  assert.equal(loadSettings().settings.get("motion"), true);
  const { settings } = loadSettings({ reducedMotion: true });
  assert.equal(settings.get("sound"), true);
  assert.equal(settings.get("volume"), 70);
  assert.equal(settings.get("motion"), false);
  assert.equal(settings.get("quality"), "high");
});

test("ignores malformed stored values", () => {
  const { settings } = loadSettings({ stored: JSON.stringify({ sound: "no", volume: 400, quality: "ultra", motion: false }) });
  assert.equal(settings.get("sound"), true);
  assert.equal(settings.get("volume"), 100);
  assert.equal(settings.get("quality"), "high");
  assert.equal(settings.get("motion"), false);
  assert.equal(loadSettings({ stored: "{broken" }).settings.get("volume"), 70);
});

test("persists changes and notifies subscribers", () => {
  const { settings, localStorage } = loadSettings();
  const seen = [];
  settings.subscribe((values) => seen.push(values.sound));
  settings.set("sound", false);
  settings.set("sound", false);
  settings.set("quality", "economy");
  assert.deepEqual(seen, [true, false, false]);
  assert.deepEqual(JSON.parse(localStorage.getItem(settings.STORAGE_KEY)), {
    sound: false, volume: 70, motion: true, quality: "economy",
  });
});
