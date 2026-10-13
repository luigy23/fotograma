import { useMemo } from 'react';
import type { Doc, Node } from '../model/types';
import { effectLayers, type BakedHalo } from '../model/effects';
import { nodeMatrix, toSvgMatrix } from '../model/matrix';
import { visibleAt } from '../model/tree';
import { NodeView } from './render';

interface Props {
  doc: Doc;
  frame: number;
  halos: Map<string, BakedHalo>;
  /** Para forzar el recálculo cuando termina de hornearse un halo. */
  tick?: number;
}

/** Una capa de primer nivel con las capas que generan sus efectos (detrás y delante). */
export function TopLevel({ doc, node, frame, halos, tick }: Props & { node: Node }) {
  const fx = useMemo(
    () => (node.effects?.some((e) => e.enabled) ? effectLayers(doc, node, halos) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, doc.duration, doc.fps, doc.assets, halos, tick],
  );
  if (!fx || node.hidden || !visibleAt(node, frame)) return <NodeView node={node} frame={frame} assets={doc.assets} pixel={doc.pixel} />;
  const m = toSvgMatrix(nodeMatrix(node.transform, frame, doc.pixel));
  const assets = fx.assets.length ? [...doc.assets, ...fx.assets] : doc.assets;
  return (
    <>
      <g transform={m} data-fx-owner={node.id}>
        {[...fx.behind].reverse().map((e) => (
          <NodeView key={e.id} node={e} frame={frame} assets={assets} pixel={doc.pixel} />
        ))}
      </g>
      <NodeView node={node} frame={frame} assets={doc.assets} pixel={doc.pixel} />
      <g transform={m} data-fx-owner={node.id}>
        {[...fx.front].reverse().map((e) => (
          <NodeView key={e.id} node={e} frame={frame} assets={assets} pixel={doc.pixel} />
        ))}
      </g>
    </>
  );
}

/** Toda la escena, de la capa de abajo a la de arriba. */
export function Scene({ doc, frame, halos, tick }: Props) {
  return (
    <>
      {[...doc.nodes].reverse().map((n) => (
        <TopLevel key={n.id} doc={doc} node={n} frame={frame} halos={halos} tick={tick} />
      ))}
    </>
  );
}
