/* Raster suitcase skins stretch only through their body panels. Handles,
   wheels and corner guards retain their proportions at every region size. */
const LuggageRenderer = (() => {
  const skins = ["./assets/suitcase-hard.png", "./assets/suitcase-soft.png"];
  const sources = skins.map((path) => {
    const image = new Image();
    image.src = path;
    return image;
  });
  const tinted = new Map();
  /* Load events, not decode(): a browser defers decoding while the tab is
     hidden, and the shift must still be ready when the player comes back. */
  const ready = Promise.all(sources.map((image) => new Promise((resolve) => {
    if (image.complete) resolve();
    else image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  })));

  function skinFor(index, color) {
    const material = index % 3 === 1 ? 1 : 0;
    const key = `${material}:${color}`;
    if (tinted.has(key)) return tinted.get(key);
    const source = sources[material];
    if (!source.complete || !source.naturalWidth) return null;
    const skin = document.createElement("canvas");
    skin.width = source.naturalWidth;
    skin.height = source.naturalHeight;
    const ctx = skin.getContext("2d");
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = color;
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

  function paint(canvas, index, color) {
    const skin = skinFor(index, color);
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
      drawPanels(ctx, skin, height, width);
    } else {
      drawPanels(ctx, skin, width, height);
    }
  }

  return { ready, paint };
})();
