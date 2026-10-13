import type { Node, PropPath, ShapeNode } from '../model/types';
import { useStore } from '../store/store';
import { canSplit, deleteSelection, groupSelection, setNodeTime, splitSelection, ungroupSelection, updateNode } from '../store/actions';
import { findNode, getProp } from '../model/tree';
import { SHAPE_LABELS, SIZE_PRESETS } from '../model/defaults';
import { EFFECT_HINTS, EFFECT_LABELS } from '../model/effects';
import type { EffectKind } from '../model/types';
import { PRESETS, applyPreset } from '../store/presets';
import { addEffect, removeEffect, updateEffect } from '../store/actions';
import { PropRow, NumberField, ColorField, MultiPropRow } from './fields';
import { EasingEditor } from './EasingEditor';
import { hexRgb, rgbHex } from './render';

function KeysSection() {
  const keySel = useStore((s) => s.keySelection);
  const doc = useStore((s) => s.doc);
  if (!keySel.length) return null;
  const first = keySel[0];
  const node = findNode(doc, first.nodeId);
  const key = node && getProp(node, first.path)?.keys.find((k) => k.id === first.keyId);
  if (!key) return null;
  return (
    <div className="section">
      <div className="section-head">
        <span>Curva de animación</span>
        <span className="hint" style={{ margin: 0 }}>
          {keySel.length} keyframe{keySel.length > 1 ? 's' : ''}
        </span>
      </div>
      <EasingEditor ease={key.ease} hold={!!key.hold} count={keySel.length} />
    </div>
  );
}

function DocSection() {
  const doc = useStore((s) => s.doc);
  const update = useStore((s) => s.update);
  const seconds = doc.duration / doc.fps;
  return (
    <>
      <div className="section">
        <div className="section-head">Lienzo</div>
        <div className="row plain">
          <span className="row-label">Formato</span>
          <select
            className="select"
            value={SIZE_PRESETS.findIndex((p) => p.w === doc.width && p.h === doc.height)}
            onChange={(e) => {
              const p = SIZE_PRESETS[Number(e.target.value)];
              if (!p) return;
              update((d) => {
                d.width = p.w;
                d.height = p.h;
                if (p.pixel !== undefined) d.pixel = p.pixel;
              });
            }}
          >
            <option value={-1}>Personalizado</option>
            {SIZE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row plain">
          <span className="row-label">Tamaño</span>
          <div className="fields">
            <NumberField label="An" value={doc.width} min={1} max={4096} digits={0} onChange={(v) => update((d) => void (d.width = Math.round(v)))} />
            <NumberField label="Al" value={doc.height} min={1} max={4096} digits={0} onChange={(v) => update((d) => void (d.height = Math.round(v)))} />
          </div>
        </div>
        <div className="row plain">
          <span className="row-label">Modo pixel</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" className="check" checked={doc.pixel} onChange={(e) => update((d) => void (d.pixel = e.target.checked))} />
            <span className="hint" style={{ margin: 0 }}>
              {doc.pixel ? 'Activado' : 'Desactivado'}
            </span>
          </label>
        </div>
        {doc.pixel && (
          <p className="hint">
            En pixel art las posiciones van a píxel entero, las imágenes solo escalan ×1, ×2, ×3… y se ven sin suavizado. El lienzo se mide en píxeles del dibujo; al exportar se
            amplía solo para que se vea nítido en el móvil.
          </p>
        )}
        <div className="row plain">
          <span className="row-label">Duración</span>
          <div className="fields">
            <NumberField
              label="s"
              value={seconds}
              min={0.1}
              max={600}
              step={0.1}
              digits={2}
              onChange={(v) => update((d) => void (d.duration = Math.max(1, Math.round(v * d.fps))))}
            />
            <NumberField label="fr" value={doc.duration} min={1} max={36000} digits={0} onChange={(v) => update((d) => void (d.duration = Math.max(1, Math.round(v))))} />
          </div>
        </div>
        <div className="row plain">
          <span className="row-label">Fotogramas/s</span>
          <select
            className="select"
            value={doc.fps}
            onChange={(e) => {
              const fps = Number(e.target.value);
              update((d) => {
                const k = fps / d.fps;
                d.duration = Math.max(1, Math.round(d.duration * k));
                d.fps = fps;
                const scaleKeys = (n: Node) => {
                  for (const path of Object.keys(PROP_INDEX) as PropPath[]) {
                    const p = getProp(n, path);
                    if (p) for (const key of p.keys) key.frame = Math.round(key.frame * k);
                  }
                  if (n.type === 'group') n.children.forEach(scaleKeys);
                };
                d.nodes.forEach((n) => scaleKeys(n as Node));
              });
            }}
          >
            {[12, 24, 25, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f === 30 ? '30 (recomendado)' : f === 60 ? '60 (pesa el doble)' : f === 12 ? '12 (pixel art clásico)' : f}
              </option>
            ))}
          </select>
        </div>
        <div className="row plain">
          <span className="row-label">Fondo (solo editor)</span>
          <div className="fields">
            {doc.background === 'transparent' ? (
              <button className="btn small outline" onClick={() => update((d) => void (d.background = '#ffffff'))}>
                Transparente
              </button>
            ) : (
              <ColorField value={hexRgb(doc.background) ?? [1, 1, 1]} onChange={(v) => update((d) => void (d.background = rgbHex(v)))} />
            )}
            <button
              className="btn small"
              title="Ver cuadrícula de transparencia"
              onClick={() => update((d) => void (d.background = d.background === 'transparent' ? '#ffffff' : 'transparent'))}
            >
              ▦
            </button>
          </div>
        </div>
        <p className="hint">Lottie no guarda el fondo: en la app se verá sobre el color de la pantalla.</p>
      </div>
      <div className="section">
        <div className="section-head">Cómo empezar</div>
        <p className="hint" style={{ marginTop: 0 }}>
          Dibuja con las herramientas de la izquierda o pega un SVG copiado de Figma (<span className="kbd">⌘V</span>). Para animar: pulsa el rombo ◇ de una propiedad, mueve la
          línea de tiempo y cambia el valor. Cada cambio crea un keyframe.
        </p>
        <div className="shortcuts">
          <span>Seleccionar · Rectángulo · Elipse</span>
          <span>
            <span className="kbd">V</span> <span className="kbd">R</span> <span className="kbd">O</span>
          </span>
          <span>Polígono · Estrella</span>
          <span>
            <span className="kbd">P</span> <span className="kbd">S</span>
          </span>
          <span>Reproducir / pausar</span>
          <span className="kbd">Espacio</span>
          <span>Mover el lienzo</span>
          <span>
            <span className="kbd">Espacio</span> + arrastrar
          </span>
          <span>Frame anterior / siguiente</span>
          <span>
            <span className="kbd">,</span> <span className="kbd">.</span>
          </span>
          <span>Copiar · Pegar (capas o keyframes)</span>
          <span>
            <span className="kbd">⌘C</span> <span className="kbd">⌘V</span>
          </span>
          <span>Agrupar · Duplicar</span>
          <span>
            <span className="kbd">⌘G</span> <span className="kbd">⌘D</span>
          </span>
          <span>Guardar proyecto · Exportar</span>
          <span>
            <span className="kbd">⌘S</span> <span className="kbd">⌘E</span>
          </span>
          <span>Más opciones</span>
          <span>clic derecho</span>
          <span>Entrar en un grupo</span>
          <span>doble clic o ⌘ clic</span>
        </div>
      </div>
    </>
  );
}

const PROP_INDEX: Record<PropPath, true> = {
  'transform.anchor': true,
  'transform.position': true,
  'transform.scale': true,
  'transform.rotation': true,
  'transform.opacity': true,
  'geometry.size': true,
  'geometry.roundness': true,
  'geometry.points': true,
  'geometry.radius': true,
  'geometry.outer': true,
  'geometry.inner': true,
  'fill.color': true,
  'fill.opacity': true,
  'stroke.color': true,
  'stroke.opacity': true,
  'stroke.width': true,
  'trim.start': true,
  'trim.end': true,
  'trim.offset': true,
};

const XY = [
  { label: 'X', step: 1 },
  { label: 'Y', step: 1 },
];

function PresetsSection() {
  return (
    <div className="section">
      <div className="section-head">Animación rápida</div>
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className="btn small outline" title={p.hint} onClick={() => applyPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="hint">Empieza en el frame actual. Luego puedes mover o ajustar sus keyframes.</p>
    </div>
  );
}

function EffectsSection({ node }: { node: Node }) {
  const effects = node.effects ?? [];
  return (
    <div className="section">
      <div className="section-head">
        <span>Efectos</span>
        <select
          className="select"
          style={{ width: 'auto' }}
          value=""
          onChange={(e) => {
            if (e.target.value) addEffect(node.id, e.target.value as EffectKind);
          }}
        >
          <option value="">+ Añadir</option>
          {(Object.keys(EFFECT_LABELS) as EffectKind[]).map((k) => (
            <option key={k} value={k}>
              {EFFECT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      {effects.length === 0 && <p className="hint" style={{ marginTop: 0 }}>Brillo, brillo pixel y destellos. Se exportan como capas que la app dibuja bien.</p>}
      {effects.map((fx) => (
        <div key={fx.id} className="fx-card">
          <div className="fx-head">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" className="check" checked={fx.enabled} onChange={(e) => updateEffect(node.id, fx.id, { enabled: e.target.checked })} />
              {EFFECT_LABELS[fx.kind]}
            </label>
            <button className="btn icon small" title="Quitar efecto" onClick={() => removeEffect(node.id, fx.id)}>
              ✕
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            {EFFECT_HINTS[fx.kind]}
          </p>
          <div className="row plain">
            <span className="row-label">Color</span>
            <ColorField value={fx.color} onChange={(v) => updateEffect(node.id, fx.id, { color: v })} />
          </div>
          <div className="row plain">
            <span className="row-label">Intensidad</span>
            <NumberField label="%" value={fx.intensity} min={0} max={100} digits={0} onChange={(v) => updateEffect(node.id, fx.id, { intensity: v })} />
          </div>
          <div className="row plain">
            <span className="row-label">Pulso cada</span>
            <NumberField label="s" value={fx.speed} min={0} max={10} step={0.1} digits={1} onChange={(v) => updateEffect(node.id, fx.id, { speed: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimeSection({ node }: { node: Node }) {
  const doc = useStore((s) => s.doc);
  const frame = useStore((s) => Math.round(s.frame));
  const a = node.inFrame ?? 0;
  const b = node.outFrame ?? doc.duration;
  return (
    <div className="section">
      <div className="section-head">Tiempo en pantalla</div>
      <div className="row plain">
        <span className="row-label">Aparece</span>
        <div className="fields">
          <NumberField label="fr" value={a} min={0} max={b - 1} digits={0} onChange={(v) => setNodeTime(node.id, v, node.outFrame)} />
          <button className="btn small outline" title="Aparece en el frame actual (⌥[)" onClick={() => setNodeTime(node.id, frame, node.outFrame)}>
            Aquí
          </button>
        </div>
      </div>
      <div className="row plain">
        <span className="row-label">Desaparece</span>
        <div className="fields">
          <NumberField label="fr" value={b} min={a + 1} max={doc.duration} digits={0} onChange={(v) => setNodeTime(node.id, node.inFrame, v)} />
          <button className="btn small outline" title="Desaparece en el frame actual (⌥])" onClick={() => setNodeTime(node.id, node.inFrame, frame)}>
            Aquí
          </button>
        </div>
      </div>
      <p className="hint">También se ajusta arrastrando los bordes de su barra en la línea de tiempo.</p>
    </div>
  );
}

function ImportWarnings() {
  const warnings = useStore((s) => s.importWarnings);
  if (!warnings.length) return null;
  return (
    <div className="warn-box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--key)', fontWeight: 600 }}>
        Avisos de la importación
        <button className="btn small" onClick={() => useStore.getState().setImportWarnings([])}>
          Entendido
        </button>
      </div>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function MultiTransformSection({ nodes }: { nodes: Node[] }) {
  const pixel = useStore((s) => s.doc.pixel);
  const allPixelImages = pixel && nodes.every((n) => n.type === 'image');
  return (
    <div className="section">
      <div className="section-head">Transformación</div>
      <MultiPropRow nodes={nodes} path="transform.position" label="Posición" fields={XY} />
      <MultiPropRow
        nodes={nodes}
        path="transform.scale"
        label="Escala"
        link
        fields={
          allPixelImages
            ? [
                { label: '×', step: 0.05, digits: 0, factor: 100 },
                { label: '×', step: 0.05, digits: 0, factor: 100 },
              ]
            : [
                { label: 'X', step: 1, digits: 1 },
                { label: 'Y', step: 1, digits: 1 },
              ]
        }
      />
      <MultiPropRow nodes={nodes} path="transform.rotation" label="Rotación" fields={[{ label: '°', step: 1, digits: 1 }]} />
      <MultiPropRow nodes={nodes} path="transform.opacity" label="Opacidad" fields={[{ label: '%', step: 1, min: 0, max: 100, digits: 1 }]} />
      <p className="hint">Escribir un valor lo pone igual en todas; arrastrar la etiqueta las cambia a cada una desde lo que tenía. En el lienzo, las esquinas escalan el conjunto (⌥ desde el centro) y el círculo lo gira.</p>
    </div>
  );
}

function TransformSection({ node }: { node: Node }) {
  const pixel = useStore((s) => s.doc.pixel);
  const pixelImage = pixel && node.type === 'image';
  const rot = node.transform.rotation;
  const rotated = pixelImage && [rot.value[0], ...rot.keys.map((k) => k.value[0])].some((r) => Math.abs(r % 90) > 0.01);
  return (
    <div className="section">
      <div className="section-head">Transformación</div>
      <PropRow node={node} path="transform.position" label="Posición" fields={XY} />
      {pixelImage ? (
        <PropRow
          node={node}
          path="transform.scale"
          label="Escala"
          link
          fields={[
            { label: '×', step: 0.05, digits: 0, factor: 100 },
            { label: '×', step: 0.05, digits: 0, factor: 100 },
          ]}
        />
      ) : (
        <PropRow
          node={node}
          path="transform.scale"
          label="Escala"
          link
          fields={[
            { label: 'X', step: 1, digits: 1 },
            { label: 'Y', step: 1, digits: 1 },
          ]}
        />
      )}
      <PropRow node={node} path="transform.rotation" label="Rotación" fields={[{ label: '°', step: 1, digits: 1 }]} />
      {rotated && <p className="hint warn-text">Girar pixel art en ángulos que no son de 90° deforma los píxeles. Mejor dibuja ese giro en Aseprite o usa 90°, 180°, 270°.</p>}
      <PropRow node={node} path="transform.opacity" label="Opacidad" fields={[{ label: '%', step: 1, min: 0, max: 100, digits: 1 }]} />
      <PropRow node={node} path="transform.anchor" label="Anclaje" fields={XY} />
      <p className="hint">El anclaje es el punto sobre el que gira y escala. También se arrastra en el lienzo (la cruz).</p>
    </div>
  );
}

function GeometrySection({ node }: { node: ShapeNode }) {
  const g = node.geometry;
  if (g.kind === 'path') {
    return (
      <div className="section">
        <div className="section-head">Forma</div>
        <p className="hint" style={{ marginTop: 0 }}>
          Trazo con {g.paths.length} subtrazo{g.paths.length === 1 ? '' : 's'} y {g.paths.reduce((a, p) => a + p.v.length, 0)} puntos. Se anima con
          transformación, color, borde y recorte.
        </p>
      </div>
    );
  }
  return (
    <div className="section">
      <div className="section-head">{SHAPE_LABELS[g.kind]}</div>
      {(g.kind === 'rect' || g.kind === 'ellipse') && (
        <PropRow
          node={node}
          path="geometry.size"
          label="Tamaño"
          fields={[
            { label: 'An', min: 0 },
            { label: 'Al', min: 0 },
          ]}
        />
      )}
      {g.kind === 'rect' && <PropRow node={node} path="geometry.roundness" label="Redondeo" fields={[{ label: 'px', min: 0 }]} />}
      {(g.kind === 'polygon' || g.kind === 'star') && (
        <PropRow node={node} path="geometry.points" label={g.kind === 'star' ? 'Puntas' : 'Lados'} fields={[{ label: '#', min: 3, max: 100, digits: 0, step: 0.1 }]} />
      )}
      {g.kind === 'polygon' && <PropRow node={node} path="geometry.radius" label="Radio" fields={[{ label: 'px', min: 0 }]} />}
      {g.kind === 'star' && (
        <>
          <PropRow node={node} path="geometry.outer" label="Radio exterior" fields={[{ label: 'px', min: 0 }]} />
          <PropRow node={node} path="geometry.inner" label="Radio interior" fields={[{ label: 'px', min: 0 }]} />
        </>
      )}
    </div>
  );
}

function StyleSections({ node }: { node: ShapeNode }) {
  return (
    <>
      <div className="section">
        <div className="section-head">
          <label>
            <input type="checkbox" className="check" checked={node.fill.enabled} onChange={(e) => updateNode(node.id, (n) => void ((n as ShapeNode).fill.enabled = e.target.checked))} />
            Relleno
          </label>
        </div>
        {node.fill.enabled && (
          <>
            <PropRow node={node} path="fill.color" label="Color" color />
            <PropRow node={node} path="fill.opacity" label="Opacidad" fields={[{ label: '%', min: 0, max: 100, digits: 1 }]} />
            {node.geometry.kind === 'path' && (
              <div className="row">
                <span />
                <span className="row-label">Huecos</span>
                <select
                  className="select"
                  value={node.fill.rule}
                  onChange={(e) => updateNode(node.id, (n) => void ((n as ShapeNode).fill.rule = Number(e.target.value) as 1 | 2))}
                >
                  <option value={1}>Distinto de cero</option>
                  <option value={2}>Par-impar</option>
                </select>
              </div>
            )}
          </>
        )}
      </div>
      <div className="section">
        <div className="section-head">
          <label>
            <input
              type="checkbox"
              className="check"
              checked={node.stroke.enabled}
              onChange={(e) => updateNode(node.id, (n) => void ((n as ShapeNode).stroke.enabled = e.target.checked))}
            />
            Borde
          </label>
        </div>
        {node.stroke.enabled && (
          <>
            <PropRow node={node} path="stroke.color" label="Color" color />
            <PropRow node={node} path="stroke.width" label="Grosor" fields={[{ label: 'px', min: 0, step: 0.5, digits: 2 }]} />
            <PropRow node={node} path="stroke.opacity" label="Opacidad" fields={[{ label: '%', min: 0, max: 100, digits: 1 }]} />
            <div className="row">
              <span />
              <span className="row-label">Extremos</span>
              <select className="select" value={node.stroke.cap} onChange={(e) => updateNode(node.id, (n) => void ((n as ShapeNode).stroke.cap = Number(e.target.value) as 1 | 2 | 3))}>
                <option value={1}>Rectos</option>
                <option value={2}>Redondos</option>
                <option value={3}>Cuadrados</option>
              </select>
            </div>
            <div className="row">
              <span />
              <span className="row-label">Esquinas</span>
              <select className="select" value={node.stroke.join} onChange={(e) => updateNode(node.id, (n) => void ((n as ShapeNode).stroke.join = Number(e.target.value) as 1 | 2 | 3))}>
                <option value={1}>En punta</option>
                <option value={2}>Redondas</option>
                <option value={3}>Biseladas</option>
              </select>
            </div>
          </>
        )}
      </div>
      <div className="section">
        <div className="section-head">
          <label>
            <input type="checkbox" className="check" checked={node.trim.enabled} onChange={(e) => updateNode(node.id, (n) => void ((n as ShapeNode).trim.enabled = e.target.checked))} />
            Recortar trazo
          </label>
        </div>
        {node.trim.enabled ? (
          <>
            <PropRow node={node} path="trim.start" label="Inicio" fields={[{ label: '%', min: 0, max: 100, digits: 1 }]} />
            <PropRow node={node} path="trim.end" label="Fin" fields={[{ label: '%', min: 0, max: 100, digits: 1 }]} />
            <PropRow node={node} path="trim.offset" label="Giro" fields={[{ label: '°', digits: 1 }]} />
            <p className="hint">Anima «Fin» de 0 a 100 para que la línea se dibuje sola.</p>
          </>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            Sirve para el efecto de línea que se dibuja.
          </p>
        )}
      </div>
    </>
  );
}

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const nodes = selection.map((id) => findNode(doc, id)).filter((n): n is Node => !!n);

  return (
    <aside className="inspector">
      <ImportWarnings />
      <KeysSection />
      {nodes.length === 0 && <DocSection />}
      {nodes.length > 1 && <PresetsSection />}
      {nodes.length > 1 && (
        <div className="section">
          <div className="section-head">{nodes.length} capas seleccionadas</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn outline small" onClick={groupSelection}>
              Agrupar
            </button>
            <button className="btn outline small" onClick={deleteSelection}>
              Eliminar
            </button>
          </div>
        </div>
      )}
      {nodes.length > 1 && <MultiTransformSection nodes={nodes} />}
      {nodes.length === 1 && (
        <>
          <div className="section">
            <div className="section-head">
              <input
                className="doc-name"
                style={{ width: '100%', marginLeft: -8, fontWeight: 600 }}
                value={nodes[0].name}
                onChange={(e) => updateNode(nodes[0].id, (n) => void (n.name = e.target.value))}
              />
            </div>
            <span className="hint">
              {nodes[0].type === 'group' ? `Grupo · ${nodes[0].children.length} elementos` : nodes[0].type === 'image' ? 'Imagen' : SHAPE_LABELS[nodes[0].geometry.kind]}
            </span>
            {(nodes[0].type === 'group' || canSplit(nodes[0])) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {nodes[0].type === 'group' && (
                  <button className="btn small outline" onClick={ungroupSelection} title="Saca las piezas del grupo (⇧⌘G)">
                    Desagrupar
                  </button>
                )}
                {canSplit(nodes[0]) && (
                  <button className="btn small outline" onClick={splitSelection} title="Convierte cada parte del trazo en su propia capa">
                    Separar en piezas
                  </button>
                )}
              </div>
            )}
            {nodes[0].type === 'group' && <p className="hint">Para animar solo una pieza: doble clic sobre ella en el lienzo, o clic derecho › Seleccionar.</p>}
          </div>
          <PresetsSection />
          <TransformSection node={nodes[0]} />
          {doc.nodes.some((n) => n.id === nodes[0].id) && <EffectsSection node={nodes[0]} />}
          {doc.nodes.some((n) => n.id === nodes[0].id) && <TimeSection node={nodes[0]} />}
          {nodes[0].type === 'shape' && <GeometrySection node={nodes[0]} />}
          {nodes[0].type === 'shape' && <StyleSections node={nodes[0]} />}
        </>
      )}
    </aside>
  );
}
