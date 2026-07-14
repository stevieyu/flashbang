export function canonicalizePublicOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function opensearch(origin: string): Response {
  const escapedOrigin = escapeXml(origin);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>flashbang</ShortName>
  <Description>The sub-1ms local first duck-duck-go style bang redirects</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/svg+xml">${escapedOrigin}/icon.svg</Image>
  <Url type="text/html" template="${escapedOrigin}/?q={searchTerms}"/>
  <Url type="application/x-suggestions+json" template="${escapedOrigin}/suggest?q={searchTerms}"/>
</OpenSearchDescription>`,
    {
      headers: { "Content-Type": "application/opensearchdescription+xml" },
    }
  );
}
