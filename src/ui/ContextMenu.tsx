import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, type MenuItem } from '../store/store';
import {
  canSplit,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  reorderSelection,
  setSelectedKeysEase,
  deleteSelectedKeys,
  splitSelection,
  ungroupSelection,
  updateNode,
} from '../store/actions';
import { ancestors, findNode } from '../model/tree';
import { EASE_PRESETS } from '../model/animate';
import { clipKind, copyFromMenu, pasteClip } from '../store/clipboard';

/** Menú del clic derecho para una o varias capas. `deepId` es la pieza exacta bajo el puntero. */
export function nodeMenuItems(deepId?: string | null): (MenuItem | 'sep')[] {
  const st = useStore.getState();
  const doc = st.doc;
  const sel = st.selection;
  const nodes = sel.map((id) => findNode(doc, id)).filter((n) => !!n);
  const one = nodes.length === 1 ? nodes[0]! : null;
  const items: (MenuItem | 'sep')[] = [];

  // Cadena grupo › pieza bajo el puntero, para coger solo una parte.
  if (deepId) {
    const chain = [...ancestors(doc.nodes, deepId), findNode(doc, deepId)!].filter(Boolean);
    if (chain.length > 1) {
      items.push({ label: 'Seleccionar', header: true });
      chain.forEach((n, i) =>
        items.push({
          label: n.name,
          indent: i,
          disabled: sel.length === 1 && sel[0] === n.id,
          action: () => {
            st.setSelection([n.id]);
            st.setKeySelection([]);
          },
        }),
      );
      items.push('sep');
    }
  }

  const anyGroup = nodes.some((n) => n!.type === 'group');
  items.push(
    { label: 'Copiar', shortcut: '⌘C', disabled: !nodes.length, action: () => copyFromMenu(false) },
    { label: 'Cortar', shortcut: '⌘X', disabled: !nodes.length, action: () => copyFromMenu(true) },
    {
      label: clipKind() === 'keys' ? 'Pegar keyframes aquí' : 'Pegar',
      shortcut: '⌘V',
      disabled: !clipKind(),
      action: () => pasteClip(),
    },
    'sep',
  );
  items.push(
    { label: 'Agrupar', shortcut: '⌘G', disabled: !nodes.length, action: groupSelection },
    { label: 'Desagrupar', shortcut: '⇧⌘G', disabled: !anyGroup, action: ungroupSelection },
    { label: 'Separar en piezas', disabled: !canSplit(one), action: splitSelection },
    { label: 'Duplicar', shortcut: '⌘D', disabled: !nodes.length, action: duplicateSelection },
    'sep',
    { label: 'Subir', shortcut: '⌘]', disabled: !nodes.length, action: () => reorderSelection(-1) },
    { label: 'Bajar', shortcut: '⌘[', disabled: !nodes.length, action: () => reorderSelection(1) },
    'sep',
  );
  if (one) {
    items.push(
      { label: one.hidden ? 'Mostrar' : 'Ocultar', action: () => updateNode(one.id, (n) => void (n.hidden = !n.hidden)) },
      { label: one.locked ? 'Desbloquear' : 'Bloquear', action: () => updateNode(one.id, (n) => void (n.locked = !n.locked)) },
      'sep',
    );
  }
  items.push({ label: 'Eliminar', shortcut: '⌫', danger: true, disabled: !nodes.length, action: deleteSelection });
  return items;
}

export function keyMenuItems(): (MenuItem | 'sep')[] {
  const n = useStore.getState().keySelection.length;
  return [
    { label: n > 1 ? `Curva de ${n} keyframes` : 'Curva', header: true },
    ...EASE_PRESETS.map((p) => ({ label: p.label, action: () => setSelectedKeysEase(p.ease) })),
    { label: 'A saltos', action: () => setSelectedKeysEase(EASE_PRESETS[0].ease, true) },
    'sep' as const,
    { label: n > 1 ? 'Copiar keyframes' : 'Copiar keyframe', shortcut: '⌘C', action: () => copyFromMenu(false) },
    { label: 'Pegar en el frame actual', shortcut: '⌘V', disabled: clipKind() !== 'keys', action: () => pasteClip() },
    'sep' as const,
    { label: n > 1 ? 'Eliminar keyframes' : 'Eliminar keyframe', shortcut: '⌫', danger: true, action: deleteSelectedKeys },
  ];
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const close = useStore((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x || menu.x, top: pos.y || menu.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : it.header ? (
          <div key={i} className="ctx-header">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            style={{ paddingLeft: 12 + (it.indent ?? 0) * 12 }}
            onClick={() => {
              close();
              it.action?.();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="ctx-short">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
