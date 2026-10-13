import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from './store/store';
import { deleteSelection, duplicateSelection, groupSelection, importSvgText, openExample, reorderSelection, setManyProps, setNodeTime, ungroupSelection } from './store/actions';
import { findNode, parentMatrix } from './model/tree';
import { evalProp } from './model/animate';
import { applyLinear, invert } from './model/matrix';
import { TopBar, handleFile, handleFiles, saveProject } from './ui/TopBar';
import { ImportDialog } from './ui/ImportDialog';
import { clipText, copySelection, parseClip, pasteClip } from './store/clipboard';
import { LayersPanel } from './ui/LayersPanel';
import { Canvas, spaceState } from './ui/Canvas';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { ContextMenu } from './ui/ContextMenu';
import type { PropPath } from './model/types';

const ExportModal = lazy(() => import('./ui/ExportModal'));

function Toast() {
  const notice = useStore((s) => s.notice);
  if (!notice) return null;
  return (
    <div key={notice.id} className={`toast ${notice.kind}`} role="status">
      {notice.text}
    </div>
  );
}

function usePlayback() {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = useStore.getState();
      const dt = (now - last) / 1000;
      last = now;
      let f = st.frame + dt * st.doc.fps;
      const r = st.playRange;
      if (r) {
        // Segmento elegido: se repite solo ese tramo.
        if (f < r.start || f >= r.end) f = r.start + ((((f - r.start) % (r.end - r.start)) + (r.end - r.start)) % (r.end - r.start));
      } else if (f >= st.doc.duration) {
        if (st.loop) f = f % st.doc.duration;
        else {
          st.setFrame(st.doc.duration);
          st.setPlaying(false);
          return;
        }
      }
      useStore.setState({ frame: f });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      const st = useStore.getState();
      st.setFrame(Math.round(st.frame));
    };
  }, [playing]);
}

const clipState: { pending: ReturnType<typeof copySelection>; copySeen: boolean; pasteSeen: boolean } = { pending: null, copySeen: true, pasteSeen: true };

const typing = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

function nudge(dx: number, dy: number) {
  const st = useStore.getState();
  const changes: { nodeId: string; path: PropPath; value: number[] }[] = [];
  for (const id of st.selection) {
    const n = findNode(st.doc, id);
    if (!n || n.locked) continue;
    const inv = invert(parentMatrix(st.doc, id, st.frame));
    const d = applyLinear(inv, [dx, dy]);
    const p = evalProp(n.transform.position, st.frame);
    changes.push({ nodeId: id, path: 'transform.position', value: [p[0] + d[0], p[1] + d[1]] });
  }
  if (changes.length) setManyProps(changes);
}

function useShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (st.previewOpen || st.pendingImages) return;

      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && k === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      // ⌘C / ⌘X / ⌘V: se atienden aquí y, si el navegador también lanza su
      // evento de copiar o pegar, ese completa el portapapeles del sistema.
      if (mod && (k === 'c' || k === 'x')) {
        const clip = copySelection(k === 'x');
        if (clip) {
          clipState.pending = clip;
          clipState.copySeen = false;
          setTimeout(() => {
            if (!clipState.copySeen) navigator.clipboard?.writeText(clipText(clip)).catch(() => undefined);
            clipState.pending = null;
          }, 0);
        }
        return;
      }
      if (mod && k === 'v') {
        clipState.pasteSeen = false;
        setTimeout(() => {
          if (!clipState.pasteSeen) pasteClip();
        }, 0);
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        saveProject();
        return;
      }
      if (mod && k === 'e') {
        e.preventDefault();
        st.setPreviewOpen(true);
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        st.setSelection(st.doc.nodes.map((n) => n.id));
        return;
      }
      if (e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        e.preventDefault();
        const f = Math.round(st.frame);
        for (const id of st.selection) {
          const n = st.doc.nodes.find((x) => x.id === id);
          if (!n) continue;
          if (e.code === 'BracketLeft') setNodeTime(id, f, n.outFrame);
          else setNodeTime(id, n.inFrame, f);
        }
        return;
      }
      if (mod && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        reorderSelection(e.key === ']' ? -1 : 1);
        return;
      }
      if (mod) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!e.repeat && !spaceState.down) {
            spaceState.down = true;
            spaceState.used = false;
          }
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          return;
        case 'Escape':
          st.setTool('select');
          if (st.keySelection.length) st.setKeySelection([]);
          else st.setSelection([]);
          return;
        case ',':
        case '.':
        case ';':
        case ':':
        case '<':
        case '>': {
          const back = e.code === 'Comma' || e.key === ',' || e.key === '<' || e.key === ';';
          const d = (back ? -1 : 1) * (e.shiftKey ? 10 : 1);
          st.setPlaying(false);
          st.setFrame(Math.round(st.frame) + d);
          return;
        }
        case 'Home':
          st.setFrame(0);
          return;
        case 'End':
          st.setFrame(st.doc.duration);
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          if (!st.selection.length) {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') st.setFrame(Math.round(st.frame) + (e.key === 'ArrowLeft' ? -step : step));
            return;
          }
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          nudge(dx, dy);
          return;
        }
      }
      const tools: Record<string, 'select' | 'rect' | 'ellipse' | 'polygon' | 'star'> = { v: 'select', r: 'rect', o: 'ellipse', e: 'ellipse', p: 'polygon', s: 'star' };
      if (tools[k] && !e.altKey) st.setTool(tools[k]);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      if (typing(e)) return;
      const st = useStore.getState();
      if (spaceState.down && !spaceState.used && !st.previewOpen) st.setPlaying(!st.playing);
      spaceState.down = false;
    };
    // Pegar: SVG copiado de Figma («Copiar como SVG») o imágenes.
    // Copiar y cortar: capas o keyframes seleccionados, también al portapapeles del sistema.
    const copy = (cut: boolean) => (e: ClipboardEvent) => {
      if (typing(e) || useStore.getState().previewOpen) return;
      clipState.copySeen = true;
      // Si ya se copió con el atajo, solo falta pasarlo al portapapeles del sistema.
      const clip = clipState.pending ?? copySelection(cut);
      clipState.pending = null;
      if (!clip) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', clipText(clip));
    };
    const onCopy = copy(false);
    const onCut = copy(true);
    const paste = (e: ClipboardEvent) => {
      if (typing(e) || useStore.getState().previewOpen) return;
      clipState.pasteSeen = true;
      const data = e.clipboardData;
      if (!data) return;
      const own = parseClip(data.getData('text/plain'));
      if (own) {
        e.preventDefault();
        pasteClip(own);
        return;
      }
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            handleFile(f);
            return;
          }
        }
      }
      const text = data.getData('image/svg+xml') || data.getData('text/plain');
      if (text && /<svg[\s>]/i.test(text)) {
        e.preventDefault();
        importSvgText(text.slice(text.search(/<svg[\s>]/i)), 'Pegado de Figma');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('paste', paste);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('paste', paste);
    };
  }, []);
}

/** Enlaces directos: ?ejemplo abre el ejemplo; ?ejemplo=exportar abre también la exportación. */
function useExampleLink() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('ejemplo')) return;
    openExample().then((ok) => {
      if (!ok) return;
      const st = useStore.getState();
      if (st.doc.nodes[0]) st.setSelection([st.doc.nodes[0].id]);
      const frame = Number(params.get('frame'));
      if (frame) st.setFrame(frame);
      if (params.get('ejemplo') === 'exportar') st.setPreviewOpen(true);
    });
  }, []);
}

export function App() {
  usePlayback();
  useShortcuts();
  useExampleLink();
  const [dragging, setDragging] = useState(false);
  const previewOpen = useStore((s) => s.previewOpen);

  return (
    <div
      className="app"
      onContextMenu={(e) => {
        if (!typing(e.nativeEvent)) e.preventDefault();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        handleFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <TopBar />
      <LayersPanel />
      <div style={{ gridRow: 2, gridColumn: 2, position: 'relative', minWidth: 0, minHeight: 0 }}>
        <Canvas />
        {dragging && <div className="drop-hint">Suelta aquí tu SVG, PNG o Lottie JSON</div>}
      </div>
      <Inspector />
      <Timeline />
      {previewOpen && (
        <Suspense fallback={null}>
          <ExportModal />
        </Suspense>
      )}
      <Toast />
      <ContextMenu />
      <ImportDialog />
    </div>
  );
}
