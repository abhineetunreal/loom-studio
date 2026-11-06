/// <reference lib="webworker" />
/**
 * render.worker.ts — off-main-thread recolor + texture compute.
 *
 * The heavy pixel pipeline (recolor every pixel, sample the wool-grain detail
 * map, write the output) used to run synchronously on the UI thread, freezing
 * the page for ~100-400ms on every recolor and every design open.  This worker
 * runs that same math off-thread so the UI stays responsive.
 *
 * Scope: the SHADER + FLAT paths only (the common case — shader-type yarn
 * libraries like OneLoom).  Photo-swatch renders fall back to the main-thread
 * path in RecolorCanvas (they need swatch pixel data this worker doesn't hold).
 *
 * Protocol:
 *   main → worker  { type:'init', detailMapUrl }
 *   worker → main  { type:'ready' }                    (detail map loaded)
 *   main → worker  { type:'pixels', ssPixels, ssW, ssH, nativeWidth }
 *   main → worker  { type:'render', reqId, lookup, overrideLayer,
 *                    tileScaleX, tileScaleY, strength }
 *   worker → main  { type:'rendered', reqId, buffer, ssW, ssH }   (buffer transferred)
 *
 * `lookup` is a Map<number,{r,g,b}> and `overrideLayer` a Map<number,number>|null;
 * both are structured-cloned by postMessage (small).  The result buffer is
 * transferred back zero-copy.
 */

import { rgbToInt } from "@/lib/recolor";

type RGB = { r: number; g: number; b: number };

// ─── Worker state ─────────────────────────────────────────────────────────────
let detailData: Uint8ClampedArray | null = null;
let detailW = 0, detailH = 0;

let ssPixels: Uint8ClampedArray | null = null;
let ssW = 0, ssH = 0;
let nativeWidth = 0;

// ─── Detail-map loading (createImageBitmap — no DOM Image in workers) ──────────
async function loadDetailMap(url: string): Promise<void> {
  const resp = await fetch(url, { mode: "cors" });
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const oc = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = oc.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  detailData = img.data;
  detailW = bmp.width;
  detailH = bmp.height;
  bmp.close();
}

// ─── Core recolor + texture (non-photo, supersampled) ─────────────────────────
// Mirrors the non-photo branch of TextureShader.applyRecolorAndTexture, kept as
// an independent copy so the main-thread class stays untouched as the fallback.
function renderSS(
  lookup: Map<number, RGB>,
  overrideLayer: Map<number, number> | null,
  tileScaleX: number,
  tileScaleY: number,
  strength: number,
): ImageData {
  const px = ssPixels!;
  const width = ssW, height = ssH;
  const out = new ImageData(width, height);
  const o = out.data;
  const nw = nativeWidth || (width >> 1);

  const hasGrain = !!detailData && strength > 0;
  const dPx = detailData;
  const twMask = detailW - 1;
  const thMask = detailH - 1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    const nativeRowOff = (y >> 1) * nw;
    const texY = hasGrain ? (((y * tileScaleY) | 0) & thMask) : 0;
    const texRowOff = texY * detailW;

    for (let x = 0; x < width; x++) {
      const pi = (rowOff + x) << 2;
      const a = px[pi + 3];
      if (a === 0) continue; // transparent — out is zero-initialised

      const nativeIdx = nativeRowOff + (x >> 1);

      let r: number, g: number, b: number;
      const override = overrideLayer ? overrideLayer.get(nativeIdx) : undefined;
      if (override !== undefined) {
        r = (override >> 16) & 0xFF;
        g = (override >> 8) & 0xFF;
        b = override & 0xFF;
      } else {
        const r0 = px[pi], g0 = px[pi + 1], b0 = px[pi + 2];
        const rep = lookup.get(rgbToInt(r0, g0, b0));
        if (rep) { r = rep.r; g = rep.g; b = rep.b; }
        else { r = r0; g = g0; b = b0; }
      }

      if (hasGrain) {
        const texX = ((x * tileScaleX) | 0) & twMask;
        const d = dPx![(texRowOff + texX) << 2];
        const factor = 1 + strength * ((d - 128) / 128);
        o[pi]     = r * factor;
        o[pi + 1] = g * factor;
        o[pi + 2] = b * factor;
      } else {
        o[pi]     = r;
        o[pi + 1] = g;
        o[pi + 2] = b;
      }
      o[pi + 3] = a;
    }
  }
  return out;
}

// ─── Message handling ─────────────────────────────────────────────────────────
self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        await loadDetailMap(msg.detailMapUrl);
        (self as unknown as Worker).postMessage({ type: "ready" });
        break;
      }
      case "pixels": {
        ssPixels = new Uint8ClampedArray(msg.ssPixels);
        ssW = msg.ssW;
        ssH = msg.ssH;
        nativeWidth = msg.nativeWidth;
        break;
      }
      case "render": {
        if (!ssPixels) {
          (self as unknown as Worker).postMessage({ type: "error", reqId: msg.reqId, message: "no pixels" });
          return;
        }
        const img = renderSS(
          msg.lookup as Map<number, RGB>,
          (msg.overrideLayer as Map<number, number> | null) ?? null,
          msg.tileScaleX, msg.tileScaleY, msg.strength,
        );
        const buf = img.data.buffer;
        (self as unknown as Worker).postMessage(
          { type: "rendered", reqId: msg.reqId, buffer: buf, ssW, ssH },
          [buf],
        );
        break;
      }
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      reqId: msg?.reqId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
