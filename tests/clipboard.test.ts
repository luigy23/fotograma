import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/store/store';
import { makeDoc, makeShape } from '../src/model/defaults';
import { setPropValue, toggleKey } from '../src/model/animate';
import { copySelection, pasteClip, parseClip, clipText } from '../src/store/clipboard';
import type { Doc } from '../src/model/types';

function setup(): Doc {
  const doc = makeDoc();
  doc.pixel = false;
  const a = makeShape('rect', [100, 100]);
  a.name = 'A';
  toggleKey(a.transform.position, 10);
  setPropValue(a.transform.position, [200, 100], 20);
  const b = makeShape('ellipse', [50, 50]);
  b.name = 'B';
  doc.nodes = [a, b];
  useStore.setState({ doc, selection: [], keySelection: [], frame: 0, past: [], future: [] });
  return doc;
}

describe('copiar y pegar', () => {
  beforeEach(() => setup());

  it('pega capas nuevas encima de la seleccionada, con ids nuevos', () => {
    const doc = useStore.getState().doc;
    useStore.setState({ selection: [doc.nodes[1].id] });
    const clip = copySelection();
    expect(clip?.kind).toBe('nodes');
    pasteClip();
    const after = useStore.getState().doc.nodes;
    expect(after.map((n) => n.name)).toEqual(['A', 'B', 'B']);
    expect(after[1].id).not.toBe(after[2].id);
    expect(useStore.getState().selection).toEqual([after[1].id]);
  });

  it('pega keyframes en el frame actual de la misma capa', () => {
    const a = useStore.getState().doc.nodes[0];
    const keys = a.transform.position.keys.map((k) => ({ nodeId: a.id, path: 'transform.position' as const, keyId: k.id }));
    useStore.setState({ keySelection: keys, selection: [a.id] });
    copySelection();
    useStore.setState({ frame: 40 });
    pasteClip();
    const frames = useStore.getState().doc.nodes[0].transform.position.keys.map((k) => k.frame);
    expect(frames).toEqual([10, 20, 40, 50]);
  });

  it('pega keyframes en otra capa', () => {
    const [a, b] = useStore.getState().doc.nodes;
    const keys = a.transform.position.keys.map((k) => ({ nodeId: a.id, path: 'transform.position' as const, keyId: k.id }));
    useStore.setState({ keySelection: keys, selection: [a.id] });
    copySelection();
    useStore.setState({ frame: 5, selection: [b.id], keySelection: [] });
    pasteClip();
    const pb = useStore.getState().doc.nodes[1].transform.position;
    expect(pb.keys.map((k) => [k.frame, k.value])).toEqual([
      [5, [100, 100]],
      [15, [200, 100]],
    ]);
  });

  it('el texto del portapapeles se reconoce y lo demás no', () => {
    const doc = useStore.getState().doc;
    useStore.setState({ selection: [doc.nodes[0].id] });
    const clip = copySelection()!;
    expect(parseClip(clipText(clip))?.kind).toBe('nodes');
    expect(parseClip('<svg></svg>')).toBeNull();
  });
});
