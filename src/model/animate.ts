import type { Ease, Keyframe, Prop, Vec } from './types';
import { uid } from './uid';

// Curvas predefinidas: cubren casi todo sin tocar la gráfica. "A saltos" es
// la opción `hold` del keyframe, no una curva.
export const EASE_PRESETS: { id: string; label: string; ease: Ease }[] = [
  { id: 'linear', label: 'Lineal', ease: { o: [0, 0], i: [1, 1] } },
  { id: 'smooth', label: 'Suave', ease: { o: [0.33, 0], i: [0.67, 1] } },
  { id: 'in', label: 'Entrada', ease: { o: [0.55, 0], i: [1, 1] } },
  { id: 'out', label: 'Salida', ease: { o: [0, 0], i: [0.45, 1] } },
  { id: 'bounce', label: 'Rebote leve', ease: { o: [0.34, 1.32], i: [0.64, 1] } },
];

export const easeById = (id: string): Ease => EASE_PRESETS.find((p) => p.id === id)!.ease;

export const DEFAULT_EASE: Ease = easeById('smooth');

export function prop(value: Vec): Prop {
  return { value: [...value], keys: [] };
}

export function isAnimated(p: Prop): boolean {
  return p.keys.length > 0;
}

/**
 * Curva cubic-bezier como la de CSS: (0,0), (x1,y1), (x2,y2), (1,1).
 * Mismo método que bezier-easing: Newton-Raphson con bisección de respaldo.
 */
export function bezierEasing(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (x1 === y1 && x2 === y2) return (t) => t;
  const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const C = (a1: number) => 3 * a1;
  const calc = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);

  const solveT = (x: number) => {
    let t = x;
    for (let n = 0; n < 8; n++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      const cx = calc(t, x1, x2) - x;
      if (Math.abs(cx) < 1e-7) return t;
      t -= cx / s;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let n = 0; n < 40; n++) {
      const cx = calc(t, x1, x2);
      if (Math.abs(cx - x) < 1e-7) return t;
      if (cx < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return calc(solveT(x), y1, y2);
  };
}

export function easeProgress(ease: Ease, t: number): number {
  return bezierEasing(ease.o[0], ease.o[1], ease.i[0], ease.i[1])(t);
}

function lerpVec(a: Vec, b: Vec, t: number): Vec {
  const out: number[] = [];
  for (let k = 0; k < a.length; k++) out.push(a[k] + ((b[k] ?? a[k]) - a[k]) * t);
  return out;
}

/** Valor de la propiedad en un frame (admite frames fraccionarios). */
export function evalProp(p: Prop, frame: number): Vec {
  const keys = p.keys;
  if (keys.length === 0) return p.value;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k];
    const b = keys[k + 1];
    if (frame >= a.frame && frame < b.frame) {
      if (a.hold) return a.value;
      const t = (frame - a.frame) / (b.frame - a.frame);
      return lerpVec(a.value, b.value, easeProgress(a.ease, t));
    }
  }
  return last.value;
}

export function keyAt(p: Prop, frame: number): Keyframe | undefined {
  const f = Math.round(frame);
  return p.keys.find((k) => k.frame === f);
}

function sortKeys(p: Prop) {
  p.keys.sort((a, b) => a.frame - b.frame);
}

/**
 * Cambia el valor de una propiedad en el frame actual. Si ya está animada,
 * crea o actualiza el keyframe de ese frame (como el auto-key de After Effects).
 */
export function setPropValue(p: Prop, value: Vec, frame: number, autoKey = false): void {
  if (p.keys.length === 0) {
    const f = Math.round(frame);
    // Auto-keyframe: el primer cambio fuera del frame 0 anima desde el valor que tenía.
    if (autoKey && f > 0 && value.some((v, i) => v !== p.value[i])) {
      p.keys.push({ id: uid(), frame: 0, value: [...p.value], ease: { ...DEFAULT_EASE } });
      p.keys.push({ id: uid(), frame: f, value: [...value], ease: { ...DEFAULT_EASE } });
      return;
    }
    p.value = [...value];
    return;
  }
  const f = Math.round(frame);
  const existing = p.keys.find((k) => k.frame === f);
  if (existing) existing.value = [...value];
  else {
    p.keys.push({ id: uid(), frame: f, value: [...value], ease: { ...DEFAULT_EASE } });
    sortKeys(p);
  }
}

/** Pone o quita el keyframe del frame actual. */
export function toggleKey(p: Prop, frame: number): void {
  const f = Math.round(frame);
  const idx = p.keys.findIndex((k) => k.frame === f);
  if (idx >= 0) {
    const removed = p.keys[idx];
    p.keys.splice(idx, 1);
    if (p.keys.length === 0) p.value = [...removed.value];
    return;
  }
  const value = evalProp(p, f);
  p.keys.push({ id: uid(), frame: f, value: [...value], ease: { ...DEFAULT_EASE } });
  sortKeys(p);
}

/** Quita toda la animación y deja el valor del frame actual. */
export function clearAnimation(p: Prop, frame: number): void {
  if (p.keys.length === 0) return;
  p.value = [...evalProp(p, frame)];
  p.keys = [];
}

export function removeKeys(p: Prop, ids: Set<string>): void {
  if (!p.keys.some((k) => ids.has(k.id))) return;
  const before = p.keys;
  p.keys = p.keys.filter((k) => !ids.has(k.id));
  if (p.keys.length === 0) p.value = [...before[0].value];
}

/**
 * Mueve keyframes en el tiempo. Si un keyframe cae sobre otro que no se mueve,
 * el que se mueve lo reemplaza.
 */
export function shiftKeys(p: Prop, ids: Set<string>, delta: number, maxFrame: number): void {
  if (delta === 0 || !p.keys.some((k) => ids.has(k.id))) return;
  const moving = p.keys.filter((k) => ids.has(k.id));
  const staying = p.keys.filter((k) => !ids.has(k.id));
  for (const k of moving) k.frame = Math.max(0, Math.min(maxFrame, Math.round(k.frame + delta)));
  const taken = new Set(moving.map((k) => k.frame));
  p.keys = [...staying.filter((k) => !taken.has(k.frame)), ...dedupeByFrame(moving)];
  sortKeys(p);
}

function dedupeByFrame(keys: Keyframe[]): Keyframe[] {
  const seen = new Map<number, Keyframe>();
  for (const k of keys) seen.set(k.frame, k);
  return [...seen.values()];
}

export function nextKeyFrame(p: Prop, frame: number): number | undefined {
  return p.keys.find((k) => k.frame > Math.round(frame))?.frame;
}

export function prevKeyFrame(p: Prop, frame: number): number | undefined {
  const before = p.keys.filter((k) => k.frame < Math.round(frame));
  return before.length ? before[before.length - 1].frame : undefined;
}
