// Modelo del documento. Está pensado para que exportar a Lottie sea casi una
// traducción directa: cada nodo de primer nivel es una capa y cada hijo de un
// grupo es un grupo de formas ("gr") dentro de esa capa.

export type Vec = number[];
export type Point = [number, number];

/** Curva de un tramo entre dos keyframes: cubic-bezier(o[0], o[1], i[0], i[1]). */
export interface Ease {
  o: Point;
  i: Point;
}

export interface Keyframe {
  id: string;
  frame: number;
  value: Vec;
  /** Curva del tramo que va de este keyframe al siguiente. */
  ease: Ease;
  /** Mantener el valor hasta el siguiente keyframe (salto seco). */
  hold?: boolean;
}

/** Propiedad animable. Sin keyframes es estática y vale `value`. */
export interface Prop {
  value: Vec;
  keys: Keyframe[];
}

export interface Transform {
  anchor: Prop; // [x, y]
  position: Prop; // [x, y]
  scale: Prop; // [x %, y %]
  rotation: Prop; // [grados]
  opacity: Prop; // [0-100]
}

/** Degradado radial (lo usan los efectos de brillo). Paradas: [posición 0-1, r, g, b, alfa]. */
export interface RadialGradient {
  center: Point;
  radius: number;
  stops: number[][];
}

export interface Fill {
  enabled: boolean;
  color: Prop; // [r, g, b] en 0-1
  opacity: Prop; // [0-100]
  rule: 1 | 2; // 1 nonzero, 2 evenodd
  gradient?: RadialGradient;
}

export interface Stroke {
  enabled: boolean;
  color: Prop;
  opacity: Prop;
  width: Prop;
  cap: 1 | 2 | 3; // butt, round, square
  join: 1 | 2 | 3; // miter, round, bevel
}

export interface Trim {
  enabled: boolean;
  start: Prop; // [0-100]
  end: Prop; // [0-100]
  offset: Prop; // [grados]
}

/** Trazo bezier al estilo Lottie: tangentes relativas a cada vértice. */
export interface BezierPath {
  closed: boolean;
  v: Point[];
  i: Point[];
  o: Point[];
}

export type Geometry =
  | { kind: 'rect'; size: Prop; roundness: Prop }
  | { kind: 'ellipse'; size: Prop }
  | { kind: 'polygon'; points: Prop; radius: Prop }
  | { kind: 'star'; points: Prop; outer: Prop; inner: Prop }
  | { kind: 'path'; paths: BezierPath[] };

export type GeometryKind = Geometry['kind'];

interface NodeBase {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  transform: Transform;
  /** Frame en que aparece (solo capas de primer nivel). Sin valor: desde el inicio. */
  inFrame?: number;
  /** Frame en que desaparece (sin incluirlo). Sin valor: hasta el final. */
  outFrame?: number;
  /** Efectos (solo capas de primer nivel). Se traducen a capas Lottie al exportar. */
  effects?: Effect[];
}

export type EffectKind = 'glow' | 'pixelGlow' | 'sparkles';

export interface Effect {
  id: string;
  kind: EffectKind;
  enabled: boolean;
  color: Vec; // [r, g, b]
  /** 0-100 */
  intensity: number;
  /** Segundos por pulso; 0 = sin pulso. */
  speed: number;
}

/** Tramo con nombre de la línea de tiempo; se exporta como marker de Lottie. */
export interface Segment {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface ShapeNode extends NodeBase {
  type: 'shape';
  geometry: Geometry;
  fill: Fill;
  stroke: Stroke;
  trim: Trim;
}

export interface GroupNode extends NodeBase {
  type: 'group';
  children: Node[];
  expanded: boolean;
}

export interface ImageNode extends NodeBase {
  type: 'image';
  assetId: string;
}

export type Node = ShapeNode | GroupNode | ImageNode;

export interface ImageAsset {
  id: string;
  name: string;
  w: number;
  h: number;
  /** data URL (PNG/JPG/WebP) */
  data: string;
}

export interface Doc {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Duración en frames. */
  duration: number;
  /** Solo para el editor; Lottie no tiene fondo. */
  background: string;
  /** Modo pixel: posiciones enteras, escala de imágenes en múltiplos enteros, sin suavizado. */
  pixel: boolean;
  segments: Segment[];
  /** Orden del panel de capas: el índice 0 es la capa de más arriba. */
  nodes: Node[];
  assets: ImageAsset[];
}

export type PropPath =
  | 'transform.anchor'
  | 'transform.position'
  | 'transform.scale'
  | 'transform.rotation'
  | 'transform.opacity'
  | 'geometry.size'
  | 'geometry.roundness'
  | 'geometry.points'
  | 'geometry.radius'
  | 'geometry.outer'
  | 'geometry.inner'
  | 'fill.color'
  | 'fill.opacity'
  | 'stroke.color'
  | 'stroke.opacity'
  | 'stroke.width'
  | 'trim.start'
  | 'trim.end'
  | 'trim.offset';
