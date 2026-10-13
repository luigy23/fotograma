import type { Doc, Node } from '../model/types';
import type { BakedHalo } from '../model/effects';
import { exportLottie } from './exportLottie';
import { prepareExport, type ExportSettings, type Prepared } from './prepare';
import { validateLottie } from './validate';

export interface FinalExport {
  prepared: Prepared;
  json: Record<string, unknown>;
  text: string;
  bytes: number;
  errors: string[];
  warnings: string[];
}

/**
 * Exportación completa: prepara (optimiza, hornea, traduce efectos), amplía
 * el pixel art sin suavizado si toca, genera el JSON y lo valida.
 */
export async function finalExport(doc: Doc, settings: ExportSettings, halos: Map<string, BakedHalo>): Promise<FinalExport> {
  const prepared = prepareExport(doc, settings, halos);
  const out = prepared.doc;
  const k = prepared.outputScale;
  if (k > 1 && out.assets.length) {
    const { upscaleDataUrl } = await import('./raster');
    const scaled = new Map<string, number>();
    out.assets = out.assets.map((a) => ({ ...a }));
    for (const a of out.assets) {
      a.data = await upscaleDataUrl(a.data, a.w, a.h, k);
      a.w *= k;
      a.h *= k;
      scaled.set(a.id, k);
    }
    // Las capas enlazadas a una imagen ampliada viven en su espacio, que ahora
    // es ×k: su posición y su escala también ×k para quedar donde estaban.
    const upscaledIds = new Set(out.nodes.filter((n) => n.type === 'image' && scaled.has(n.assetId)).map((n) => n.id));
    for (const n of out.nodes) {
      const parent = prepared.parents.get(n.id);
      if (!parent || !upscaledIds.has(parent)) continue;
      const t = n.transform;
      const mul = (v: number[]) => v.map((x) => x * k);
      t.position.value = mul(t.position.value);
      t.position.keys.forEach((key) => (key.value = mul(key.value)));
      t.scale.value = mul(t.scale.value);
      t.scale.keys.forEach((key) => (key.value = mul(key.value)));
    }
    // La imagen es ×k más grande: su ancla ×k y su escala ÷k la dejan igual en pantalla.
    const fix = (n: Node) => {
      if (n.type === 'image' && scaled.has(n.assetId)) {
        const t = n.transform;
        const mulA = (v: number[]) => v.map((x) => x * k);
        const divS = (v: number[]) => v.map((x) => x / k);
        t.anchor.value = mulA(t.anchor.value);
        t.anchor.keys.forEach((key) => (key.value = mulA(key.value)));
        t.scale.value = divS(t.scale.value);
        t.scale.keys.forEach((key) => (key.value = divS(key.value)));
      }
      if (n.type === 'group') n.children.forEach(fix);
    };
    out.nodes.forEach(fix);
  }
  const { json, warnings } = exportLottie(out, { parents: prepared.parents, rootScale: k });
  const errors = validateLottie(json).map((e) => `${e.path || 'raíz'}: ${e.message}`);
  const text = JSON.stringify(json);
  return { prepared, json, text, bytes: new Blob([text]).size, errors, warnings };
}

/** .lottie (dotLottie): zip con manifest.json y la animación en animations/. */
export async function buildDotLottie(text: string, id: string): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const manifest = {
    version: '1.0',
    generator: 'Fotograma',
    animations: [{ id, loop: true, autoplay: true, speed: 1 }],
  };
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    [`animations/${id}.json`]: strToU8(text),
  });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}
