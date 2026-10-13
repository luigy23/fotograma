import type { BezierPath, Geometry, Point } from './types';
import { evalProp } from './animate';
import { apply, type Mat } from './matrix';

// Las formas se convierten a trazos con el mismo orden de vértices que usa
// lottie-web. Así "Recortar trazo" empieza en el mismo punto en el editor y
// en la app.

const KAPPA = 0.5519;

export function rectPath(w: number, h: number, roundness: number): BezierPath {
  const v0 = w / 2;
  const v1 = h / 2;
  const round = Math.max(0, Math.min(v0, v1, roundness));
  const c = round * (1 - KAPPA);
  // [vértice, salida absoluta, entrada absoluta], en sentido horario empezando
  // arriba a la derecha (como RectShapeProperty de lottie-web).
  const triples: [Point, Point, Point][] =
    round === 0
      ? [
          [[v0, -v1], [v0, -v1], [v0, -v1]],
          [[v0, v1], [v0, v1], [v0, v1]],
          [[-v0, v1], [-v0, v1], [-v0, v1]],
          [[-v0, -v1], [-v0, -v1], [-v0, -v1]],
        ]
      : [
          [[v0, -v1 + round], [v0, -v1 + round], [v0, -v1 + c]],
          [[v0, v1 - round], [v0, v1 - c], [v0, v1 - round]],
          [[v0 - round, v1], [v0 - round, v1], [v0 - c, v1]],
          [[-v0 + round, v1], [-v0 + c, v1], [-v0 + round, v1]],
          [[-v0, v1 - round], [-v0, v1 - round], [-v0, v1 - c]],
          [[-v0, -v1 + round], [-v0, -v1 + c], [-v0, -v1 + round]],
          [[-v0 + round, -v1], [-v0 + round, -v1], [-v0 + c, -v1]],
          [[v0 - round, -v1], [v0 - c, -v1], [v0 - round, -v1]],
        ];
  return fromTriples(triples, true);
}

export function ellipsePath(w: number, h: number): BezierPath {
  const s0 = w / 2;
  const s1 = h / 2;
  const triples: [Point, Point, Point][] = [
    [[0, -s1], [s0 * KAPPA, -s1], [-s0 * KAPPA, -s1]],
    [[s0, 0], [s0, s1 * KAPPA], [s0, -s1 * KAPPA]],
    [[0, s1], [-s0 * KAPPA, s1], [s0 * KAPPA, s1]],
    [[-s0, 0], [-s0, -s1 * KAPPA], [-s0, s1 * KAPPA]],
  ];
  return fromTriples(triples, true);
}

export function polygonPath(points: number, radius: number): BezierPath {
  const n = Math.max(3, Math.floor(points));
  const v: Point[] = [];
  let ang = -Math.PI / 2;
  const step = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    v.push([radius * Math.cos(ang), radius * Math.sin(ang)]);
    ang += step;
  }
  return { closed: true, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) };
}

export function starPath(points: number, outer: number, inner: number): BezierPath {
  const n = Math.max(3, Math.floor(points)) * 2;
  const v: Point[] = [];
  let ang = -Math.PI / 2;
  const step = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const r = k % 2 === 0 ? outer : inner;
    v.push([r * Math.cos(ang), r * Math.sin(ang)]);
    ang += step;
  }
  return { closed: true, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) };
}

function fromTriples(triples: [Point, Point, Point][], closed: boolean): BezierPath {
  return {
    closed,
    v: triples.map((t) => t[0]),
    o: triples.map((t) => [t[1][0] - t[0][0], t[1][1] - t[0][1]]),
    i: triples.map((t) => [t[2][0] - t[0][0], t[2][1] - t[0][1]]),
  };
}

export function geometryPaths(g: Geometry, frame: number): BezierPath[] {
  switch (g.kind) {
    case 'rect': {
      const s = evalProp(g.size, frame);
      return [rectPath(s[0], s[1], evalProp(g.roundness, frame)[0])];
    }
    case 'ellipse': {
      const s = evalProp(g.size, frame);
      return [ellipsePath(s[0], s[1])];
    }
    case 'polygon':
      return [polygonPath(evalProp(g.points, frame)[0], evalProp(g.radius, frame)[0])];
    case 'star':
      return [starPath(evalProp(g.points, frame)[0], evalProp(g.outer, frame)[0], evalProp(g.inner, frame)[0])];
    case 'path':
      return g.paths;
  }
}

const fmt = (n: number) => +n.toFixed(3);

export function pathToD(p: BezierPath): string {
  if (p.v.length === 0) return '';
  const parts = [`M${fmt(p.v[0][0])} ${fmt(p.v[0][1])}`];
  const seg = (a: number, b: number) => {
    const c1: Point = [p.v[a][0] + p.o[a][0], p.v[a][1] + p.o[a][1]];
    const c2: Point = [p.v[b][0] + p.i[b][0], p.v[b][1] + p.i[b][1]];
    const isLine = p.o[a][0] === 0 && p.o[a][1] === 0 && p.i[b][0] === 0 && p.i[b][1] === 0;
    parts.push(
      isLine
        ? `L${fmt(p.v[b][0])} ${fmt(p.v[b][1])}`
        : `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p.v[b][0])} ${fmt(p.v[b][1])}`,
    );
  };
  for (let k = 0; k < p.v.length - 1; k++) seg(k, k + 1);
  if (p.closed && p.v.length > 1) {
    seg(p.v.length - 1, 0);
    parts.push('Z');
  }
  return parts.join('');
}

export function pathsToD(paths: BezierPath[]): string {
  return paths.map(pathToD).join('');
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Puntos muestreados de los trazos, ya transformados por `m`. */
export function samplePaths(paths: BezierPath[], m: Mat, steps = 8): Point[] {
  const out: Point[] = [];
  for (const p of paths) {
    const n = p.v.length;
    const segs = p.closed ? n : n - 1;
    if (n === 1) out.push(apply(m, p.v[0]));
    for (let k = 0; k < segs; k++) {
      const a = k;
      const b = (k + 1) % n;
      const p0 = p.v[a];
      const p3 = p.v[b];
      const p1: Point = [p0[0] + p.o[a][0], p0[1] + p.o[a][1]];
      const p2: Point = [p3[0] + p.i[b][0], p3[1] + p.i[b][1]];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        out.push(apply(m, [cubicAt(p0[0], p1[0], p2[0], p3[0], t), cubicAt(p0[1], p1[1], p2[1], p3[1], t)]));
      }
    }
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOf(points: Point[]): Box | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBoxes(boxes: (Box | null)[]): Box | null {
  const pts: Point[] = [];
  for (const b of boxes) {
    if (!b) continue;
    pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]);
  }
  return boundsOf(pts);
}

export function translatePath(p: BezierPath, dx: number, dy: number): BezierPath {
  return { ...p, v: p.v.map(([x, y]) => [x + dx, y + dy]) };
}
