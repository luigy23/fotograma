import type { Doc, Ease, ImageAsset, ImageNode, Prop, ShapeNode } from '../model/types';
import { easeById } from '../model/animate';
import { makeDoc, makeImage, makeShape } from '../model/defaults';
import { makeEffect } from '../model/effects';
import { uid } from '../model/uid';

// Ejemplo que viene con la app: un mago pixel que respira, lanza un hechizo y
// celebra. Los sprites están dibujados aquí mismo en texto (un carácter por
// píxel) para poder retocarlos sin herramientas.

const PALETTE: Record<string, string> = {
  k: '#1b1630', // contorno
  p: '#6d5dfc', // túnica
  P: '#9d92ff', // brillo de la túnica
  d: '#4a3fc4', // sombra de la túnica
  s: '#f2c9a0', // piel
  S: '#d9a679', // sombra de la piel
  w: '#f4f1ea', // barba
  W: '#cfcac0', // sombra de la barba
  y: '#f5b84a', // oro
  Y: '#fff3c4', // brillo del oro
  b: '#8a5a2b', // madera
  B: '#b07a40', // brillo de la madera
  o: '#5ad8ff', // orbe
  O: '#d6f7ff', // brillo del orbe
  c: '#2a8fb8', // sombra del orbe
  e: '#1b1630', // ojos
};

const WIZARD = [
  '............kkk.......',
  '...........kppk.......',
  '..........kpppk.......',
  '..........kpPpk.......',
  '.........kppPppk......',
  '.........kpppppk......',
  '........kpppyppk......',
  '........kppyYypk......',
  '.......kpppPyppppk....',
  '....kkkkkkkkkkkkkkkk..',
  '...kddddddddddddddddk.',
  '....kkkkkkkkkkkkkkkk..',
  '......kssssssssssk....',
  '......kssssssssssk....',
  '......ksSssssssSsk....',
  '......kwwwsssswwwk....',
  '.....kwwwwwwwwwwwwk...',
  '....kpkwwwwwwwwwwkpk..',
  '...kppkwwwwWwwwwwkppk.',
  '...kppPkwwwwwwwwkpPpk.',
  '..kpppPkwwwWwwwkpPpppk',
  '..kpppPpkwwwwwkppPpppk',
  '..kpppPppkwwwkpppPpppk',
  '..kpppPpppkkkppppPpppk',
  '..kpppPpppppppppPppppk',
  '..kpppPpppppppppPppdpk',
  '.kppppPppppppppppPpdpk',
  '.kpppPpppppppppppppddk',
  '.kddddddddddddddddddk.',
  '.kkkkkkkkkkkkkkkkkkkk.',
];

const EYES = ['ee..ee', 'ee..ee'];
const CLOSED_EYES = ['ee..ee'];

const STAFF = [
  '.k...k.',
  '.kb.bk.',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '.kkbkk.',
  'kssssk.',
  'ksSSsk.',
  '.kbbk..',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '..kBk..',
  '..kbk..',
  '..kbk..',
  '..kkk..',
];

const ORB = ['..kkk..', '.kOook.', 'kOooook', 'koooock', 'koooock', '.kocck.', '..kkk..'];

const STAR = ['...k...', '..kyk..', 'kkyYykk', 'kyYYYyk', 'kkyYykk', '..kyk..', '...k...'];

const CIRCLE = [
  '........oooooooooooooooo........',
  '....oooo................oooo....',
  '.ooo........................ooo.',
  'o..............................o',
  '.ooo........................ooo.',
  '....oooo................oooo....',
  '........oooooooooooooooo........',
];

/** De texto a PNG: cada carácter es un píxel de la paleta; el punto es transparente. */
async function sprite(name: string, rows: string[]): Promise<ImageAsset> {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = PALETTE[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return { id: 'demo_' + name, name: `${name}.png`, w, h, data: c.toDataURL('image/png') };
}

type EaseId = 'linear' | 'smooth' | 'in' | 'out' | 'bounce' | 'hold';
type K = [frame: number, value: number[], ease?: EaseId];

function track(p: Prop, keys: K[]) {
  p.keys = keys.map(([frame, value, e = 'smooth']) => {
    const ease: Ease = easeById(e === 'hold' ? 'linear' : e);
    return { id: uid(), frame, value, ease: { o: [...ease.o], i: [...ease.i] }, hold: e === 'hold' || undefined };
  });
  p.value = [...keys[0][1]];
}

/** Desplazamiento vertical del cuerpo: respira, se agacha, toma impulso, salta dos veces. */
const BODY: [number, number, EaseId][] = [
  [0, 0, 'hold'],
  [9, -1, 'hold'],
  [18, 0, 'hold'],
  [27, -1, 'hold'],
  [36, 1, 'hold'],
  [39, 2, 'out'],
  [43, -2, 'smooth'],
  [48, 0, 'hold'],
  [60, 0, 'out'],
  [66, -7, 'in'],
  [72, 1, 'hold'],
  [74, 0, 'out'],
  [79, -4, 'in'],
  [84, 1, 'hold'],
  [86, 0, 'hold'],
  [96, 0, 'hold'],
  [105, -1, 'hold'],
  [114, 0, 'hold'],
  [120, 0, 'hold'],
];

/** El bastón sigue al cuerpo y además se levanta al lanzar el hechizo. */
const STAFF_DY: [number, number, EaseId][] = [
  [0, 0, 'hold'],
  [9, -1, 'hold'],
  [18, 0, 'hold'],
  [27, -1, 'hold'],
  [36, 1, 'hold'],
  [39, 2, 'out'],
  [44, -8, 'smooth'],
  [48, -6, 'hold'],
  [60, -6, 'out'],
  [66, -10, 'in'],
  [72, 1, 'hold'],
  [74, 0, 'out'],
  [79, -4, 'in'],
  [84, 1, 'hold'],
  [86, 0, 'hold'],
  [96, 0, 'hold'],
  [105, -1, 'hold'],
  [114, 0, 'hold'],
  [120, 0, 'hold'],
];

function follow(node: ImageNode, dy: [number, number, EaseId][]) {
  const [x, y] = node.transform.position.value;
  track(
    node.transform.position,
    dy.map(([f, d, e]) => [f, [x, y + d], e]),
  );
}

function image(asset: ImageAsset, name: string, left: number, top: number): ImageNode {
  // Posición = esquina superior izquierda + ancla (centro redondeado hacia abajo).
  return makeImage(asset.id, name, asset.w, asset.h, [left + Math.floor(asset.w / 2), top + Math.floor(asset.h / 2)], true);
}

export async function buildWizardDemo(): Promise<Doc> {
  const doc = makeDoc();
  doc.name = 'Mago pixel';
  doc.width = 64;
  doc.height = 64;
  doc.fps = 30;
  doc.duration = 120;
  doc.pixel = true;
  doc.background = '#241f42';

  const [aWizard, aEyes, aClosed, aStaff, aOrb, aStar, aCircle] = await Promise.all([
    sprite('mago', WIZARD),
    sprite('ojos', EYES),
    sprite('ojos-cerrados', CLOSED_EYES),
    sprite('baston', STAFF),
    sprite('orbe', ORB),
    sprite('estrella', STAR),
    sprite('circulo', CIRCLE),
  ]);
  doc.assets = [aWizard, aEyes, aClosed, aStaff, aOrb, aStar, aCircle];

  // Sombra vectorial: se encoge cuando el mago está en el aire.
  const shadow = makeShape('ellipse', [25, 56], 24, 4, 'Sombra') as ShapeNode;
  shadow.fill.color.value = [0.106, 0.086, 0.188];
  shadow.fill.opacity.value = [45];
  track(shadow.transform.scale, [
    [0, [100, 100], 'hold'],
    [60, [100, 100], 'out'],
    [66, [60, 100], 'in'],
    [72, [100, 100], 'out'],
    [79, [78, 100], 'in'],
    [84, [100, 100], 'smooth'],
    [120, [100, 100], 'hold'],
  ]);

  // Círculo mágico en el suelo durante el hechizo, con brillo suave.
  const circle = image(aCircle, 'Círculo mágico', 9, 52);
  circle.inFrame = 38;
  circle.outFrame = 66;
  track(circle.transform.scale, [
    [38, [0, 0], 'hold'],
    [39, [100, 100], 'hold'],
    [66, [100, 100], 'hold'],
  ]);
  track(circle.transform.opacity, [
    [38, [100], 'smooth'],
    [56, [100], 'smooth'],
    [66, [0], 'smooth'],
  ]);
  circle.effects = [{ ...makeEffect('glow', uid()), color: [0.35, 0.85, 1], intensity: 35, speed: 0.5 }];

  const wizard = image(aWizard, 'Mago', 14, 25);
  follow(wizard, BODY);

  // Parpadeo y ojos felices al celebrar: se alternan dos capas.
  const eyes = image(aEyes, 'Ojos', 23, 38);
  follow(eyes, BODY);
  track(eyes.transform.opacity, [
    [0, [100], 'hold'],
    [20, [0], 'hold'],
    [23, [100], 'hold'],
    [60, [0], 'hold'],
    [88, [100], 'hold'],
    [108, [0], 'hold'],
    [111, [100], 'hold'],
    [120, [100], 'hold'],
  ]);
  const closed = image(aClosed, 'Ojos cerrados', 23, 39);
  follow(closed, BODY);
  track(closed.transform.opacity, [
    [0, [0], 'hold'],
    [20, [100], 'hold'],
    [23, [0], 'hold'],
    [60, [100], 'hold'],
    [88, [0], 'hold'],
    [108, [100], 'hold'],
    [111, [0], 'hold'],
    [120, [0], 'hold'],
  ]);

  const staff = image(aStaff, 'Bastón', 35, 24);
  follow(staff, STAFF_DY);

  // El orbe: en el bastón, sale volando, crece y estalla; luego vuelve a aparecer.
  const orb = image(aOrb, 'Orbe', 35, 18);
  track(orb.transform.position, [
    [0, [38, 21], 'hold'],
    [9, [38, 20], 'hold'],
    [18, [38, 21], 'hold'],
    [27, [38, 20], 'hold'],
    [36, [38, 22], 'hold'],
    [39, [38, 23], 'out'],
    [44, [38, 13], 'out'],
    [50, [44, 8], 'smooth'],
    [56, [48, 12], 'hold'],
    [96, [38, 21], 'hold'],
    [105, [38, 20], 'hold'],
    [114, [38, 21], 'hold'],
    [120, [38, 21], 'hold'],
  ]);
  track(orb.transform.scale, [
    [0, [100, 100], 'hold'],
    [47, [200, 200], 'hold'],
    [53, [100, 100], 'hold'],
    [96, [0, 0], 'hold'],
    [98, [100, 100], 'hold'],
    [120, [100, 100], 'hold'],
  ]);
  track(orb.transform.opacity, [
    [0, [100], 'hold'],
    [56, [0], 'hold'],
    [96, [100], 'hold'],
    [120, [100], 'hold'],
  ]);
  orb.effects = [{ ...makeEffect('pixelGlow', uid()), color: [0.62, 0.94, 1], intensity: 60, speed: 1 }];

  // La estrella del estallido: pop a saltos (×3, ×2, ×1), cae un poco y se apaga.
  const star = image(aStar, 'Estrella', 45, 9);
  star.inFrame = 56;
  star.outFrame = 92;
  track(star.transform.position, [
    [56, [48, 12], 'smooth'],
    [92, [48, 18], 'smooth'],
  ]);
  track(star.transform.scale, [
    [56, [0, 0], 'hold'],
    [57, [300, 300], 'hold'],
    [59, [200, 200], 'hold'],
    [80, [200, 200], 'hold'],
    [83, [100, 100], 'hold'],
    [92, [100, 100], 'hold'],
  ]);
  track(star.transform.opacity, [
    [56, [100], 'smooth'],
    [78, [100], 'smooth'],
    [92, [0], 'smooth'],
  ]);
  star.effects = [{ ...makeEffect('sparkles', uid()), color: [1, 0.85, 0.4], intensity: 80, speed: 0.6 }];

  // Orden del panel: arriba lo que va delante.
  doc.nodes = [star, orb, staff, closed, eyes, wizard, circle, shadow];
  doc.segments = [
    { id: uid(), name: 'reposo', start: 0, end: 36 },
    { id: uid(), name: 'hechizo', start: 36, end: 60 },
    { id: uid(), name: 'celebra', start: 60, end: 120 },
  ];
  return doc;
}
