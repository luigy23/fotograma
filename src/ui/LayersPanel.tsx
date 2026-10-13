import { useState } from 'react';
import type { Node } from '../model/types';
import { useStore, type Tool } from '../store/store';
import { deleteSelection, duplicateSelection, groupSelection, moveNode, openExample, ungroupSelection, updateNode } from '../store/actions';
import { locate } from '../model/tree';
import { Icon } from './icons';
import { nodeMenuItems } from './ContextMenu';

const TOOLS: { id: Tool; label: string; key: string; icon: keyof typeof Icon }[] = [
  { id: 'select', label: 'Seleccionar', key: 'V', icon: 'select' },
  { id: 'rect', label: 'Rectángulo', key: 'R', icon: 'rect' },
  { id: 'ellipse', label: 'Elipse', key: 'O', icon: 'ellipse' },
  { id: 'polygon', label: 'Polígono', key: 'P', icon: 'polygon' },
  { id: 'star', label: 'Estrella', key: 'S', icon: 'star' },
];

function nodeIcon(n: Node) {
  if (n.type === 'group') return Icon.group(14);
  if (n.type === 'image') return Icon.image(14);
  const k = n.geometry.kind;
  return (k === 'path' ? Icon.path : Icon[k])(14);
}

type Drop = { id: string; where: 'above' | 'below' | 'inside' } | null;

export function LayersPanel() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const st = useStore.getState;

  const isOpen = (n: Node) => (n.type === 'group' ? (open[n.id] ?? n.expanded) : false);

  const select = (e: React.MouseEvent, id: string) => {
    const sel = st().selection;
    if (e.shiftKey || e.metaKey || e.ctrlKey) st().setSelection(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else st().setSelection([id]);
    st().setKeySelection([]);
  };

  const onDrop = () => {
    if (!drop || !dragId || drop.id === dragId) return;
    const target = locate(doc.nodes, drop.id);
    if (!target) return;
    if (drop.where === 'inside') {
      moveNode(dragId, drop.id, 0);
      setOpen((o) => ({ ...o, [drop.id]: true }));
    } else moveNode(dragId, target.parent?.id ?? null, target.index + (drop.where === 'below' ? 1 : 0));
  };

  const renderRows = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <div key={n.id}>
        <div
          className={`layer-row ${selection.includes(n.id) ? 'sel' : ''} ${n.hidden ? 'hidden-node' : ''} ${drop?.id === n.id ? 'drop-' + drop.where : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={renaming !== n.id}
          onDragStart={(e) => {
            setDragId(n.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', n.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDrop(null);
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const where = n.type === 'group' && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'above' : 'below';
            setDrop({ id: n.id, where });
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop();
            setDrop(null);
          }}
          onClick={(e) => select(e, n.id)}
          onDoubleClick={() => setRenaming(n.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!st().selection.includes(n.id)) st().setSelection([n.id]);
            st().openMenu({ x: e.clientX, y: e.clientY, items: [...nodeMenuItems(null), 'sep', { label: 'Cambiar nombre', action: () => setRenaming(n.id) }] });
          }}
        >
          <span
            className="twisty"
            style={{ visibility: n.type === 'group' ? 'visible' : 'hidden' }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => ({ ...o, [n.id]: !isOpen(n) }));
            }}
          >
            {isOpen(n) ? Icon.chevronDown(12) : Icon.chevronRight(12)}
          </span>
          <span className="layer-icon">{nodeIcon(n)}</span>
          <span className="layer-name">
            {renaming === n.id ? (
              <input
                autoFocus
                defaultValue={n.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== n.name) updateNode(n.id, (x) => void (x.name = v));
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              n.name
            )}
          </span>
          <button
            className={`layer-toggle ${n.locked ? 'on' : ''}`}
            title={n.locked ? 'Desbloquear' : 'Bloquear (no se puede seleccionar en el lienzo)'}
            onClick={(e) => {
              e.stopPropagation();
              updateNode(n.id, (x) => void (x.locked = !x.locked));
            }}
          >
            {n.locked ? Icon.lock(13) : Icon.unlock(13)}
          </button>
          <button
            className={`layer-toggle ${n.hidden ? 'on' : ''}`}
            title={n.hidden ? 'Mostrar' : 'Ocultar (tampoco se verá en la app)'}
            onClick={(e) => {
              e.stopPropagation();
              updateNode(n.id, (x) => void (x.hidden = !x.hidden));
            }}
          >
            {n.hidden ? Icon.eyeOff(13) : Icon.eye(13)}
          </button>
        </div>
        {n.type === 'group' && isOpen(n) && renderRows(n.children, depth + 1)}
      </div>
    ));

  const hasSel = selection.length > 0;
  return (
    <aside className="left">
      <div className="tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => st().setTool(t.id)}>
            {Icon[t.icon](17)}
          </button>
        ))}
      </div>
      <div className="panel-title">
        <span>Capas</span>
        <span style={{ display: 'flex', gap: 2 }}>
          <button className="btn icon small" title="Agrupar (⌘G)" disabled={!hasSel} onClick={groupSelection}>
            {Icon.group(13)}
          </button>
          <button className="btn icon small" title="Desagrupar (⇧⌘G)" disabled={!hasSel} onClick={ungroupSelection}>
            {Icon.ungroup(13)}
          </button>
          <button className="btn icon small" title="Duplicar (⌘D)" disabled={!hasSel} onClick={duplicateSelection}>
            {Icon.copy(13)}
          </button>
          <button className="btn icon small" title="Eliminar (Supr)" disabled={!hasSel} onClick={deleteSelection}>
            {Icon.trash(13)}
          </button>
        </span>
      </div>
      <div
        className="layers"
        onClick={(e) => {
          if (e.target === e.currentTarget) st().setSelection([]);
        }}
      >
        {doc.nodes.length === 0 ? (
          <div className="empty-layers">
            <b>Sin capas todavía.</b>
            <br />
            Dibuja una forma, arrastra aquí un SVG o PNG, o en Figma usa <b>Copiar como SVG</b> y pégalo con <span className="kbd">⌘V</span>.
            <button className="btn small outline" style={{ marginTop: 12 }} onClick={() => openExample()}>
              Abrir el ejemplo del mago
            </button>
          </div>
        ) : (
          renderRows(doc.nodes, 0)
        )}
      </div>
    </aside>
  );
}
