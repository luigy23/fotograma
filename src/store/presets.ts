import type { Doc, Ease, Node, Prop, Vec } from '../model/types';
import { easeById, evalProp } from '../model/animate';
import { findNode } from '../model/tree';
import { uid } from '../model/uid';
import { useStore } from './store';

// Microanimaciones de un clic. Se aplican desde el frame actual sobre lo que
// ya tenga la capa. Poco rebote y nada de temblores. En pixel art las
// imágenes no escalan a medias: se mueven a saltos de píxel.

export type PresetId = 'appear' | 'pop' | 'bounce' | 'beat';

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'appear', label: 'Aparecer', hint: 'Entra con un fundido y sube un poco.' },
  { id: 'pop', label: 'Pop', hint: 'Crece desde cero con un rebote leve.' },
  { id: 'bounce', label: 'Rebote', hint: 'Un salto corto y otro más pequeño.' },
  { id: 'beat', label: 'Latido', hint: 'Late suave en bucle hasta el final.' },
];

const S = () => useStore.getState();

function upsertKey(p: Prop, frame: number, value: Vec, ease: Ease, hold = false) {
  const f = Math.round(frame);
  const existing = p.keys.find((k) => k.frame === f);
  const k = { id: uid(), frame: f, value: [...value], ease: { o: [...ease.o] as [number, number], i: [...ease.i] as [number, number] }, hold: hold || undefined };
  if (existing) Object.assign(existing, { value: k.value, ease: k.ease, hold: k.hold });
  else p.keys.push(k);
  p.keys.sort((a, b) => a.frame - b.frame);
}

function applyTo(doc: Doc, n: Node, id: PresetId, t0: number) {
  const fps = doc.fps;
  const sec = (s: number) => Math.max(1, Math.round(s * fps));
  const end = doc.duration;
  const t = n.transform;
  const pos = evalProp(t.position, t0);
  const scale = evalProp(t.scale, t0);
  const opacity = evalProp(t.opacity, t0);
  const pixelImage = doc.pixel && n.type === 'image';
  const unit = doc.pixel ? 1 : 4;
  const smooth = easeById('smooth');
  const out = easeById('out');
  const inn = easeById('in');
  const bounce = easeById('bounce');
  const linear = easeById('linear');
  // Nada más allá del final de la animación.
  // En pixel art, las posiciones de los keyframes también van a píxel entero.
  const upsert = (p: Prop, f: number, v: Vec, e: Ease, hold = false) =>
    upsertKey(p, Math.min(end, f), doc.pixel && (p === t.position || p === t.anchor) ? v.map(Math.round) : v, e, hold);

  switch (id) {
    case 'appear': {
      const d = sec(0.4);
      upsert(t.opacity, t0, [0], out);
      upsert(t.opacity, t0 + d, opacity, smooth);
      upsert(t.position, t0, [pos[0], pos[1] + 3 * unit], out);
      upsert(t.position, t0 + d, pos, smooth);
      break;
    }
    case 'pop': {
      if (pixelImage) {
        upsert(t.scale, t0, [0, 0], linear, true);
        upsert(t.scale, t0 + 1, scale, linear, true);
        upsert(t.position, t0 + 1, [pos[0], pos[1] - 2], out);
        upsert(t.position, t0 + sec(0.25), pos, smooth);
      } else {
        // La curva «Rebote leve» ya pasa un poco del tamaño final y vuelve.
        upsert(t.scale, t0, [0, 0], bounce);
        upsert(t.scale, t0 + sec(0.35), scale, smooth);
      }
      break;
    }
    case 'bounce': {
      const h = doc.pixel ? 3 : 16;
      const up = (k: number) => [pos[0], pos[1] - h * k];
      upsert(t.position, t0, pos, out);
      upsert(t.position, t0 + sec(0.18), up(1), inn);
      upsert(t.position, t0 + sec(0.36), pos, out);
      upsert(t.position, t0 + sec(0.48), up(0.35), inn);
      upsert(t.position, t0 + sec(0.6), pos, smooth);
      break;
    }
    case 'beat': {
      const remaining = Math.max(sec(0.5), end - t0);
      const cycles = Math.max(1, Math.round(remaining / (0.9 * fps)));
      const P = remaining / cycles;
      for (let c = 0; c < cycles; c++) {
        const b = t0 + c * P;
        if (pixelImage) {
          upsert(t.position, b, pos, linear, true);
          upsert(t.position, b + P / 2, [pos[0], pos[1] - 1], linear, true);
        } else {
          upsert(t.scale, b, scale, out);
          upsert(t.scale, b + P * 0.15, scale.map((v) => v * 1.08), smooth);
          upsert(t.scale, b + P * 0.32, scale, out);
          upsert(t.scale, b + P * 0.47, scale.map((v) => v * 1.04), smooth);
          upsert(t.scale, b + P * 0.62, scale, linear, true);
        }
      }
      if (pixelImage) upsert(t.position, end, pos, linear, true);
      else upsert(t.scale, end, scale, linear, true);
      break;
    }
  }
}

export function applyPreset(id: PresetId) {
  const st = S();
  const ids = st.selection;
  if (!ids.length) {
    st.notify('Selecciona una capa para aplicarle la animación.', 'info');
    return;
  }
  const t0 = Math.round(st.frame);
  st.update((d) => {
    for (const nid of ids) {
      const n = findNode(d as Doc, nid);
      if (n && !n.locked) applyTo(d as Doc, n as Node, id, t0);
    }
  });
  for (const nid of ids) st.toggleTimelineRow(nid, true);
  const label = PRESETS.find((p) => p.id === id)!.label;
  st.notify(`«${label}» aplicado desde el frame ${t0}.`, 'ok');
}
