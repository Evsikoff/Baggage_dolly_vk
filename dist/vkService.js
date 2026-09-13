/* All VK Bridge calls live here so the game remains playable when it is
   opened directly in a browser or when a platform request fails. */
const VKService = (() => {
  const STORAGE_KEY = "game_progress_save";
  const INTERSTITIAL_COOLDOWN_MS = 120_000;
  const INTERSTITIAL_TIME_KEY = "baggage-dolly-last-interstitial";
  const REQUEST_TIMEOUT_MS = 8_000;
  let bridge = null;
  let initialized = false;
  let initializing = null;

  function storageGet(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn("Ошибка сохранения в локальном хранилище:", error);
      return false;
    }
  }

  function isVKRuntime() {
    const params = new URLSearchParams(window.location.search);
    return params.has("vk_app_id")
      || Boolean(window.AndroidBridge)
      || Boolean(window.ReactNativeWebView)
      || Boolean(window.webkit?.messageHandlers);
  }

  function createLocalBridge() {
    return {
      isMock: true,
      async send(method, params = {}) {
        if (method === "VKWebAppStorageGet") {
          return { keys: (params.keys || []).map((key) => ({ key, value: "" })) };
        }
        if (method === "VKWebAppShowNativeAds") return { result: true, mock: true };
        return { result: true, mock: true };
      },
    };
  }

  function resolveBridge() {
    if (bridge) return bridge;
    bridge = isVKRuntime() && window.vkBridge?.send ? window.vkBridge : createLocalBridge();
    if (bridge.isMock) console.info("VK Bridge: включён безопасный режим локальной разработки");
    return bridge;
  }

  function withTimeout(promise, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), REQUEST_TIMEOUT_MS);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }

  async function initialize() {
    if (initialized) return true;
    if (initializing) return initializing;
    initializing = withTimeout(resolveBridge().send("VKWebAppInit"), "VKWebAppInit")
      .then(() => {
        initialized = true;
        return true;
      })
      .catch((error) => {
        console.warn("VK Bridge недоступен, игра продолжит работу локально:", error);
        bridge = createLocalBridge();
        initialized = true;
        return false;
      });
    return initializing;
  }

  function parseProgress(raw, validator) {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return (!validator || validator(data)) ? data : null;
    } catch (_) {
      return null;
    }
  }

  async function loadGameProgress(defaultData, validator) {
    await initialize();
    try {
      const response = await withTimeout(
        resolveBridge().send("VKWebAppStorageGet", { keys: [STORAGE_KEY] }),
        "VKWebAppStorageGet",
      );
      const cloudRaw = response?.keys?.find((entry) => entry.key === STORAGE_KEY)?.value;
      const cloudData = parseProgress(cloudRaw, validator);
      if (cloudData) {
        storageSet(localStorage, STORAGE_KEY, JSON.stringify(cloudData));
        return { data: cloudData, source: "vk", isFirstRun: false };
      }
    } catch (error) {
      console.warn("Ошибка загрузки из VK Cloud, проверяем локальное сохранение:", error);
    }

    const localData = parseProgress(storageGet(localStorage, STORAGE_KEY), validator);
    if (localData) {
      void saveToCloud(localData);
      return { data: localData, source: "local", isFirstRun: false };
    }

    return {
      data: { ...defaultData, isFirstRun: true },
      source: "default",
      isFirstRun: true,
    };
  }

  async function saveToCloud(data) {
    const serializedData = JSON.stringify(data);
    try {
      await initialize();
      return await withTimeout(
        resolveBridge().send("VKWebAppStorageSet", { key: STORAGE_KEY, value: serializedData }),
        "VKWebAppStorageSet",
      );
    } catch (error) {
      console.warn("Ошибка сохранения в VK Cloud:", error);
      return null;
    }
  }

  function saveGameProgress(data) {
    const serializedData = JSON.stringify(data);
    storageSet(localStorage, STORAGE_KEY, serializedData);
    return saveToCloud(data);
  }

  async function showNativeAd(adFormat) {
    await initialize();
    return GameAudio.withMuted(() => resolveBridge().send("VKWebAppShowNativeAds", { ad_format: adFormat }));
  }

  async function showRewardedAd() {
    return showNativeAd("reward");
  }

  async function showInterstitial() {
    const now = Date.now();
    const lastShown = Number(storageGet(sessionStorage, INTERSTITIAL_TIME_KEY) || 0);
    if (now - lastShown < INTERSTITIAL_COOLDOWN_MS) {
      return { result: false, skipped: "cooldown" };
    }
    try {
      const result = await showNativeAd("interstitial");
      storageSet(sessionStorage, INTERSTITIAL_TIME_KEY, String(Date.now()));
      return result;
    } catch (error) {
      console.error("Ошибка при показе межстраничной рекламы:", error);
      return { result: false, error };
    }
  }

  return {
    STORAGE_KEY,
    INTERSTITIAL_COOLDOWN_MS,
    initialize,
    loadGameProgress,
    saveGameProgress,
    showRewardedAd,
    showInterstitial,
    get isMock() { return Boolean(resolveBridge().isMock); },
  };
})();
