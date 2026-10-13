import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Doc, Effect, ImageAsset, Node } from '../model/types';
import { Scene } from '../ui/Scene';
import { NodeView } from '../ui/render';
import { haloFromAlpha, haloRings, localBounds, type BakedHalo } from '../model/effects';
import { makeTransform } from '../model/defaults';

// Pasar la escena a píxeles: halos horneados, sprite sheets y fotogramas.
// Se carga aparte (usa react-dom/server) solo cuando hace falta.

/** SVG de la escena en un frame. En pixel art, sin antialias y con imágenes nítidas. */
export function sceneSvg(doc: Doc, frame: number, halos: Map<string, BakedHalo>): string {
  const body = renderToStaticMarkup(createElement(Scene, { doc, frame, halos }));
  const crisp = doc.pixel ? '<style>path{shape-rendering:crispEdges}image{image-rendering:pixelated}</style>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${crisp}${body}</svg>`;
}

export async function svgToImage(xml: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('No se pudo dibujar el fotograma.'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
  });
  return img;
}

/** Escala una imagen ×k con vecino más cercano (sin suavizado). */
export async function upscaleDataUrl(data: string, w: number, h: number, k: number): Promise<string> {
  const img = await loadImage(data);
  const { c, ctx } = canvas(w * k, h * k);
  ctx.drawImage(img, 0, 0, w * k, h * k);
  return c.toDataURL('image/png');
}

/** Hornea el halo pixel de una capa: su silueta dilatada en anillos. */
export async function bakePixelHalo(doc: Doc, node: Node, fx: Effect): Promise<BakedHalo | null> {
  const box = localBounds(doc, node);
  if (!box) return null;
  const x0 = Math.floor(box.x);
  const y0 = Math.floor(box.y);
  const w = Math.ceil(box.x + box.w) - x0;
  const h = Math.ceil(box.y + box.h) - y0;
  // La capa tal cual, sin su transformación, desplazada a su caja.
  const local = { ...node, effects: undefined, hidden: false, inFrame: undefined, outFrame: undefined, transform: makeTransform([-x0, -y0]) } as Node;
  const body = renderToStaticMarkup(createElement(NodeView, { node: local, frame: 0, assets: doc.assets, pixel: doc.pixel }));
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>path{shape-rendering:crispEdges}image{image-rendering:pixelated}</style>${body}</svg>`;
  const img = await svgToImage(xml);
  const { ctx } = canvas(w, h);
  ctx.drawImage(img, 0, 0);
  const alpha = ctx.getImageData(0, 0, w, h).data;
  const rings = haloRings(fx.intensity);
  const halo = haloFromAlpha(alpha, w, h, rings, fx.color);
  const out = canvas(halo.w, halo.h);
  out.ctx.putImageData(new ImageData(halo.data, halo.w, halo.h), 0, 0);
  const asset: ImageAsset = { id: `halo_${node.id}_${fx.id}`, name: `Halo ${node.name}`, w: halo.w, h: halo.h, data: out.c.toDataURL('image/png') };
  return { asset, x: x0 - rings, y: y0 - rings };
}

export interface SpriteSheet {
  png: Blob;
  url: string;
  meta: Record<string, unknown>;
  frames: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

/** Dibuja cada fotograma de [from, to) a resolución nativa ×scale. */
export async function renderFrames(doc: Doc, halos: Map<string, BakedHalo>, from: number, to: number, scale: number, onFrame: (c: HTMLCanvasElement, i: number) => void) {
  const fw = doc.width * scale;
  const fh = doc.height * scale;
  for (let f = from, i = 0; f < to; f++, i++) {
    const img = await svgToImage(sceneSvg(doc, f, halos));
    const { c, ctx } = canvas(fw, fh);
    if (scale === 1) ctx.drawImage(img, 0, 0);
    else {
      // Primero a tamaño nativo y luego ×scale sin suavizado.
      const base = canvas(doc.width, doc.height);
      base.ctx.drawImage(img, 0, 0);
      ctx.drawImage(base.c, 0, 0, fw, fh);
    }
    onFrame(c, i);
  }
}

export async function buildSpriteSheet(
  doc: Doc,
  halos: Map<string, BakedHalo>,
  opts: { scale: number; from: number; to: number; fileBase: string; segments: { name: string; start: number; end: number }[] },
): Promise<SpriteSheet> {
  const frames = Math.max(1, opts.to - opts.from);
  const fw = doc.width * opts.scale;
  const fh = doc.height * opts.scale;
  const columns = Math.max(1, Math.min(frames, Math.floor(4096 / fw) || 1, Math.ceil(Math.sqrt(frames * (fh / fw)))));
  const rows = Math.ceil(frames / columns);
  const sheet = canvas(fw * columns, fh * rows);
  await renderFrames(doc, halos, opts.from, opts.to, opts.scale, (c, i) => {
    sheet.ctx.drawImage(c, (i % columns) * fw, Math.floor(i / columns) * fh);
  });
  const png = await new Promise<Blob>((resolve) => sheet.c.toBlob((b) => resolve(b!), 'image/png'));
  const meta = {
    image: `${opts.fileBase}.png`,
    frameWidth: fw,
    frameHeight: fh,
    frames,
    columns,
    rows,
    fps: doc.fps,
    scale: opts.scale,
    // start y end son fotogramas de esta hoja (0 = el primero), end incluido.
    segments: opts.segments
      .filter((s) => s.end > opts.from && s.start < opts.to)
      .map((s) => ({ name: s.name, start: Math.max(0, s.start - opts.from), end: Math.min(frames, s.end - opts.from) - 1 })),
    generator: 'Fotograma',
  };
  return { png, url: URL.createObjectURL(png), meta, frames, columns, rows, frameWidth: fw, frameHeight: fh };
}

/** Fotogramas sueltos en PNG dentro de un .zip. */
export async function buildFramesZip(doc: Doc, halos: Map<string, BakedHalo>, opts: { scale: number; from: number; to: number; fileBase: string }): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const blobs: Promise<void>[] = [];
  const digits = String(opts.to - opts.from).length;
  await renderFrames(doc, halos, opts.from, opts.to, opts.scale, (c, i) => {
    blobs.push(
      new Promise<void>((resolve) =>
        c.toBlob(async (b) => {
          files[`${opts.fileBase}_${String(i).padStart(Math.max(3, digits), '0')}.png`] = new Uint8Array(await b!.arrayBuffer());
          resolve();
        }, 'image/png'),
      ),
    );
  });
  await Promise.all(blobs);
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}
