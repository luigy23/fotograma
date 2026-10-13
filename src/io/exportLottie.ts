import type { Doc, Ease, Geometry, GroupNode, Keyframe, Node, Prop, ShapeNode, Transform, Vec } from '../model/types';

// Exporta el documento a Lottie JSON (formato Bodymovin 5.x, que es lo que
// leen lottie-web, lottie-android/iOS y el paquete `lottie` de Flutter).
// Solo usa piezas que esos reproductores soportan bien: capas de forma e
// imagen, grupos, rectángulo, elipse, polígono/estrella, trazos, relleno,
// borde y recorte de trazo.

type Json = Record<string, unknown>;

export const GENERATOR = 'Fotograma';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function easeOut(e: Ease) {
  return { x: r3(clamp01(e.o[0])), y: r3(e.o[1]) };
}
function easeIn(e: Ease) {
  return { x: r3(clamp01(e.i[0])), y: r3(e.i[1]) };
}

function keyframes(keys: Keyframe[], map: (v: Vec) => Vec): Json[] {
  return keys.map((k, idx) => {
    const out: Json = { t: k.frame, s: map(k.value) };
    if (idx < keys.length - 1) {
      if (k.hold) out.h = 1;
      else {
        out.o = easeOut(k.ease);
        out.i = easeIn(k.ease);
      }
    }
    return out;
  });
}

const vec = (v: Vec) => v.map(r3);
const color = (v: Vec) => [r4(v[0]), r4(v[1]), r4(v[2]), 1];

function scalarProp(p: Prop): Json {
  if (p.keys.length === 0) return { a: 0, k: r3(p.value[0]) };
  return { a: 1, k: keyframes(p.keys, (v) => [r3(v[0])]) };
}

function vectorProp(p: Prop, map: (v: Vec) => Vec = vec): Json {
  if (p.keys.length === 0) return { a: 0, k: map(p.value) };
  return { a: 1, k: keyframes(p.keys, map) };
}

function transformProps(t: Transform): Json {
  return {
    a: vectorProp(t.anchor),
    p: vectorProp(t.position),
    s: vectorProp(t.scale),
    r: scalarProp(t.rotation),
    o: scalarProp(t.opacity),
  };
}

function geometryItems(g: Geometry, name: string): Json[] {
  switch (g.kind) {
    case 'rect':
      return [{ ty: 'rc', nm: name, d: 1, p: { a: 0, k: [0, 0] }, s: vectorProp(g.size), r: scalarProp(g.roundness) }];
    case 'ellipse':
      return [{ ty: 'el', nm: name, d: 1, p: { a: 0, k: [0, 0] }, s: vectorProp(g.size) }];
    case 'polygon':
      return [
        {
          ty: 'sr',
          nm: name,
          sy: 2,
          d: 1,
          p: { a: 0, k: [0, 0] },
          pt: scalarProp(g.points),
          or: scalarProp(g.radius),
          os: { a: 0, k: 0 },
          r: { a: 0, k: 0 },
        },
      ];
    case 'star':
      return [
        {
          ty: 'sr',
          nm: name,
          sy: 1,
          d: 1,
          p: { a: 0, k: [0, 0] },
          pt: scalarProp(g.points),
          or: scalarProp(g.outer),
          os: { a: 0, k: 0 },
          ir: scalarProp(g.inner),
          is: { a: 0, k: 0 },
          r: { a: 0, k: 0 },
        },
      ];
    case 'path':
      return g.paths.map((p, idx) => ({
        ty: 'sh',
        nm: g.paths.length > 1 ? `${name} ${idx + 1}` : name,
        d: 1,
        ks: {
          a: 0,
          k: {
            c: p.closed,
            v: p.v.map((pt) => vec(pt)),
            i: p.i.map((pt) => vec(pt)),
            o: p.o.map((pt) => vec(pt)),
          },
        },
      }));
  }
}

function shapeItems(node: ShapeNode): Json[] {
  const items = geometryItems(node.geometry, node.name);
  if (node.trim.enabled) {
    items.push({ ty: 'tm', nm: 'Recorte', s: scalarProp(node.trim.start), e: scalarProp(node.trim.end), o: scalarProp(node.trim.offset), m: 1 });
  }
  // En Lottie lo que va antes en la lista se pinta encima: borde sobre relleno.
  if (node.stroke.enabled) {
    items.push({
      ty: 'st',
      nm: 'Borde',
      c: vectorProp(node.stroke.color, color),
      o: scalarProp(node.stroke.opacity),
      w: scalarProp(node.stroke.width),
      lc: node.stroke.cap,
      lj: node.stroke.join,
      ml: 4,
      bm: 0,
    });
  }
  if (node.fill.enabled && node.fill.gradient) {
    const g = node.fill.gradient;
    // Paradas de color y después las de opacidad, como las guarda Lottie.
    const colors = g.stops.flatMap((st) => [r3(st[0]), r4(st[1]), r4(st[2]), r4(st[3])]);
    const alphas = g.stops.flatMap((st) => [r3(st[0]), r3(st[4] ?? 1)]);
    items.push({
      ty: 'gf',
      nm: 'Degradado',
      o: scalarProp(node.fill.opacity),
      r: node.fill.rule,
      bm: 0,
      t: 2,
      s: { a: 0, k: vec(g.center) },
      e: { a: 0, k: vec([g.center[0] + g.radius, g.center[1]]) },
      h: { a: 0, k: 0 },
      a: { a: 0, k: 0 },
      g: { p: g.stops.length, k: { a: 0, k: [...colors, ...alphas] } },
    });
  } else if (node.fill.enabled) {
    items.push({ ty: 'fl', nm: 'Relleno', c: vectorProp(node.fill.color, color), o: scalarProp(node.fill.opacity), r: node.fill.rule, bm: 0 });
  }
  return items;
}

function groupItem(node: Node, warnings: string[]): Json | null {
  if (node.type === 'image') {
    warnings.push(`La imagen «${node.name}» está dentro de un grupo y Lottie no lo permite; no se exportó.`);
    return null;
  }
  const it: Json[] =
    node.type === 'shape' ? shapeItems(node) : node.children.map((c) => groupItem(c, warnings)).filter((x): x is Json => !!x);
  it.push({ ty: 'tr', nm: 'Transformación', ...transformProps(node.transform) });
  const out: Json = { ty: 'gr', nm: node.name, np: it.length - 1, it };
  if (node.hidden) out.hd = true;
  return out;
}

function layerBase(node: Node, ind: number, doc: Doc): Json {
  const out: Json = {
    ddd: 0,
    ind,
    nm: node.name,
    sr: 1,
    ks: transformProps(node.transform),
    ao: 0,
    ip: node.inFrame ?? 0,
    op: node.outFrame ?? doc.duration,
    st: 0,
    bm: 0,
  };
  if (node.hidden) out.hd = true;
  return out;
}

export interface ExportResult {
  json: Json;
  warnings: string[];
}

export interface ExportExtras {
  /** id de capa → id de la capa padre (parent de Lottie). */
  parents?: Map<string, string>;
  /** Si es > 1, todas las capas cuelgan de una capa nula escalada ×k. */
  rootScale?: number;
}

export function exportLottie(doc: Doc, extras: ExportExtras = {}): ExportResult {
  const warnings: string[] = [];
  const layers: Json[] = [];
  const usedAssets = new Set<string>();
  const indOf = new Map(doc.nodes.map((n, i) => [n.id, i + 1]));

  doc.nodes.forEach((node, idx) => {
    const base = layerBase(node, idx + 1, doc);
    const parentId = extras.parents?.get(node.id);
    if (parentId && indOf.has(parentId)) base.parent = indOf.get(parentId);
    if (node.type === 'image') {
      const asset = doc.assets.find((a) => a.id === node.assetId);
      if (!asset) {
        warnings.push(`A la imagen «${node.name}» le falta el archivo; no se exportó.`);
        return;
      }
      usedAssets.add(asset.id);
      layers.push({ ...base, ty: 2, refId: asset.id });
      return;
    }
    const shapes =
      node.type === 'shape'
        ? shapeItems(node)
        : (node as GroupNode).children.map((c) => groupItem(c, warnings)).filter((x): x is Json => !!x);
    layers.push({ ...base, ty: 4, shapes });
  });

  const k = extras.rootScale ?? 1;
  if (k > 1) {
    const ind = doc.nodes.length + 1;
    for (const l of layers) if (l.parent === undefined) l.parent = ind;
    layers.push({
      ddd: 0,
      ind,
      ty: 3,
      nm: 'Escala pixel',
      sr: 1,
      ks: { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [k * 100, k * 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
      ao: 0,
      ip: 0,
      op: doc.duration,
      st: 0,
      bm: 0,
    });
  }

  const assets = doc.assets
    .filter((a) => usedAssets.has(a.id))
    .map((a) => ({ id: a.id, nm: a.name, w: a.w, h: a.h, u: '', p: a.data, e: 1 }));

  const json: Json = {
    v: '5.12.0',
    fr: doc.fps,
    ip: 0,
    op: doc.duration,
    w: Math.round(doc.width * k),
    h: Math.round(doc.height * k),
    nm: doc.name,
    ddd: 0,
    assets,
    layers,
    markers: (doc.segments ?? []).map((sg) => ({ tm: sg.start, cm: sg.name, dr: Math.max(0, sg.end - sg.start) })),
    meta: { g: GENERATOR },
  };
  return { json, warnings };
}

export function exportLottieString(doc: Doc, pretty = false): string {
  return JSON.stringify(exportLottie(doc).json, null, pretty ? 2 : undefined);
}
