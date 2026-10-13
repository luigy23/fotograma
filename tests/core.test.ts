import { describe, expect, it } from 'vitest';
import { bezierEasing, evalProp, prop, setPropValue, toggleKey, shiftKeys } from '../src/model/animate';
import { makeDoc, makeGroup, makeShape } from '../src/model/defaults';
import { exportLottie } from '../src/io/exportLottie';
import { importLottie } from '../src/io/importLottie';
import { importSvg } from '../src/io/importSvg';
import { validateLottie } from '../src/io/validate';
import { nodeBounds } from '../src/model/tree';
import type { Doc } from '../src/model/types';

function sampleDoc(): Doc {
  const doc = makeDoc();
  const rect = makeShape('rect', [256, 256], 160, 100);
  rect.geometry.kind === 'rect' && (rect.geometry.roundness.value = [16]);
  toggleKey(rect.transform.position, 0);
  setPropValue(rect.transform.position, [256, 100], 30);
  toggleKey(rect.transform.rotation, 0);
  setPropValue(rect.transform.rotation, [180], 60);
  rect.transform.rotation.keys[0].hold = true;
  toggleKey(rect.fill.color, 0);
  setPropValue(rect.fill.color, [1, 0.2, 0.3], 60);
  rect.stroke.enabled = true;
  rect.trim.enabled = true;
  toggleKey(rect.trim.end, 0);
  setPropValue(rect.trim.end, [0], 0);
  setPropValue(rect.trim.end, [100], 40);

  const star = makeShape('star', [100, 100]);
  const poly = makeShape('polygon', [400, 400]);
  const ell = makeShape('ellipse', [0, 0], 80, 40);
  const group = makeGroup([star, makeGroup([ell, poly], 'Interno')], 'Grupo');
  toggleKey(group.transform.scale, 0);
  setPropValue(group.transform.scale, [120, 120], 20);
  doc.nodes = [group, rect];
  return doc;
}

describe('animación', () => {
  it('la curva lineal y los extremos son exactos', () => {
    const lin = bezierEasing(0, 0, 1, 1);
    expect(lin(0.3)).toBeCloseTo(0.3, 5);
    const e = bezierEasing(0.42, 0, 0.58, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    expect(e(0.5)).toBeCloseTo(0.5, 3);
  });

  it('interpola entre keyframes y respeta el mantener', () => {
    const p = prop([0]);
    toggleKey(p, 0);
    setPropValue(p, [100], 10);
    p.keys[0].ease = { o: [0, 0], i: [1, 1] };
    expect(evalProp(p, 5)[0]).toBeCloseTo(50, 3);
    expect(evalProp(p, 20)[0]).toBe(100);
    p.keys[0].hold = true;
    expect(evalProp(p, 9)[0]).toBe(0);
  });

  it('mover keyframes encima de otro lo reemplaza', () => {
    const p = prop([0]);
    toggleKey(p, 0);
    setPropValue(p, [5], 5);
    setPropValue(p, [10], 10);
    shiftKeys(p, new Set([p.keys[2].id]), -5, 100);
    expect(p.keys.map((k) => k.frame)).toEqual([0, 5]);
    expect(p.keys[1].value).toEqual([10]);
  });
});

describe('exportación', () => {
  it('cumple el esquema oficial de Lottie 1.0', () => {
    const { json, warnings } = exportLottie(sampleDoc());
    expect(warnings).toEqual([]);
    expect(validateLottie(json)).toEqual([]);
  });

  it('ida y vuelta sin pérdidas', () => {
    const first = exportLottie(sampleDoc()).json;
    const { doc, warnings } = importLottie(first);
    expect(warnings).toEqual([]);
    const second = exportLottie(doc).json;
    expect(second).toEqual(first);
  });
});

describe('SVG', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 400 200">
    <style>.a{fill:#ff0000}</style>
    <rect x="0" y="0" width="400" height="200" fill="white"/>
    <g transform="translate(100 50)">
      <circle class="a" cx="0" cy="0" r="50"/>
      <path d="M0 0 L100 0 Q150 50 100 100 Z" stroke="#00f" stroke-width="10" fill="none"/>
    </g>
    <text>hola</text>
  </svg>`;

  it('respeta viewBox, transformaciones y estilos', () => {
    const r = importSvg(svg, 'logo.svg');
    expect(r.width).toBe(200);
    expect(r.height).toBe(100);
    expect(r.warnings.some((w) => w.includes('textos'))).toBe(true);
    const root = r.node!;
    expect(root.type).toBe('group');
    if (root.type !== 'group') return;
    expect(root.children).toHaveLength(2);
    const doc = makeDoc();
    doc.nodes = [root];
    // El fondo va primero en el SVG, así que queda abajo del todo (último en el panel).
    const bg = root.children[1];
    const b = nodeBounds(doc, bg, 0)!;
    expect(b.x).toBeCloseTo(0, 1);
    expect(b.w).toBeCloseTo(200, 1);
    const inner = root.children[0];
    expect(inner.type).toBe('group');
    if (inner.type !== 'group') return;
    const circle = inner.children[1];
    expect(circle.type === 'shape' && circle.fill.color.value).toEqual([1, 0, 0]);
    const cb = nodeBounds(doc, circle, 0)!;
    expect(cb.x + cb.w / 2).toBeCloseTo(50, 1);
    expect(cb.w).toBeCloseTo(50, 1);
    const stroke = inner.children[0];
    expect(stroke.type === 'shape' && stroke.stroke.enabled && stroke.stroke.width.value[0]).toBeCloseTo(5, 3);
    expect(stroke.type === 'shape' && stroke.fill.enabled).toBe(false);
  });

  it('el SVG importado exporta un Lottie válido', () => {
    const doc = makeDoc();
    doc.nodes = [importSvg(svg).node!];
    expect(validateLottie(exportLottie(doc).json)).toEqual([]);
  });
});
