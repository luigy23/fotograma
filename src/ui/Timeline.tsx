import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Node, PropPath } from '../model/types';
import { useStore, type KeyRef } from '../store/store';
import { addSegment, keysOf, removeSegment, setNodeTime, shiftNodeTime, shiftSelectedKeys, updateSegment } from '../store/actions';
import { animatedPaths, getProp, PROP_LABELS } from '../model/tree';
import { Icon } from './icons';
import { KeyNav } from './fields';
import { keyMenuItems, nodeMenuItems } from './ContextMenu';

const ROW_H = 26;
const SIDE_PAD = 14;

type Row = { kind: 'node'; node: Node; depth: number } | { kind: 'prop'; node: Node; path: PropPath; depth: number };

function buildRows(nodes: Node[], open: Record<string, boolean>, depth = 0, out: Row[] = []): Row[] {
  for (const n of nodes) {
    out.push({ kind: 'node', node: n, depth });
    const isOpen = open[n.id] ?? (n.type !== 'group' || animatedPaths(n).length > 0);
    if (!isOpen) continue;
    for (const path of animatedPaths(n)) out.push({ kind: 'prop', node: n, path, depth });
    if (n.type === 'group') buildRows(n.children, open, depth + 1, out);
  }
  return out;
}

function hasOpenable(n: Node) {
  return n.type === 'group' || animatedPaths(n).length > 0;
}

function niceStep(pxPerFrame: number, fps: number): number {
  const candidates = [1, 2, 5, 10, Math.round(fps / 4), Math.round(fps / 2), fps, fps * 2, fps * 5, fps * 10, fps * 30, fps * 60];
  return candidates.filter((c) => c > 0).sort((a, b) => a - b).find((c) => c * pxPerFrame >= 64) ?? fps * 60;
}

const fmtTime = (frames: number, fps: number) => {
  const s = frames / fps;
  return `${Math.round(s * 100) / 100}s`;
};

export function Timeline() {
  const doc = useStore((s) => s.doc);
  const frame = useStore((s) => s.frame);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const selection = useStore((s) => s.selection);
  const keySel = useStore((s) => s.keySelection);
  const open = useStore((s) => s.timelineOpen);
  const autoKey = useStore((s) => s.autoKey);
  const playRange = useStore((s) => s.playRange);
  const [renamingSeg, setRenamingSeg] = useState<string | null>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [scrollX, setScrollX] = useState(0);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useLayoutEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(100, (width - SIDE_PAD * 2) * zoom);
  const ppf = inner / doc.duration;
  const maxScroll = Math.max(0, inner - (width - SIDE_PAD * 2));
  useEffect(() => {
    if (scrollX > maxScroll) setScrollX(maxScroll);
  }, [maxScroll, scrollX]);
  const xOf = (f: number) => SIDE_PAD + f * ppf - scrollX;
  const frameAt = (clientX: number) => {
    const r = tracksRef.current!.getBoundingClientRect();
    return (clientX - r.left - SIDE_PAD + scrollX) / ppf;
  };

  // Mantener el cabezal a la vista mientras se reproduce.
  useEffect(() => {
    if (!playing || zoom <= 1) return;
    const x = frame * ppf;
    if (x < scrollX || x > scrollX + width - SIDE_PAD * 2) setScrollX(Math.min(maxScroll, Math.max(0, x - 40)));
  }, [frame, playing, zoom, ppf, scrollX, width, maxScroll]);

  const rows = buildRows(doc.nodes, open);
  const st = useStore.getState;

  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    st().setPlaying(false);
    const go = (cx: number) => st().setFrame(Math.round(frameAt(cx)));
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const isSel = (k: KeyRef) => keySel.some((s) => s.keyId === k.keyId);

  const onKeyDown = (e: React.PointerEvent, ref: KeyRef, keyFrame: number) => {
    e.preventDefault();
    e.stopPropagation();
    let sel = keySel;
    if (e.shiftKey) sel = isSel(ref) ? sel.filter((s) => s.keyId !== ref.keyId) : [...sel, ref];
    else if (!isSel(ref)) sel = [ref];
    st().setKeySelection(sel);
    st().setSelection([ref.nodeId]);
    const startX = e.clientX;
    let applied = 0;
    let moved = false;
    st().beginGesture();
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / ppf);
      if (delta !== applied) {
        moved = true;
        shiftSelectedKeys(delta - applied);
        applied = delta;
        st().setFrame(keyFrame + delta);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      st().endGesture();
      if (!moved) st().setFrame(keyFrame);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragBar = (e: React.PointerEvent, id: string, mode: 'in' | 'out' | 'move', a: number, b: number) => {
    e.preventDefault();
    e.stopPropagation();
    st().setSelection([id]);
    st().setKeySelection([]);
    st().beginGesture();
    const startX = e.clientX;
    let applied = 0;
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / ppf);
      if (mode === 'in') setNodeTime(id, Math.min(b - 1, a + delta), b >= doc.duration ? undefined : b);
      else if (mode === 'out') setNodeTime(id, a || undefined, Math.max(a + 1, b + delta));
      else if (delta !== applied) {
        shiftNodeTime(id, delta - applied);
        applied = delta;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      st().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragSegment = (e: React.PointerEvent, id: string, mode: 'start' | 'end' | 'move', start: number, end: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let moved = false;
    st().beginGesture();
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / ppf);
      if (delta) moved = true;
      if (mode === 'start') updateSegment(id, { start: Math.min(end - 1, start + delta) });
      else if (mode === 'end') updateSegment(id, { end: Math.max(start + 1, end + delta) });
      else {
        const d = Math.max(-start, Math.min(doc.duration - end, delta));
        updateSegment(id, { start: start + d, end: end + d });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      st().endGesture();
      if (!moved && mode === 'move') {
        // Clic: reproducir ese tramo en bucle.
        const sg = st().doc.segments.find((x) => x.id === id);
        if (sg) {
          st().setPlayRange({ start: sg.start, end: sg.end });
          st().setFrame(sg.start);
          st().setPlaying(true);
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onTracksDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const body = e.currentTarget.getBoundingClientRect();
    const x0 = e.clientX - body.left;
    const y0 = e.clientY - body.top + (e.currentTarget as HTMLElement).scrollTop;
    const additive = e.shiftKey;
    const base = additive ? keySel : [];
    setMarquee({ x0, y0, x1: x0, y1: y0 });
    const el = e.currentTarget as HTMLElement;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - body.left;
      const y1 = ev.clientY - body.top + el.scrollTop;
      if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 3) dragged = true;
      setMarquee({ x0, y0, x1, y1 });
      const fx0 = (Math.min(x0, x1) - SIDE_PAD + scrollX) / ppf;
      const fx1 = (Math.max(x0, x1) - SIDE_PAD + scrollX) / ppf;
      const ry0 = Math.min(y0, y1);
      const ry1 = Math.max(y0, y1);
      const hits: KeyRef[] = [];
      rows.forEach((row, idx) => {
        if (row.kind !== 'prop') return;
        const top = idx * ROW_H;
        if (top + ROW_H < ry0 || top > ry1) return;
        for (const k of getProp(row.node, row.path)?.keys ?? []) {
          if (k.frame >= fx0 && k.frame <= fx1) hits.push({ nodeId: row.node.id, path: row.path, keyId: k.id });
        }
      });
      st().setKeySelection([...base, ...hits.filter((h) => !base.some((b) => b.keyId === h.keyId))]);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (!dragged) {
        if (!additive) st().setKeySelection([]);
        st().setFrame(Math.round(frameAt(ev.clientX)));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (zoom <= 1) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (d) setScrollX((s) => Math.max(0, Math.min(maxScroll, s + d)));
  };

  const step = niceStep(ppf, doc.fps);
  const ticks: number[] = [];
  for (let f = 0; f <= doc.duration; f += step) ticks.push(f);
  const fInt = Math.round(frame);

  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    const app = document.querySelector('.app') as HTMLElement;
    const startY = e.clientY;
    const startH = parseFloat(getComputedStyle(app).getPropertyValue('--timeline-h')) || 280;
    const move = (ev: PointerEvent) => {
      const h = Math.max(150, Math.min(window.innerHeight - 220, startH - (ev.clientY - startY)));
      app.style.setProperty('--timeline-h', `${h}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="timeline">
      <div className="timeline-resize" onPointerDown={resize} />
      <div className="transport">
        <button className="btn icon" title="Al inicio (Inicio)" onClick={() => st().setFrame(0)}>
          {Icon.first(15)}
        </button>
        <button className="btn icon" title="Frame anterior (,)" onClick={() => st().setFrame(fInt - 1)}>
          {Icon.prev(15)}
        </button>
        <button className="btn icon" title="Reproducir / pausar (Espacio)" onClick={() => st().setPlaying(!playing)} style={{ color: playing ? 'var(--accent-2)' : undefined }}>
          {playing ? Icon.pause(15) : Icon.play(15)}
        </button>
        <button className="btn icon" title="Frame siguiente (.)" onClick={() => st().setFrame(fInt + 1)}>
          {Icon.next(15)}
        </button>
        <button className="btn icon" title="Al final (Fin)" onClick={() => st().setFrame(doc.duration)}>
          {Icon.last(15)}
        </button>
        <button className={`btn icon ${loop ? 'active' : ''}`} title="Repetir en bucle" onClick={() => st().setLoop(!loop)}>
          {Icon.loop(15)}
        </button>
        <button
          className={`btn small auto-key ${autoKey ? 'on' : ''}`}
          title="Auto-keyframe: cualquier cambio crea un keyframe en el frame actual"
          onClick={() => st().setAutoKey(!autoKey)}
        >
          <span className="rec" /> Auto
        </button>
        <span className="timecode">
          {String(fInt).padStart(3, '0')} <small>/ {doc.duration} fr</small> · {(frame / doc.fps).toFixed(2)}s
        </span>
        <span className="spacer" />
        <span className="hint" style={{ margin: 0 }}>
          Zoom
        </span>
        <input type="range" min={1} max={12} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110 }} />
      </div>
      <div className="tl-body">
        <div className="tl-names">
          <div className="tl-names-head">Capas y propiedades animadas</div>
          <div className="tl-seg-head">
            <span>Segmentos</span>
            {playRange && (
              <button className="btn small" onClick={() => st().setPlayRange(null)} title="Volver a reproducir toda la animación">
                Ver todo
              </button>
            )}
            <button
              className="btn small"
              title="Marca un tramo con nombre (reposo, pensando, celebra…) para que el dev lo reproduzca por separado"
              onClick={() => setRenamingSeg(addSegment())}
            >
              + Segmento
            </button>
          </div>
          <div className="tl-scroll" style={{ height: 'calc(100% - 52px)' }} onScroll={(e) => syncScroll(e.currentTarget)} data-sync="names">
            {rows.map((row) =>
              row.kind === 'node' ? (
                <div
                  key={row.node.id}
                  className={`tl-row node-row ${selection.includes(row.node.id) ? 'sel' : ''}`}
                  onClick={(e) => {
                    st().setSelection(e.shiftKey ? [...selection, row.node.id] : [row.node.id]);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!selection.includes(row.node.id)) st().setSelection([row.node.id]);
                    st().openMenu({ x: e.clientX, y: e.clientY, items: nodeMenuItems(null) });
                  }}
                >
                  <div className="tl-name" style={{ paddingLeft: 6 + row.depth * 14 }}>
                    <span
                      className="twisty"
                      onClick={(e) => {
                        e.stopPropagation();
                        const cur = open[row.node.id] ?? (row.node.type !== 'group' || animatedPaths(row.node).length > 0);
                        st().toggleTimelineRow(row.node.id, !cur);
                      }}
                      style={{ visibility: hasOpenable(row.node) ? 'visible' : 'hidden' }}
                    >
                      {(open[row.node.id] ?? (row.node.type !== 'group' || animatedPaths(row.node).length > 0)) ? Icon.chevronDown(12) : Icon.chevronRight(12)}
                    </span>
                    <span className="nm" style={{ color: 'var(--text)' }}>
                      {row.node.name}
                    </span>
                  </div>
                </div>
              ) : (
                <div key={row.node.id + row.path} className="tl-row">
                  <div className="tl-name prop" style={{ paddingLeft: 26 + row.depth * 14 }}>
                    <span
                      className="nm"
                      onClick={() => {
                        st().setSelection([row.node.id]);
                        st().setKeySelection(keysOf(row.node, row.path));
                      }}
                      title="Clic para seleccionar todos sus keyframes"
                      style={{ cursor: 'pointer' }}
                    >
                      {PROP_LABELS[row.path]}
                    </span>
                    <KeyNav node={row.node} path={row.path} />
                  </div>
                </div>
              ),
            )}
            {rows.length === 0 && <div className="tl-empty">Aquí aparecerán las capas y sus keyframes.</div>}
          </div>
        </div>
        <div className="tl-tracks" ref={tracksRef} onWheel={onWheel}>
          <div className="tl-ruler" onPointerDown={scrub}>
            {ticks.map((t) => (
              <div key={t}>
                <div className="tick" style={{ left: xOf(t), height: 7 }} />
                <div className="tick-label" style={{ left: xOf(t) }}>
                  {fmtTime(t, doc.fps)}
                </div>
              </div>
            ))}
            <div className="tick" style={{ left: xOf(doc.duration), height: 26, background: 'var(--text-3)' }} />
          </div>
          <div className="tl-seg-row">
            {doc.segments.map((sg, i) => {
              const active = playRange && playRange.start === sg.start && playRange.end === sg.end;
              return (
                <div
                  key={sg.id}
                  className={`seg ${active ? 'on' : ''}`}
                  style={{ left: xOf(sg.start), width: Math.max(4, xOf(sg.end) - xOf(sg.start)), ['--seg' as string]: SEG_COLORS[i % SEG_COLORS.length] }}
                  title={`${sg.name}: frames ${sg.start}–${sg.end - 1}. Clic para verlo en bucle; arrastra para moverlo.`}
                  onPointerDown={(e) => dragSegment(e, sg.id, 'move', sg.start, sg.end)}
                  onDoubleClick={() => setRenamingSeg(sg.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    st().openMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { label: sg.name, header: true },
                        {
                          label: 'Reproducir en bucle',
                          action: () => {
                            st().setPlayRange({ start: sg.start, end: sg.end });
                            st().setFrame(sg.start);
                            st().setPlaying(true);
                          },
                        },
                        { label: 'Cambiar nombre', action: () => setRenamingSeg(sg.id) },
                        'sep',
                        { label: 'Eliminar segmento', danger: true, action: () => removeSegment(sg.id) },
                      ],
                    });
                  }}
                >
                  <span className="seg-handle left" onPointerDown={(e) => dragSegment(e, sg.id, 'start', sg.start, sg.end)} />
                  {renamingSeg === sg.id ? (
                    <input
                      autoFocus
                      defaultValue={sg.name}
                      onPointerDown={(e) => e.stopPropagation()}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== sg.name) updateSegment(sg.id, { name: v });
                        setRenamingSeg(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenamingSeg(null);
                      }}
                    />
                  ) : (
                    <span className="seg-name">{sg.name}</span>
                  )}
                  <span className="seg-handle right" onPointerDown={(e) => dragSegment(e, sg.id, 'end', sg.start, sg.end)} />
                </div>
              );
            })}
          </div>
          <div className="tl-scroll" style={{ height: 'calc(100% - 52px)', position: 'relative' }} onPointerDown={onTracksDown} onScroll={(e) => syncScroll(e.currentTarget)} data-sync="tracks">
            {rows.map((row) => {
              if (row.kind === 'node') {
                const frames = new Set<number>();
                for (const path of animatedPaths(row.node)) for (const k of getProp(row.node, path)?.keys ?? []) frames.add(k.frame);
                const n = row.node;
                const a = n.inFrame ?? 0;
                const b = n.outFrame ?? doc.duration;
                return (
                  <div key={n.id} className={`tl-row node-row ${selection.includes(n.id) ? 'sel' : ''}`}>
                    {row.depth === 0 && (
                      <div
                        className={`layer-bar ${selection.includes(n.id) ? 'sel' : ''}`}
                        style={{ left: xOf(a), width: Math.max(2, xOf(b) - xOf(a)) }}
                        title="Arrastra para mover la capa en el tiempo; los bordes cambian cuándo aparece y desaparece"
                        onPointerDown={(e) => dragBar(e, n.id, 'move', a, b)}
                      >
                        <span className="bar-handle left" onPointerDown={(e) => dragBar(e, n.id, 'in', a, b)} />
                        <span className="bar-handle right" onPointerDown={(e) => dragBar(e, n.id, 'out', a, b)} />
                      </div>
                    )}
                    {[...frames].map((f) => (
                      <div key={f} className="diamond summary" style={{ left: xOf(f) }} />
                    ))}
                  </div>
                );
              }
              const p = getProp(row.node, row.path)!;
              return (
                <div key={row.node.id + row.path} className="tl-row">
                  {p.keys.slice(0, -1).map((k, i) => (
                    <div
                      key={'s' + k.id}
                      className="ease-span"
                      style={{
                        left: xOf(k.frame),
                        width: Math.max(0, xOf(p.keys[i + 1].frame) - xOf(k.frame)),
                        background: k.hold ? 'transparent' : undefined,
                        borderTop: k.hold ? '2px dotted rgba(215,138,60,0.5)' : undefined,
                      }}
                    />
                  ))}
                  {p.keys.map((k) => {
                    const ref = { nodeId: row.node.id, path: row.path, keyId: k.id };
                    return (
                      <div
                        key={k.id}
                        className={`diamond ${k.hold ? 'hold' : ''} ${isSel(ref) ? 'sel' : ''}`}
                        style={{ left: xOf(k.frame) }}
                        title={`Frame ${k.frame}`}
                        onPointerDown={(e) => e.button === 0 && onKeyDown(e, ref, k.frame)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!isSel(ref)) {
                            st().setKeySelection([ref]);
                            st().setSelection([ref.nodeId]);
                          }
                          st().openMenu({ x: e.clientX, y: e.clientY, items: keyMenuItems() });
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
            {marquee && (
              <div
                className="marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
          </div>
          <div className="playhead" style={{ left: xOf(frame) }} />
          <div className="playhead-cap" style={{ left: xOf(frame) }}>
            {fInt}
          </div>
        </div>
      </div>
    </section>
  );
}

const SEG_COLORS = ['#4fd18b', '#5aa9ff', '#f5b84a', '#ff7aa8', '#b18cff', '#4fd1c5'];

function syncScroll(el: HTMLElement) {
  const other = document.querySelector(`.tl-scroll[data-sync="${el.dataset.sync === 'names' ? 'tracks' : 'names'}"]`) as HTMLElement | null;
  if (other && other.scrollTop !== el.scrollTop) other.scrollTop = el.scrollTop;
}
