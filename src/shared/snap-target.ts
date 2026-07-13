export type SnapTargetParts = readonly [siteFilter: string, origin: string];

export const MAX_SNAP_TARGET_LENGTH = 512;

function parseSnapTarget(value: string): SnapTargetParts | string {
  const target = value.trim();
  if (!target) {
    return "Snap target is empty";
  }
  if (target.length > MAX_SNAP_TARGET_LENGTH) {
    return `Snap target must be at most ${MAX_SNAP_TARGET_LENGTH} characters`;
  }
  if (/\s/.test(target)) {
    return "Snap target cannot contain whitespace";
  }

  try {
    const withScheme = target.includes("://") ? target : `https://${target}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "Snap target must use http or https";
    }
    if (!(url.hostname && url.host) || url.username || url.password) {
      return "Invalid snap target";
    }
    if (url.search || url.hash) {
      return "Snap target cannot contain a query or fragment";
    }

    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    const siteHost = url.host.startsWith("www.")
      ? url.host.substring(4)
      : url.host;
    return [`+site:${siteHost}${path}`, `${url.protocol}//${url.host}${path}`];
  } catch {
    return "Invalid snap target";
  }
}

export function validateSnapTarget(value: string): string | null {
  const parsed = parseSnapTarget(value);
  return typeof parsed === "string" ? parsed : null;
}

export function compileSnapTarget(value: string): SnapTargetParts | null {
  const parsed = parseSnapTarget(value);
  return typeof parsed === "string" ? null : parsed;
}
