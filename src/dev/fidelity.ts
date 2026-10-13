// Herramienta temporal de verificación: compara dos Lottie renderizados con lottie-web.
import lottie from 'lottie-web/build/player/lottie_light';

async function rasterize(data: object, frame: number, w: number, h: number): Promise<Uint8ClampedArray> {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px`;
  document.body.appendChild(box);
  const anim = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(data)) });
  await new Promise((r) => setTimeout(r, 50));
  anim.goToAndStop(frame, true);
  await new Promise((r) => setTimeout(r, 30));
  const svg = box.querySelector('svg')!;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((r, j) => {
    img.onload = r;
    img.onerror = j;
    img.src = url;
  });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  anim.destroy();
  box.remove();
  URL.revokeObjectURL(url);
  return ctx.getImageData(0, 0, w, h).data;
}

export async function compare(a: object, b: object, frames: number[], w: number, h: number) {
  const out: { frame: number; diffPct: number; nonEmpty: number }[] = [];
  for (const f of frames) {
    const pa = await rasterize(a, f, w, h);
    const pb = await rasterize(b, f, w, h);
    let diff = 0;
    let nonEmpty = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i + 3] > 0) nonEmpty++;
      const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) + Math.abs(pa[i + 3] - pb[i + 3]);
      if (d > 24) diff++;
    }
    out.push({ frame: f, diffPct: Math.round((diff / (pa.length / 4)) * 10000) / 100, nonEmpty });
  }
  return out;
}

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Doc } from '../model/types';

async function rasterizeSvg(xml: string, w: number, h: number) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((r, j) => {
    img.onload = r;
    img.onerror = j;
    img.src = url;
  });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  return ctx.getImageData(0, 0, w, h).data;
}

/** Compara el lienzo del editor (con efectos) con lottie-web reproduciendo el JSON final. */
export async function compareEditor(doc: Doc, frames: number[], outputScale = 1) {
  const { finalExport } = await import('../io/finalExport');
  const { halos, ensureHalosAsync } = await import('../store/bake');
  const { Scene } = await import('../ui/Scene');
  await ensureHalosAsync(doc);
  const out = await finalExport(doc, { trim: false, outputScale }, halos);
  const W = doc.width * outputScale;
  const H = doc.height * outputScale;
  const res: { frame: number; diffPct: number; nonEmpty: number }[] = [];
  for (const f of frames) {
    const body = renderToStaticMarkup(createElement(Scene, { doc, frame: f, halos }));
    const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${doc.width} ${doc.height}"><style>image{image-rendering:pixelated}</style>${body}</svg>`;
    const pa = await rasterizeSvg(xml, W, H);
    const pb = await rasterize(out.json, f, W, H);
    let diff = 0;
    let nonEmpty = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (pb[i + 3] > 0) nonEmpty++;
      const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) + Math.abs(pa[i + 3] - pb[i + 3]);
      if (d > 48) diff++;
    }
    res.push({ frame: f, diffPct: Math.round((diff / (pa.length / 4)) * 10000) / 100, nonEmpty });
  }
  return res;
}

/** Pone en pantalla, lado a lado, lottie-web (rojo) y el editor (verde) para mirarlos. */
export async function showSideBySide(doc: Doc, frame: number, outputScale = 8) {
  const { finalExport } = await import('../io/finalExport');
  const { halos, ensureHalosAsync } = await import('../store/bake');
  const { Scene } = await import('../ui/Scene');
  await ensureHalosAsync(doc);
  const out = await finalExport(doc, { trim: false, outputScale }, halos);
  const W = doc.width * outputScale;
  const H = doc.height * outputScale;
  document.querySelectorAll('.fid-dbg').forEach((e) => e.remove());
  const a = document.createElement('div');
  a.className = 'fid-dbg';
  a.style.cssText = `position:fixed;left:20px;top:60px;width:${W}px;height:${H}px;z-index:999;background:#fff;outline:2px solid red`;
  document.body.appendChild(a);
  const anim = lottie.loadAnimation({ container: a, renderer: 'svg', loop: false, autoplay: false, animationData: out.json });
  await new Promise((r) => setTimeout(r, 200));
  anim.goToAndStop(frame, true);
  const b = document.createElement('div');
  b.className = 'fid-dbg';
  b.style.cssText = `position:fixed;left:${40 + W}px;top:60px;width:${W}px;height:${H}px;z-index:999;background:#fff;outline:2px solid lime`;
  b.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${doc.width} ${doc.height}"><style>image{image-rendering:pixelated}</style>${renderToStaticMarkup(createElement(Scene, { doc, frame, halos }))}</svg>`;
  document.body.appendChild(b);
  return out.json;
}
