import { expect, it } from 'vitest';
import { validateLottie } from '../src/io/validate';

it('el validador sí detecta un Lottie roto', () => {
  const errors = validateLottie({ v: '5.12.0', fr: 60, ip: 0, op: 60, w: 100, h: 100, layers: [{ ty: 4, ip: 0, op: 60, shapes: [{ ty: 'fl', c: { a: 0, k: [2, 0, 0] } }] }] });
  expect(errors.length).toBeGreaterThan(0);
});
