// A tiny OAuth 2.0 authorization server for the e2e tests.
//
// GET  /authorize  shows a consent page whose "Continue" link redirects back to
//                  redirect_uri with code + state
// POST /token      exchanges a code (client secret + PKCE S256 checked, single use)
// GET  /userinfo   returns the user for a Bearer access token
// GET  /health     readiness check for Playwright's webServer
//
// The Convex local backend calls /token and /userinfo from the same machine.

import http from "node:http";
import crypto from "node:crypto";

const port = Number(process.env.MOCK_OAUTH_PORT ?? 4590);
const host = process.env.MOCK_OAUTH_HOST ?? "127.0.0.1";
const clientId = process.env.MOCK_OAUTH_CLIENT_ID ?? "e2e-client";
const clientSecret = process.env.MOCK_OAUTH_CLIENT_SECRET ?? "e2e-secret";

const user = {
  id: "mock-user-1",
  sub: "mock-user-1",
  email: "mock-oauth-user@example.com",
  email_verified: true,
  name: "Mock OAuth User",
};

// code -> { redirectUri, codeChallenge, codeChallengeMethod }
const codes = new Map();
// access token -> user
const accessTokens = new Map();

const log = (...args) => console.log("[mock-oauth]", ...args);

const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]
  );

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const handleAuthorize = (url, res) => {
  const params = url.searchParams;
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  if (params.get("client_id") !== clientId || !redirectUri || !state) {
    return json(res, 400, { error: "invalid_request" });
  }
  if (params.get("response_type") !== "code") {
    return json(res, 400, { error: "unsupported_response_type" });
  }
  const code = crypto.randomBytes(16).toString("hex");
  codes.set(code, {
    redirectUri,
    codeChallenge: params.get("code_challenge"),
    codeChallengeMethod: params.get("code_challenge_method"),
  });
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  log("authorize", { redirectUri, state });
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html><head><title>Mock OAuth consent</title></head>
<body>
  <h1>Mock OAuth Provider</h1>
  <p>Sign in to the e2e app as ${escapeHtml(user.email)}?</p>
  <a id="continue" href="${escapeHtml(callback.toString())}">Continue</a>
</body></html>`);
};

const handleToken = async (req, res) => {
  const params = new URLSearchParams(await readBody(req));
  let id = params.get("client_id");
  let secret = params.get("client_secret");
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString();
    const sep = decoded.indexOf(":");
    id = decodeURIComponent(decoded.slice(0, sep));
    secret = decodeURIComponent(decoded.slice(sep + 1));
  }
  if (id !== clientId || secret !== clientSecret) {
    log("token: invalid client", { id });
    return json(res, 401, { error: "invalid_client" });
  }
  if (params.get("grant_type") !== "authorization_code") {
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  const code = params.get("code");
  const entry = code ? codes.get(code) : undefined;
  if (!entry) {
    log("token: invalid code");
    return json(res, 400, { error: "invalid_grant" });
  }
  // Codes are single use
  codes.delete(code);
  if (params.get("redirect_uri") !== entry.redirectUri) {
    log("token: redirect_uri mismatch");
    return json(res, 400, { error: "invalid_grant" });
  }
  if (entry.codeChallenge) {
    const verifier = params.get("code_verifier") ?? "";
    const challenge =
      entry.codeChallengeMethod === "S256"
        ? crypto.createHash("sha256").update(verifier).digest("base64url")
        : verifier;
    if (challenge !== entry.codeChallenge) {
      log("token: PKCE mismatch");
      return json(res, 400, { error: "invalid_grant" });
    }
  }
  const accessToken = crypto.randomBytes(24).toString("hex");
  accessTokens.set(accessToken, user);
  log("token issued");
  json(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid profile email",
  });
};

const handleUserInfo = (req, res) => {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const found = accessTokens.get(token);
  if (!found) {
    log("userinfo: invalid token");
    return json(res, 401, { error: "invalid_token" });
  }
  log("userinfo", found.email);
  json(res, 200, found);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      return handleAuthorize(url, res);
    }
    if (req.method === "POST" && url.pathname === "/token") {
      return await handleToken(req, res);
    }
    if (req.method === "GET" && url.pathname === "/userinfo") {
      return handleUserInfo(req, res);
    }
    json(res, 404, { error: "not_found" });
  } catch (error) {
    log("error", error);
    json(res, 500, { error: "server_error" });
  }
});

server.listen(port, host, () => {
  log(`listening on http://${host}:${port}`);
});
