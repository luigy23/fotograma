import svgpath from 'svgpath';
import type { BezierPath, Node, Point, ShapeNode } from '../model/types';
import { prop } from '../model/animate';
import { makeFill, makeGroup, makeStroke, makeTrim, makeTransform } from '../model/defaults';
import { boundsOf, samplePaths, type Box } from '../model/geometry';
import { IDENTITY, multiply, scaleFactor, type Mat } from '../model/matrix';
import { uid } from '../model/uid';

// Importa un SVG (lo normal: exportado desde Figma o Illustrator). Hornea las
// transformaciones en los puntos, así que cada elemento queda como un trazo
// con su pivote en el centro, listo para animar.

export interface SvgImport {
  node: Node | null;
  width: number;
  height: number;
  warnings: string[];
}

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  fillRule: 'nonzero' | 'evenodd';
  lineCap: string;
  lineJoin: string;
  display: boolean;
}

const DEFAULT_STYLE: Style = {
  fill: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fillRule: 'nonzero',
  lineCap: 'butt',
  lineJoin: 'miter',
  display: true,
};

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  pink: '#ffc0cb',
  transparent: 'none',
};

export function parseColor(c: string): { rgb: number[]; alpha: number } | null {
  const s = c.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  const named = NAMED[s];
  if (named) return named === 'none' ? null : parseColor(named);
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], alpha };
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const alpha = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { rgb: [ch(parts[0]) / 255, ch(parts[1]) / 255, ch(parts[2]) / 255], alpha };
  }
  return null;
}

function parseTransform(attr: string | null): Mat {
  if (!attr) return [...IDENTITY];
  let m: Mat = [...IDENTITY];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = [...IDENTITY];
    switch (match[1]) {
      case 'matrix':
        t = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case 'translate':
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale':
        t = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
        break;
      case 'rotate': {
        const r = ((args[0] ?? 0) * Math.PI) / 180;
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        const c = Math.cos(r);
        const s = Math.sin(r);
        t = multiply(multiply([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Reglas sencillas de <style> (.clase, #id, etiqueta), como las que exporta Illustrator. */
function parseStyleSheets(root: Element): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  for (const el of Array.from(root.getElementsByTagName('style'))) {
    const css = (el.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const decls = parseDecls(m[2]);
      for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        rules.set(sel, { ...(rules.get(sel) ?? {}), ...decls });
      }
    }
  }
  return rules;
}

function parseDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of s.split(';')) {
    const idx = d.indexOf(':');
    if (idx < 0) continue;
    out[d.slice(0, idx).trim().toLowerCase()] = d.slice(idx + 1).trim();
  }
  return out;
}

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility'];

function readStyle(el: Element, parent: Style, sheets: Map<string, Record<string, string>>): Style {
  const decl: Record<string, string> = {};
  const fromSheet = (sel: string) => Object.assign(decl, sheets.get(sel) ?? {});
  fromSheet(el.tagName.toLowerCase());
  for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) fromSheet('.' + cls);
  if (el.id) fromSheet('#' + el.id);
  for (const p of STYLE_PROPS) {
    const v = el.getAttribute(p);
    if (v !== null) decl[p] = v;
  }
  Object.assign(decl, parseDecls(el.getAttribute('style') ?? ''));

  const s: Style = { ...parent, opacity: 1 };
  if (decl['fill'] !== undefined && decl['fill'] !== 'inherit') s.fill = decl['fill'];
  if (decl['stroke'] !== undefined && decl['stroke'] !== 'inherit') s.stroke = decl['stroke'];
  if (decl['stroke-width'] !== undefined) s.strokeWidth = parseFloat(decl['stroke-width']) || 0;
  if (decl['fill-opacity'] !== undefined) s.fillOpacity = parseFloat(decl['fill-opacity']);
  if (decl['stroke-opacity'] !== undefined) s.strokeOpacity = parseFloat(decl['stroke-opacity']);
  if (decl['opacity'] !== undefined) s.opacity = parseFloat(decl['opacity']);
  if (decl['fill-rule'] !== undefined) s.fillRule = decl['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero';
  if (decl['stroke-linecap'] !== undefined) s.lineCap = decl['stroke-linecap'];
  if (decl['stroke-linejoin'] !== undefined) s.lineJoin = decl['stroke-linejoin'];
  if (decl['display'] === 'none' || decl['visibility'] === 'hidden') s.display = false;
  return s;
}

const n = (el: Element, a: string, d = 0) => {
  const v = parseFloat(el.getAttribute(a) ?? '');
  return isFinite(v) ? v : d;
};

/** Convierte cualquier elemento básico de SVG en un atributo `d`. */
function elementToD(el: Element): string | null {
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const x = n(el, 'x');
      const y = n(el, 'y');
      const w = n(el, 'width');
      const h = n(el, 'height');
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? n(el, 'rx') : n(el, 'ry');
      let ry = el.hasAttribute('ry') ? n(el, 'ry') : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = n(el, 'cx');
      const cy = n(el, 'cy');
      const rx = el.tagName.toLowerCase() === 'circle' ? n(el, 'r') : n(el, 'rx');
      const ry = el.tagName.toLowerCase() === 'circle' ? n(el, 'r') : n(el, 'ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line':
      return `M${n(el, 'x1')} ${n(el, 'y1')}L${n(el, 'x2')} ${n(el, 'y2')}`;
    case 'polyline':
    case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let k = 2; k + 1 < pts.length; k += 2) d += `L${pts[k]} ${pts[k + 1]}`;
      return el.tagName.toLowerCase() === 'polygon' ? d + 'Z' : d;
    }
  }
  return null;
}

const EPS = 1e-3;
const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** De un `d` (ya en coordenadas absolutas del lienzo) a trazos bezier de Lottie. */
export function dToPaths(d: string, m: Mat): BezierPath[] {
  const paths: BezierPath[] = [];
  let cur: BezierPath | null = null;
  let pos: Point = [0, 0];
  let start: Point = [0, 0];

  const finish = (closed: boolean) => {
    if (!cur) return;
    if (closed) {
      cur.closed = true;
      const last = cur.v.length - 1;
      if (last > 0 && same(cur.v[last], cur.v[0])) {
        cur.i[0] = cur.i[last];
        cur.v.pop();
        cur.i.pop();
        cur.o.pop();
      }
    }
    if (cur.v.length > 1 || (cur.v.length === 1 && closed)) paths.push(cur);
    cur = null;
  };
  const lineTo = (p: Point) => {
    if (!cur) {
      cur = { closed: false, v: [pos], i: [[0, 0]], o: [[0, 0]] };
    }
    cur.v.push(p);
    cur.i.push([0, 0]);
    cur.o.push([0, 0]);
    pos = p;
  };
  const curveTo = (c1: Point, c2: Point, p: Point) => {
    if (!cur) cur = { closed: false, v: [pos], i: [[0, 0]], o: [[0, 0]] };
    const li = cur.v.length - 1;
    cur.o[li] = [c1[0] - pos[0], c1[1] - pos[1]];
    cur.v.push(p);
    cur.i.push([c2[0] - p[0], c2[1] - p[1]]);
    cur.o.push([0, 0]);
    pos = p;
  };

  svgpath(d)
    .abs()
    .unarc()
    .unshort()
    .matrix([...m])
    .abs()
    .iterate((seg) => {
      const s = seg as (string | number)[];
      const c = s[0] as string;
      const v = s.slice(1) as number[];
      switch (c) {
        case 'M':
          finish(false);
          pos = [v[0], v[1]];
          start = pos;
          cur = { closed: false, v: [pos], i: [[0, 0]], o: [[0, 0]] };
          break;
        case 'L':
          lineTo([v[0], v[1]]);
          break;
        case 'H':
          lineTo([v[0], pos[1]]);
          break;
        case 'V':
          lineTo([pos[0], v[0]]);
          break;
        case 'C':
          curveTo([v[0], v[1]], [v[2], v[3]], [v[4], v[5]]);
          break;
        case 'Q': {
          const q: Point = [v[0], v[1]];
          const p: Point = [v[2], v[3]];
          const c1: Point = [pos[0] + ((q[0] - pos[0]) * 2) / 3, pos[1] + ((q[1] - pos[1]) * 2) / 3];
          const c2: Point = [p[0] + ((q[0] - p[0]) * 2) / 3, p[1] + ((q[1] - p[1]) * 2) / 3];
          curveTo(c1, c2, p);
          break;
        }
        case 'Z':
        case 'z':
          finish(true);
          pos = start;
          break;
      }
    });
  finish(false);
  return paths;
}

function hexOf(rgb: number[]): string {
  return rgb
    .slice(0, 3)
    .map((c) => Math.round(c * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Simplifica un trazo sin cambiar su forma: quita puntos repetidos y puntos
 * intermedios de líneas rectas (el pixel art de Figma trae muchos).
 */
export function simplifyPath(p: BezierPath): BezierPath {
  const n = p.v.length;
  if (n < 3) return p;
  const isZero = (q: Point) => Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const prevI = keep.length ? keep[keep.length - 1] : p.closed ? n - 1 : -1;
    // Punto repetido unido por una recta: sobra.
    if (prevI >= 0 && same(p.v[i], p.v[prevI]) && isZero(p.o[prevI]) && isZero(p.i[i])) {
      p.o[prevI] = p.o[i];
      continue;
    }
    keep.push(i);
  }
  const out = keep.map((i) => ({ v: p.v[i], i: p.i[i], o: p.o[i] }));
  // Puntos en medio de una recta (sin curvas a ningún lado).
  let changed = true;
  while (changed && out.length > (p.closed ? 3 : 2)) {
    changed = false;
    for (let k = 0; k < out.length; k++) {
      if (!p.closed && (k === 0 || k === out.length - 1)) continue;
      const a = out[(k - 1 + out.length) % out.length];
      const b = out[k];
      const c = out[(k + 1) % out.length];
      if (!isZero(a.o) || !isZero(b.i) || !isZero(b.o) || !isZero(c.i)) continue;
      const cross = (b.v[0] - a.v[0]) * (c.v[1] - a.v[1]) - (b.v[1] - a.v[1]) * (c.v[0] - a.v[0]);
      const dot = (b.v[0] - a.v[0]) * (c.v[0] - b.v[0]) + (b.v[1] - a.v[1]) * (c.v[1] - b.v[1]);
      if (Math.abs(cross) < 1e-3 && dot >= 0) {
        out.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  return { closed: p.closed, v: out.map((x) => x.v), i: out.map((x) => x.i), o: out.map((x) => x.o) };
}

const CAP: Record<string, 1 | 2 | 3> = { butt: 1, round: 2, square: 3 };
const JOIN: Record<string, 1 | 2 | 3> = { miter: 1, round: 2, bevel: 3 };

function centerPaths(paths: BezierPath[]): { paths: BezierPath[]; box: Box | null } {
  const box = boundsOf(samplePaths(paths, [...IDENTITY]));
  if (!box) return { paths, box };
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { paths: paths.map((p) => ({ ...p, v: p.v.map(([x, y]) => [x - cx, y - cy] as Point) })), box };
}

function nameFor(el: Element, fallback: string): string {
  return el.getAttribute('id') || el.getAttribute('data-name') || el.getAttribute('inkscape:label') || fallback;
}

const TAG_NAMES: Record<string, string> = {
  path: 'Trazo',
  rect: 'Rectángulo',
  circle: 'Círculo',
  ellipse: 'Elipse',
  line: 'Línea',
  polyline: 'Polilínea',
  polygon: 'Polígono',
};

export function importSvg(text: string, fileName = 'SVG'): SvgImport {
  const warnings = new Set<string>();
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = dom.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg' || dom.getElementsByTagName('parsererror').length) {
    throw new Error('El archivo no es un SVG válido.');
  }

  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every((x) => isFinite(x)) && vb[2] > 0 && vb[3] > 0;
  let width = parseFloat(svg.getAttribute('width') ?? '');
  let height = parseFloat(svg.getAttribute('height') ?? '');
  if (!isFinite(width) || (svg.getAttribute('width') ?? '').endsWith('%')) width = hasVb ? vb[2] : 512;
  if (!isFinite(height) || (svg.getAttribute('height') ?? '').endsWith('%')) height = hasVb ? vb[3] : 512;
  let root: Mat = [...IDENTITY];
  if (hasVb) root = multiply([width / vb[2], 0, 0, height / vb[3], 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);

  const sheets = parseStyleSheets(svg);
  const gradients = new Map<string, string>();
  for (const g of Array.from(svg.querySelectorAll('linearGradient, radialGradient'))) {
    const stop = g.querySelector('stop');
    const color = stop ? stop.getAttribute('stop-color') ?? parseDecls(stop.getAttribute('style') ?? '')['stop-color'] : null;
    if (g.id && color) gradients.set(g.id, color);
  }
  const resolvePaint = (paint: string): string => {
    const m = paint.match(/url\(\s*['"]?#([^'")]+)['"]?\s*\)/);
    if (!m) return paint === 'currentColor' ? '#000000' : paint;
    warnings.add('Los degradados se importaron con su primer color (Lottie los soporta, el editor todavía no).');
    return gradients.get(m[1]) ?? '#888888';
  };

  const visit = (el: Element, m: Mat, parentStyle: Style): Node[] => {
    const tag = el.tagName.toLowerCase().replace(/^svg:/, '');
    if (['defs', 'style', 'title', 'desc', 'metadata', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'pattern', 'symbol', 'filter'].includes(tag)) {
      return [];
    }
    const style = readStyle(el, parentStyle, sheets);
    if (!style.display) return [];
    const local = multiply(m, parseTransform(el.getAttribute('transform')));
    if (el.getAttribute('mask')) warnings.add('Las máscaras del SVG se ignoraron.');
    if (el.getAttribute('filter')) warnings.add('Los filtros (sombras, desenfoques) del SVG se ignoraron.');

    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      const kids: Node[] = [];
      // En SVG lo último se pinta encima; en el panel de capas, lo de arriba va primero.
      for (const child of Array.from(el.children).reverse()) kids.push(...visit(child, local, style));
      if (kids.length === 0) return [];
      if (style.opacity < 1) {
        if (kids.length === 1) kids[0].transform.opacity.value = [kids[0].transform.opacity.value[0] * style.opacity];
        else return [groupAround(kids, nameFor(el, 'Grupo'), style.opacity)];
      }
      if (kids.length === 1 || tag === 'svg') return kids;
      return [groupAround(kids, nameFor(el, 'Grupo'), 1)];
    }
    if (tag === 'text') {
      warnings.add('Los textos no se importan: conviértelos a contornos en Figma antes de exportar el SVG.');
      return [];
    }
    if (tag === 'image') {
      warnings.add('Las imágenes dentro del SVG no se importan; súbelas aparte como imagen.');
      return [];
    }
    if (tag === 'use') {
      warnings.add('Los elementos <use> no se importan; en Figma desagrupa los componentes antes de exportar.');
      return [];
    }
    const d = elementToD(el);
    if (!d) return [];
    const raw = dToPaths(d, local).map(simplifyPath);
    if (raw.length === 0) return [];
    const { paths, box } = centerPaths(raw);
    if (!box) return [];

    const fill = parseColor(resolvePaint(style.fill));
    const stroke = parseColor(resolvePaint(style.stroke));
    const sw = style.strokeWidth * scaleFactor(local);
    const center: Point = [box.x + box.w / 2, box.y + box.h / 2];
    const node: ShapeNode = {
      id: uid(),
      type: 'shape',
      // Sin id en el SVG, el color ayuda a reconocer cada pieza en el panel de capas.
      name: nameFor(el, `${TAG_NAMES[tag] ?? 'Trazo'} ${hexOf(fill?.rgb ?? stroke?.rgb ?? [0, 0, 0])}`),
      hidden: false,
      locked: false,
      transform: makeTransform(center),
      geometry: { kind: 'path', paths },
      fill: fill
        ? { ...makeFill(fill.rgb), opacity: prop([Math.round(fill.alpha * style.fillOpacity * 1000) / 10]), rule: style.fillRule === 'evenodd' ? 2 : 1 }
        : makeFill([0, 0, 0], false),
      stroke:
        stroke && sw > 0
          ? {
              ...makeStroke(stroke.rgb, sw, true),
              opacity: prop([Math.round(stroke.alpha * style.strokeOpacity * 1000) / 10]),
              cap: CAP[style.lineCap] ?? 1,
              join: JOIN[style.lineJoin] ?? 1,
            }
          : makeStroke(undefined, 1, false),
      trim: makeTrim(),
    };
    node.transform.opacity.value = [Math.round(style.opacity * 1000) / 10];
    if (!fill && !(stroke && sw > 0)) return [];
    return [node];
  };

  const nodes = visit(svg, root, DEFAULT_STYLE);
  if (svg.querySelector('clipPath')) warnings.add('Los recortes (clip-path) del SVG se ignoraron.');
  let node: Node | null = null;
  const base = fileName.replace(/\.svg$/i, '');
  if (nodes.length === 1) {
    node = nodes[0];
    if (node.type === 'group' && node.name === 'Grupo') node.name = base;
  } else if (nodes.length > 1) node = groupAround(nodes, base, 1);
  return { node, width, height, warnings: [...warnings] };
}

/** Grupo con pivote en el centro de sus hijos (matriz identidad). */
function groupAround(children: Node[], name: string, opacity: number): Node {
  const pts: Point[] = [];
  for (const c of children) {
    const p = c.transform.position.value;
    pts.push([p[0], p[1]]);
    if (c.type === 'shape' && c.geometry.kind === 'path') {
      const b = boundsOf(samplePaths(c.geometry.paths, [1, 0, 0, 1, p[0], p[1]]));
      if (b) pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]);
    }
  }
  const box = boundsOf(pts);
  const center: Point = box ? [box.x + box.w / 2, box.y + box.h / 2] : [0, 0];
  const g = makeGroup(children, name, center);
  g.transform.opacity.value = [Math.round(opacity * 1000) / 10];
  return g;
}
