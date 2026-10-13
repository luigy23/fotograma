import { describe, expect, it } from 'vitest';
import { makeDoc, makeShape, makeImage } from '../src/model/defaults';
import { setPropValue, toggleKey, prop } from '../src/model/animate';
import { haloKey, makeEffect } from '../src/model/effects';
import { exportLottie } from '../src/io/exportLottie';
import { prepareExport, cleanKeys } from '../src/io/prepare';
import { validateLottie } from '../src/io/validate';
import { simplifyPath, dToPaths } from '../src/io/importSvg';
import { splitIntoPieces } from '../src/store/actions';
import type { Doc } from '../src/model/types';

const noHalos = new Map();

function animatedDoc(): Doc {
  const doc = makeDoc();
  doc.width = 64;
  doc.height = 64;
  doc.fps = 30;
  doc.duration = 60;
  const star = makeShape('star', [32, 32], 20, 20);
  star.effects = [makeEffect('glow', 'g1'), makeEffect('sparkles', 's1')];
  toggleKey(star.transform.position, 10);
  setPropValue(star.transform.position, [40, 20], 30);
  doc.nodes = [star];
  doc.segments = [{ id: 'a', name: 'reposo', start: 10, end: 31 }];
  return doc;
}

describe('exportación optimizada', () => {
  it('los efectos salen como capas enlazadas y el JSON cumple Lottie 1.0', () => {
    const doc = animatedDoc();
    const p = prepareExport(doc, { trim: false, outputScale: 1 }, noHalos);
    const { json } = exportLottie(p.doc, { parents: p.parents, rootScale: 1 });
    const layers = json.layers as { parent?: number; ind: number; nm: string; shapes?: { ty: string }[] }[];
    const star = layers.find((l) => l.nm === 'Estrella')!;
    const children = layers.filter((l) => l.parent === star.ind);
    expect(children.length).toBeGreaterThan(3);
    expect(JSON.stringify(json)).toContain('"ty":"gf"');
    expect((json.markers as { cm: string; tm: number; dr: number }[])[0]).toEqual({ tm: 10, cm: 'reposo', dr: 21 });
    expect(validateLottie(json)).toEqual([]);
  });

  it('pixel art: posiciones horneadas a píxel entero con keyframes a saltos', () => {
    const doc = animatedDoc();
    doc.nodes[0].effects = [];
    const p = prepareExport(doc, { trim: false, outputScale: 1 }, noHalos);
    const keys = p.doc.nodes[0].transform.position.keys;
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      expect(k.hold).toBe(true);
      for (const v of k.value) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('salida pixel ×8: capa nula escalada y comp más grande', () => {
    const doc = animatedDoc();
    doc.nodes[0].effects = [];
    const p = prepareExport(doc, { trim: false, outputScale: 8 }, noHalos);
    const { json } = exportLottie(p.doc, { parents: p.parents, rootScale: p.outputScale });
    expect(json.w).toBe(512);
    const layers = json.layers as { ty: number; parent?: number; ind: number; ks: { s: { k: number[] } } }[];
    const nul = layers.find((l) => l.ty === 3)!;
    expect(nul.ks.s.k).toEqual([800, 800]);
    expect(layers.filter((l) => l.ty !== 3).every((l) => l.parent === nul.ind)).toBe(true);
    expect(validateLottie(json)).toEqual([]);
  });

  it('recorta los silencios del principio y del final', () => {
    const doc = animatedDoc();
    doc.nodes[0].effects = [];
    doc.segments = [];
    const p = prepareExport(doc, { trim: true, outputScale: 1 }, noHalos);
    expect(p.range).toEqual({ from: 10, to: 31, original: 60 });
    expect(p.doc.duration).toBe(21);
    expect(p.doc.nodes[0].transform.position.keys[0].frame).toBe(0);
  });

  it('quita capas ocultas y keyframes que no cambian nada', () => {
    const doc = makeDoc();
    const a = makeShape('rect', [10, 10]);
    const b = makeShape('ellipse', [10, 10]);
    b.hidden = true;
    toggleKey(a.transform.opacity, 0);
    setPropValue(a.transform.opacity, [100], 10);
    setPropValue(a.transform.opacity, [100], 20);
    doc.nodes = [a, b];
    const p = prepareExport(doc, { trim: false, outputScale: 1 }, noHalos);
    expect(p.doc.nodes).toHaveLength(1);
    expect(p.doc.nodes[0].transform.opacity.keys).toHaveLength(0);
    expect(p.removed.hidden).toBe(1);
  });

  it('cleanKeys deja los extremos de un tramo quieto', () => {
    const p = prop([0]);
    toggleKey(p, 0);
    setPropValue(p, [50], 10);
    setPropValue(p, [50], 20);
    setPropValue(p, [50], 30);
    setPropValue(p, [0], 40);
    expect(cleanKeys(p)).toBe(1);
    expect(p.keys.map((k) => k.frame)).toEqual([0, 10, 30, 40]);
  });
});

describe('caché de halos', () => {
  it('exportar no modifica las imágenes de la caché', () => {
    const doc = makeDoc();
    const node = makeShape('rect', [16, 16], 10, 10);
    node.effects = [makeEffect('pixelGlow', 'p1')];
    doc.nodes = [node];
    const asset = { id: 'halo', name: 'h', w: 14, h: 14, data: 'data:image/png;base64,AA==' };
    const halos = new Map([[haloKey(node, node.effects[0]), { asset, x: -7, y: -7 }]]);
    const p = prepareExport(doc, { trim: false, outputScale: 1 }, halos);
    p.doc.assets[0].w = 999;
    expect(asset.w).toBe(14);
  });
});

describe('trazos', () => {
  it('simplifica puntos en medio de rectas sin cambiar la forma', () => {
    const [path] = dToPaths('M0 0H10H20V10V20H0Z', [1, 0, 0, 1, 0, 0]);
    const simple = simplifyPath(path);
    expect(simple.v).toEqual([
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ]);
  });

  it('separar en piezas respeta los huecos (una "o" sigue siendo una pieza)', () => {
    const paths = dToPaths('M0 0H40V40H0Z M10 10V30H30V10Z M60 0H80V20H60Z', [1, 0, 0, 1, 0, 0]);
    const pieces = splitIntoPieces(paths, 1);
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.length).sort()).toEqual([1, 2]);
  });

  it('las imágenes en pixel art caen en la rejilla', () => {
    const img = makeImage('a', 'x', 33, 17, [20.6, 10.2], true);
    expect(img.transform.anchor.value).toEqual([16, 8]);
    expect(img.transform.position.value).toEqual([21, 10]);
  });
});
