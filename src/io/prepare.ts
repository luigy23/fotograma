import type { Doc, Keyframe, Node, Prop } from '../model/types';
import { evalProp } from '../model/animate';
import { effectLayers, type BakedHalo } from '../model/effects';
import { allProps } from '../model/tree';

// Todo lo técnico que hace el editor antes de exportar, para que la
// diseñadora no tenga que saberlo: limpiar, hornear el pixel art, traducir
// efectos a capas y recortar los silencios.

export interface ExportSettings {
  /** Quitar lo que no se mueve al principio y al final. */
  trim: boolean;
  /** Para sprite sheets: dejar los efectos como efectos (los dibuja la escena). */
  keepEffects?: boolean;
  /** Pixel art: el JSON sale ×k con las imágenes ampliadas sin suavizado. */
  outputScale: number;
}

export interface Prepared {
  doc: Doc;
  /** id de capa generada → id de la capa a la que va enlazada (parent). */
  parents: Map<string, string>;
  /** Imágenes a ampliar ×outputScale al exportar (lo hace el exportador asíncrono). */
  outputScale: number;
  range: { from: number; to: number; original: number };
  removed: { hidden: number; emptyGroups: number; keys: number };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function removeHidden(nodes: Node[], counts: Prepared['removed']): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.hidden) {
      counts.hidden++;
      continue;
    }
    if (n.type === 'group') {
      n.children = removeHidden(n.children, counts);
      if (n.children.length === 0) {
        counts.emptyGroups++;
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

function eachNode(nodes: Node[], fn: (n: Node) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.type === 'group') eachNode(n.children, fn);
  }
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/** Quita keyframes que no cambian nada; si todos valen lo mismo, la propiedad queda estática. */
export function cleanKeys(p: Prop): number {
  const before = p.keys.length;
  if (before === 0) return 0;
  if (p.keys.every((k) => same(k.value, p.keys[0].value))) {
    p.value = [...p.keys[0].value];
    p.keys = [];
    return before;
  }
  const kept: Keyframe[] = [];
  p.keys.forEach((k, i) => {
    const prev = p.keys[i - 1];
    const next = p.keys[i + 1];
    if (prev && next && same(prev.value, k.value) && same(k.value, next.value)) return;
    kept.push(k);
  });
  p.keys = kept;
  return before - kept.length;
}

/** Pixel art: la posición avanza a saltos de píxel entero en cada frame. */
function bakePixel(p: Prop) {
  if (p.keys.length === 0) {
    p.value = p.value.map(Math.round);
    return;
  }
  const first = p.keys[0].frame;
  const last = p.keys[p.keys.length - 1].frame;
  const keys: Keyframe[] = [];
  let prev: number[] | null = null;
  for (let f = first; f <= last; f++) {
    const v = evalProp(p, f).map(Math.round);
    if (prev && same(prev, v) && f !== last) continue;
    keys.push({ id: `px${f}`, frame: f, value: v, ease: { o: [0, 0], i: [1, 1] }, hold: true });
    prev = v;
  }
  p.keys = keys;
  p.value = keys[0].value;
}

function shiftTime(doc: Doc, delta: number) {
  eachNode(doc.nodes, (n) => {
    for (const p of allProps(n)) for (const k of p.keys) k.frame += delta;
    if (n.inFrame !== undefined) n.inFrame = Math.max(0, n.inFrame + delta) || undefined;
    if (n.outFrame !== undefined) n.outFrame += delta;
  });
  for (const s of doc.segments) {
    s.start += delta;
    s.end += delta;
  }
}

/** Primer y último frame en que pasa algo. */
export function contentRange(doc: Doc): { from: number; to: number } {
  let from = Infinity;
  let to = -Infinity;
  let any = false;
  eachNode(doc.nodes, (n) => {
    for (const p of allProps(n)) {
      if (!p.keys.length) continue;
      any = true;
      from = Math.min(from, p.keys[0].frame);
      to = Math.max(to, p.keys[p.keys.length - 1].frame);
    }
  });
  for (const n of doc.nodes) {
    if (n.inFrame !== undefined) {
      any = true;
      from = Math.min(from, n.inFrame);
      to = Math.max(to, n.inFrame);
    }
    if (n.outFrame !== undefined) {
      any = true;
      from = Math.min(from, n.outFrame - 1);
      to = Math.max(to, n.outFrame - 1);
    }
  }
  for (const s of doc.segments) {
    any = true;
    from = Math.min(from, s.start);
    to = Math.max(to, s.end - 1);
  }
  // Los efectos laten durante toda la animación: no se recorta.
  if (!any || doc.nodes.some((n) => n.effects?.some((e) => e.enabled))) return { from: 0, to: doc.duration - 1 };
  return { from: Math.max(0, from), to: Math.min(doc.duration - 1, to) };
}

export function prepareExport(source: Doc, settings: ExportSettings, halos: Map<string, BakedHalo>): Prepared {
  const doc = clone(source);
  const removed = { hidden: 0, emptyGroups: 0, keys: 0 };
  doc.nodes = removeHidden(doc.nodes, removed);

  // Efectos → capas normales enlazadas a su capa.
  const parents = new Map<string, string>();
  const layers: Node[] = [];
  for (const n of doc.nodes) {
    if (settings.keepEffects) {
      layers.push(n);
      continue;
    }
    const fx = n.effects?.some((e) => e.enabled) ? effectLayers(source, n, halos) : null;
    delete n.effects;
    if (!fx) {
      layers.push(n);
      continue;
    }
    for (const e of [...fx.front, ...fx.behind]) {
      parents.set(e.id, n.id);
      e.inFrame = n.inFrame;
      e.outFrame = n.outFrame;
      e.locked = false;
    }
    layers.push(...fx.front, n, ...fx.behind);
    // Copia: la exportación amplía las imágenes y la caché de halos no se debe tocar.
    for (const a of fx.assets) if (!doc.assets.some((x) => x.id === a.id)) doc.assets.push({ ...a });
  }
  doc.nodes = layers;

  eachNode(doc.nodes, (n) => {
    if (doc.pixel) {
      bakePixel(n.transform.position);
      bakePixel(n.transform.anchor);
    }
    for (const p of allProps(n)) removed.keys += cleanKeys(p);
  });

  const original = doc.duration;
  let range = { from: 0, to: doc.duration, original };
  if (settings.trim) {
    const r = contentRange(doc);
    const from = r.from;
    const to = Math.max(r.from + 1, r.to + 1);
    if (from > 0 || to < doc.duration) {
      if (from > 0) shiftTime(doc, -from);
      doc.duration = to - from;
      range = { from, to, original };
    }
  }
  return { doc, parents, outputScale: doc.pixel ? Math.max(1, Math.round(settings.outputScale)) : 1, range, removed };
}

/** Escala ×k recomendada para que el pixel art salga nítido en el móvil (~512 px). */
export function suggestedOutputScale(doc: Doc): number {
  if (!doc.pixel) return 1;
  const side = Math.max(doc.width, doc.height);
  const options = [1, 2, 4, 8, 16];
  return options.reduce((best, k) => (Math.abs(side * k - 512) < Math.abs(side * best - 512) ? k : best), 1);
}
