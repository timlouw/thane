/** The known name closest to `name`: the same letters in another case, or one or two edits away. */
export const closestName = (name: string, known: Iterable<string>): string | undefined => {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const above = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[b.length]!;
  };
  let best: { name: string; score: number } | undefined;
  for (const candidate of known) {
    const score = candidate.toLowerCase() === name.toLowerCase() ? 0 : distance(name, candidate);
    if (score <= 2 && (!best || score < best.score)) best = { name: candidate, score };
  }
  return best?.name;
};
