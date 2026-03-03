export type TemplateParts = readonly [string, string];
const TEMPLATE_CACHE = new Map<string, TemplateParts | null>();

export function resolveTemplateParts(url: string): TemplateParts | null {
  const cached = TEMPLATE_CACHE.get(url);
  if (cached !== undefined) {
    return cached;
  }
  const idx = url.indexOf("{}");
  const parts =
    idx === -1
      ? null
      : ([url.substring(0, idx), url.substring(idx + 2)] as const);
  TEMPLATE_CACHE.set(url, parts);
  return parts;
}
