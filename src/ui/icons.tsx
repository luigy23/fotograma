// Iconos de trazo a 1.6px, dibujados a mano para no depender de librerías.
import type { ReactElement } from 'react';

const P = (d: string, extra?: ReactElement) => (size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
);

export const Icon = {
  select: P('M5 3l13 8-6 1.5L9 19z'),
  rect: P('M4.5 5.5h15v13h-15z'),
  ellipse: P('M12 5c4.7 0 8 3.1 8 7s-3.3 7-8 7-8-3.1-8-7 3.3-7 8-7z'),
  polygon: P('M12 3.5l7.8 4.5v8L12 20.5 4.2 16V8z'),
  star: P('M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'),
  path: P('M4 18c4-1 3-11 8-12s5 9 8 7'),
  group: P('M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3', <rect x="8" y="8" width="8" height="8" rx="1" />),
  ungroup: P('M3.5 3.5h7v7h-7zM13.5 13.5h7v7h-7z', <path d="M13.5 6.5h4v4M10.5 17.5h-4v-4" strokeDasharray="2 2" />),
  image: P('M4 5h16v14H4z', <path d="M4 16l5-5 4 4 2.5-2.5L20 17M15 9.5h.01" />),
  eye: P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', <circle cx="12" cy="12" r="2.6" />),
  eyeOff: P('M3 3l18 18M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 01-2.6 3.3M6.5 7.6A16 16 0 002.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1'),
  lock: P('M6.5 10.5h11v9h-11z', <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />),
  unlock: P('M6.5 10.5h11v9h-11z', <path d="M8.5 10.5V8a3.5 3.5 0 016.8-1.2" />),
  chevronRight: P('M9 6l6 6-6 6'),
  chevronDown: P('M6 9l6 6 6-6'),
  play: P('M7 4.5v15l12-7.5z'),
  pause: P('M7.5 5v14M16.5 5v14'),
  first: P('M6 5v14M18 5.5L9 12l9 6.5z'),
  last: P('M18 5v14M6 5.5l9 6.5-9 6.5z'),
  prev: P('M15 6l-6 6 6 6'),
  next: P('M9 6l6 6-6 6'),
  loop: P('M4 12a7 7 0 0112-5l2 2M20 12a7 7 0 01-12 5l-2-2', <path d="M18 4v5h-5M6 20v-5h5" />),
  undo: P('M8 8H4V4M4.5 8.5A8 8 0 1112 20'),
  redo: P('M16 8h4V4M19.5 8.5A8 8 0 1012 20'),
  upload: P('M12 16V4M7 9l5-5 5 5M4 16v4h16v-4'),
  download: P('M12 4v12M7 11l5 5 5-5M4 20h16'),
  file: P('M6 3.5h8l4 4v13H6z', <path d="M14 3.5v4h4" />),
  plus: P('M12 5v14M5 12h14'),
  trash: P('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13'),
  copy: P('M8 8h11v11H8z', <path d="M5 16V5h11" />),
  fit: P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  minus: P('M5 12h14'),
  link: P('M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'),
  unlink: P('M14.5 6.3l-.5.5M19 11l-1.5 1.5M9.5 17.7l.5-.5M5 13l1.5-1.5M8 4v2M4 8h2M16 20v-2M20 16h-2'),
  x: P('M6 6l12 12M18 6L6 18'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  warn: P('M12 4l9 16H3z', <path d="M12 10v4M12 17h.01" />),
  sparkle: P('M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6'),
  diamond: (size = 12) => (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <path d="M6 1l5 5-5 5-5-5z" fill="currentColor" />
    </svg>
  ),
  diamondOutline: (size = 12) => (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <path d="M6 1.6l4.4 4.4L6 10.4 1.6 6z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  diamondHalf: (size = 12) => (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <path d="M6 1.6l4.4 4.4L6 10.4 1.6 6z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 1.6L1.6 6 6 10.4z" fill="currentColor" />
    </svg>
  ),
};
