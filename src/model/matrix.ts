import type { Point, Transform } from './types';
import { evalProp } from './animate';

/** Matriz afín 2D [a, b, c, d, e, f], como la de SVG. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const inv = 1 / det;
  return [
    m[3] * inv,
    -m[1] * inv,
    -m[2] * inv,
    m[0] * inv,
    (m[2] * m[5] - m[3] * m[4]) * inv,
    (m[1] * m[4] - m[0] * m[5]) * inv,
  ];
}

export function apply(m: Mat, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Aplica solo la parte lineal (para vectores de desplazamiento). */
export function applyLinear(m: Mat, p: Point): Point {
  return [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function scale(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export interface TransformValues {
  anchor: Point;
  position: Point;
  scale: Point;
  rotation: number;
  opacity: number;
}

/**
 * En modo pixel la posición y el ancla avanzan a saltos de píxel entero, frame
 * a frame (al exportar se hornean igual, con keyframes "a saltos").
 */
export function pixelSnap(v: number[]): number[] {
  return v.map((x) => Math.round(x));
}

export function evalTransform(t: Transform, frame: number, pixel = false): TransformValues {
  const pf = pixel ? Math.floor(frame + 1e-6) : frame;
  const a = pixel ? pixelSnap(evalProp(t.anchor, pf)) : evalProp(t.anchor, frame);
  const p = pixel ? pixelSnap(evalProp(t.position, pf)) : evalProp(t.position, frame);
  const s = evalProp(t.scale, frame);
  return {
    anchor: [a[0], a[1]],
    position: [p[0], p[1]],
    scale: [s[0], s[1]],
    rotation: evalProp(t.rotation, frame)[0],
    opacity: evalProp(t.opacity, frame)[0],
  };
}

/** Matriz de Lottie: T(posición) · R(rotación) · S(escala) · T(-ancla). */
export function transformMatrix(v: TransformValues): Mat {
  return multiply(
    multiply(multiply(translate(v.position[0], v.position[1]), rotate(v.rotation)), scale(v.scale[0] / 100, v.scale[1] / 100)),
    translate(-v.anchor[0], -v.anchor[1]),
  );
}

export function nodeMatrix(t: Transform, frame: number, pixel = false): Mat {
  return transformMatrix(evalTransform(t, frame, pixel));
}

export function toSvgMatrix(m: Mat): string {
  return `matrix(${m.map((n) => +n.toFixed(6)).join(' ')})`;
}

/** Determinante para escalar grosores de borde al hornear transformaciones. */
export function scaleFactor(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}
