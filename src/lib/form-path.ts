export function readFormPath<T = unknown>(source: unknown, path: string): T | undefined {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value == null) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source) as T | undefined;
}
