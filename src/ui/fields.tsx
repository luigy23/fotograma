import { useRef, useState } from 'react';
import type { Node, PropPath, Vec } from '../model/types';
import { evalProp, keyAt, nextKeyFrame, prevKeyFrame } from '../model/animate';
import { getProp } from '../model/tree';
import { useStore } from '../store/store';
import { setManyProps, setNodeProp, toggleKeysMany, toggleNodeKey } from '../store/actions';
import { hexRgb, rgbHex } from './render';
import { Icon } from './icons';

const fmt = (v: number, digits: number) => {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? '0' : String(r);
};

interface NumberFieldProps {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  className?: string;
  title?: string;
  /** Varias capas con valores distintos: se muestra «Mixto». */
  mixed?: boolean;
  /** Arrastre y flechas en relativo (cada capa desde su valor). */
  onDeltaStart?: () => void;
  onDelta?: (delta: number) => void;
}

/** Campo numérico: se escribe, se ajusta con flechas o se arrastra la etiqueta. */
export function NumberField({
  value,
  onChange,
  label,
  step = 1,
  min = -Infinity,
  max = Infinity,
  digits = 2,
  className = '',
  title,
  mixed = false,
  onDeltaStart,
  onDelta,
}: NumberFieldProps) {
  // Mientras se escribe se muestra el texto tecleado; el resto del tiempo, el
  // valor real del frame actual (así nunca se queda atrasado).
  const [editing, setEditing] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = editing ?? (mixed ? '' : fmt(value, digits));
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const commit = (text: string) => {
    const expr = text.replace(',', '.').trim();
    let v = Number(expr);
    if (!isFinite(v) && /^[-+*/().\d\s]+$/.test(expr)) {
      try {
        v = Number(Function(`"use strict";return (${expr})`)());
      } catch {
        v = NaN;
      }
    }
    if (isFinite(v) && (v !== value || mixed)) onChange(clamp(v));
  };

  const onScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const startX = e.clientX;
    const start = value;
    st.beginGesture();
    onDeltaStart?.();
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const delta = Math.round((ev.clientX - startX) * step * mult * 1000) / 1000;
      if (onDelta) onDelta(delta);
      else onChange(clamp(Math.round((start + delta) * 1000) / 1000));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`num ${className}`} title={title}>
      {label && <span onPointerDown={onScrub}>{label}</span>}
      <input
        value={shown}
        placeholder={mixed ? 'Mixto' : undefined}
        onChange={(e) => setEditing(e.target.value)}
        onFocus={(e) => {
          setEditing(mixed ? '' : fmt(value, digits));
          e.target.select();
        }}
        onBlur={() => {
          if (editing !== null && !cancelled.current) commit(editing);
          cancelled.current = false;
          setEditing(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            if (onDelta) {
              onDeltaStart?.();
              onDelta(d);
              setEditing(null);
              return;
            }
            const v = clamp(Math.round((value + d) * 1000) / 1000);
            onChange(v);
            setEditing(fmt(v, digits));
          }
        }}
      />
    </div>
  );
}

export function ColorField({ value, onChange, className = '' }: { value: Vec; onChange: (v: Vec) => void; className?: string }) {
  const hex = rgbHex(value);
  const [editing, setEditing] = useState<string | null>(null);
  const pickerOpen = useRef(false);
  return (
    <div className={`color-field ${className}`}>
      <input
        type="color"
        value={hex}
        onFocus={() => {
          if (!pickerOpen.current) {
            pickerOpen.current = true;
            useStore.getState().beginGesture();
          }
        }}
        onBlur={() => {
          pickerOpen.current = false;
          useStore.getState().endGesture();
        }}
        onChange={(e) => {
          const rgb = hexRgb(e.target.value);
          if (rgb) onChange(rgb);
        }}
      />
      <input
        type="text"
        size={7}
        value={editing ?? hex.slice(1)}
        maxLength={7}
        onFocus={(e) => {
          setEditing(hex.slice(1));
          e.target.select();
        }}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => {
          const rgb = editing !== null ? hexRgb(editing) : null;
          if (rgb && rgbHex(rgb) !== hex) onChange(rgb);
          setEditing(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

/** Rombo de keyframe: vacío (estática), medio (animada) o lleno (hay keyframe aquí). */
export function KeyButton({ node, path }: { node: Node; path: PropPath }) {
  const frame = useStore((s) => s.frame);
  const p = getProp(node, path);
  if (!p) return <span />;
  const animated = p.keys.length > 0;
  const here = animated && !!keyAt(p, frame);
  return (
    <button
      className={`keybtn ${animated ? 'animated' : ''}`}
      title={here ? 'Quitar keyframe de este frame' : animated ? 'Añadir keyframe en este frame' : 'Animar esta propiedad (crea el primer keyframe)'}
      onClick={() => toggleNodeKey(node.id, path)}
    >
      {here ? Icon.diamond(12) : animated ? Icon.diamondHalf(12) : Icon.diamondOutline(12)}
    </button>
  );
}

export function KeyNav({ node, path }: { node: Node; path: PropPath }) {
  const frame = useStore((s) => s.frame);
  const p = getProp(node, path);
  if (!p) return null;
  const prev = prevKeyFrame(p, frame);
  const next = nextKeyFrame(p, frame);
  return (
    <div className="keynav">
      <button title="Keyframe anterior" disabled={prev === undefined} onClick={() => prev !== undefined && useStore.getState().setFrame(prev)}>
        {Icon.prev(12)}
      </button>
      <KeyButton node={node} path={path} />
      <button title="Keyframe siguiente" disabled={next === undefined} onClick={() => next !== undefined && useStore.getState().setFrame(next)}>
        {Icon.next(12)}
      </button>
    </div>
  );
}

export interface FieldSpec {
  label: string;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  /** Se muestra valor ÷ factor (p. ej. escala 200 % como ×2). */
  factor?: number;
}

/** Fila del inspector para una propiedad animable. */
export function PropRow({
  node,
  path,
  label,
  fields,
  color,
  link,
}: {
  node: Node;
  path: PropPath;
  label: string;
  fields?: FieldSpec[];
  color?: boolean;
  link?: boolean;
}) {
  const frame = useStore((s) => s.frame);
  const pixel = useStore((s) => s.doc.pixel);
  const [linked, setLinked] = useState(true);
  const p = getProp(node, path);
  if (!p) return null;
  // En pixel art se muestra el píxel entero que se dibuja, no el valor intermedio.
  const snap = pixel && (path === 'transform.position' || path === 'transform.anchor');
  const value = snap ? evalProp(p, Math.floor(frame + 1e-6)).map(Math.round) : evalProp(p, frame);
  const animated = p.keys.length > 0;
  const keyed = animated && !!keyAt(p, frame);
  const cls = `${animated ? 'animated' : ''} ${keyed ? 'keyed' : ''}`;
  const set = (v: Vec) => setNodeProp(node.id, path, v);

  return (
    <div className="row">
      <KeyButton node={node} path={path} />
      <div className="row-label" title={label}>
        {label}
        {link && (
          <button
            className="btn small"
            style={{ height: 18, padding: '0 3px', marginLeft: 2, color: linked ? 'var(--accent-2)' : 'var(--text-3)' }}
            title={linked ? 'Proporcional: activado' : 'Proporcional: desactivado'}
            onClick={() => setLinked(!linked)}
          >
            {linked ? Icon.link(12) : Icon.unlink(12)}
          </button>
        )}
      </div>
      <div className="fields">
        {color ? (
          <ColorField value={value} onChange={set} className={cls} />
        ) : (
          (fields ?? []).map((f, i) => (
            <NumberField
              key={i}
              label={f.label}
              value={(value[i] ?? 0) / (f.factor ?? 1)}
              step={f.step}
              min={f.min}
              max={f.max}
              digits={f.digits}
              className={cls}
              onChange={(raw) => {
                const v = raw * (f.factor ?? 1);
                const next = [...value];
                if (link && linked && value.length === 2 && value[i] !== 0) {
                  const k = v / value[i];
                  next[0] = Math.round(value[0] * k * 100) / 100;
                  next[1] = Math.round(value[1] * k * 100) / 100;
                  next[i] = v;
                } else next[i] = v;
                set(next);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Fila del inspector para varias capas a la vez. */
export function MultiPropRow({ nodes, path, label, fields, link }: { nodes: Node[]; path: PropPath; label: string; fields: FieldSpec[]; link?: boolean }) {
  const frame = useStore((s) => s.frame);
  const pixel = useStore((s) => s.doc.pixel);
  const [linked, setLinked] = useState(true);
  const base = useRef<Vec[]>([]);
  const targets = nodes.filter((n) => !!getProp(n, path));
  if (!targets.length) return null;
  const snap = pixel && (path === 'transform.position' || path === 'transform.anchor');
  const valueOf = (n: Node) => {
    const p = getProp(n, path)!;
    return snap ? evalProp(p, Math.floor(frame + 1e-6)).map(Math.round) : evalProp(p, frame);
  };
  const values = targets.map(valueOf);
  const props = targets.map((n) => getProp(n, path)!);
  const animated = props.some((p) => p.keys.length > 0);
  const keyedAll = props.every((p) => !!keyAt(p, frame));
  const cls = `${animated ? 'animated' : ''} ${keyedAll && animated ? 'keyed' : ''}`;
  const proportional = !!link && linked && values[0].length === 2;

  const setAbsolute = (i: number, v: number) =>
    setManyProps(
      targets.map((n, j) => {
        const cur = values[j];
        let next = [...cur];
        if (proportional && cur[i] !== 0) next = cur.map((x, k) => (k === i ? v : Math.round(((x * v) / cur[i]) * 100) / 100));
        else next[i] = v;
        return { nodeId: n.id, path, value: next };
      }),
    );
  const setRelative = (i: number, d: number) =>
    setManyProps(
      targets.map((n, j) => {
        const b = base.current[j] ?? values[j];
        let next = [...b];
        if (proportional && b[i] !== 0) {
          const k = (b[i] + d) / b[i];
          next = b.map((x) => Math.round(x * k * 100) / 100);
        } else next[i] = b[i] + d;
        return { nodeId: n.id, path, value: next };
      }),
    );

  return (
    <div className="row">
      <button
        className={`keybtn ${animated ? 'animated' : ''}`}
        title={keyedAll && animated ? 'Quitar el keyframe de este frame en todas' : 'Añadir keyframe en este frame a todas'}
        onClick={() => toggleKeysMany(targets.map((n) => n.id), path, keyedAll && animated)}
      >
        {keyedAll && animated ? Icon.diamond(12) : animated ? Icon.diamondHalf(12) : Icon.diamondOutline(12)}
      </button>
      <div className="row-label" title={label}>
        {label}
        {link && (
          <button
            className="btn small"
            style={{ height: 18, padding: '0 3px', marginLeft: 2, color: linked ? 'var(--accent-2)' : 'var(--text-3)' }}
            title={linked ? 'Proporcional: activado' : 'Proporcional: desactivado'}
            onClick={() => setLinked(!linked)}
          >
            {linked ? Icon.link(12) : Icon.unlink(12)}
          </button>
        )}
      </div>
      <div className="fields">
        {fields.map((f, i) => {
          const factor = f.factor ?? 1;
          const mixed = values.some((v) => Math.abs(v[i] - values[0][i]) > 1e-6);
          return (
            <NumberField
              key={i}
              label={f.label}
              value={values[0][i] / factor}
              mixed={mixed}
              step={f.step}
              min={f.min}
              max={f.max}
              digits={f.digits}
              className={cls}
              onChange={(v) => setAbsolute(i, v * factor)}
              onDeltaStart={() => (base.current = targets.map(valueOf))}
              onDelta={(d) => setRelative(i, d * factor)}
            />
          );
        })}
      </div>
    </div>
  );
}
