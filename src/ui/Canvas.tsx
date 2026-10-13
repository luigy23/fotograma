import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Node, Point, PropPath, Vec } from '../model/types';
import { useStore } from '../store/store';
import { addNode, setManyProps } from '../store/actions';
import { Scene } from './Scene';
import { halos, ensureHalos } from '../store/bake';
import { nodeMenuItems } from './ContextMenu';
import { evalProp } from '../model/animate';
import { makeShape } from '../model/defaults';
import { ancestors, findNode, nodeBounds, parentMatrix } from '../model/tree';
import { unionBoxes } from '../model/geometry';
import { apply, applyLinear, evalTransform, invert, multiply, rotate, scale as scaleM, translate, transformMatrix, type Mat } from '../model/matrix';
import type { Box } from '../model/geometry';
import { Icon } from './icons';

interface View {
  zoom: number;
  x: number;
  y: number;
}

type Drag =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'draw'; start: Point; current: Point }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean; base: string[] }
  | { kind: 'move'; start: Point; items: { id: string; pos: Vec; inv: Mat }[]; moved: boolean }
  | { kind: 'scale'; id: string; q0: Point; s0: Vec; invPre: Mat }
  | { kind: 'rotate'; id: string; center: Point; a0: number; r0: number }
  | { kind: 'mscale'; items: MultiItem[]; start: Point; corner: Point; center: Point }
  | { kind: 'mrotate'; items: MultiItem[]; center: Point; a0: number }
  | { kind: 'anchor'; id: string; full: Mat; lin: Mat; a0: Vec; p0: Vec };

/** Estado inicial de cada capa al escalar o girar varias a la vez. */
interface MultiItem {
  id: string;
  world: Point;
  scale: Vec;
  rot: number;
  inv: Mat;
  /** Imagen en modo pixel: su escala va a ×1, ×2… */
  pixelImage: boolean;
}

export const spaceState = { down: false, used: false };

export function Canvas() {
  const doc = useStore((s) => s.doc);
  const frame = useStore((s) => s.frame);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const bakeTick = useStore((s) => s.bakeTick);
  useEffect(() => ensureHalos(doc), [doc]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const fitted = useRef('');
  const userMoved = useRef(false);

  const fit = useCallback(() => {
    const pad = 48;
    const z = Math.min((size.w - pad * 2) / doc.width, (size.h - pad * 2) / doc.height);
    const zoom = Math.max(0.05, Math.min(8, z));
    setView({ zoom, x: (size.w - doc.width * zoom) / 2, y: (size.h - doc.height * zoom) / 2 });
  }, [size, doc.width, doc.height]);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Ajusta al tamaño del lienzo al cambiar sus medidas, y al redimensionar la
  // ventana mientras la diseñadora no haya movido la vista a mano.
  useEffect(() => {
    const key = `${doc.width}x${doc.height}`;
    if (fitted.current !== key || !userMoved.current) {
      fitted.current = key;
      userMoved.current = false;
      fit();
    }
  }, [doc.width, doc.height, size, fit]);

  const toDoc = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.zoom, (e.clientY - r.top - view.y) / view.zoom];
  };
  const toScreen = (p: Point): Point => [p[0] * view.zoom + view.x, p[1] * view.zoom + view.y];

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  /** Nodo bajo el puntero según el elemento DOM tocado. */
  const pick = (target: EventTarget | null, deep: boolean): string | null => {
    const st = useStore.getState();
    // Lo que dibujan los efectos selecciona la capa dueña del efecto.
    const owner = (target as Element | null)?.closest?.('[data-fx-owner]')?.getAttribute('data-fx-owner');
    if (owner) return findNode(st.doc, owner)?.locked ? null : owner;
    const chain: string[] = [];
    let el = (target as Element | null)?.closest?.('[data-node-id]') ?? null;
    while (el) {
      const id = el.getAttribute('data-node-id')!;
      if (findNode(st.doc, id)) chain.unshift(id);
      el = el.parentElement?.closest('[data-node-id]') ?? null;
    }
    if (!chain.length) return null;
    if (chain.some((id) => findNode(st.doc, id)?.locked)) return null;
    if (deep) return chain[chain.length - 1];
    const selectedInChain = [...chain].reverse().find((id) => st.selection.includes(id));
    return selectedInChain ?? chain[0];
  };

  const beginMove = (start: Point, ids: string[]) => {
    const st = useStore.getState();
    const f = st.frame;
    // Solo los nodos de más arriba: si se mueve un grupo, sus hijos van con él.
    const top = ids.filter((id) => !ancestors(st.doc.nodes, id).some((g) => ids.includes(g.id)));
    const items = top
      .map((id) => findNode(st.doc, id))
      .filter((n): n is Node => !!n && !n.locked)
      .map((n) => ({ id: n.id, pos: evalProp(n.transform.position, f), inv: invert(parentMatrix(st.doc, n.id, f)) }));
    st.beginGesture();
    setDragBoth({ kind: 'move', start, items, moved: false });
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    if (e.button === 2) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toDoc(e);
    if (e.button === 1 || spaceState.down) {
      spaceState.used = true;
      userMoved.current = true;
      setDragBoth({ kind: 'pan', start: [e.clientX, e.clientY], view });
      return;
    }
    if (e.button !== 0) return;
    const handle = (e.target as Element).getAttribute?.('data-handle');
    if (handle && st.selection.length === 1) {
      startHandle(handle, p, st.selection[0]);
      return;
    }
    if (handle && st.selection.length > 1) {
      startMultiHandle(handle, p);
      return;
    }
    if (st.tool !== 'select') {
      setDragBoth({ kind: 'draw', start: p, current: p });
      return;
    }
    const id = pick(e.target, e.metaKey || e.ctrlKey);
    if (id) {
      let sel = st.selection;
      if (e.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      else if (!sel.includes(id)) sel = [id];
      st.setSelection(sel);
      st.setKeySelection([]);
      if (sel.includes(id)) beginMove(p, sel);
      return;
    }
    setDragBoth({ kind: 'marquee', start: p, current: p, additive: e.shiftKey, base: e.shiftKey ? st.selection : [] });
  };

  const startHandle = (handle: string, p: Point, id: string) => {
    const st = useStore.getState();
    const node = findNode(st.doc, id);
    if (!node || node.locked) return;
    const f = st.frame;
    const parentM = parentMatrix(st.doc, id, f);
    const tv = evalTransform(node.transform, f, st.doc.pixel);
    st.beginGesture();
    if (handle === 'rotate') {
      const center = apply(parentM, tv.position);
      setDragBoth({ kind: 'rotate', id, center, a0: Math.atan2(p[1] - center[1], p[0] - center[0]), r0: tv.rotation });
    } else if (handle === 'anchor') {
      const full = multiply(parentM, transformMatrix(tv));
      const lin = multiply(rotate(tv.rotation), scaleM(tv.scale[0] / 100, tv.scale[1] / 100));
      setDragBoth({ kind: 'anchor', id, full, lin, a0: tv.anchor, p0: tv.position });
    } else {
      const pre = multiply(multiply(parentM, translate(tv.position[0], tv.position[1])), rotate(tv.rotation));
      const invPre = invert(pre);
      setDragBoth({ kind: 'scale', id, q0: apply(invPre, p), s0: tv.scale, invPre });
    }
  };

  /** Varias capas: escalan y giran como conjunto, sin agruparlas. */
  const startMultiHandle = (handle: string, p: Point) => {
    const st = useStore.getState();
    const f = st.frame;
    const ids = st.selection.filter((id) => !ancestors(st.doc.nodes, id).some((g) => st.selection.includes(g.id)));
    const nodes = ids.map((id) => findNode(st.doc, id)).filter((n): n is Node => !!n && !n.locked);
    const box = unionBoxes(nodes.map((n) => nodeBounds(st.doc, n, f)));
    if (!nodes.length || !box) return;
    const items: MultiItem[] = nodes.map((n) => {
      const pm = parentMatrix(st.doc, n.id, f);
      const tv = evalTransform(n.transform, f, st.doc.pixel);
      return { id: n.id, world: apply(pm, tv.position), scale: tv.scale, rot: tv.rotation, inv: invert(pm), pixelImage: st.doc.pixel && n.type === 'image' };
    });
    const center: Point = [box.x + box.w / 2, box.y + box.h / 2];
    st.beginGesture();
    if (handle === 'rotate') {
      setDragBoth({ kind: 'mrotate', items, center, a0: Math.atan2(p[1] - center[1], p[0] - center[0]) });
      return;
    }
    const corners: Point[] = [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x + box.w, box.y + box.h],
      [box.x, box.y + box.h],
    ];
    const i = Number(handle.split('-')[1]) || 0;
    setDragBoth({ kind: 'mscale', items, start: corners[i], corner: corners[(i + 2) % 4], center });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toDoc(e);
    const st = useStore.getState();
    switch (d.kind) {
      case 'pan':
        setView({ ...d.view, x: d.view.x + e.clientX - d.start[0], y: d.view.y + e.clientY - d.start[1] });
        break;
      case 'draw':
        setDragBoth({ ...d, current: p });
        break;
      case 'marquee': {
        const next = { ...d, current: p };
        setDragBoth(next);
        const box = normBox(d.start, p);
        const hits: string[] = [];
        for (const n of st.doc.nodes) {
          if (n.hidden || n.locked) continue;
          const b = nodeBounds(st.doc, n, st.frame);
          if (b && intersects(b, box)) hits.push(n.id);
        }
        st.setSelection([...new Set([...d.base, ...hits])]);
        break;
      }
      case 'move': {
        let dx = p[0] - d.start[0];
        let dy = p[1] - d.start[1];
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!d.moved && Math.hypot(dx * view.zoom, dy * view.zoom) < 3) return;
        if (!d.moved) dragRef.current = { ...d, moved: true };
        setManyProps(
          d.items.map((it) => {
            const local = applyLinear(it.inv, [dx, dy]);
            return { nodeId: it.id, path: 'transform.position' as PropPath, value: [round2(it.pos[0] + local[0]), round2(it.pos[1] + local[1])] };
          }),
        );
        break;
      }
      case 'scale': {
        const q = apply(d.invPre, p);
        let sx = Math.abs(d.q0[0]) > 1e-3 ? d.s0[0] * (q[0] / d.q0[0]) : d.s0[0];
        let sy = Math.abs(d.q0[1]) > 1e-3 ? d.s0[1] * (q[1] / d.q0[1]) : d.s0[1];
        if (e.shiftKey) {
          const k = Math.hypot(q[0], q[1]) / Math.max(1e-3, Math.hypot(d.q0[0], d.q0[1]));
          sx = d.s0[0] * k;
          sy = d.s0[1] * k;
        }
        setManyProps([{ nodeId: d.id, path: 'transform.scale', value: [round2(sx), round2(sy)] }]);
        break;
      }
      case 'mscale': {
        // Desde la esquina contraria; con ⌥ desde el centro; con ⇧ proporcional.
        const pivot = e.altKey ? d.center : d.corner;
        const dx0 = d.start[0] - pivot[0];
        const dy0 = d.start[1] - pivot[1];
        let fx = Math.abs(dx0) > 1e-3 ? (p[0] - pivot[0]) / dx0 : 1;
        let fy = Math.abs(dy0) > 1e-3 ? (p[1] - pivot[1]) / dy0 : 1;
        if (e.shiftKey) {
          const len2 = dx0 * dx0 + dy0 * dy0;
          const k = len2 > 1e-6 ? ((p[0] - pivot[0]) * dx0 + (p[1] - pivot[1]) * dy0) / len2 : 1;
          fx = fy = k;
        }
        const changes: { nodeId: string; path: PropPath; value: Vec }[] = [];
        for (const it of d.items) {
          // En pixel art la escala salta a múltiplos enteros: la posición sigue al mismo salto.
          const snap = (f: number, s0: number) => (it.pixelImage && s0 ? (Math.round((s0 * f) / 100) * 100) / s0 : f);
          const fx2 = snap(fx, it.scale[0]);
          const fy2 = snap(fy, it.scale[1]);
          const w: Point = [pivot[0] + (it.world[0] - pivot[0]) * fx2, pivot[1] + (it.world[1] - pivot[1]) * fy2];
          const pos = apply(it.inv, w);
          changes.push({ nodeId: it.id, path: 'transform.position', value: [round2(pos[0]), round2(pos[1])] });
          changes.push({ nodeId: it.id, path: 'transform.scale', value: [round2(it.scale[0] * fx2), round2(it.scale[1] * fy2)] });
        }
        setManyProps(changes);
        break;
      }
      case 'mrotate': {
        let deg = ((Math.atan2(p[1] - d.center[1], p[0] - d.center[0]) - d.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        const r = (deg * Math.PI) / 180;
        const c = Math.cos(r);
        const sn = Math.sin(r);
        const changes: { nodeId: string; path: PropPath; value: Vec }[] = [];
        for (const it of d.items) {
          const vx = it.world[0] - d.center[0];
          const vy = it.world[1] - d.center[1];
          const pos = apply(it.inv, [d.center[0] + vx * c - vy * sn, d.center[1] + vx * sn + vy * c]);
          changes.push({ nodeId: it.id, path: 'transform.position', value: [round2(pos[0]), round2(pos[1])] });
          changes.push({ nodeId: it.id, path: 'transform.rotation', value: [round2(it.rot + deg)] });
        }
        setManyProps(changes);
        break;
      }
      case 'rotate': {
        const a = Math.atan2(p[1] - d.center[1], p[0] - d.center[0]);
        let r = d.r0 + ((a - d.a0) * 180) / Math.PI;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        setManyProps([{ nodeId: d.id, path: 'transform.rotation', value: [round2(r)] }]);
        break;
      }
      case 'anchor': {
        const local = apply(invert(d.full), p);
        const da: Point = [local[0] - d.a0[0], local[1] - d.a0[1]];
        const dp = applyLinear(d.lin, da);
        setManyProps([
          { nodeId: d.id, path: 'transform.anchor', value: [round2(local[0]), round2(local[1])] },
          { nodeId: d.id, path: 'transform.position', value: [round2(d.p0[0] + dp[0]), round2(d.p0[1] + dp[1])] },
        ]);
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const st = useStore.getState();
    setDragBoth(null);
    if (!d) return;
    if (d.kind === 'draw') {
      const box = normBox(d.start, d.current);
      let w = box.w;
      let h = box.h;
      const tiny = w * view.zoom < 4 && h * view.zoom < 4;
      if (tiny) {
        w = 120;
        h = 120;
      } else if (e.shiftKey) w = h = Math.max(w, h);
      const center: Point = tiny ? d.start : [box.x + w / 2, box.y + h / 2];
      if (st.tool !== 'select') {
        const shape = makeShape(st.tool, [round2(center[0]), round2(center[1])], round2(w), round2(h));
        addNode(shape);
        st.setTool('select');
      }
      return;
    }
    if (d.kind === 'marquee') {
      if (Math.hypot(d.current[0] - d.start[0], d.current[1] - d.start[1]) * view.zoom < 3 && !d.additive) {
        st.setSelection([]);
        st.setKeySelection([]);
      }
      return;
    }
    if (d.kind !== 'pan') st.endGesture();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const deep = pick(e.target, true);
    const id = pick(e.target, e.metaKey || e.ctrlKey);
    if (id && !st.selection.includes(id) && !(deep && st.selection.includes(deep))) st.setSelection([id]);
    if (!id && !deep) st.setSelection([]);
    st.openMenu({ x: e.clientX, y: e.clientY, items: nodeMenuItems(deep) });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = pick(e.target, true);
    if (id) useStore.getState().setSelection([id]);
  };

  // Rueda: desplaza; con ⌘/Ctrl (o pellizco del trackpad) hace zoom hacia el puntero.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const r = el.getBoundingClientRect();
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          const factor = Math.exp(-e.deltaY * 0.01);
          const zoom = Math.max(0.05, Math.min(16, v.zoom * factor));
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          return { zoom, x: mx - ((mx - v.x) * zoom) / v.zoom, y: my - ((my - v.y) * zoom) / v.zoom };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (k: number) => {
    userMoved.current = true;
    setView((v) => {
      const zoom = Math.max(0.05, Math.min(16, v.zoom * k));
      const cx = size.w / 2;
      const cy = size.h / 2;
      return { zoom, x: cx - ((cx - v.x) * zoom) / v.zoom, y: cy - ((cy - v.y) * zoom) / v.zoom };
    });
  };

  // ---------- Overlay de selección ----------
  const f = frame;
  const selNodes = selection.map((id) => findNode(doc, id)).filter((n): n is Node => !!n && !n.hidden);
  const boxes = selNodes.map((n) => ({ n, b: nodeBounds(doc, n, f) })).filter((x) => x.b) as { n: Node; b: Box }[];
  const single = boxes.length === 1 && selection.length === 1 && !boxes[0].n.locked ? boxes[0] : null;
  const multiBox = selection.length > 1 && boxes.some((b) => !b.n.locked) ? unionBoxes(boxes.filter((b) => !b.n.locked).map((b) => b.b)) : null;
  if (multiBox) {
    const pad = 2 / view.zoom;
    multiBox.x -= pad;
    multiBox.y -= pad;
    multiBox.w += pad * 2;
    multiBox.h += pad * 2;
  }

  let anchorScreen: Point | null = null;
  if (single) {
    const tv = evalTransform(single.n.transform, f, doc.pixel);
    anchorScreen = toScreen(apply(parentMatrix(doc, single.n.id, f), tv.position));
  }

  const drawPreview = drag?.kind === 'draw' ? normBox(drag.start, drag.current) : null;
  const marquee = drag?.kind === 'marquee' ? normBox(drag.start, drag.current) : null;
  const cursor =
    drag?.kind === 'pan' || spaceState.down ? 'grabbing' : tool !== 'select' ? 'crosshair' : drag?.kind === 'move' ? 'move' : 'default';

  return (
    <div className="stage">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" fill="#ffffff" />
            <rect width="8" height="8" fill="#e9e9ee" />
            <rect x="8" y="8" width="8" height="8" fill="#e9e9ee" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <rect width={doc.width} height={doc.height} fill={doc.background === 'transparent' ? 'url(#checker)' : doc.background} />
          <g>
            <Scene doc={doc} frame={f} halos={halos} tick={bakeTick} />
          </g>
          <path
            d={`M-100000 -100000H100000V100000H-100000Z M0 0V${doc.height}H${doc.width}V0Z`}
            fillRule="evenodd"
            fill="rgba(12,13,16,0.78)"
            pointerEvents="none"
          />
          <rect width={doc.width} height={doc.height} fill="none" stroke="#3a3b48" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </g>

        <g className="overlay">
          {boxes.map(({ n, b }) => {
            const [x, y] = toScreen([b.x, b.y]);
            return (
              <rect
                key={n.id}
                x={x}
                y={y}
                width={b.w * view.zoom}
                height={b.h * view.zoom}
                fill="none"
                stroke="#7b6cff"
                strokeWidth={1.5}
                strokeDasharray={n.locked ? '4 3' : undefined}
                pointerEvents="none"
              />
            );
          })}
          {single && <Handles box={single.b} toScreen={toScreen} anchor={anchorScreen!} />}
          {!single && multiBox && <Handles box={multiBox} toScreen={toScreen} anchor={null} />}
          {drawPreview && (
            <DrawPreview tool={tool} box={drawPreview} toScreen={toScreen} zoom={view.zoom} />
          )}
          {marquee && (
            <rect
              x={toScreen([marquee.x, marquee.y])[0]}
              y={toScreen([marquee.x, marquee.y])[1]}
              width={marquee.w * view.zoom}
              height={marquee.h * view.zoom}
              fill="rgba(123,108,255,0.1)"
              stroke="#7b6cff"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      <div className="stage-hud">
        <button className="btn icon" title="Alejar" onClick={() => zoomBy(1 / 1.25)}>
          {Icon.minus(14)}
        </button>
        <span className="zoom-label">{Math.round(view.zoom * 100)}%</span>
        <button className="btn icon" title="Acercar" onClick={() => zoomBy(1.25)}>
          {Icon.plus(14)}
        </button>
        <button
          className="btn icon"
          title="Ajustar a la pantalla"
          onClick={() => {
            userMoved.current = false;
            fit();
          }}
        >
          {Icon.fit(14)}
        </button>
      </div>
    </div>
  );
}

function Handles({ box, toScreen, anchor }: { box: Box; toScreen: (p: Point) => Point; anchor: Point | null }) {
  const [x0, y0] = toScreen([box.x, box.y]);
  const [x1, y1] = toScreen([box.x + box.w, box.y + box.h]);
  const corners: [number, number, string][] = [
    [x0, y0, 'nwse-resize'],
    [x1, y0, 'nesw-resize'],
    [x1, y1, 'nwse-resize'],
    [x0, y1, 'nesw-resize'],
  ];
  const mx = (x0 + x1) / 2;
  return (
    <g>
      <line x1={mx} y1={y0} x2={mx} y2={y0 - 22} stroke="#7b6cff" strokeWidth={1.2} pointerEvents="none" />
      <circle data-handle="rotate" cx={mx} cy={y0 - 26} r={5.5} fill="#fff" stroke="#7b6cff" strokeWidth={1.5} style={{ cursor: 'grab' }} />
      {corners.map(([x, y, cur], i) => (
        <rect
          key={i}
          data-handle={`scale-${i}`}
          x={x - 4.5}
          y={y - 4.5}
          width={9}
          height={9}
          rx={2}
          fill="#fff"
          stroke="#7b6cff"
          strokeWidth={1.5}
          style={{ cursor: cur }}
        />
      ))}
      {anchor && (
      <g style={{ cursor: 'move' }}>
        <circle data-handle="anchor" cx={anchor[0]} cy={anchor[1]} r={7} fill="rgba(123,108,255,0.12)" stroke="#7b6cff" strokeWidth={1.4} />
        <path
          d={`M${anchor[0] - 11} ${anchor[1]}H${anchor[0] + 11}M${anchor[0]} ${anchor[1] - 11}V${anchor[1] + 11}`}
          stroke="#7b6cff"
          strokeWidth={1.2}
          pointerEvents="none"
        />
      </g>
      )}
    </g>
  );
}

function DrawPreview({ tool, box, toScreen, zoom }: { tool: string; box: Box; toScreen: (p: Point) => Point; zoom: number }) {
  const [x, y] = toScreen([box.x, box.y]);
  const w = box.w * zoom;
  const h = box.h * zoom;
  const common = { fill: 'rgba(123,108,255,0.18)', stroke: '#7b6cff', strokeWidth: 1.5, pointerEvents: 'none' as const };
  if (tool === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  if (tool === 'rect') return <rect x={x} y={y} width={w} height={h} {...common} />;
  const r = Math.max(w, h) / 2;
  return <circle cx={x + w / 2} cy={y + h / 2} r={r} {...common} strokeDasharray="4 3" />;
}

function normBox(a: Point, b: Point): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

