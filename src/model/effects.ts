import type { BezierPath, Doc, Effect, EffectKind, ImageAsset, ImageNode, Keyframe, Node, Point, Prop, ShapeNode } from './types';
import { DEFAULT_EASE, easeById, evalProp, prop } from './animate';
import { makeFill, makeStroke, makeTransform, makeTrim } from './defaults';
import { boundsOf, geometryPaths, samplePaths, unionBoxes, type Box } from './geometry';
import { IDENTITY, multiply, nodeMatrix } from './matrix';

// Los efectos no existen en Lottie como tales: cada uno se traduce a capas
// normales (degradado radial, imagen de halo horneada, formas que titilan)
// enlazadas a su capa con `parent`. El editor dibuja esas mismas capas, así
// que la vista previa y el JSON coinciden. Nada de blur ni expresiones: el
// paquete lottie de Flutter no los dibuja bien.

export const EFFECT_LABELS: Record<EffectKind, string> = {
  glow: 'Brillo',
  pixelGlow: 'Brillo pixel',
  sparkles: 'Destellos',
};

export const EFFECT_HINTS: Record<EffectKind, string> = {
  glow: 'Halo suave detrás de la capa (degradado radial).',
  pixelGlow: 'Halo de píxeles alrededor de la silueta y destellos de 4 puntas.',
  sparkles: 'Estrellitas de 4 puntas que aparecen y se apagan alrededor.',
};

export function makeEffect(kind: EffectKind, id: string): Effect {
  return {
    id,
    kind,
    enabled: true,
    color: kind === 'glow' ? [1, 0.82, 0.35] : [1, 0.95, 0.62],
    intensity: 60,
    speed: kind === 'sparkles' ? 1.6 : 1.2,
  };
}

/** Periodo en frames que cabe un número entero de veces: el bucle no da saltos. */
export function loopPeriod(duration: number, fps: number, seconds: number): number {
  if (seconds <= 0) return 0;
  const n = Math.max(1, Math.round(duration / (seconds * fps)));
  return duration / n;
}

function key(frame: number, value: number[], hold = false, ease = DEFAULT_EASE): Keyframe {
  return { id: `fx${frame}-${value.join('_')}`, frame, value, ease: { o: [...ease.o] as Point, i: [...ease.i] as Point }, hold: hold || undefined };
}

/** Pulso entre `hi` y `lo` que vuelve a `hi` al final de cada periodo. */
function pulse(duration: number, period: number, hi: number, lo: number, hold: boolean): Prop {
  if (!period) return prop([hi]);
  const keys: Keyframe[] = [];
  const cycles = Math.round(duration / period);
  for (let c = 0; c < cycles; c++) {
    const t0 = Math.round(c * period);
    const tm = Math.round(c * period + period / 2);
    keys.push(key(t0, [hi], hold), key(tm, [lo], hold));
  }
  keys.push(key(duration, [hi], hold));
  return dedupe({ value: [hi], keys });
}

function dedupe(p: Prop): Prop {
  const map = new Map<number, Keyframe>();
  for (const k of p.keys) map.set(k.frame, k);
  p.keys = [...map.values()].sort((a, b) => a.frame - b.frame);
  return p;
}

/** Producto de dos opacidades (la de la capa y la del pulso), muestreado si hace falta. */
export function multiplyOpacity(a: Prop, b: Prop, duration: number, hold: boolean): Prop {
  if (a.keys.length === 0) {
    const k = a.value[0] / 100;
    return { value: [b.value[0] * k], keys: b.keys.map((x) => ({ ...x, value: [x.value[0] * k] })) };
  }
  if (b.keys.length === 0) {
    const k = b.value[0] / 100;
    return { value: [a.value[0] * k], keys: a.keys.map((x) => ({ ...x, value: [x.value[0] * k] })) };
  }
  const keys: Keyframe[] = [];
  for (let f = 0; f <= duration; f++) {
    const v = Math.round(((evalProp(a, f)[0] * evalProp(b, f)[0]) / 100) * 10) / 10;
    if (keys.length && keys[keys.length - 1].value[0] === v && f < duration) continue;
    keys.push({ id: `m${f}`, frame: f, value: [v], ease: { o: [0, 0], i: [1, 1] }, hold: hold || undefined });
  }
  return { value: keys[0].value, keys };
}

/** Caja del contenido de la capa en su propio espacio (sin su transformación). */
export function localBounds(doc: Doc, node: Node): Box | null {
  if (node.type === 'image') {
    const a = doc.assets.find((x) => x.id === node.assetId);
    return a ? { x: 0, y: 0, w: a.w, h: a.h } : null;
  }
  if (node.type === 'shape') {
    const b = boundsOf(samplePaths(geometryPaths(node.geometry, 0), [...IDENTITY]));
    if (b && node.stroke.enabled) {
      const sw = node.stroke.width.value[0] / 2;
      return { x: b.x - sw, y: b.y - sw, w: b.w + sw * 2, h: b.h + sw * 2 };
    }
    return b;
  }
  const childBox = (n: Node, m: typeof IDENTITY): Box | null => {
    const mm = multiply(m, nodeMatrix(n.transform, 0));
    if (n.type === 'group') return unionBoxes(n.children.filter((c) => !c.hidden).map((c) => childBox(c, mm)));
    const lb = localBounds(doc, n);
    if (!lb) return null;
    const corners: Point[] = [
      [lb.x, lb.y],
      [lb.x + lb.w, lb.y],
      [lb.x + lb.w, lb.y + lb.h],
      [lb.x, lb.y + lb.h],
    ];
    return boundsOf(corners.map(([x, y]) => [mm[0] * x + mm[2] * y + mm[4], mm[1] * x + mm[3] * y + mm[5]] as Point));
  };
  return unionBoxes(node.children.filter((c) => !c.hidden).map((c) => childBox(c, [...IDENTITY])));
}

function rng(seedText: string) {
  let h = 1779033703;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shapeBase(id: string, name: string, paths: BezierPath[], color: number[], position: Point): ShapeNode {
  return {
    id,
    type: 'shape',
    name,
    hidden: false,
    locked: true,
    transform: makeTransform(position),
    geometry: { kind: 'path', paths },
    fill: makeFill(color),
    stroke: makeStroke(undefined, 1, false),
    trim: makeTrim(),
  };
}

function closedPoly(points: Point[]): BezierPath {
  return { closed: true, v: points, i: points.map(() => [0, 0]), o: points.map(() => [0, 0]) };
}

/** Destello de 4 puntas (✦) de radio r. */
function starPath(r: number): BezierPath {
  const k = r * 0.2;
  return closedPoly([
    [0, -r],
    [k, -k],
    [r, 0],
    [k, k],
    [0, r],
    [-k, k],
    [-r, 0],
    [-k, -k],
  ]);
}

/** Cruz pixel: píxel central y brazos de `arm` píxeles, alineada a la rejilla. */
function pixelPlus(arm: number): BezierPath {
  const a = arm;
  return closedPoly([
    [0, -a],
    [1, -a],
    [1, 0],
    [1 + a, 0],
    [1 + a, 1],
    [1, 1],
    [1, 1 + a],
    [0, 1 + a],
    [0, 1],
    [-a, 1],
    [-a, 0],
    [0, 0],
  ]);
}

/** Puntos repartidos alrededor de la caja, con algo de azar estable. */
function pointsAround(box: Box, n: number, rand: () => number, margin: number): Point[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2 + margin;
  const ry = box.h / 2 + margin;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const ang = ((i + rand() * 0.6) / n) * Math.PI * 2 - Math.PI / 2;
    const k = 0.75 + rand() * 0.35;
    out.push([cx + Math.cos(ang) * rx * k, cy + Math.sin(ang) * ry * k]);
  }
  return out;
}

/** Halo pixel ya horneado (PNG), lo calcula `bakePixelHalo`. */
export interface BakedHalo {
  asset: ImageAsset;
  x: number;
  y: number;
}

export interface EffectLayers {
  /** Van detrás de la capa. */
  behind: Node[];
  /** Van delante de la capa. */
  front: Node[];
  /** Imágenes que necesitan esas capas (halos horneados). */
  assets: ImageAsset[];
}

export function haloRings(intensity: number): number {
  return 1 + Math.round((intensity / 100) * 3);
}

/** Clave del halo: cambia si cambia el contenido de la capa o el efecto. */
export function haloKey(node: Node, fx: Effect): string {
  const content = JSON.stringify({ ...node, transform: null, effects: null, name: null, inFrame: null, outFrame: null, locked: null, hidden: null });
  return `${fx.id}|${fx.intensity}|${fx.color.join(',')}|${hash(content)}`;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Capas generadas por los efectos de un nodo, en el espacio del nodo (se
 * enlazan a él con parent). `halos` trae los halos pixel ya horneados.
 */
export function effectLayers(doc: Doc, node: Node, halos: Map<string, BakedHalo>): EffectLayers {
  const out: EffectLayers = { behind: [], front: [], assets: [] };
  const effects = (node.effects ?? []).filter((e) => e.enabled);
  if (!effects.length) return out;
  const box = localBounds(doc, node);
  if (!box) return out;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const nodeOpacity = node.transform.opacity;

  for (const fx of effects) {
    const period = loopPeriod(doc.duration, doc.fps, fx.speed);
    const k = fx.intensity / 100;
    const rand = rng(node.id + fx.id);
    const color = fx.color.slice(0, 3);
    const tag = `${node.id}~${fx.id}`;

    if (fx.kind === 'glow') {
      const r = (Math.max(box.w, box.h) / 2) * (1.15 + k * 0.85) + 2;
      const a0 = 0.35 + k * 0.55;
      const glow = shapeBase(`${tag}~glow`, `${node.name} · Brillo`, [], color, [cx, cy]);
      glow.geometry = { kind: 'ellipse', size: prop([r * 2, r * 2]) };
      glow.fill.gradient = {
        center: [0, 0],
        radius: r,
        stops: [
          [0, ...color, a0],
          [0.5, ...color, a0 * 0.4],
          [1, ...color, 0],
        ],
      };
      glow.fill.opacity = pulse(doc.duration, period, 100, 55, false);
      glow.transform.opacity = { value: [...nodeOpacity.value], keys: nodeOpacity.keys.map((x) => ({ ...x })) };
      out.behind.push(glow);
    }

    if (fx.kind === 'pixelGlow') {
      const halo = halos.get(haloKey(node, fx));
      if (halo) {
        const img: ImageNode = {
          id: `${tag}~halo`,
          type: 'image',
          name: `${node.name} · Halo pixel`,
          hidden: false,
          locked: true,
          assetId: halo.asset.id,
          transform: makeTransform([halo.x, halo.y], [0, 0]),
        };
        img.transform.opacity = multiplyOpacity(nodeOpacity, pulse(doc.duration, period, 100, 50, true), doc.duration, true);
        out.behind.push(img);
        out.assets.push(halo.asset);
      }
      // Destellos de 4 puntas en pixel: aparecen y se apagan a saltos.
      const n = 2 + Math.round(k * 3);
      const pts = pointsAround(box, n, rand, haloRings(fx.intensity) + 2);
      const cycle = period || doc.duration;
      pts.forEach((p, i) => {
        const arm = 1 + (i % 2 === 0 && k > 0.5 ? 1 : 0);
        // Píxel central en [0,1]: con posición entera cae justo en la rejilla.
        const s = shapeBase(`${tag}~spark${i}`, `${node.name} · Destello ${i + 1}`, [pixelPlus(arm)], color, [Math.round(p[0]), Math.round(p[1])]);
        s.transform.scale = twinkle(doc.duration, cycle, i / n, 0.3, true);
        s.transform.opacity = { value: [...nodeOpacity.value], keys: nodeOpacity.keys.map((x) => ({ ...x })) };
        out.front.push(s);
      });
    }

    if (fx.kind === 'sparkles') {
      const n = 3 + Math.round(k * 4);
      const size = Math.max(3, Math.max(box.w, box.h) * (0.05 + k * 0.07));
      const pts = pointsAround(box, n, rand, size);
      const cycle = period || doc.duration;
      pts.forEach((p, i) => {
        const s = shapeBase(`${tag}~star${i}`, `${node.name} · Destello ${i + 1}`, [starPath(size * (0.7 + rand() * 0.5))], color, [p[0], p[1]]);
        s.transform.scale = twinkle(doc.duration, cycle, (i / n + rand() * 0.15) % 1, 0.45, false);
        s.transform.rotation = spin(doc.duration, cycle);
        s.transform.opacity = { value: [...nodeOpacity.value], keys: nodeOpacity.keys.map((x) => ({ ...x })) };
        out.front.push(s);
      });
    }
  }
  return out;
}

/** Escala 0 → 100 → 0 una vez por ciclo, desfasada `phase` (0-1) y visible `on` (0-1) del ciclo. */
function twinkle(duration: number, cycle: number, phase: number, on: number, hold: boolean): Prop {
  const keys: Keyframe[] = [];
  const cycles = Math.max(1, Math.round(duration / cycle));
  const smooth = easeById('smooth');
  for (let c = 0; c < cycles; c++) {
    const base = c * cycle + phase * cycle;
    const t0 = Math.round(base);
    const t1 = Math.round(base + (cycle * on) / 2);
    const t2 = Math.round(base + cycle * on);
    if (t2 > duration) continue;
    keys.push(key(t0, [0, 0], hold, smooth), key(t1, [100, 100], hold, smooth), key(Math.max(t2, t1 + 1), [0, 0], hold, smooth));
  }
  if (!keys.length) return prop([0, 0]);
  if (keys[0].frame > 0) keys.unshift(key(0, [0, 0], true));
  return dedupe({ value: [0, 0], keys });
}

function spin(duration: number, cycle: number): Prop {
  const keys: Keyframe[] = [];
  const cycles = Math.max(1, Math.round(duration / cycle));
  for (let c = 0; c <= cycles; c++) keys.push(key(Math.round(c * cycle), [c * 45], false, easeById('linear')));
  return dedupe({ value: [0], keys });
}

/**
 * Hornea el halo pixel: silueta de la capa dilatada en anillos de píxeles,
 * cada anillo más transparente. Devuelve un PNG a resolución nativa.
 */
export function haloFromAlpha(alpha: Uint8ClampedArray, w: number, h: number, rings: number, color: number[]) {
  const W = w + rings * 2;
  const H = h + rings * 2;
  const solid = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[(y * w + x) * 4 + 3] > 40) solid[(y + rings) * W + x + rings] = 1;
  const dist = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < W * H; i++) if (solid[i]) dist[i] = 0;
  // Distancia en "anillos" con vecindad de 8 (cuadrada, como el pixel art).
  for (let r = 1; r <= rings; r++) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (dist[i] !== 255) continue;
        for (let dy = -1; dy <= 1 && dist[i] === 255; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (dist[ny * W + nx] === r - 1) {
              dist[i] = r;
              break;
            }
          }
      }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  const alphas = [0, 0.85, 0.55, 0.32, 0.16];
  for (let i = 0; i < W * H; i++) {
    const d = dist[i];
    if (d === 0 || d === 255 || d > rings) continue;
    out[i * 4] = Math.round(color[0] * 255);
    out[i * 4 + 1] = Math.round(color[1] * 255);
    out[i * 4 + 2] = Math.round(color[2] * 255);
    out[i * 4 + 3] = Math.round((alphas[d] ?? 0.1) * 255);
  }
  return { data: out, w: W, h: H };
}
