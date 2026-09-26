/* Sound effects are synthesized on the fly from oscillators and one noise
   buffer, so there are no audio files to download. Everything runs through
   one master gain: the menu's volume sets it, and GameAudio drops it to zero
   while an advert is on screen. */
const GameSound = (() => {
  const SILENT = 0.0001;
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = true;
  let volume = 0.7;
  let gated = GameAudio.muted;

  function audible() {
    return enabled && !gated && volume > 0;
  }

  /* Squared, so the slider feels even to the ear rather than to the meter. */
  function level() {
    return audible() ? volume * volume : 0;
  }

  /* The context only starts inside a tap or click, as browsers demand. */
  function ensureContext() {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      context = new Context();
      master = context.createGain();
      master.gain.value = level();
      master.connect(context.destination);
    }
    if (context.state === "suspended" && !document.hidden) context.resume().catch(() => {});
    return context;
  }

  function applyLevel() {
    if (master) master.gain.setTargetAtTime(level(), context.currentTime, 0.02);
  }

  function envelope(gain, at, peak, attack, duration) {
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(SILENT, at + duration);
  }

  function tone(at, { type = "sine", from, to = from, duration, peak, attack = 0.006 }) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
    envelope(gain, at, peak, attack, duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
  }

  function noise(at, { duration, peak, type, frequency, q = 1, attack = 0.004 }) {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, Math.round(context.sampleRate * 1.5), context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    envelope(gain, at, peak, attack, duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + duration + 0.05);
  }

  const EFFECTS = {
    /* A case set down on the steel bed: a dull thump with a scuff on top. */
    place(at) {
      tone(at, { from: 150, to: 70, duration: 0.16, peak: 0.5 });
      noise(at, { duration: 0.07, peak: 0.18, type: "bandpass", frequency: 1400, q: 0.8 });
    },
    lift(at) {
      noise(at, { duration: 0.12, peak: 0.12, type: "bandpass", frequency: 900, q: 0.7 });
      tone(at, { type: "triangle", from: 220, to: 330, duration: 0.1, peak: 0.12 });
    },
    error(at) {
      tone(at, { type: "square", from: 150, duration: 0.11, peak: 0.07 });
      tone(at + 0.13, { type: "square", from: 118, duration: 0.16, peak: 0.07 });
    },
    click(at) {
      tone(at, { type: "triangle", from: 900, to: 600, duration: 0.05, peak: 0.12 });
    },
    hint(at) {
      [880, 1174.66, 1567.98].forEach((from, step) => {
        tone(at + step * 0.07, { from, duration: 0.35, peak: 0.12 });
      });
    },
    complete(at) {
      [523.25, 659.25, 783.99, 1046.5].forEach((from, step) => {
        tone(at + step * 0.09, { type: "triangle", from, duration: 0.5, peak: 0.16 });
      });
    },
    /* The tug pulling the loaded dolly away: a low rumble that swells. */
    depart(at) {
      noise(at, { duration: 1.1, peak: 0.2, type: "lowpass", frequency: 240, q: 1.5, attack: 0.3 });
      tone(at, { from: 55, to: 82, duration: 1.1, peak: 0.1, attack: 0.3 });
    },
  };

  function play(name) {
    if (!audible() || document.hidden || !EFFECTS[name] || !ensureContext()) return;
    try {
      EFFECTS[name](context.currentTime + 0.005);
    } catch (error) {
      console.warn("Не удалось проиграть звук:", error);
    }
  }

  GameAudio.registerMuteHandler((muted) => {
    gated = muted;
    applyLevel();
  });

  /* Nothing keeps sounding while the game is hidden behind another tab or
     the VK client. */
  document.addEventListener("visibilitychange", () => {
    if (!context) return;
    if (document.hidden) context.suspend().catch(() => {});
    else context.resume().catch(() => {});
  });

  return {
    play,
    unlock: ensureContext,
    configure(settings) {
      enabled = Boolean(settings.sound);
      volume = Math.min(100, Math.max(0, Number(settings.volume) || 0)) / 100;
      applyLevel();
    },
  };
})();
