/** Compare dotted numeric versions (e.g. 0.2.0). Returns -1 / 0 / 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export function versionLt(a: string, b: string): boolean {
  return compareVersions(a, b) < 0;
}

export function versionLte(a: string, b: string): boolean {
  return compareVersions(a, b) <= 0;
}
