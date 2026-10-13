import type { Doc, GroupNode, Node, Prop, PropPath } from './types';
import { IDENTITY, multiply, nodeMatrix, type Mat } from './matrix';
import { geometryPaths, samplePaths, boundsOf, unionBoxes, type Box } from './geometry';
import { apply } from './matrix';

export interface Located {
  node: Node;
  parent: GroupNode | null;
  siblings: Node[];
  index: number;
  depth: number;
}

export function walk(nodes: Node[], fn: (n: Node, parent: GroupNode | null, depth: number) => void, parent: GroupNode | null = null, depth = 0) {
  for (const n of nodes) {
    fn(n, parent, depth);
    if (n.type === 'group') walk(n.children, fn, n, depth + 1);
  }
}

export function locate(nodes: Node[], id: string, parent: GroupNode | null = null, depth = 0): Located | null {
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.id === id) return { node: n, parent, siblings: nodes, index: k, depth };
    if (n.type === 'group') {
      const found = locate(n.children, id, n, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function findNode(doc: Doc, id: string): Node | null {
  return locate(doc.nodes, id)?.node ?? null;
}

/** Cadena de ancestros desde la raíz hasta el nodo (sin incluirlo). */
export function ancestors(nodes: Node[], id: string): GroupNode[] {
  const chain: GroupNode[] = [];
  const visit = (list: Node[]): boolean => {
    for (const n of list) {
      if (n.id === id) return true;
      if (n.type === 'group') {
        chain.push(n);
        if (visit(n.children)) return true;
        chain.pop();
      }
    }
    return false;
  };
  visit(nodes);
  return chain;
}

export function parentMatrix(doc: Doc, id: string, frame: number): Mat {
  let m: Mat = [...IDENTITY];
  for (const g of ancestors(doc.nodes, id)) m = multiply(m, nodeMatrix(g.transform, frame, doc.pixel));
  return m;
}

export function worldMatrix(doc: Doc, node: Node, frame: number): Mat {
  return multiply(parentMatrix(doc, node.id, frame), nodeMatrix(node.transform, frame, doc.pixel));
}

/** Caja en coordenadas del lienzo de un nodo, dada la matriz de su padre. */
export function nodeBounds(doc: Doc, node: Node, frame: number, parentM: Mat = parentMatrix(doc, node.id, frame)): Box | null {
  const m = multiply(parentM, nodeMatrix(node.transform, frame, doc.pixel));
  if (node.type === 'shape') {
    const pts = samplePaths(geometryPaths(node.geometry, frame), m);
    const box = boundsOf(pts);
    if (box && node.stroke.enabled) {
      const sw = (node.stroke.width.value[0] ?? 0) / 2;
      return { x: box.x - sw, y: box.y - sw, w: box.w + sw * 2, h: box.h + sw * 2 };
    }
    return box;
  }
  if (node.type === 'image') {
    const a = doc.assets.find((x) => x.id === node.assetId);
    if (!a) return null;
    return boundsOf([apply(m, [0, 0]), apply(m, [a.w, 0]), apply(m, [a.w, a.h]), apply(m, [0, a.h])]);
  }
  return unionBoxes(node.children.filter((c) => !c.hidden).map((c) => nodeBounds(doc, c, frame, m)));
}

export function getProp(node: Node, path: PropPath): Prop | null {
  const [group, key] = path.split('.') as [string, string];
  const holder = (node as unknown as Record<string, Record<string, unknown>>)[group];
  if (!holder || typeof holder !== 'object') return null;
  const p = holder[key] as Prop | undefined;
  return p && Array.isArray(p.keys) ? p : null;
}

export const PROP_LABELS: Record<PropPath, string> = {
  'transform.anchor': 'Punto de anclaje',
  'transform.position': 'Posición',
  'transform.scale': 'Escala',
  'transform.rotation': 'Rotación',
  'transform.opacity': 'Opacidad',
  'geometry.size': 'Tamaño',
  'geometry.roundness': 'Redondeo',
  'geometry.points': 'Puntas',
  'geometry.radius': 'Radio',
  'geometry.outer': 'Radio exterior',
  'geometry.inner': 'Radio interior',
  'fill.color': 'Color de relleno',
  'fill.opacity': 'Opacidad del relleno',
  'stroke.color': 'Color del borde',
  'stroke.opacity': 'Opacidad del borde',
  'stroke.width': 'Grosor del borde',
  'trim.start': 'Recorte: inicio',
  'trim.end': 'Recorte: fin',
  'trim.offset': 'Recorte: giro',
};

/** Propiedades animables que tiene un nodo, en el orden del inspector. */
export function propPaths(node: Node): PropPath[] {
  const t: PropPath[] = ['transform.position', 'transform.scale', 'transform.rotation', 'transform.opacity', 'transform.anchor'];
  if (node.type !== 'shape') return t;
  const g: PropPath[] = [];
  switch (node.geometry.kind) {
    case 'rect':
      g.push('geometry.size', 'geometry.roundness');
      break;
    case 'ellipse':
      g.push('geometry.size');
      break;
    case 'polygon':
      g.push('geometry.points', 'geometry.radius');
      break;
    case 'star':
      g.push('geometry.points', 'geometry.outer', 'geometry.inner');
      break;
  }
  return [
    ...t,
    ...g,
    'fill.color',
    'fill.opacity',
    'stroke.color',
    'stroke.opacity',
    'stroke.width',
    'trim.start',
    'trim.end',
    'trim.offset',
  ];
}

export function animatedPaths(node: Node): PropPath[] {
  return propPaths(node).filter((p) => (getProp(node, p)?.keys.length ?? 0) > 0);
}

export function allProps(node: Node): Prop[] {
  return propPaths(node)
    .map((p) => getProp(node, p))
    .filter((p): p is Prop => !!p);
}

/** Una capa se ve si inFrame <= frame < outFrame (como ip/op en Lottie). */
export function visibleAt(node: Node, frame: number): boolean {
  if (node.inFrame !== undefined && frame < node.inFrame) return false;
  if (node.outFrame !== undefined && frame >= node.outFrame) return false;
  return true;
}
