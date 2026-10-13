import type { Doc } from '../model/types';
import { haloKey, type BakedHalo } from '../model/effects';
import { useStore } from './store';

// Halos pixel horneados (PNG). Se calculan aparte la primera vez que hacen falta.
export const halos = new Map<string, BakedHalo>();
const pending = new Map<string, Promise<void>>();

function jobs(doc: Doc) {
  const out: { key: string; run: () => Promise<void> }[] = [];
  for (const node of doc.nodes) {
    for (const fx of node.effects ?? []) {
      if (fx.kind !== 'pixelGlow' || !fx.enabled) continue;
      const key = haloKey(node, fx);
      if (halos.has(key)) continue;
      out.push({
        key,
        run: async () => {
          const { bakePixelHalo } = await import('../io/raster');
          const h = await bakePixelHalo(doc, node, fx);
          if (h) halos.set(key, h);
        },
      });
    }
  }
  return out;
}

/** Lanza los horneados pendientes y avisa al lienzo cuando terminan. */
export function ensureHalos(doc: Doc) {
  for (const j of jobs(doc)) {
    if (pending.has(j.key)) continue;
    const p = j
      .run()
      .catch(() => undefined)
      .finally(() => {
        pending.delete(j.key);
        useStore.setState((s) => ({ bakeTick: s.bakeTick + 1 }));
      });
    pending.set(j.key, p);
  }
}

/** Espera a que estén todos (lo usa la exportación). */
export async function ensureHalosAsync(doc: Doc) {
  ensureHalos(doc);
  await Promise.all([...pending.values()]);
}
