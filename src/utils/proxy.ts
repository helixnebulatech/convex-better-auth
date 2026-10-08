const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
];

/**
 * Rebuilds a proxied upstream response without its hop-by-hop headers
 * (RFC 9110 section 7.6.1). They describe the proxy-to-Convex connection; if
 * the framework re-emits them, e.g. `connection: keep-alive`, Node keeps the
 * client socket open even though the client sent `Connection: close`.
 */
export const toProxyResponse = (upstream: Response) => {
  const headers = new Headers(upstream.headers);
  const listed = headers.get("connection")?.split(",") ?? [];
  for (const name of [...HOP_BY_HOP_HEADERS, ...listed]) {
    const trimmed = name.trim();
    if (/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(trimmed)) {
      headers.delete(trimmed);
    }
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};
