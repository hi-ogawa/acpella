export function truncateString(s: string, limit: number) {
  if (s.length > limit) {
    return s.slice(0, limit - 3) + "...";
  }
  return s;
}

export function prefixLines(text: string, prefix: string): string {
  return splitLines(text)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function hangingIndent(text: string, prefix: string): string {
  const indent = " ".repeat(prefix.length);
  return splitLines(text)
    .map((line, index) => `${index === 0 ? prefix : indent}${line}`)
    .join("\n");
}

export function formatSessionLog(sessionName: string, label: string, text: string): string {
  return hangingIndent(text, `[${sessionName}] (${label}) `);
}

export function objectPickBy<K extends PropertyKey, V>(
  o: Record<K, V>,
  f: (v: V, k: K) => boolean,
): Record<K, V> {
  return Object.fromEntries(Object.entries(o).filter(([k, v]: any[]) => f(v, k))) as any;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
