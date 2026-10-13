import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Doc, PropPath } from '../model/types';
import { makeDoc, normalizeDoc } from '../model/defaults';

export type Tool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'star';

export interface KeyRef {
  nodeId: string;
  path: PropPath;
  keyId: string;
}

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Título de sección (no clicable). */
  header?: boolean;
  indent?: number;
}

export interface Menu {
  x: number;
  y: number;
  items: (MenuItem | 'sep')[];
}

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

interface State {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  gestureBase: Doc | null;
  selection: string[];
  keySelection: KeyRef[];
  frame: number;
  playing: boolean;
  loop: boolean;
  tool: Tool;
  notice: Notice | null;
  previewOpen: boolean;
  timelineOpen: Record<string, boolean>;
  importWarnings: string[];
  menu: Menu | null;
  autoKey: boolean;
  /** Tramo que se repite al reproducir (segmento elegido). */
  playRange: { start: number; end: number } | null;
  pendingImages: File[] | null;
  bakeTick: number;

  update: (recipe: (d: Draft<Doc>) => void) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  replaceDoc: (doc: Doc) => void;
  setSelection: (ids: string[]) => void;
  setKeySelection: (keys: KeyRef[]) => void;
  setFrame: (f: number) => void;
  setPlaying: (p: boolean) => void;
  setLoop: (l: boolean) => void;
  setTool: (t: Tool) => void;
  notify: (text: string, kind?: Notice['kind']) => void;
  setPreviewOpen: (o: boolean) => void;
  toggleTimelineRow: (id: string, open?: boolean) => void;
  setImportWarnings: (w: string[]) => void;
  openMenu: (m: Menu) => void;
  closeMenu: () => void;
  setAutoKey: (v: boolean) => void;
  setPlayRange: (r: { start: number; end: number } | null) => void;
  setPendingImages: (f: File[] | null) => void;
}

// Deshacer sin límite práctico: immer comparte lo que no cambia entre versiones,
// así que cada paso guardado ocupa poco.
const HISTORY_LIMIT = 100_000;
const AUTOSAVE_KEY = 'fotograma:doc';

function loadAutosave(): Doc | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as Doc;
    return Array.isArray(doc.nodes) ? normalizeDoc(doc) : null;
  } catch {
    return null;
  }
}

let noticeId = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  doc: loadAutosave() ?? makeDoc(),
  past: [],
  future: [],
  gestureBase: null,
  selection: [],
  keySelection: [],
  frame: 0,
  playing: false,
  loop: true,
  tool: 'select',
  notice: null,
  previewOpen: false,
  timelineOpen: {},
  importWarnings: [],
  menu: null,
  autoKey: false,
  playRange: null,
  pendingImages: null,
  bakeTick: 0,

  update: (recipe) => {
    const { doc, gestureBase, past } = get();
    const next = produce(doc, recipe);
    if (next === doc) return;
    if (gestureBase) set({ doc: next });
    else set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },
  beginGesture: () => {
    if (!get().gestureBase) set({ gestureBase: get().doc });
  },
  endGesture: () => {
    const { gestureBase, doc, past } = get();
    if (!gestureBase) return;
    if (gestureBase !== doc) set({ gestureBase: null, past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
    else set({ gestureBase: null });
  },
  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], keySelection: [] });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), keySelection: [] });
  },
  replaceDoc: (doc) => set({ doc: normalizeDoc(doc), playRange: null, past: [...get().past, get().doc].slice(-HISTORY_LIMIT), future: [], selection: [], keySelection: [], frame: 0 }),
  setSelection: (ids) => set({ selection: ids }),
  setKeySelection: (keys) => set({ keySelection: keys }),
  setFrame: (f) => {
    const d = get().doc.duration;
    set({ frame: Math.max(0, Math.min(d, f)) });
  },
  setPlaying: (p) => set({ playing: p }),
  setLoop: (l) => set({ loop: l }),
  setTool: (t) => set({ tool: t }),
  // Un aviso a la vez, corto: el nuevo reemplaza al anterior.
  notify: (text, kind = 'info') => {
    clearTimeout(noticeTimer);
    noticeId += 1;
    set({ notice: { id: noticeId, text, kind } });
    noticeTimer = setTimeout(() => set({ notice: null }), kind === 'error' ? 4000 : 2300);
  },
  setPreviewOpen: (o) => set({ previewOpen: o }),
  toggleTimelineRow: (id, open) => set({ timelineOpen: { ...get().timelineOpen, [id]: open ?? !get().timelineOpen[id] } }),
  setImportWarnings: (w) => set({ importWarnings: w }),
  openMenu: (m) => set({ menu: m }),
  closeMenu: () => set({ menu: null }),
  setAutoKey: (v) => set({ autoKey: v }),
  setPlayRange: (r) => set({ playRange: r }),
  setPendingImages: (f) => set({ pendingImages: f }),
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(useStore.getState().doc));
    } catch {
      useStore.getState().notify('No se pudo guardar la copia automática (¿imágenes muy pesadas?). Exporta para no perder el trabajo.', 'error');
    }
  }, 400);
});

export const frameInt = () => Math.round(useStore.getState().frame);
