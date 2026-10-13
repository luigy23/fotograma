import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { importImageSequence, importImagesAsLayers } from '../store/actions';

/** Varias imágenes a la vez: ¿capas apiladas o secuencia fotograma a fotograma? */
export function ImportDialog() {
  const files = useStore((s) => s.pendingImages);
  const fps = useStore((s) => s.doc.fps);
  const setPending = useStore((s) => s.setPendingImages);
  const [mode, setMode] = useState<'layers' | 'sequence'>('layers');
  const [each, setEach] = useState(2);

  useEffect(() => {
    if (files) setEach(Math.max(1, Math.round(fps / 12)));
  }, [files, fps]);

  if (!files) return null;
  const names = [...files].map((f) => f.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const go = () => {
    setPending(null);
    if (mode === 'layers') importImagesAsLayers(files);
    else importImageSequence(files, each);
  };
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && setPending(null)}>
      <div className="modal small-modal" role="dialog" aria-label="Importar imágenes">
        <div className="modal-head">{files.length} imágenes</div>
        <div className="import-body">
          <label className={`choice ${mode === 'layers' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'layers'} onChange={() => setMode('layers')} />
            <div>
              <b>Como capas</b>
              <span>Una encima de otra, para animar cada parte (cuerpo, ojos, orbe…). La primera por nombre queda abajo.</span>
            </div>
          </label>
          <label className={`choice ${mode === 'sequence' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'sequence'} onChange={() => setMode('sequence')} />
            <div>
              <b>Como secuencia</b>
              <span>Una tras otra en el tiempo, fotograma a fotograma.</span>
              {mode === 'sequence' && (
                <span className="each">
                  Cada imagen dura
                  <input type="number" min={1} max={120} value={each} onChange={(e) => setEach(Math.max(1, Number(e.target.value) || 1))} />
                  frames ({Math.round((each / fps) * 1000)} ms)
                </span>
              )}
            </div>
          </label>
          <div className="file-list">{names.join(' · ')}</div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setPending(null)}>
            Cancelar
          </button>
          <button className="btn primary" onClick={go}>
            Importar
          </button>
        </div>
      </div>
    </div>
  );
}
