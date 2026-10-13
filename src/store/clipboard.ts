import type { Draft } from 'immer';
import type { Doc, Ease, ImageAsset, Node, PropPath, Vec } from '../model/types';
import { findNode, getProp, locate, walk } from '../model/tree';
import { uid } from '../model/uid';
import { cloneWithNewIds, deleteSelectedKeys, deleteSelection, pixelRule, stripTopLevelOnly } from './actions';
import { useStore, type KeyRef } from './store';

// Copiar y pegar capas o keyframes. Se guarda en memoria y también en el
// portapapeles del sistema (como JSON), así se puede pegar en otra pestaña.

export interface NodeClip {
  kind: 'nodes';
  nodes: Node[];
  assets: ImageAsset[];
}

export interface KeyClip {
  kind: 'keys';
  items: { nodeId: string; path: PropPath; keys: { offset: number; value: Vec; ease: Ease; hold?: boolean }[] }[];
}

export type Clip = NodeClip | KeyClip;

const TAG = 'fotograma-clip';
let memory: Clip | null = null;
const S = () => useStore.getState();

export function hasClip(): boolean {
  return !!memory;
}

export function clipKind(): Clip['kind'] | null {
  return memory?.kind ?? null;
}

export function clipText(clip: Clip): string {
  return JSON.stringify({ [TAG]: 1, clip });
}

export function parseClip(text: string): Clip | null {
  if (!text || !text.includes(TAG)) return null;
  try {
    const data = JSON.parse(text);
    return data?.[TAG] && data.clip ? (data.clip as Clip) : null;
  } catch {
    return null;
  }
}

/** Capas de arriba de la selección (si va un grupo, sus hijos van con él), en orden del panel. */
function topSelected(doc: Doc): Node[] {
  const sel = new Set(S().selection);
  const out: Node[] = [];
  const visit = (nodes: Node[], covered: boolean) => {
    for (const n of nodes) {
      const picked = sel.has(n.id) && !covered;
      if (picked) out.push(n);
      if (n.type === 'group') visit(n.children, covered || picked);
    }
  };
  visit(doc.nodes, false);
  return out;
}

function buildKeyClip(keys: KeyRef[], doc: Doc): KeyClip | null {
  const items: KeyClip['items'] = [];
  let first = Infinity;
  for (const ref of keys) {
    const n = findNode(doc, ref.nodeId);
    const k = n && getProp(n, ref.path)?.keys.find((x) => x.id === ref.keyId);
    if (k) first = Math.min(first, k.frame);
  }
  if (!isFinite(first)) return null;
  for (const ref of keys) {
    const n = findNode(doc, ref.nodeId);
    const k = n && getProp(n, ref.path)?.keys.find((x) => x.id === ref.keyId);
    if (!k) continue;
    let item = items.find((x) => x.nodeId === ref.nodeId && x.path === ref.path);
    if (!item) items.push((item = { nodeId: ref.nodeId, path: ref.path, keys: [] }));
    item.keys.push({ offset: k.frame - first, value: [...k.value], ease: JSON.parse(JSON.stringify(k.ease)), hold: k.hold });
  }
  for (const it of items) it.keys.sort((a, b) => a.offset - b.offset);
  return { kind: 'keys', items };
}

/** Copia lo seleccionado: keyframes si hay, si no, capas. Con `cut` también lo borra. */
export function copySelection(cut = false): Clip | null {
  const st = S();
  const doc = st.doc;
  let clip: Clip | null = null;
  if (st.keySelection.length) clip = buildKeyClip(st.keySelection, doc);
  else {
    const nodes = topSelected(doc);
    if (nodes.length) {
      const ids = new Set<string>();
      for (const n of nodes) walk([n], (x) => void (x.type === 'image' && ids.add(x.assetId)));
      clip = { kind: 'nodes', nodes: JSON.parse(JSON.stringify(nodes)), assets: doc.assets.filter((a) => ids.has(a.id)) };
    }
  }
  if (!clip) return null;
  memory = clip;
  if (cut) {
    if (clip.kind === 'keys') deleteSelectedKeys();
    else deleteSelection();
  }
  const what = clip.kind === 'keys' ? `${st.keySelection.length} keyframe${st.keySelection.length > 1 ? 's' : ''}` : `${clip.nodes.length} capa${clip.nodes.length > 1 ? 's' : ''}`;
  st.notify(`${cut ? 'Cortado' : 'Copiado'}: ${what}.`, 'ok');
  return clip;
}

export function pasteClip(clip: Clip | null = memory): boolean {
  if (!clip) return false;
  memory = clip;
  if (clip.kind === 'nodes') pasteNodes(clip);
  else pasteKeys(clip);
  return true;
}

function pasteNodes(clip: NodeClip) {
  const st = S();
  const doc = st.doc;
  const anchorId = st.selection[0];
  const loc = anchorId ? locate(doc.nodes, anchorId) : null;
  const hasImage = clip.nodes.some((n) => {
    let img = false;
    walk([n], (x) => void (x.type === 'image' && (img = true)));
    return img;
  });
  // Encima de la capa seleccionada, en su mismo nivel (las imágenes, siempre arriba del todo).
  const parentId = loc?.parent && !hasImage ? loc.parent.id : null;
  const copies = clip.nodes.map((n) => {
    const c = cloneWithNewIds(n);
    if (parentId) stripTopLevelOnly(c);
    if (c.effects) c.effects = c.effects.map((e) => ({ ...e, id: uid() }));
    if (doc.pixel) {
      const pos = c.transform.position;
      pos.value = pixelRule(doc, c, 'transform.position', pos.value);
      for (const k of pos.keys) k.value = pixelRule(doc, c, 'transform.position', k.value);
    }
    return c;
  });
  st.update((d) => {
    for (const a of clip.assets) if (!d.assets.some((x) => x.id === a.id)) d.assets.push(a);
    const siblings = (parentId ? (findNode(d as Doc, parentId) as Draft<Node> & { children: Node[] }).children : d.nodes) as Node[];
    const idx = loc && (parentId ? loc.parent?.id === parentId : !loc.parent) ? loc.index : 0;
    siblings.splice(idx, 0, ...copies);
  });
  st.setSelection(copies.map((c) => c.id));
  st.setKeySelection([]);
  st.notify(`Pegado: ${copies.length} capa${copies.length > 1 ? 's' : ''}.`, 'ok');
}

function pasteKeys(clip: KeyClip) {
  const st = S();
  const doc = st.doc;
  const t0 = Math.round(st.frame);
  const sources = [...new Set(clip.items.map((i) => i.nodeId))];
  let targets = st.selection.map((id) => findNode(doc, id)).filter((n): n is Node => !!n);
  if (!targets.length) targets = sources.map((id) => findNode(doc, id)).filter((n): n is Node => !!n);
  if (!targets.length) {
    st.notify('Selecciona la capa donde pegar los keyframes.', 'info');
    return;
  }
  const pasted: KeyRef[] = [];
  let skipped = 0;
  st.update((d) => {
    for (const target of targets) {
      const node = findNode(d as Doc, target.id);
      if (!node) continue;
      // A la misma capa: sus propiedades. A otra capa: las de la primera capa copiada.
      const own = clip.items.filter((i) => i.nodeId === target.id);
      const items = own.length ? own : clip.items.filter((i) => i.nodeId === sources[0]);
      for (const item of items) {
        const p = getProp(node, item.path);
        if (!p || p.value.length !== item.keys[0]?.value.length) {
          skipped++;
          continue;
        }
        for (const k of item.keys) {
          const frame = t0 + k.offset;
          if (frame > d.duration) continue;
          const value = pixelRule(d as Doc, node, item.path, k.value);
          const existing = p.keys.find((x) => x.frame === frame);
          const id = existing?.id ?? uid();
          if (existing) Object.assign(existing, { value: [...value], ease: { o: [...k.ease.o], i: [...k.ease.i] }, hold: k.hold });
          else p.keys.push({ id, frame, value: [...value], ease: { o: [...k.ease.o] as [number, number], i: [...k.ease.i] as [number, number] }, hold: k.hold });
          p.keys.sort((a, b) => a.frame - b.frame);
          pasted.push({ nodeId: node.id, path: item.path, keyId: id });
        }
      }
    }
  });
  st.setKeySelection(pasted);
  for (const t of targets) st.toggleTimelineRow(t.id, true);
  if (!pasted.length) st.notify('Esas propiedades no existen en la capa seleccionada.', 'info');
  else st.notify(`Pegados ${pasted.length} keyframe${pasted.length > 1 ? 's' : ''} desde el frame ${t0}${skipped ? ' (algunas propiedades no aplican a esta capa)' : ''}.`, 'ok');
}

/** Para el menú del clic derecho: copia y además intenta dejarlo en el portapapeles del sistema. */
export function copyFromMenu(cut = false) {
  const clip = copySelection(cut);
  if (clip) navigator.clipboard?.writeText(clipText(clip)).catch(() => undefined);
}
