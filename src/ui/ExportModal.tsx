import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import lottie from 'lottie-web/build/player/lottie_light';
import { useStore } from '../store/store';
import { downloadText, safeFileName } from '../store/actions';
import { halos, ensureHalosAsync } from '../store/bake';
import { finalExport, buildDotLottie, type FinalExport } from '../io/finalExport';
import { prepareExport, suggestedOutputScale } from '../io/prepare';
import type { Doc } from '../model/types';
import { Icon } from './icons';

// Panel de exportación: vista previa real dentro de un móvil, semáforo de
// calidad y las dos salidas (Lottie y sprite sheet). Se carga aparte.

type Level = 'ok' | 'warn' | 'bad';

interface Check {
  level: Level;
  label: string;
  value: string;
  detail?: string;
}

function countIn(json: unknown, test: (o: Record<string, unknown>) => boolean): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (test(x as Record<string, unknown>)) n++;
      Object.values(x).forEach(walk);
    }
  };
  walk(json);
  return n;
}

function checksFor(doc: Doc, out: FinalExport): Check[] {
  const json = out.json;
  const kb = out.bytes / 1024;
  const layers = (json.layers as unknown[]).length;
  const gradients = countIn(json, (o) => o.ty === 'gf' || o.ty === 'gs');
  const masks = countIn(json, (o) => Array.isArray(o.masksProperties) && (o.masksProperties as unknown[]).length > 0);
  const vertices = countVertices(json);
  const imagePixels = ((json.assets as { w?: number; h?: number }[]) ?? []).reduce((a, x) => a + (x.w ?? 0) * (x.h ?? 0), 0);

  // Aviso de rendimiento para Android de gama baja: suma de lo que más pesa al dibujar.
  const reasons: string[] = [];
  let heavy = 0;
  const add = (points: number, reason: string) => {
    heavy += points;
    reasons.push(reason);
  };
  if (layers > 60) add(2, `${layers} capas`);
  else if (layers > 35) add(1, `${layers} capas`);
  if (imagePixels > 4_000_000) add(2, 'imágenes muy grandes');
  else if (imagePixels > 1_500_000) add(1, 'imágenes grandes');
  if (gradients > 4) add(1, `${gradients} degradados`);
  if (masks > 0) add(1, `${masks} máscaras`);
  if (vertices > 4000) add(1, 'trazos con muchos puntos');
  if (doc.fps > 30) add(1, `${doc.fps} fps`);
  if (kb > 300) add(1, 'archivo pesado');

  return [
    {
      level: out.errors.length ? 'bad' : 'ok',
      label: 'Estándar Lottie 1.0',
      value: out.errors.length ? `${out.errors.length} problemas` : 'Cumple',
      detail: out.errors.slice(0, 5).join(' · ') || undefined,
    },
    { level: kb < 50 ? 'ok' : kb < 150 ? 'warn' : 'bad', label: 'Peso', value: kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`, detail: kb >= 50 ? 'Por debajo de 50 KB carga al instante.' : undefined },
    { level: layers <= 35 ? 'ok' : layers <= 60 ? 'warn' : 'bad', label: 'Capas', value: String(layers) },
    {
      level: masks ? 'warn' : gradients > 4 ? 'warn' : 'ok',
      label: 'Máscaras y degradados',
      value: `${masks} · ${gradients}`,
    },
    {
      level: heavy === 0 ? 'ok' : heavy <= 2 ? 'warn' : 'bad',
      label: 'Android gama baja (A52)',
      value: heavy === 0 ? 'Fluido' : heavy <= 2 ? 'Puede ir justo' : 'Pesado',
      detail: reasons.length ? `Por: ${reasons.join(', ')}.` : undefined,
    },
  ];
}

function countVertices(json: unknown): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (o.ty === 'sh') {
        const k = (o.ks as { k?: { v?: unknown[] } })?.k;
        if (k && Array.isArray(k.v)) n += k.v.length;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(json);
  return n;
}

function LottiePane({ doc, out, appWidth, setAppWidth, dark, setDark }: { doc: Doc; out: FinalExport; appWidth: number; setAppWidth: (n: number) => void; dark: boolean; setDark: (b: boolean) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useEffect(() => {
    if (!boxRef.current) return;
    const anim = lottie.loadAnimation({ container: boxRef.current, renderer: 'svg', loop: true, autoplay: true, animationData: JSON.parse(out.text) });
    return () => anim.destroy();
  }, [out]);

  // Se mide al montar (antes de pintar) y cada vez que cambia el tamaño: el
  // ResizeObserver solo no basta en pestañas de fondo o sin ventana.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setFit(Math.min(1, (el.clientHeight - 56) / 868, (el.clientWidth - 24) / 414));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const w = out.json.w as number;
  const h = out.json.h as number;
  return (
    <div className="phone-area" ref={areaRef}>
      <div className="phone-bar">
        <span>Ancho en la app</span>
        <input type="number" min={16} max={390} value={appWidth} onChange={(e) => setAppWidth(Math.max(16, Math.min(390, Number(e.target.value) || 16)))} />
        <span>dp</span>
        <button className="btn small outline" onClick={() => setDark(!dark)}>
          Fondo {dark ? 'claro' : 'oscuro'}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {fit < 0.999 ? `Móvil al ${Math.round(fit * 100)} %` : 'Tamaño real'}
        </span>
      </div>
      <div className="phone" style={{ transform: `scale(${fit})` }}>
        <div className={`phone-screen ${dark ? 'dark' : ''} ${doc.pixel ? 'pixel' : ''}`}>
          <div ref={boxRef} style={{ width: appWidth, height: (appWidth * h) / w }} />
        </div>
      </div>
    </div>
  );
}

function SpritePane({ doc }: { doc: Doc }) {
  const notify = useStore((s) => s.notify);
  const [scale, setScale] = useState(1);
  const [segment, setSegment] = useState('all');
  const [sheet, setSheet] = useState<Awaited<ReturnType<typeof import('../io/raster').buildSpriteSheet>> | null>(null);
  const [busy, setBusy] = useState(false);
  const base = safeFileName(doc.name);

  const range = useMemo(() => {
    const sg = doc.segments.find((s) => s.id === segment);
    return sg ? { from: sg.start, to: sg.end } : { from: 0, to: doc.duration };
  }, [doc, segment]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    (async () => {
      await ensureHalosAsync(doc);
      const { buildSpriteSheet } = await import('../io/raster');
      const prepared = prepareExport(doc, { trim: false, outputScale: 1, keepEffects: true }, halos).doc;
      const s = await buildSpriteSheet(prepared, halos, { scale, from: range.from, to: range.to, fileBase: base, segments: doc.segments });
      if (!cancelled) setSheet(s);
      setBusy(false);
    })().catch((e) => {
      setBusy(false);
      notify((e as Error).message, 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [doc, scale, range, base, notify]);

  return (
    <>
      <div className="sheet-area">
        {sheet ? <img src={sheet.url} alt="Sprite sheet" className="sheet-img" /> : <span className="hint">Generando…</span>}
        {busy && sheet && <span className="busy-tag">Actualizando…</span>}
      </div>
      <div className="export-side">
        <div className="row plain">
          <span className="row-label">Escala</span>
          <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {[1, 2, 4, 8].map((k) => (
              <option key={k} value={k}>
                ×{k}
                {k === 1 ? ' (nativa)' : ''} · {doc.width * k}×{doc.height * k}
              </option>
            ))}
          </select>
        </div>
        <div className="row plain">
          <span className="row-label">Tramo</span>
          <select className="select" value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="all">Toda la animación</option>
            {doc.segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.start}–{s.end - 1})
              </option>
            ))}
          </select>
        </div>
        {sheet && (
          <>
            <div className="stat">
              Fotogramas <b>{sheet.frames}</b>
            </div>
            <div className="stat">
              Fotograma{' '}
              <b>
                {sheet.frameWidth}×{sheet.frameHeight}
              </b>
            </div>
            <div className="stat">
              Rejilla{' '}
              <b>
                {sheet.columns}×{sheet.rows}
              </b>
            </div>
            <div className="stat">
              Peso <b>{(sheet.png.size / 1024).toFixed(1)} KB</b>
            </div>
          </>
        )}
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={!sheet}
          style={{ justifyContent: 'center', height: 36 }}
          onClick={() => {
            if (!sheet) return;
            const a = document.createElement('a');
            a.href = sheet.url;
            a.download = `${base}.png`;
            a.click();
            downloadText(JSON.stringify(sheet.meta, null, 2), `${base}.json`);
            notify('Hoja de sprites y sus datos descargados.', 'ok');
          }}
        >
          {Icon.download(15)} Descargar hoja + datos
        </button>
        <button
          className="btn outline"
          style={{ justifyContent: 'center' }}
          onClick={async () => {
            const { buildFramesZip } = await import('../io/raster');
            const prepared = prepareExport(doc, { trim: false, outputScale: 1, keepEffects: true }, halos).doc;
            const zip = await buildFramesZip(prepared, halos, { scale, from: range.from, to: range.to, fileBase: base });
            const url = URL.createObjectURL(zip);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${base}-fotogramas.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
          }}
        >
          {Icon.download(14)} Fotogramas sueltos (.zip)
        </button>
        <p className="hint">Cada fotograma a la resolución del dibujo, sin suavizado. El .json trae tamaño, fps y los segmentos con su primer y último fotograma.</p>
      </div>
    </>
  );
}

export default function ExportModal() {
  const doc = useStore((s) => s.doc);
  const setOpen = useStore((s) => s.setPreviewOpen);
  const notify = useStore((s) => s.notify);
  const [tab, setTab] = useState<'lottie' | 'sprite'>('lottie');
  const [trim, setTrim] = useState(true);
  const [outScale, setOutScale] = useState(() => suggestedOutputScale(doc));
  const [out, setOut] = useState<FinalExport | null>(null);
  const [dark, setDark] = useState(false);
  const [appWidth, setAppWidth] = useState(() => Math.round(Math.min(390, doc.pixel ? 200 : doc.width / 2)));
  const fileBase = safeFileName(doc.name);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureHalosAsync(doc);
      const res = await finalExport(doc, { trim, outputScale: outScale }, halos);
      if (!cancelled) setOut(res);
    })().catch((e) => notify((e as Error).message, 'error'));
    return () => {
      cancelled = true;
    };
  }, [doc, trim, outScale, notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const checks = out ? checksFor(doc, out) : [];
  const r = out?.prepared.range;
  const trimmed = !!r && (r.from !== 0 || r.to !== r.original);
  const rm = out?.prepared.removed;
  const optimized = rm ? [rm.hidden && `${rm.hidden} capa${rm.hidden > 1 ? 's' : ''} oculta${rm.hidden > 1 ? 's' : ''}`, rm.emptyGroups && `${rm.emptyGroups} grupo${rm.emptyGroups > 1 ? 's' : ''} vacío${rm.emptyGroups > 1 ? 's' : ''}`, rm.keys && `${rm.keys} keyframe${rm.keys > 1 ? 's' : ''} que no cambiaba${rm.keys > 1 ? 'n' : ''} nada`].filter(Boolean) : [];

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal export-modal" role="dialog" aria-label="Exportar">
        <div className="modal-head">
          Exportar
          <div className="tabs">
            <button className={tab === 'lottie' ? 'on' : ''} onClick={() => setTab('lottie')}>
              Lottie
            </button>
            <button className={tab === 'sprite' ? 'on' : ''} onClick={() => setTab('sprite')}>
              Sprite sheet
            </button>
          </div>
          <span className="spacer" />
          <button className="btn icon" onClick={() => setOpen(false)} title="Cerrar (Esc)">
            {Icon.x(16)}
          </button>
        </div>
        <div className="modal-body export-body">
          {tab === 'lottie' ? (
            <>
              {out ? <LottiePane doc={doc} out={out} appWidth={appWidth} setAppWidth={setAppWidth} dark={dark} setDark={setDark} /> : <div className="phone-area" />}
              <div className="export-side">
                <div className="checks">
                  {checks.map((c) => (
                    <div key={c.label} className="check-row" title={c.detail}>
                      <span className={`dot ${c.level}`} />
                      <span className="check-label">{c.label}</span>
                      <b>{c.value}</b>
                      {c.detail && c.level !== 'ok' && <span className="check-detail">{c.detail}</span>}
                    </div>
                  ))}
                </div>
                <label className="opt">
                  <input type="checkbox" className="check" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
                  <span>
                    Recortar silencios
                    {trimmed && r ? (
                      <small>
                        Queda de {r.from} a {r.to} ({r.to - r.from} de {r.original} frames)
                      </small>
                    ) : (
                      <small>No hay tramos quietos al principio ni al final</small>
                    )}
                  </span>
                </label>
                {doc.pixel && (
                  <div className="row plain">
                    <span className="row-label">Salida pixel</span>
                    <select className="select" value={outScale} onChange={(e) => setOutScale(Number(e.target.value))}>
                      {[1, 2, 4, 8, 16].map((k) => (
                        <option key={k} value={k}>
                          ×{k} · {doc.width * k}×{doc.height * k}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {optimized.length > 0 && <p className="hint">Optimizado: se quitaron {optimized.join(', ')}.</p>}
                {doc.pixel && <p className="hint">Posiciones horneadas a píxel entero e imágenes ampliadas sin suavizado.</p>}
                {out && out.warnings.length > 0 && (
                  <ul className="issue-list">
                    {out.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <span className="spacer" />
                <button
                  className="btn primary"
                  disabled={!out}
                  style={{ justifyContent: 'center', height: 36 }}
                  onClick={() => {
                    if (!out) return;
                    downloadText(out.text, `${fileBase}.json`);
                    notify(`Descargado ${fileBase}.json`, 'ok');
                  }}
                >
                  {Icon.download(15)} Descargar .json
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn outline"
                    disabled={!out}
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={async () => {
                      if (!out) return;
                      const blob = await buildDotLottie(out.text, fileBase);
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${fileBase}.lottie`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 2000);
                    }}
                  >
                    .lottie
                  </button>
                  <button
                    className="btn outline"
                    disabled={!out}
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={async () => {
                      if (!out) return;
                      try {
                        await navigator.clipboard.writeText(out.text);
                        notify('JSON copiado.', 'ok');
                      } catch {
                        notify('El navegador no dejó copiar; usa Descargar.', 'error');
                      }
                    }}
                  >
                    Copiar JSON
                  </button>
                </div>
                <details className="dev-notes">
                  <summary>Para el dev</summary>
                  <p>
                    <code>Lottie.asset('assets/animations/{fileBase}.json'{doc.pixel ? ', filterQuality: FilterQuality.none' : ''})</code>
                  </p>
                  {doc.segments.length > 0 && (
                    <p>
                      Segmentos como markers: {doc.segments.map((s) => `«${s.name}»`).join(', ')}. Se reproducen con <code>composition.getMarker('{doc.segments[0].name}')</code>.
                    </p>
                  )}
                </details>
              </div>
            </>
          ) : (
            <SpritePane doc={doc} />
          )}
        </div>
      </div>
    </div>
  );
}
