/** Stable, well-separated hue for a player id (FNV-1a hash -> hue). */
export function hueFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

export function colorFor(id: string, lightness = 60): string {
  return `hsl(${hueFor(id)} 95% ${lightness}%)`;
}
