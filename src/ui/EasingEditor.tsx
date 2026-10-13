import { useRef } from 'react';
import type { Ease, Point } from '../model/types';
import { EASE_PRESETS } from '../model/animate';
import { useStore } from '../store/store';
import { setSelectedKeysEase } from '../store/actions';

const W = 260;
const H = 190;
const PAD_X = 22;
const Y_MIN = -0.6;
const Y_MAX = 1.6;

const sx = (x: number) => PAD_X + x * (W - PAD_X * 2);
const sy = (y: number) => H - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * H;
const ix = (px: number) => (px - PAD_X) / (W - PAD_X * 2);
const iy = (py: number) => Y_MIN + ((H - py) / H) * (Y_MAX - Y_MIN);

function MiniCurve({ ease }: { ease: Ease }) {
  const w = 34;
  const h = 20;
  const y = (v: number) => h - 3 - v * (h - 6);
  return (
    <svg width={w} height={h}>
      <path
        d={`M2 ${y(0)} C${2 + ease.o[0] * (w - 4)} ${y(ease.o[1])} ${2 + ease.i[0] * (w - 4)} ${y(ease.i[1])} ${w - 2} ${y(1)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      />
    </svg>
  );
}

const same = (a: Ease, b: Ease) =>
  Math.abs(a.o[0] - b.o[0]) < 1e-3 && Math.abs(a.o[1] - b.o[1]) < 1e-3 && Math.abs(a.i[0] - b.i[0]) < 1e-3 && Math.abs(a.i[1] - b.i[1]) < 1e-3;

export function EasingEditor({ ease, hold, count }: { ease: Ease; hold: boolean; count: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const startDrag = (which: 'o' | 'i') => (e: React.PointerEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    st.beginGesture();
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = W / rect.width;
    const move = (ev: PointerEvent) => {
      const px = (ev.clientX - rect.left) * scale;
      const py = (ev.clientY - rect.top) * scale;
      const pt: Point = [Math.max(0, Math.min(1, ix(px))), Math.max(-1, Math.min(2, iy(py)))];
      const round = (p: Point): Point => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
      setSelectedKeysEase(which === 'o' ? { o: round(pt), i: ease.i } : { o: ease.o, i: round(pt) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e.nativeEvent);
  };

  const curve = `M${sx(0)} ${sy(0)} C${sx(ease.o[0])} ${sy(ease.o[1])} ${sx(ease.i[0])} ${sy(ease.i[1])} ${sx(1)} ${sy(1)}`;
  const cssEase = `cubic-bezier(${ease.o[0]}, ${ease.o[1]}, ${ease.i[0]}, ${ease.i[1]})`;

  return (
    <div>
      <div className="ease-presets">
        {EASE_PRESETS.map((p) => (
          <button key={p.id} className={`ease-chip ${!hold && same(p.ease, ease) ? 'on' : ''}`} onClick={() => setSelectedKeysEase(p.ease)} title={p.label}>
            <MiniCurve ease={p.ease} />
            {p.label}
          </button>
        ))}
        <button className={`ease-chip ${hold ? 'on' : ''}`} onClick={() => setSelectedKeysEase(ease, !hold)} title="El valor salta de golpe al siguiente keyframe">
          <svg width={34} height={20}>
            <path d="M2 17H18V3H32" fill="none" stroke="currentColor" strokeWidth={1.6} />
          </svg>
          A saltos
        </button>
      </div>
      {!hold && (
        <details className="ease-manual">
          <summary>Ajustar la curva a mano</summary>
          <svg ref={svgRef} className="ease-editor" viewBox={`0 0 ${W} ${H}`}>
            <rect x={sx(0)} y={sy(1)} width={sx(1) - sx(0)} height={sy(0) - sy(1)} fill="rgba(255,255,255,0.025)" stroke="#2c2d38" />
            <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="#2c2d38" strokeDasharray="3 3" />
            <line x1={sx(0)} y1={sy(0)} x2={sx(ease.o[0])} y2={sy(ease.o[1])} stroke="#6c6d7e" />
            <line x1={sx(1)} y1={sy(1)} x2={sx(ease.i[0])} y2={sy(ease.i[1])} stroke="#6c6d7e" />
            <path d={curve} fill="none" stroke="#f5b84a" strokeWidth={2.2} />
            <circle cx={sx(0)} cy={sy(0)} r={3} fill="#a4a5b5" />
            <circle cx={sx(1)} cy={sy(1)} r={3} fill="#a4a5b5" />
            <circle cx={sx(ease.o[0])} cy={sy(ease.o[1])} r={6} fill="#7b6cff" stroke="#fff" strokeWidth={1.5} style={{ cursor: 'grab' }} onPointerDown={startDrag('o')} />
            <circle cx={sx(ease.i[0])} cy={sy(ease.i[1])} r={6} fill="#7b6cff" stroke="#fff" strokeWidth={1.5} style={{ cursor: 'grab' }} onPointerDown={startDrag('i')} />
          </svg>
          <div style={{ position: 'relative', height: 18, margin: '8px 2px 0', borderRadius: 9, background: 'var(--panel-2)' }}>
            <div
              key={cssEase}
              style={{
                position: 'absolute',
                top: 3,
                left: 3,
                width: 12,
                height: 12,
                borderRadius: 6,
                background: 'var(--key)',
                animation: `ease-demo 1.2s ${cssEase} infinite alternate`,
              }}
            />
            <style>{`@keyframes ease-demo { from { left: 3px } to { left: calc(100% - 15px) } }`}</style>
          </div>
        </details>
      )}
      <p className="hint">
        {count === 1 ? 'Curva del tramo que sale de este keyframe.' : `Se aplica a ${count} keyframes.`} {!hold && <span style={{ fontFamily: 'var(--mono)' }}>{ease.o.concat(ease.i).map((n) => +n.toFixed(2)).join(', ')}</span>}
      </p>
    </div>
  );
}
