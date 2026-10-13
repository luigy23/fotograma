import { memo } from 'react';
import type { ImageAsset, Node, ShapeNode, Vec } from '../model/types';
import { evalProp } from '../model/animate';
import { geometryPaths, pathsToD } from '../model/geometry';
import { nodeMatrix, toSvgMatrix } from '../model/matrix';
import { visibleAt } from '../model/tree';

export function rgbCss(v: Vec): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgb(${c(v[0])} ${c(v[1])} ${c(v[2])})`;
}

export function rgbHex(v: Vec): string {
  const c = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(v[0])}${c(v[1])}${c(v[2])}`;
}

export function hexRgb(hex: string): Vec | null {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** "Recortar trazo" con stroke-dasharray sobre pathLength=100. */
function trimDash(node: ShapeNode, frame: number) {
  if (!node.trim.enabled) return null;
  let s = evalProp(node.trim.start, frame)[0];
  let e = evalProp(node.trim.end, frame)[0];
  const o = evalProp(node.trim.offset, frame)[0];
  if (s > e) [s, e] = [e, s];
  s = Math.max(0, Math.min(100, s));
  e = Math.max(0, Math.min(100, e));
  const len = e - s;
  if (len >= 99.999) return null;
  if (len <= 0.001) return { hidden: true } as const;
  const shift = (((s + (o / 360) * 100) % 100) + 100) % 100;
  return { dasharray: `${len} ${100 - len}`, dashoffset: -shift } as const;
}

function ShapeView({ node, frame }: { node: ShapeNode; frame: number }) {
  const d = pathsToD(geometryPaths(node.geometry, frame));
  const fill = node.fill;
  const stroke = node.stroke;
  const trim = trimDash(node, frame);
  const trimmedAway = trim && 'hidden' in trim;
  return (
    <>
      {fill.enabled && fill.gradient && (
        <defs>
          <radialGradient id={`grad-${node.id}`} gradientUnits="userSpaceOnUse" cx={fill.gradient.center[0]} cy={fill.gradient.center[1]} r={fill.gradient.radius}>
            {fill.gradient.stops.map((st, i) => (
              <stop key={i} offset={st[0]} stopColor={rgbCss(st.slice(1, 4))} stopOpacity={st[4] ?? 1} />
            ))}
          </radialGradient>
        </defs>
      )}
      {fill.enabled && !trimmedAway && (
        <path
          d={d}
          fill={fill.gradient ? `url(#grad-${node.id})` : rgbCss(evalProp(fill.color, frame))}
          fillOpacity={evalProp(fill.opacity, frame)[0] / 100}
          fillRule={fill.rule === 2 ? 'evenodd' : 'nonzero'}
        />
      )}
      {stroke.enabled && !trimmedAway && (
        <path
          d={d}
          fill="none"
          stroke={rgbCss(evalProp(stroke.color, frame))}
          strokeOpacity={evalProp(stroke.opacity, frame)[0] / 100}
          strokeWidth={Math.max(0, evalProp(stroke.width, frame)[0])}
          strokeLinecap={stroke.cap === 1 ? 'butt' : stroke.cap === 2 ? 'round' : 'square'}
          strokeLinejoin={stroke.join === 1 ? 'miter' : stroke.join === 2 ? 'round' : 'bevel'}
          strokeMiterlimit={4}
          pathLength={trim ? 100 : undefined}
          strokeDasharray={trim && 'dasharray' in trim ? trim.dasharray : undefined}
          strokeDashoffset={trim && 'dashoffset' in trim ? trim.dashoffset : undefined}
        />
      )}
      {/* Zona de clic transparente para formas sin relleno. */}
      {!fill.enabled && <path d={d} fill="transparent" stroke="transparent" strokeWidth={8} />}
    </>
  );
}

interface Props {
  node: Node;
  frame: number;
  assets: ImageAsset[];
  pixel?: boolean;
}

export const NodeView = memo(function NodeView({ node, frame, assets, pixel = false }: Props) {
  if (node.hidden || !visibleAt(node, frame)) return null;
  const m = nodeMatrix(node.transform, frame, pixel);
  const opacity = Math.max(0, Math.min(100, evalProp(node.transform.opacity, frame)[0])) / 100;
  return (
    <g data-node-id={node.id} transform={toSvgMatrix(m)} opacity={opacity}>
      {node.type === 'shape' && <ShapeView node={node} frame={frame} />}
      {node.type === 'image' &&
        (() => {
          const a = assets.find((x) => x.id === node.assetId);
          return a ? (
            <image href={a.data} width={a.w} height={a.h} preserveAspectRatio="none" style={pixel ? { imageRendering: 'pixelated' } : undefined} />
          ) : null;
        })()}
      {node.type === 'group' &&
        [...node.children].reverse().map((c) => <NodeView key={c.id} node={c} frame={frame} assets={assets} pixel={pixel} />)}
    </g>
  );
});
