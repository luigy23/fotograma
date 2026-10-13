let counter = 0;

export function uid(): string {
  counter += 1;
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}
