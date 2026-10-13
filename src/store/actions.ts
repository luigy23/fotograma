import type { Draft } from 'immer';
import type { BezierPath, Doc, Ease, Effect, EffectKind, GroupNode, ImageAsset, Node, Point, PropPath, Segment, ShapeNode, Transform, Vec } from '../model/types';
import { makeEffect } from '../model/effects';
import { clearAnimation, removeKeys, setPropValue, shiftKeys, toggleKey } from '../model/animate';
import { makeGroup, makeImage } from '../model/defaults';
import { allProps, getProp, locate, nodeBounds, propPaths, walk } from '../model/tree';
import { boundsOf, samplePaths, unionBoxes } from '../model/geometry';
import { apply, nodeMatrix } from '../model/matrix';
import { uid } from '../model/uid';
import { importSvg } from '../io/importSvg';
import { importLottie } from '../io/importLottie';
import { useStore, type KeyRef } from './store';

const S = () => useStore.getState();

function nodeIn(d: Draft<Doc> | Doc, id: string): Node | null {
  return locate(d.nodes as Node[], id)?.node ?? null;
}

// ---------- Propiedades y keyframes ----------

/**
 * Reglas del modo pixel: posiciones y anclas en píxel entero, y las imágenes
 * solo escalan en múltiplos enteros (×1, ×2, ×3; el signo voltea).
 */
export function pixelRule(doc: Doc, node: Node, path: PropPath, value: Vec): Vec {
  if (!doc.pixel) return value;
  if (path === 'transform.position' || path === 'transform.anchor') return value.map((v) => Math.round(v));
  if (path === 'transform.scale' && node.type === 'image') return value.map((v) => Math.round(v / 100) * 100);
  return value;
}

export function setNodeProp(nodeId: string, path: PropPath, value: Vec) {
  setManyProps([{ nodeId, path, value }]);
}

/** Cambia propiedades (de uno o varios nodos) en el frame actual. */
export function setManyProps(changes: { nodeId: string; path: PropPath; value: Vec }[]) {
  const { frame, autoKey } = S();
  S().update((d) => {
    for (const c of changes) {
      const n = nodeIn(d, c.nodeId);
      const p = n && getProp(n, c.path);
      if (p) setPropValue(p, pixelRule(d as Doc, n, c.path, c.value), frame, autoKey);
    }
  });
}

export function toggleNodeKey(nodeId: string, path: PropPath) {
  const frame = S().frame;
  S().update((d) => {
    const n = nodeIn(d, nodeId);
    const p = n && getProp(n, path);
    if (p) toggleKey(p, frame);
  });
  S().toggleTimelineRow(nodeId, true);
}

/** Rombo con varias capas: añade el keyframe a las que no lo tienen, o lo quita de todas. */
export function toggleKeysMany(nodeIds: string[], path: PropPath, remove: boolean) {
  const f = Math.round(S().frame);
  S().update((d) => {
    for (const id of nodeIds) {
      const n = nodeIn(d, id);
      const p = n && getProp(n, path);
      if (!p) continue;
      const has = p.keys.some((k) => k.frame === f);
      if (remove === has) toggleKey(p, f);
    }
  });
  for (const id of nodeIds) S().toggleTimelineRow(id, true);
}

export function clearNodeAnimation(nodeId: string, path: PropPath) {
  const frame = S().frame;
  S().update((d) => {
    const n = nodeIn(d, nodeId);
    const p = n && getProp(n, path);
    if (p) clearAnimation(p, frame);
  });
}

export function updateNode(nodeId: string, fn: (n: Draft<Node>) => void) {
  S().update((d) => {
    const n = nodeIn(d, nodeId);
    if (n) fn(n as Draft<Node>);
  });
}

function keyIdsByNode(keys: KeyRef[]) {
  const map = new Map<string, Set<string>>();
  for (const k of keys) {
    if (!map.has(k.nodeId)) map.set(k.nodeId, new Set());
    map.get(k.nodeId)!.add(k.keyId);
  }
  return map;
}

export function deleteSelectedKeys() {
  const keys = S().keySelection;
  if (!keys.length) return false;
  const byNode = keyIdsByNode(keys);
  S().update((d) => {
    for (const [nodeId, ids] of byNode) {
      const n = nodeIn(d, nodeId);
      if (n) for (const p of allProps(n)) removeKeys(p, ids);
    }
  });
  S().setKeySelection([]);
  return true;
}

export function shiftSelectedKeys(delta: number) {
  const keys = S().keySelection;
  const max = S().doc.duration;
  const byNode = keyIdsByNode(keys);
  S().update((d) => {
    for (const [nodeId, ids] of byNode) {
      const n = nodeIn(d, nodeId);
      if (n) for (const p of allProps(n)) shiftKeys(p, ids, delta, max);
    }
  });
}

export function setSelectedKeysEase(ease: Ease, hold = false) {
  const byNode = keyIdsByNode(S().keySelection);
  S().update((d) => {
    for (const [nodeId, ids] of byNode) {
      const n = nodeIn(d, nodeId);
      if (!n) continue;
      for (const p of allProps(n))
        for (const k of p.keys)
          if (ids.has(k.id)) {
            k.ease = { o: [...ease.o] as Point, i: [...ease.i] as Point };
            k.hold = hold || undefined;
          }
    }
  });
}

/** Selecciona todos los keyframes de una propiedad o de un nodo. */
export function keysOf(node: Node, path?: PropPath): KeyRef[] {
  const paths = path ? [path] : propPaths(node);
  const out: KeyRef[] = [];
  for (const p of paths) for (const k of getProp(node, p)?.keys ?? []) out.push({ nodeId: node.id, path: p, keyId: k.id });
  return out;
}

// ---------- Efectos ----------

export function addEffect(nodeId: string, kind: EffectKind) {
  S().update((d) => {
    const n = nodeIn(d, nodeId);
    if (!n) return;
    n.effects = [...(n.effects ?? []), makeEffect(kind, uid())];
  });
}

export function updateEffect(nodeId: string, effectId: string, patch: Partial<Effect>) {
  S().update((d) => {
    const n = nodeIn(d, nodeId);
    const fx = n?.effects?.find((e) => e.id === effectId);
    if (fx) Object.assign(fx, patch);
  });
}

export function removeEffect(nodeId: string, effectId: string) {
  S().update((d) => {
    const n = nodeIn(d, nodeId);
    if (n?.effects) n.effects = n.effects.filter((e) => e.id !== effectId);
  });
}

// ---------- Segmentos ----------

export function addSegment() {
  const st = S();
  const f = Math.round(st.frame);
  const len = Math.max(1, Math.round(st.doc.fps));
  const n = st.doc.segments.length + 1;
  const seg = { id: uid(), name: `segmento ${n}`, start: Math.min(f, st.doc.duration - 1), end: Math.min(st.doc.duration, f + len) };
  st.update((d) => {
    d.segments.push(seg);
  });
  return seg.id;
}

export function updateSegment(id: string, patch: Partial<Segment>) {
  const dur = S().doc.duration;
  S().update((d) => {
    const sg = d.segments.find((x) => x.id === id);
    if (!sg) return;
    Object.assign(sg, patch);
    sg.start = Math.max(0, Math.min(dur - 1, Math.round(sg.start)));
    sg.end = Math.max(sg.start + 1, Math.min(dur, Math.round(sg.end)));
  });
}

export function removeSegment(id: string) {
  S().update((d) => {
    d.segments = d.segments.filter((x) => x.id !== id);
  });
  if (S().playRange) S().setPlayRange(null);
}

// ---------- Tiempo de capa (entrada y salida) ----------

export function setNodeTime(id: string, inFrame: number | undefined, outFrame: number | undefined) {
  const dur = S().doc.duration;
  S().update((d) => {
    const n = nodeIn(d, id);
    if (!n) return;
    let a = inFrame === undefined ? undefined : Math.max(0, Math.round(inFrame));
    let b = outFrame === undefined ? undefined : Math.min(dur, Math.round(outFrame));
    if (a !== undefined && b !== undefined && b <= a) b = a + 1;
    if (a === 0) a = undefined;
    if (b !== undefined && b >= dur) b = undefined;
    n.inFrame = a;
    n.outFrame = b;
  });
}

/** Desplaza una capa en el tiempo: su entrada, su salida y sus keyframes. */
export function shiftNodeTime(id: string, delta: number) {
  if (!delta) return;
  const dur = S().doc.duration;
  S().update((d) => {
    const n = nodeIn(d, id);
    if (!n) return;
    const a = n.inFrame ?? 0;
    const b = n.outFrame ?? dur;
    const dd = Math.max(-a, Math.min(dur - b, delta));
    if (!dd) return;
    n.inFrame = a + dd || undefined;
    n.outFrame = b + dd >= dur ? undefined : b + dd;
    const visit = (x: Node) => {
      for (const p of allProps(x)) for (const k of p.keys) k.frame += dd;
      if (x.type === 'group') x.children.forEach(visit);
    };
    visit(n as Node);
  });
}

// ---------- Nodos ----------

export function addNode(node: Node) {
  S().update((d) => {
    d.nodes.unshift(node as Draft<Node>);
  });
  S().setSelection([node.id]);
}

/** Ids seleccionados sin los que ya van dentro de un grupo seleccionado. */
function topSelection(doc: Doc): string[] {
  const sel = new Set(S().selection);
  const out: string[] = [];
  walk(doc.nodes, (n, parent) => {
    if (!sel.has(n.id)) return;
    let p: GroupNode | null = parent;
    let covered = false;
    while (p) {
      if (sel.has(p.id)) covered = true;
      p = locate(doc.nodes, p.id)?.parent ?? null;
    }
    if (!covered) out.push(n.id);
  });
  return out;
}

export function deleteSelection() {
  if (deleteSelectedKeys()) return;
  const ids = topSelection(S().doc);
  if (!ids.length) return;
  S().update((d) => {
    for (const id of ids) {
      const loc = locate(d.nodes as Node[], id);
      if (loc) loc.siblings.splice(loc.index, 1);
    }
  });
  S().setSelection([]);
}

export function cloneWithNewIds(n: Node): Node {
  const copy = JSON.parse(JSON.stringify(n)) as Node;
  const reid = (x: Node) => {
    x.id = uid();
    for (const p of allProps(x)) for (const k of p.keys) k.id = uid();
    if (x.type === 'group') x.children.forEach(reid);
  };
  reid(copy);
  return copy;
}

export function duplicateSelection() {
  const ids = topSelection(S().doc);
  if (!ids.length) return;
  const newIds: string[] = [];
  S().update((d) => {
    for (const id of ids) {
      const loc = locate(d.nodes as Node[], id);
      if (!loc) continue;
      const copy = cloneWithNewIds(loc.node);
      copy.name = `${loc.node.name} copia`;
      const shift = (v: Vec) => [v[0] + 16, v[1] + 16];
      copy.transform.position.value = shift(copy.transform.position.value);
      for (const k of copy.transform.position.keys) k.value = shift(k.value);
      loc.siblings.splice(loc.index, 0, copy);
      newIds.push(copy.id);
    }
  });
  S().setSelection(newIds);
}

export function groupSelection() {
  const doc = S().doc;
  const ids = topSelection(doc);
  if (!ids.length) return;
  const locs = ids.map((id) => locate(doc.nodes, id)!);
  const parentId = locs[0].parent?.id ?? null;
  if (locs.some((l) => (l.parent?.id ?? null) !== parentId)) {
    S().notify('Para agrupar, las capas tienen que estar al mismo nivel.', 'error');
    return;
  }
  if (locs.some((l) => l.node.type === 'image')) {
    S().notify('Lottie no permite imágenes dentro de grupos.', 'error');
    return;
  }
  const frame = Math.round(S().frame);
  const box = unionBoxes(locs.map((l) => nodeBounds(doc, l.node, frame)));
  // El pivote va al centro de lo agrupado. Las cajas están en coordenadas del
  // lienzo, que coinciden con las del padre solo si el padre es identidad.
  const center: Point = box && (!locs[0].parent || isIdentityGroup(locs[0].parent)) ? [box.x + box.w / 2, box.y + box.h / 2] : [0, 0];
  const group = makeGroup([], 'Grupo', center);
  const ordered = [...locs].sort((a, b) => a.index - b.index);
  S().update((d) => {
    const siblings = (parentId ? (nodeIn(d, parentId) as GroupNode).children : d.nodes) as Node[];
    const firstIndex = ordered[0].index;
    const moved: Node[] = [];
    for (const l of [...ordered].reverse()) moved.unshift(siblings.splice(l.index, 1)[0]);
    group.children = moved;
    siblings.splice(firstIndex, 0, group);
  });
  S().setSelection([group.id]);
}

function isIdentityGroup(g: GroupNode): boolean {
  const t = g.transform;
  const stat = [t.anchor, t.position, t.scale, t.rotation].every((p) => p.keys.length === 0);
  return (
    stat &&
    t.anchor.value[0] === t.position.value[0] &&
    t.anchor.value[1] === t.position.value[1] &&
    t.scale.value[0] === 100 &&
    t.scale.value[1] === 100 &&
    t.rotation.value[0] === 0
  );
}

export function ungroupSelection() {
  const doc = S().doc;
  const groups = topSelection(doc)
    .map((id) => locate(doc.nodes, id)!)
    .filter((l) => l.node.type === 'group');
  if (!groups.length) {
    S().notify('Selecciona un grupo para desagrupar.', 'info');
    return;
  }
  const animated = groups.find((l) => allTransformProps(l.node).some((p) => p.keys.length > 0));
  if (animated) {
    S().notify(`«${animated.node.name}» tiene animación propia y se perdería al desagrupar. Quítale los keyframes o anima las piezas por separado.`, 'error');
    return;
  }
  const childIds: string[] = [];
  let approximate = false;
  S().update((d) => {
    for (const g of groups) {
      const loc = locate(d.nodes as Node[], g.node.id);
      if (!loc || loc.node.type !== 'group') continue;
      const t = loc.node.transform;
      const G = nodeMatrix(t as Transform, 0);
      const gRot = t.rotation.value[0];
      const gScale = t.scale.value;
      const gOpacity = t.opacity.value[0] / 100;
      const uniform = Math.abs(gScale[0] - gScale[1]) < 1e-6;
      const kids = loc.node.children;
      for (const k of kids) {
        const kt = k.transform;
        const childRotates = kt.rotation.value[0] !== 0 || kt.rotation.keys.some((x) => x.value[0] !== 0);
        if (!uniform && childRotates) approximate = true;
        // La matriz del grupo se hornea en cada hijo: exacta con escala uniforme o hijos sin giro.
        const mapPos = (v: Vec) => apply(G, [v[0], v[1]]);
        kt.position.value = mapPos(kt.position.value);
        for (const key of kt.position.keys) key.value = mapPos(key.value);
        const mapRot = (v: Vec) => [v[0] + gRot];
        kt.rotation.value = mapRot(kt.rotation.value);
        for (const key of kt.rotation.keys) key.value = mapRot(key.value);
        const mapScale = (v: Vec) => [(v[0] * gScale[0]) / 100, (v[1] * gScale[1]) / 100];
        kt.scale.value = mapScale(kt.scale.value);
        for (const key of kt.scale.keys) key.value = mapScale(key.value);
        const mapOp = (v: Vec) => [v[0] * gOpacity];
        kt.opacity.value = mapOp(kt.opacity.value);
        for (const key of kt.opacity.keys) key.value = mapOp(key.value);
        if (loc.parent === null && loc.node.inFrame !== undefined) k.inFrame = loc.node.inFrame;
        if (loc.parent === null && loc.node.outFrame !== undefined) k.outFrame = loc.node.outFrame;
        childIds.push(k.id);
      }
      loc.siblings.splice(loc.index, 1, ...kids);
    }
  });
  S().setSelection(childIds);
  if (approximate) S().notify('Desagrupado. El grupo tenía escala desigual y algunas piezas giran: revisa que se vean igual.', 'info');
}

function allTransformProps(n: Node) {
  const t = n.transform;
  return [t.anchor, t.position, t.scale, t.rotation, t.opacity];
}

// ---------- Separar un trazo en piezas ----------

function polygonOf(p: BezierPath): Point[] {
  return samplePaths([p], [1, 0, 0, 1, 0, 0], 6);
}

function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Agrupa los subtrazos en piezas: cada contorno exterior con sus huecos
 * (la "o" sigue siendo una "o" y no un círculo relleno encima de otro).
 */
export function splitIntoPieces(paths: BezierPath[], rule: 1 | 2): BezierPath[][] {
  const polys = paths.map(polygonOf);
  const areas = polys.map((p) => signedArea(p));
  const containers = paths.map((_, i) =>
    paths
      .map((__, j) => j)
      .filter((j) => j !== i && Math.abs(areas[j]) > Math.abs(areas[i]) && polys[i].length > 0 && pointInPolygon(polys[i][0], polys[j])),
  );
  const isHole = (i: number): boolean => {
    if (!paths[i].closed || containers[i].length === 0) return false;
    if (rule === 2) return containers[i].length % 2 === 1;
    const parent = containers[i].reduce((best, j) => (Math.abs(areas[j]) < Math.abs(areas[best]) ? j : best));
    return Math.sign(areas[parent]) !== Math.sign(areas[i]) && !isHole(parent);
  };
  const holes = paths.map((_, i) => isHole(i));
  const pieces = new Map<number, BezierPath[]>();
  paths.forEach((p, i) => {
    if (!holes[i]) pieces.set(i, [p]);
  });
  paths.forEach((p, i) => {
    if (!holes[i]) return;
    const owner = containers[i].filter((j) => !holes[j]).reduce<number | null>((best, j) => (best === null || Math.abs(areas[j]) < Math.abs(areas[best]) ? j : best), null);
    if (owner !== null) pieces.get(owner)!.push(p);
    else pieces.set(i, [p]);
  });
  return [...pieces.values()];
}

export function canSplit(n: Node | null): boolean {
  return !!n && n.type === 'shape' && n.geometry.kind === 'path' && n.geometry.paths.length > 1;
}

export function splitSelection() {
  const doc = S().doc;
  const id = S().selection[0];
  const loc = id ? locate(doc.nodes, id) : null;
  if (!loc || !canSplit(loc.node)) {
    S().notify('Selecciona un trazo que tenga varias partes.', 'info');
    return;
  }
  const node = loc.node as ShapeNode;
  if (node.geometry.kind !== 'path') return;
  const groups = splitIntoPieces(node.geometry.paths, node.fill.rule);
  if (groups.length < 2) {
    S().notify('Este trazo es una sola pieza (con sus huecos); no hay nada que separar.', 'info');
    return;
  }
  const staticT = allTransformProps(node).every((p) => p.keys.length === 0);
  const M = nodeMatrix(node.transform, 0);
  const pieces: ShapeNode[] = groups.map((paths, i) => {
    const box = boundsOf(samplePaths(paths, [1, 0, 0, 1, 0, 0]))!;
    const c: Point = [box.x + box.w / 2, box.y + box.h / 2];
    const copy = JSON.parse(JSON.stringify(node)) as ShapeNode;
    copy.id = uid();
    copy.name = `${node.name} ${i + 1}`;
    copy.inFrame = undefined;
    copy.outFrame = undefined;
    copy.geometry = { kind: 'path', paths: paths.map((p) => ({ ...p, v: p.v.map(([x, y]) => [x - c[0], y - c[1]] as Point) })) };
    for (const p of allProps(copy)) for (const k of p.keys) k.id = uid();
    if (staticT) {
      // Pivote en el centro de la pieza, sin moverla.
      const pos = apply(M, c);
      copy.transform.anchor.value = [0, 0];
      copy.transform.position.value = [Math.round(pos[0] * 100) / 100, Math.round(pos[1] * 100) / 100];
    } else {
      // Con animación se conserva el pivote original para no alterar el movimiento.
      const shift = (v: Vec) => [v[0] - c[0], v[1] - c[1]];
      copy.transform.anchor.value = shift(copy.transform.anchor.value);
      for (const k of copy.transform.anchor.keys) k.value = shift(k.value);
    }
    return copy;
  });
  const center = apply(M, [0, 0]);
  const group = makeGroup(pieces, node.name, staticT ? [Math.round(center[0] * 100) / 100, Math.round(center[1] * 100) / 100] : [0, 0]);
  if (loc.parent === null) {
    group.inFrame = node.inFrame;
    group.outFrame = node.outFrame;
  }
  S().update((d) => {
    const l = locate(d.nodes as Node[], id)!;
    l.siblings.splice(l.index, 1, group as Draft<Node>);
  });
  S().setSelection([pieces[0].id]);
  S().notify(`Separado en ${pieces.length} piezas. Ya puedes animar cada una por su lado.`, 'ok');
}

/** Mueve un nodo a otra posición del árbol (arrastrar en el panel de capas). */
export function moveNode(id: string, targetParentId: string | null, targetIndex: number) {
  const doc = S().doc;
  const loc = locate(doc.nodes, id);
  if (!loc) return;
  if (targetParentId) {
    if (targetParentId === id) return;
    if (loc.node.type === 'group' && locate([loc.node], targetParentId)) return;
    if (loc.node.type === 'image') {
      S().notify('Lottie no permite imágenes dentro de grupos.', 'error');
      return;
    }
  }
  S().update((d) => {
    const from = locate(d.nodes as Node[], id)!;
    const [node] = from.siblings.splice(from.index, 1);
    const target = (targetParentId ? (locate(d.nodes as Node[], targetParentId)!.node as GroupNode).children : d.nodes) as Node[];
    let idx = targetIndex;
    if (from.siblings === target && from.index < targetIndex) idx -= 1;
    if (targetParentId) stripTopLevelOnly(node);
    target.splice(Math.max(0, Math.min(target.length, idx)), 0, node);
  });
  if (targetParentId && (loc.node.effects?.length || loc.node.inFrame !== undefined || loc.node.outFrame !== undefined)) {
    S().notify('Dentro de un grupo no hay efectos ni tiempo de capa propios: se quitaron de esa capa.', 'info');
  }
}

/** Efectos y entrada/salida solo existen en capas de primer nivel. */
export function stripTopLevelOnly(n: Node) {
  delete n.effects;
  delete n.inFrame;
  delete n.outFrame;
}

export function reorderSelection(dir: -1 | 1) {
  const ids = topSelection(S().doc);
  S().update((d) => {
    for (const id of dir < 0 ? ids : [...ids].reverse()) {
      const loc = locate(d.nodes as Node[], id);
      if (!loc) continue;
      const to = loc.index + dir;
      if (to < 0 || to >= loc.siblings.length) continue;
      const [n] = loc.siblings.splice(loc.index, 1);
      loc.siblings.splice(to, 0, n);
    }
  });
}

// ---------- Archivos ----------

export function importSvgText(text: string, fileName: string) {
  try {
    const res = importSvg(text, fileName);
    if (!res.node) {
      S().notify('El SVG no tiene formas que se puedan animar.', 'error');
      return;
    }
    const doc = S().doc;
    const node = res.node;
    const empty = doc.nodes.length === 0;
    if (!empty) {
      // Centrar el SVG en el lienzo actual.
      const dx = (doc.width - res.width) / 2;
      const dy = (doc.height - res.height) / 2;
      const shift = (n: Node) => {
        n.transform.position.value = [n.transform.position.value[0] + dx, n.transform.position.value[1] + dy];
        if (n.type === 'group') {
          n.transform.anchor.value = [n.transform.anchor.value[0] + dx, n.transform.anchor.value[1] + dy];
          n.children.forEach(shift);
        }
      };
      shift(node);
    }
    S().update((d) => {
      if (empty) {
        d.width = Math.round(res.width);
        d.height = Math.round(res.height);
      }
      d.nodes.unshift(node as Draft<Node>);
    });
    S().setSelection([node.id]);
    S().setImportWarnings(res.warnings);
    S().notify(res.warnings.length ? 'SVG importado con avisos: míralos a la derecha.' : 'SVG importado.', res.warnings.length ? 'info' : 'ok');
  } catch (e) {
    S().notify((e as Error).message, 'error');
  }
}

function readImage(file: File): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    reader.onload = () => {
      const data = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error(`${file.name} no es una imagen válida`));
      img.onload = () => resolve({ id: 'img_' + uid(), name: file.name, w: img.naturalWidth, h: img.naturalHeight, data });
      img.src = data;
    };
    reader.readAsDataURL(file);
  });
}

function fitScale(doc: Doc, a: ImageAsset): number {
  return Math.min(1, (doc.width * 0.8) / a.w, (doc.height * 0.8) / a.h);
}

/** Si el lienzo está vacío, toma el tamaño de la imagen (en pixel art, el del dibujo). */
function adoptCanvas(assets: ImageAsset[]) {
  if (S().doc.nodes.length) return;
  const w = Math.max(...assets.map((a) => a.w));
  const h = Math.max(...assets.map((a) => a.h));
  S().update((d) => {
    d.width = w;
    d.height = h;
  });
}

export async function importImageFile(file: File) {
  await importImagesAsLayers([file]);
}

/** Varias imágenes como capas apiladas (p. ej. cuerpo, ojos y orbe exportados aparte). */
export async function importImagesAsLayers(files: File[]) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  try {
    const assets = await Promise.all(sorted.map(readImage));
    adoptCanvas(assets);
    const doc = S().doc;
    const nodes = assets.map((a) => {
      const n = makeImage(a.id, a.name.replace(/\.[^.]+$/, ''), a.w, a.h, [doc.width / 2, doc.height / 2], doc.pixel);
      const fit = fitScale(doc, a);
      if (fit < 1 && !doc.pixel) n.transform.scale.value = [Math.round(fit * 1000) / 10, Math.round(fit * 1000) / 10];
      return n;
    });
    S().update((d) => {
      d.assets.push(...assets);
      // El primero por nombre queda abajo; el último, encima.
      d.nodes.unshift(...([...nodes].reverse() as Draft<Node>[]));
    });
    S().setSelection(nodes.map((n) => n.id));
    const heavy = files.some((f) => f.size > 300_000);
    S().notify(
      heavy
        ? 'Imagen pesada: el JSON la lleva dentro y crecerá. Mejor un PNG optimizado.'
        : nodes.length > 1
          ? `${nodes.length} capas añadidas.`
          : 'Imagen añadida.',
      heavy ? 'info' : 'ok',
    );
  } catch (e) {
    S().notify((e as Error).message, 'error');
  }
}

/**
 * Varias imágenes como secuencia: cada una se ve `framesEach` frames y luego
 * da paso a la siguiente (animación fotograma a fotograma, como el pixel art).
 */
export async function importImageSequence(files: File[], framesEach: number) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  try {
    const assets = await Promise.all(sorted.map(readImage));
    adoptCanvas(assets);
    const doc = S().doc;
    const k = Math.max(1, Math.round(framesEach));
    const total = assets.length * k;
    const nodes = assets.map((a, i) => {
      const n = makeImage(a.id, a.name.replace(/\.[^.]+$/, ''), a.w, a.h, [doc.width / 2, doc.height / 2], doc.pixel);
      const fit = fitScale(doc, assets[0]);
      if (fit < 1 && !doc.pixel) n.transform.scale.value = [Math.round(fit * 1000) / 10, Math.round(fit * 1000) / 10];
      n.inFrame = i * k || undefined;
      n.outFrame = (i + 1) * k;
      return n;
    });
    S().update((d) => {
      d.assets.push(...assets);
      if (total > d.duration) d.duration = total;
      // La última imagen se queda hasta el final de la animación.
      const last = nodes[nodes.length - 1];
      if (last.outFrame !== undefined && last.outFrame >= d.duration) last.outFrame = undefined;
      d.nodes.unshift(...(nodes as Draft<Node>[]));
    });
    S().setSelection(nodes.map((n) => n.id));
    S().notify(`Secuencia de ${assets.length} imágenes, ${k} frame${k > 1 ? 's' : ''} cada una.`, 'ok');
  } catch (e) {
    S().notify((e as Error).message, 'error');
  }
}

export const PROJECT_TAG = 'fotograma';

/** Abre el proyecto de ejemplo que viene con la app (public/examples). */
export async function openExample(): Promise<boolean> {
  try {
    const res = await fetch('./examples/mago.fotograma.json');
    if (!res.ok) throw new Error();
    openLottieText(await res.text());
    return true;
  } catch {
    S().notify('No se pudo abrir el ejemplo.', 'error');
    return false;
  }
}

/** Archivo de trabajo: el documento completo, con efectos y capas ocultas. */
export function projectText(): string {
  return JSON.stringify({ [PROJECT_TAG]: 1, doc: S().doc });
}

export function openLottieText(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed[PROJECT_TAG] && parsed.doc) {
      S().replaceDoc(parsed.doc as Doc);
      S().setImportWarnings([]);
      S().notify('Proyecto abierto.', 'ok');
      return;
    }
    const { doc, warnings } = importLottie(parsed);
    S().replaceDoc(doc);
    S().setImportWarnings(warnings);
    S().notify(warnings.length ? `Abierto con ${warnings.length} aviso${warnings.length > 1 ? 's' : ''}: míralos a la derecha.` : 'Animación abierta.', warnings.length ? 'info' : 'ok');
  } catch (e) {
    S().notify((e as Error).message || 'No se pudo leer el archivo.', 'error');
  }
}

export function downloadText(text: string, fileName: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string) {
  return (name || 'animacion').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'animacion';
}
