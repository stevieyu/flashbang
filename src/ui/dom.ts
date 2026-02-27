export function $<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) {
    throw new Error(`Missing: ${sel}`);
  }
  return el as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}
