const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
];

const removeHopByHopHeaders = (headers: Headers) => {
  const listed = headers.get("connection")?.split(",") ?? [];
  for (const name of [...HOP_BY_HOP_HEADERS, ...listed]) {
    const trimmed = name.trim();
    if (/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(trimmed)) {
      headers.delete(trimmed);
    }
  }
};

/**
 * Copies the headers of a request the framework handlers forward to Convex,
 * without its hop-by-hop headers (RFC 9110 section 7.6.1), `expect` and
 * `content-length`. They describe the client's connection to the app, and
 * Node's fetch rejects `transfer-encoding`, `keep-alive`, `upgrade` and
 * `expect` outright, which turned such requests into a 500.
 */
export const toProxyRequestHeaders = (request: Request) => {
  const headers = new Headers(request.headers);
  removeHopByHopHeaders(headers);
  headers.delete("expect");
  headers.delete("content-length");
  return headers;
};

/**
 * Rebuilds a proxied upstream response without its hop-by-hop headers
 * (RFC 9110 section 7.6.1). They describe the proxy-to-Convex connection; if
 * the framework re-emits them, e.g. `connection: keep-alive`, Node keeps the
 * client socket open even though the client sent `Connection: close`.
 */
export const toProxyResponse = (upstream: Response) => {
  const headers = new Headers(upstream.headers);
  removeHopByHopHeaders(headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};
