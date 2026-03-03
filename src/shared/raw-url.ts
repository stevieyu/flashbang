const CH_SLASH = 47; // /

export function readPathname(rawUrl: string): string {
  const schemePos = rawUrl.indexOf("://");
  let start = 0;
  if (schemePos !== -1) {
    start = rawUrl.indexOf("/", schemePos + 3);
    if (start === -1) {
      return "/";
    }
  } else if (rawUrl.charCodeAt(0) === CH_SLASH) {
    start = 0;
  } else {
    return "/";
  }

  let end = rawUrl.length;
  const qPos = rawUrl.indexOf("?", start);
  if (qPos !== -1 && qPos < end) {
    end = qPos;
  }
  const hPos = rawUrl.indexOf("#", start);
  if (hPos !== -1 && hPos < end) {
    end = hPos;
  }

  return end === start ? "/" : rawUrl.substring(start, end);
}

export function readOrigin(rawUrl: string): string {
  const schemePos = rawUrl.indexOf("://");
  if (schemePos === -1) {
    return "";
  }

  const slashPos = rawUrl.indexOf("/", schemePos + 3);
  if (slashPos === -1) {
    return rawUrl;
  }
  return rawUrl.substring(0, slashPos);
}
