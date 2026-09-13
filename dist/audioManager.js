/* Central mute gate for game audio. Future audio engines can subscribe to the
   `gameaudiomutechange` event or register their own mute callback here. */
const GameAudio = (() => {
  const handlers = new Set();
  const mediaState = new Map();
  let muteDepth = 0;

  function notify(muted) {
    document.dispatchEvent(new CustomEvent("gameaudiomutechange", { detail: { muted } }));
    handlers.forEach((handler) => {
      try { handler(muted); } catch (error) { console.warn("Не удалось изменить громкость игры:", error); }
    });
  }

  function mute() {
    muteDepth += 1;
    if (muteDepth > 1) return;
    document.querySelectorAll("audio, video").forEach((media) => {
      mediaState.set(media, media.muted);
      media.muted = true;
    });
    notify(true);
  }

  function unmute() {
    if (muteDepth === 0) return;
    muteDepth -= 1;
    if (muteDepth > 0) return;
    mediaState.forEach((wasMuted, media) => {
      if (media.isConnected) media.muted = wasMuted;
    });
    mediaState.clear();
    notify(false);
  }

  async function withMuted(task) {
    mute();
    try {
      return await task();
    } finally {
      unmute();
    }
  }

  return {
    registerMuteHandler(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    mute,
    unmute,
    withMuted,
    get muted() { return muteDepth > 0; },
  };
})();

