import type { BezierPath, Doc, Ease, Fill, Geometry, ImageAsset, Keyframe, Node, Point, Prop, ShapeNode, Stroke, Transform, Trim, Vec } from '../model/types';
import { DEFAULT_EASE, evalProp, prop } from '../model/animate';
import { makeDoc, makeFill, makeStroke, makeTrim, SHAPE_LABELS } from '../model/defaults';
import { geometryPaths } from '../model/geometry';
import { uid } from '../model/uid';

// Lee Lottie JSON: los que exporta Fotograma (ida y vuelta sin pérdidas) y los
// de After Effects/LottieFiles en lo que el editor sabe representar. Lo que no
// entiende lo avisa en `warnings` en vez de fallar.

type J = Record<string, any>;

export interface ImportResult {
  doc: Doc;
  warnings: string[];
}

const num = (x: unknown, d = 0) => (typeof x === 'number' && isFinite(x) ? x : d);

function first(x: unknown): number {
  if (Array.isArray(x)) return num(x[0]);
  return num(x);
}

function toVec(x: unknown, dims: number, fallback: Vec): Vec {
  if (typeof x === 'number') return [x];
  if (Array.isArray(x)) {
    const out = x.slice(0, dims).map((n) => num(n));
    while (out.length < dims) out.push(fallback[out.length] ?? 0);
    return out;
  }
  return [...fallback];
}

function readEase(k: J): Ease {
  if (!k.o || !k.i) return { ...DEFAULT_EASE, o: [...DEFAULT_EASE.o], i: [...DEFAULT_EASE.i] };
  return { o: [first(k.o.x), first(k.o.y)], i: [first(k.i.x), first(k.i.y)] };
}

class Ctx {
  warnings = new Set<string>();
  warn(msg: string) {
    this.warnings.add(msg);
  }
}

function readProp(p: J | undefined, dims: number, fallback: Vec, ctx: Ctx, what: string): Prop {
  if (!p || typeof p !== 'object') return prop(fallback);
  if (p.x && typeof p.x === 'string') ctx.warn(`Las expresiones de After Effects no se importan (${what}).`);
  const k = p.k;
  const animated = p.a === 1 || (Array.isArray(k) && k.length > 0 && typeof k[0] === 'object' && k[0] !== null && 't' in k[0]);
  if (!animated) return prop(toVec(k, dims, fallback));
  const keys: Keyframe[] = [];
  let prevEnd: unknown;
  for (const kf of k as J[]) {
    const s = kf.s ?? prevEnd;
    if (s === undefined) continue;
    keys.push({
      id: uid(),
      frame: Math.round(num(kf.t)),
      value: toVec(s, dims, fallback),
      ease: readEase(kf),
      hold: kf.h === 1 ? true : undefined,
    });
    prevEnd = kf.e;
  }
  // Formato antiguo: el último keyframe solo trae el tiempo y el valor viene en `e` del anterior.
  const lastRaw = (k as J[])[k.length - 1];
  if (lastRaw && lastRaw.s === undefined && prevEnd === undefined) {
    const prevRaw = (k as J[])[k.length - 2];
    if (prevRaw?.e !== undefined) {
      keys.push({ id: uid(), frame: Math.round(num(lastRaw.t)), value: toVec(prevRaw.e, dims, fallback), ease: { ...DEFAULT_EASE } });
    }
  }
  const dedup = new Map<number, Keyframe>();
  for (const key of keys) dedup.set(key.frame, key);
  const sorted = [...dedup.values()].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) return prop(fallback);
  if (sorted.length === 1) return prop(sorted[0].value);
  return { value: sorted[0].value, keys: sorted };
}

function readPosition(p: J | undefined, ctx: Ctx): Prop {
  if (p && p.s === true && (p.x || p.y)) {
    const px = readProp(p.x, 1, [0], ctx, 'posición X');
    const py = readProp(p.y, 1, [0], ctx, 'posición Y');
    if (px.keys.length === 0 && py.keys.length === 0) return prop([px.value[0], py.value[0]]);
    ctx.warn('La posición con X e Y separadas se combinó en una sola; revisa las curvas.');
    const frames = [...new Set([...px.keys, ...py.keys].map((k) => k.frame))].sort((a, b) => a - b);
    const keys = frames.map((f) => {
      const src = px.keys.find((k) => k.frame === f) ?? py.keys.find((k) => k.frame === f)!;
      return { id: uid(), frame: f, value: [evalProp(px, f)[0], evalProp(py, f)[0]], ease: src.ease, hold: src.hold };
    });
    return { value: keys[0].value, keys };
  }
  return readProp(p, 2, [0, 0], ctx, 'posición');
}

function readTransform(t: J | undefined, ctx: Ctx): Transform {
  const tr = t ?? {};
  if ((tr.sk && first(tr.sk.k) !== 0) || (tr.sk && tr.sk.a === 1)) ctx.warn('El sesgado (skew) no se importa.');
  if (tr.rx || tr.ry || tr.rz || tr.or) ctx.warn('Las rotaciones 3D no se importan.');
  return {
    anchor: readProp(tr.a, 2, [0, 0], ctx, 'ancla'),
    position: readPosition(tr.p, ctx),
    scale: readProp(tr.s, 2, [100, 100], ctx, 'escala'),
    rotation: readProp(tr.r ?? tr.rz, 1, [0], ctx, 'rotación'),
    opacity: readProp(tr.o, 1, [100], ctx, 'opacidad'),
  };
}

function shiftAnchor(t: Transform, dx: number, dy: number) {
  if (dx === 0 && dy === 0) return;
  const shift = (v: Vec) => [v[0] - dx, v[1] - dy];
  t.anchor.value = shift(t.anchor.value);
  for (const k of t.anchor.keys) k.value = shift(k.value);
}

function readBezier(k: J): BezierPath {
  const v = (k.v ?? []) as Point[];
  return {
    closed: !!k.c,
    v: v.map((p) => [num(p[0]), num(p[1])]),
    i: v.map((_, n) => [num(k.i?.[n]?.[0]), num(k.i?.[n]?.[1])]),
    o: v.map((_, n) => [num(k.o?.[n]?.[0]), num(k.o?.[n]?.[1])]),
  };
}

function gradientFirstColor(g: J | undefined): Vec {
  const raw = g?.k?.k;
  const arr = Array.isArray(raw) ? (typeof raw[0] === 'object' ? raw[0].s : raw) : null;
  if (Array.isArray(arr) && arr.length >= 4) return [num(arr[1]), num(arr[2]), num(arr[3])];
  return [0.5, 0.5, 0.5];
}

interface Styles {
  fill?: Fill;
  stroke?: Stroke;
  trim?: Trim;
}

interface RawGeom {
  geometry: Geometry;
  offset: Point;
  name: string;
}

function readGeometry(item: J, ctx: Ctx): RawGeom | null {
  const name = item.nm ?? '';
  switch (item.ty) {
    case 'rc': {
      const pos = readProp(item.p, 2, [0, 0], ctx, 'posición del rectángulo');
      if (pos.keys.length) ctx.warn('Rectángulos con la posición interna animada: se usó la posición inicial.');
      return {
        name,
        offset: [pos.value[0], pos.value[1]],
        geometry: { kind: 'rect', size: readProp(item.s, 2, [100, 100], ctx, 'tamaño'), roundness: readProp(item.r, 1, [0], ctx, 'redondeo') },
      };
    }
    case 'el': {
      const pos = readProp(item.p, 2, [0, 0], ctx, 'posición de la elipse');
      if (pos.keys.length) ctx.warn('Elipses con la posición interna animada: se usó la posición inicial.');
      return { name, offset: [pos.value[0], pos.value[1]], geometry: { kind: 'ellipse', size: readProp(item.s, 2, [100, 100], ctx, 'tamaño') } };
    }
    case 'sr': {
      const pos = readProp(item.p, 2, [0, 0], ctx, 'posición de la estrella');
      const rot = readProp(item.r, 1, [0], ctx, 'rotación de la estrella');
      const os = readProp(item.os, 1, [0], ctx, 'redondeo');
      const is = readProp(item.is, 1, [0], ctx, 'redondeo');
      const points = readProp(item.pt, 1, [5], ctx, 'puntas');
      const outer = readProp(item.or, 1, [50], ctx, 'radio');
      const star = item.sy !== 2;
      const geometry: Geometry = star
        ? { kind: 'star', points, outer, inner: readProp(item.ir, 1, [25], ctx, 'radio interior') }
        : { kind: 'polygon', points, radius: outer };
      if (rot.value[0] !== 0 || rot.keys.length || os.value[0] !== 0 || is.value[0] !== 0) {
        ctx.warn('Estrellas o polígonos con giro o redondeo propio se convirtieron en trazo fijo.');
        const paths = geometryPaths(geometry, 0).map((p) => rotatePath(p, rot.value[0]));
        return { name, offset: [pos.value[0], pos.value[1]], geometry: { kind: 'path', paths } };
      }
      return { name, offset: [pos.value[0], pos.value[1]], geometry };
    }
    case 'sh': {
      const ks = item.ks ?? {};
      let k = ks.k;
      if (ks.a === 1 || Array.isArray(k)) {
        ctx.warn('Los trazos que cambian de forma (morph) se importaron con su primera forma.');
        k = Array.isArray(k) ? (Array.isArray(k[0]?.s) ? k[0].s[0] : k[0]?.s) : k;
      }
      if (!k) return null;
      return { name, offset: [0, 0], geometry: { kind: 'path', paths: [readBezier(k)] } };
    }
  }
  return null;
}

function rotatePath(p: BezierPath, deg: number): BezierPath {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const rot = ([x, y]: Point): Point => [x * c - y * s, x * s + y * c];
  return { closed: p.closed, v: p.v.map(rot), i: p.i.map(rot), o: p.o.map(rot) };
}

function translatePathBy(p: BezierPath, dx: number, dy: number): BezierPath {
  return { ...p, v: p.v.map(([x, y]) => [x + dx, y + dy] as Point) };
}

/** Une varias geometrías del mismo nivel en un solo trazo fijo. */
function mergeGeoms(geoms: RawGeom[], ctx: Ctx): RawGeom {
  if (geoms.length === 1) return geoms[0];
  const paths: BezierPath[] = [];
  for (const g of geoms) {
    if (g.geometry.kind !== 'path') {
      const animated = Object.values(g.geometry).some((v) => typeof v === 'object' && v && 'keys' in v && (v as Prop).keys.length);
      if (animated) ctx.warn('Varias formas animadas en un mismo grupo se unieron en un trazo fijo.');
    }
    for (const p of geometryPaths(g.geometry, 0)) paths.push(translatePathBy(p, g.offset[0], g.offset[1]));
  }
  return { name: geoms[0].name, offset: [0, 0], geometry: { kind: 'path', paths } };
}

const UNSUPPORTED_SHAPES: Record<string, string> = {
  rd: 'Redondear esquinas',
  mm: 'Combinar trazos',
  rp: 'Repetidor',
  pb: 'Fruncir y engordar',
  op: 'Desplazar trazo',
  zz: 'Zigzag',
  tw: 'Torcer',
  gs: 'Borde degradado',
};

/**
 * Lee una lista de elementos de forma (de una capa o de un grupo) y devuelve
 * un nodo: forma si no hay subgrupos, grupo si los hay.
 */
function readItems(items: J[], transform: Transform, name: string, hidden: boolean, inherited: Styles, ctx: Ctx): Node | null {
  const geoms: RawGeom[] = [];
  const groups: J[] = [];
  const styles: Styles = {};
  let trTransform: J | undefined;

  for (const it of items ?? []) {
    if (!it || typeof it !== 'object') continue;
    switch (it.ty) {
      case 'gr':
        groups.push(it);
        break;
      case 'tr':
        trTransform = it;
        break;
      case 'fl':
        if (!styles.fill) {
          styles.fill = {
            enabled: !it.hd,
            color: readProp(it.c, 3, [0, 0, 0], ctx, 'color'),
            opacity: readProp(it.o, 1, [100], ctx, 'opacidad del relleno'),
            rule: it.r === 2 ? 2 : 1,
          };
        }
        break;
      case 'gf':
        if (!styles.fill) {
          ctx.warn('Los rellenos degradados se importaron con su primer color.');
          styles.fill = { ...makeFill(gradientFirstColor(it.g)), opacity: readProp(it.o, 1, [100], ctx, 'opacidad del relleno') };
        }
        break;
      case 'st':
        if (!styles.stroke) {
          styles.stroke = {
            enabled: !it.hd,
            color: readProp(it.c, 3, [0, 0, 0], ctx, 'color del borde'),
            opacity: readProp(it.o, 1, [100], ctx, 'opacidad del borde'),
            width: readProp(it.w, 1, [1], ctx, 'grosor'),
            cap: [1, 2, 3].includes(it.lc) ? it.lc : 2,
            join: [1, 2, 3].includes(it.lj) ? it.lj : 2,
          };
          if (Array.isArray(it.d) && it.d.length) ctx.warn('Los bordes discontinuos se importaron como continuos.');
        }
        break;
      case 'tm':
        styles.trim = {
          enabled: !it.hd,
          start: readProp(it.s, 1, [0], ctx, 'recorte'),
          end: readProp(it.e, 1, [100], ctx, 'recorte'),
          offset: readProp(it.o, 1, [0], ctx, 'recorte'),
        };
        break;
      case 'rc':
      case 'el':
      case 'sr':
      case 'sh': {
        if (it.hd) break;
        const g = readGeometry(it, ctx);
        if (g) geoms.push(g);
        break;
      }
      default:
        if (UNSUPPORTED_SHAPES[it.ty]) ctx.warn(`«${UNSUPPORTED_SHAPES[it.ty]}» todavía no está soportado; se ignoró.`);
    }
  }

  const effective: Styles = {
    fill: styles.fill ?? inherited.fill,
    stroke: styles.stroke ?? inherited.stroke,
    trim: styles.trim ?? inherited.trim,
  };
  const ownTransform = trTransform ? readTransform(trTransform, ctx) : transform;

  const makeShapeNode = (g: RawGeom, t: Transform, nm: string): ShapeNode => {
    const node: ShapeNode = {
      id: uid(),
      type: 'shape',
      name: nm || g.name || SHAPE_LABELS[g.geometry.kind],
      hidden,
      locked: false,
      transform: t,
      geometry: g.geometry,
      fill: clone(effective.fill) ?? makeFill([0, 0, 0], false),
      stroke: clone(effective.stroke) ?? makeStroke(undefined, 1, false),
      trim: clone(effective.trim) ?? makeTrim(),
    };
    shiftAnchor(node.transform, g.offset[0], g.offset[1]);
    return node;
  };

  const childNodes: Node[] = [];
  for (const g of groups) {
    const child = readItems(g.it ?? [], identityTransform(), g.nm ?? 'Grupo', !!g.hd, effective, ctx);
    if (child) childNodes.push(child);
  }

  if (groups.length === 0) {
    if (geoms.length === 0) return null;
    return makeShapeNode(mergeGeoms(geoms, ctx), ownTransform, name);
  }

  if (geoms.length > 0) childNodes.unshift(makeShapeNode(mergeGeoms(geoms, ctx), identityTransform(), name));
  if (childNodes.length === 0) return null;
  return { id: uid(), type: 'group', name: name || 'Grupo', hidden, locked: false, expanded: false, transform: ownTransform, children: childNodes };
}

function clone<T>(x: T | undefined): T | undefined {
  return x === undefined ? undefined : (JSON.parse(JSON.stringify(x)) as T);
}

function identityTransform(): Transform {
  return { anchor: prop([0, 0]), position: prop([0, 0]), scale: prop([100, 100]), rotation: prop([0]), opacity: prop([100]) };
}

function shiftNodeKeys(node: Node, delta: number) {
  const shiftProp = (p: Prop) => {
    for (const k of p.keys) k.frame += delta;
  };
  const visit = (n: Node) => {
    for (const p of Object.values(n.transform)) shiftProp(p);
    if (n.type === 'shape') {
      for (const holder of [n.geometry, n.fill, n.stroke, n.trim] as unknown as Record<string, unknown>[]) {
        for (const v of Object.values(holder)) if (v && typeof v === 'object' && 'keys' in (v as object)) shiftProp(v as Prop);
      }
    }
    if (n.type === 'group') n.children.forEach(visit);
  };
  visit(node);
}

function hexToRgb(hex: string): Vec {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function importLottie(input: unknown): ImportResult {
  const data = (typeof input === 'string' ? JSON.parse(input) : input) as J;
  if (!data || typeof data !== 'object' || !Array.isArray(data.layers)) {
    throw new Error('El archivo no parece un Lottie JSON (no tiene "layers").');
  }
  const ctx = new Ctx();
  const doc = makeDoc();
  doc.pixel = false;
  doc.name = typeof data.nm === 'string' && data.nm ? data.nm : 'Animación';
  doc.width = num(data.w, 512);
  doc.height = num(data.h, 512);
  doc.fps = num(data.fr, 60);
  const ip = num(data.ip, 0);
  doc.duration = Math.max(1, Math.round(num(data.op, 120) - ip));
  if (ip !== 0) ctx.warn('La animación no empezaba en el frame 0; se conservaron los tiempos originales.');

  for (const m of (data.markers ?? []) as J[]) {
    if (typeof m?.tm !== 'number') continue;
    const start = Math.round(m.tm - ip);
    doc.segments.push({ id: uid(), name: String(m.cm ?? 'segmento'), start, end: start + Math.max(1, Math.round(num(m.dr, 1))) });
  }

  const assets = new Map<string, J>();
  for (const a of (data.assets ?? []) as J[]) if (a && a.id) assets.set(a.id, a);

  const precomps: string[] = [];
  const texts: string[] = [];
  const parents = new Set<number>();
  for (const l of data.layers as J[]) if (typeof l.parent === 'number') parents.add(l.parent);
  if (parents.size) ctx.warn('Las capas emparentadas (parent) se importaron sin su padre; revisa posiciones.');

  for (const layer of data.layers as J[]) {
    if (!layer || typeof layer !== 'object') continue;
    const name: string = layer.nm ?? 'Capa';
    if (layer.masksProperties?.length) ctx.warn('Las máscaras no se importan todavía.');
    if (layer.tt) ctx.warn('Los mates (track matte) no se importan todavía.');
    if (layer.ef?.length) ctx.warn('Los efectos de capa no se importan.');
    if (layer.tm) ctx.warn('El remapeo de tiempo no se importa.');
    if (num(layer.sr, 1) !== 1) ctx.warn('El estiramiento de tiempo de capa no se importa.');

    const transform = readTransform(layer.ks, ctx);
    const hidden = !!layer.hd;
    let node: Node | null = null;

    switch (layer.ty) {
      case 4:
        node = readItems(layer.shapes ?? [], transform, name, hidden, {}, ctx);
        break;
      case 1: {
        const w = num(layer.sw, 100);
        const h = num(layer.sh, 100);
        const shape: ShapeNode = {
          id: uid(),
          type: 'shape',
          name,
          hidden,
          locked: false,
          transform,
          geometry: { kind: 'rect', size: prop([w, h]), roundness: prop([0]) },
          fill: makeFill(hexToRgb(layer.sc ?? '#000000')),
          stroke: makeStroke(undefined, 1, false),
          trim: makeTrim(),
        };
        shiftAnchor(shape.transform, w / 2, h / 2);
        node = shape;
        break;
      }
      case 2: {
        const a = assets.get(layer.refId);
        if (!a || typeof a.p !== 'string' || !(a.e === 1 || a.p.startsWith('data:'))) {
          ctx.warn(`La imagen «${name}» apunta a un archivo externo; no se pudo importar.`);
          break;
        }
        if (!doc.assets.some((x) => x.id === a.id)) {
          const asset: ImageAsset = { id: String(a.id), name: a.nm ?? name, w: num(a.w, 100), h: num(a.h, 100), data: a.p };
          doc.assets.push(asset);
        }
        node = { id: uid(), type: 'image', name, hidden, locked: false, assetId: String(a.id), transform };
        break;
      }
      case 3:
        if (!parents.has(layer.ind)) ctx.warn('Las capas nulas se ignoraron.');
        break;
      case 0:
        precomps.push(name);
        break;
      case 5:
        texts.push(name);
        break;
      default:
        ctx.warn(`Capa «${name}» de un tipo no soportado; se ignoró.`);
    }
    if (node) {
      // Tiempo de la capa: aparece en ip, desaparece en op; `st` desplaza sus keyframes.
      const st = num(layer.st, 0);
      if (st) shiftNodeKeys(node, Math.round(st));
      const lip = Math.round(num(layer.ip, ip));
      const lop = Math.round(num(layer.op, data.op));
      if (lip > ip) node.inFrame = lip;
      if (lop < num(data.op)) node.outFrame = lop;
      doc.nodes.push(node);
    }
  }

  if (precomps.length) {
    const sample = [...new Set(precomps.filter(Boolean))].slice(0, 3).join(', ');
    ctx.warn(
      `${precomps.length === 1 ? 'Una precomposición' : `${precomps.length} precomposiciones`}${sample ? ` (${sample}${precomps.length > 3 ? '…' : ''})` : ''} de After Effects no se abren todavía.`,
    );
  }
  if (texts.length) ctx.warn(`${texts.length === 1 ? 'Un texto' : `${texts.length} textos`} no se importaron: conviértelos a contornos antes de exportar.`);

  return { doc, warnings: [...ctx.warnings] };
}
