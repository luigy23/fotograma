import type { BezierPath, Doc, Fill, Geometry, GeometryKind, GroupNode, ImageNode, Point, ShapeNode, Stroke, Transform, Trim } from './types';
import { prop } from './animate';
import { uid } from './uid';

export function makeTransform(position: Point = [0, 0], anchor: Point = [0, 0]): Transform {
  return {
    anchor: prop(anchor),
    position: prop(position),
    scale: prop([100, 100]),
    rotation: prop([0]),
    opacity: prop([100]),
  };
}

export function makeFill(rgb: number[] = [0.43, 0.36, 0.99], enabled = true): Fill {
  return { enabled, color: prop(rgb), opacity: prop([100]), rule: 1 };
}

export function makeStroke(rgb: number[] = [0.07, 0.07, 0.1], width = 4, enabled = false): Stroke {
  return { enabled, color: prop(rgb), opacity: prop([100]), width: prop([width]), cap: 2, join: 2 };
}

export function makeTrim(): Trim {
  return { enabled: false, start: prop([0]), end: prop([100]), offset: prop([0]) };
}

export const SHAPE_LABELS: Record<GeometryKind, string> = {
  rect: 'Rectángulo',
  ellipse: 'Elipse',
  polygon: 'Polígono',
  star: 'Estrella',
  path: 'Trazo',
};

export function makeGeometry(kind: GeometryKind, w = 120, h = 120, paths: BezierPath[] = []): Geometry {
  switch (kind) {
    case 'rect':
      return { kind, size: prop([w, h]), roundness: prop([0]) };
    case 'ellipse':
      return { kind, size: prop([w, h]) };
    case 'polygon':
      return { kind, points: prop([6]), radius: prop([Math.max(w, h) / 2]) };
    case 'star':
      return { kind, points: prop([5]), outer: prop([Math.max(w, h) / 2]), inner: prop([Math.max(w, h) / 4]) };
    case 'path':
      return { kind, paths };
  }
}

export function makeShape(kind: GeometryKind, position: Point, w = 120, h = 120, name?: string): ShapeNode {
  return {
    id: uid(),
    type: 'shape',
    name: name ?? SHAPE_LABELS[kind],
    hidden: false,
    locked: false,
    transform: makeTransform(position),
    geometry: makeGeometry(kind, w, h),
    fill: makeFill(),
    stroke: makeStroke(),
    trim: makeTrim(),
  };
}

export function makeGroup(children: GroupNode['children'], name = 'Grupo', position: Point = [0, 0]): GroupNode {
  return {
    id: uid(),
    type: 'group',
    name,
    hidden: false,
    locked: false,
    expanded: true,
    transform: makeTransform(position, position),
    children,
  };
}

export function makeImage(assetId: string, name: string, w: number, h: number, position: Point, pixel = false): ImageNode {
  // En pixel art el ancla va a un píxel entero: así la imagen cae siempre en la rejilla.
  const anchor: Point = pixel ? [Math.floor(w / 2), Math.floor(h / 2)] : [w / 2, h / 2];
  const pos: Point = pixel ? [Math.round(position[0]), Math.round(position[1])] : position;
  return {
    id: uid(),
    type: 'image',
    name,
    hidden: false,
    locked: false,
    assetId,
    transform: makeTransform(pos, anchor),
  };
}

export function makeDoc(): Doc {
  return {
    name: 'Animación',
    width: 512,
    height: 512,
    fps: 30,
    duration: 60,
    background: '#ffffff',
    pixel: true,
    segments: [],
    nodes: [],
    assets: [],
  };
}

/** Completa documentos guardados con versiones anteriores del editor. */
export function normalizeDoc(doc: Doc): Doc {
  return { ...makeDoc(), ...doc, segments: doc.segments ?? [], pixel: doc.pixel ?? false };
}

export interface SizePreset {
  label: string;
  w: number;
  h: number;
  pixel?: boolean;
}

export const SIZE_PRESETS: SizePreset[] = [
  { label: 'Pixel 32 × 32', w: 32, h: 32, pixel: true },
  { label: 'Pixel 48 × 48', w: 48, h: 48, pixel: true },
  { label: 'Pixel 64 × 64', w: 64, h: 64, pixel: true },
  { label: 'Pixel 96 × 96', w: 96, h: 96, pixel: true },
  { label: 'Pixel 128 × 128', w: 128, h: 128, pixel: true },
  { label: 'Icono 512 × 512', w: 512, h: 512 },
  { label: 'Tarjeta 1080 × 1080', w: 1080, h: 1080 },
  { label: 'Pantalla del móvil 788 × 1704', w: 788, h: 1704 },
];
