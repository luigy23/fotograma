import { useRef } from 'react';
import { useStore } from '../store/store';
import { downloadText, importImageFile, importSvgText, openLottieText, projectText, safeFileName } from '../store/actions';
import { makeDoc } from '../model/defaults';
import { Icon } from './icons';

export function handleFile(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
    file.text().then((t) => importSvgText(t, file.name));
  } else if (file.type.startsWith('image/')) {
    importImageFile(file);
  } else if (name.endsWith('.json') || file.type === 'application/json') {
    file.text().then((t) => {
      const st = useStore.getState();
      if (st.doc.nodes.length && !confirm('¿Abrir este archivo? Se reemplaza lo que tienes ahora (puedes deshacer con ⌘Z).')) return;
      openLottieText(t);
    });
  } else {
    useStore.getState().notify('Formato no soportado. Usa SVG, PNG, JPG o Lottie JSON.', 'error');
  }
}

/** Varios archivos a la vez: si son 2+ imágenes, pregunta si van como capas o como secuencia. */
export function handleFiles(files: File[]) {
  const images = files.filter((f) => f.type.startsWith('image/') && f.type !== 'image/svg+xml' && !f.name.toLowerCase().endsWith('.svg'));
  if (images.length > 1) {
    useStore.getState().setPendingImages(images);
    files = files.filter((f) => !images.includes(f));
  }
  for (const f of files) handleFile(f);
}

export function saveProject() {
  const doc = useStore.getState().doc;
  downloadText(projectText(), `${safeFileName(doc.name)}.fotograma.json`);
  useStore.getState().notify('Proyecto guardado. Ábrelo con «Abrir» para seguir editando.', 'ok');
}

export function TopBar() {
  const doc = useStore((s) => s.doc);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState;
  const openRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <svg width="12" height="13" viewBox="0 0 12 13">
            <path d="M1 0h10v3.2H4.6v2.3h5.6v3.1H4.6V13H1z" fill="white" />
          </svg>
        </span>
        Fotograma
      </div>
      <input className="doc-name" value={doc.name} onChange={(e) => st().update((d) => void (d.name = e.target.value))} title="Nombre de la animación" />
      <span className="sep" />
      <button
        className="btn"
        onClick={() => {
          if (doc.nodes.length && !confirm('¿Empezar una animación nueva? La actual se puede recuperar con ⌘Z.')) return;
          st().replaceDoc(makeDoc());
        }}
      >
        {Icon.file(15)} <span className="only-wide">Nuevo</span>
      </button>
      <button className="btn" onClick={() => openRef.current?.click()} title="Abrir un proyecto de Fotograma o un Lottie JSON">
        {Icon.upload(15)} <span className="only-wide">Abrir</span>
      </button>
      <button className="btn" onClick={saveProject} title="Guardar el proyecto para seguir editándolo (⌘S)">
        {Icon.file(15)} <span className="only-wide">Guardar</span>
      </button>
      <button className="btn" onClick={() => importRef.current?.click()} title="Importar SVG o imagen al lienzo">
        {Icon.image(15)} <span className="only-wide">Importar SVG o imagen</span>
      </button>
      <span className="sep" />
      <button className="btn icon" disabled={!canUndo} onClick={() => st().undo()} title="Deshacer (⌘Z)">
        {Icon.undo(15)}
      </button>
      <button className="btn icon" disabled={!canRedo} onClick={() => st().redo()} title="Rehacer (⇧⌘Z)">
        {Icon.redo(15)}
      </button>
      <span className="spacer" />
      <button className="btn primary" onClick={() => st().setPreviewOpen(true)} title="Vista previa y exportar (⌘E)">
        {Icon.download(15)} Exportar JSON
      </button>
      <input
        ref={openRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </header>
  );
}
