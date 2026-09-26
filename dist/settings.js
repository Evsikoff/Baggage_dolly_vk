/* Player preferences from the menu. They belong to the device rather than to
   the shift, so they stay in localStorage and never travel to VK Cloud. */
const GameSettings = (() => {
  const STORAGE_KEY = "baggage-dolly-settings";
  const QUALITIES = ["high", "economy"];
  const prefersStill = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const DEFAULTS = { sound: true, volume: 70, motion: !prefersStill, quality: "high" };
  const listeners = new Set();

  /* Anything malformed in storage quietly falls back to the default. */
  function sanitize(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object") return clean;
    if (typeof raw.sound === "boolean") clean.sound = raw.sound;
    if (Number.isFinite(raw.volume)) clean.volume = Math.min(100, Math.max(0, Math.round(raw.volume)));
    if (typeof raw.motion === "boolean") clean.motion = raw.motion;
    if (QUALITIES.includes(raw.quality)) clean.quality = raw.quality;
    return clean;
  }

  function read() {
    try { return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (_) { return {}; }
  }

  let values = { ...DEFAULTS, ...read() };

  function set(key, value) {
    const next = sanitize({ ...values, [key]: value });
    if (next[key] === values[key]) return;
    values = { ...values, ...next };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (_) {}
    listeners.forEach((listener) => listener({ ...values }));
  }

  /* The listener runs once straight away, so it can also set things up. */
  function subscribe(listener) {
    listeners.add(listener);
    listener({ ...values });
    return () => listeners.delete(listener);
  }

  return {
    STORAGE_KEY,
    get: (key) => values[key],
    set,
    subscribe,
  };
})();
