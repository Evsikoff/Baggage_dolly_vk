/* Raster suitcase skins stretch only through their body panels. Handles,
   wheels and corner guards retain their proportions at every region size. */
const LuggageRenderer = (() => {
  /* Every skin is a 1254x1254 RGBA case seen from above on transparency,
     grey enough for the tag colour to multiply over it, with the handle
     inside the middle fifth of the top band and the wheels in the outer
     columns. Add a file here to put it in the rotation; a file that fails
     to load is dropped from the pool instead of stopping the shift. */
  const SKINS = [
    "./assets/suitcase-hard.png",
    "./assets/suitcase-soft.png",
    "./assets/suitcase-ribbed.png",
    "./assets/suitcase-quilted.png",
    "./assets/suitcase-trunk.png",
    "./assets/suitcase-flightcase.png",
    "./assets/suitcase-duffel.png",
    "./assets/suitcase-wrapped.png",
  ];

  const sources = SKINS.map((path) => {
    const image = new Image();
    image.src = path;
    return image;
  });
  const tinted = new Map();
  /* Load events, not decode(): a browser defers decoding while the tab is
     hidden, and the shift must still be ready when the player comes back. */
  const loads = sources.map((image) => new Promise((resolve) => {
    if (image.complete) resolve();
    else image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  }));
  const ready = Promise.all(loads);

  let pool = sources;
  ready.then(() => {
    const loaded = sources.filter((image) => image.complete && image.naturalWidth);
    if (loaded.length) pool = loaded;
  });

  /* One scrambled number per tag decides which skin the case is made of,
     which way round it lies and how worn its colour looks. It is derived
     from the tag index, so a case keeps its identity between repaints
     while a loaded dolly ends up a mixed pile rather than a pattern. */
  function variantOf(index) {
    let hash = Math.imul(index + 1, 2654435761) >>> 0;
    hash = (hash ^ (hash >>> 15)) >>> 0;
    hash = Math.imul(hash, 2246822507) >>> 0;
    /* Stay unsigned: a negative hash would index the pool off its end. */
    hash = (hash ^ (hash >>> 13)) >>> 0;
    return {
      source: pool[hash % pool.length],
      flipX: (hash >>> 7) & 1 ? -1 : 1,
      flipY: (hash >>> 11) & 1 ? -1 : 1,
      tone: 0.9 + ((hash >>> 15) % 21) / 100,
    };
  }

  /* The tag colour multiplies over the grey skin. Shading it per case keeps
     two cases of one colour from looking pressed out of the same mould. */
  function shade(color, tone) {
    const value = parseInt(color.slice(1), 16);
    const channel = (shift) => Math.min(255, Math.round(((value >> shift) & 255) * tone));
    return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
  }

  function skinFor(variant, color) {
    const source = variant.source;
    if (!source || !source.complete || !source.naturalWidth) return null;
    const wash = shade(color, variant.tone);
    const key = `${source.src}:${wash}`;
    if (tinted.has(key)) return tinted.get(key);
    const skin = document.createElement("canvas");
    skin.width = source.naturalWidth;
    skin.height = source.naturalHeight;
    const ctx = skin.getContext("2d");
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, skin.width, skin.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(source, 0, 0);
    tinted.set(key, skin);
    return skin;
  }

  function drawPanels(ctx, skin, width, height) {
    const corner = Math.min(24, width * .22, height * .18);
    const handle = Math.min(34, width * .28);
    // Five columns keep the central handle at a fixed width. Three rows
    // stretch the body length without lengthening the wheels or end caps.
    const sx = [0, .20, .30, .70, .80, 1].map((x) => x * skin.width);
    const sy = [0, .20, .80, 1].map((y) => y * skin.height);
    const dx = [0, corner, (width - handle) / 2, (width + handle) / 2, width - corner, width];
    const dy = [0, corner, height - corner, height];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        ctx.drawImage(skin, sx[x], sy[y], sx[x + 1] - sx[x], sy[y + 1] - sy[y],
          dx[x], dy[y], dx[x + 1] - dx[x], dy[y + 1] - dy[y]);
      }
    }
  }

  /* Both band layouts are symmetric, so mirroring the destination lays the
     case down the other way round without disturbing the nine slices. */
  function drawCase(ctx, skin, width, height, variant) {
    ctx.save();
    ctx.translate(variant.flipX < 0 ? width : 0, variant.flipY < 0 ? height : 0);
    ctx.scale(variant.flipX, variant.flipY);
    drawPanels(ctx, skin, width, height);
    ctx.restore();
  }

  function paint(canvas, index, color) {
    const variant = variantOf(index);
    const skin = skinFor(variant, color);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!skin || !width || !height) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    const ctx = canvas.getContext("2d");
    ctx.scale(density, density);
    ctx.imageSmoothingQuality = "high";
    if (width > height) {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
      drawCase(ctx, skin, height, width, variant);
    } else {
      drawCase(ctx, skin, width, height, variant);
    }
  }

  return { ready, loads, paint };
})();
