import { test, expect, type Page, type Route } from "@playwright/test";

// OAuth sign-in through the cross-domain plugin, against the mock provider in
// e2e/mock-oauth-provider.mjs. The SPA (localhost:5176) and the Convex site
// (127.0.0.1:3211) are different sites, like a real cross-domain deployment.

const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL!;
const mockOAuthUrl = process.env.MOCK_OAUTH_URL!;
const mockUserEmail = "mock-oauth-user@example.com";

const VERIFY_PATH = "**/api/auth/cross-domain/one-time-token/verify";

// Starts the OAuth flow from the SPA and stops on the provider's consent page.
// Returns the callback URL the provider would send the browser to.
async function startMockSignIn(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("auth-unauthenticated")).toBeVisible({
    timeout: 30_000,
  });

  const startRequest = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/auth/cross-domain/oauth/start") &&
      req.method() === "POST"
  );
  await page.getByRole("button", { name: "Sign in with Mock" }).click();

  // The client starts the redirect with a top-level form POST from the SPA
  const start = await startRequest;
  expect(await start.headerValue("origin")).toBe("http://localhost:5176");
  expect(await start.headerValue("content-type")).toContain(
    "application/x-www-form-urlencoded"
  );
  const startResponse = await start.response();
  expect(startResponse?.status()).toBe(302);
  expect(await startResponse?.headerValue("location")).toContain(
    `${mockOAuthUrl}/authorize`
  );

  const continueLink = page.locator("#continue");
  await expect(continueLink).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toContain(`${mockOAuthUrl}/authorize`);

  // The start endpoint set Better Auth's signed state cookie on the Convex
  // site, in this browser
  const cookies = await page.context().cookies(convexSiteUrl);
  expect(cookies.map((c) => c.name)).toContain("better-auth.state");

  const callbackUrl = await continueLink.getAttribute("href");
  expect(callbackUrl).toContain(`${convexSiteUrl}/api/auth/callback/mock?`);
  return callbackUrl!;
}

async function expectSignedIn(page: Page) {
  await expect(page.getByTestId("auth-authenticated")).toBeVisible({
    timeout: 30_000,
  });
  // Rendered from the authenticated Convex query api.auth.getCurrentUser
  await expect(page.getByText(mockUserEmail)).toBeVisible({ timeout: 30_000 });
}

// helmet and many apps use no-referrer, under which browsers send
// `Origin: null` on a cross-origin form POST
for (const via of ["header", "meta tag"] as const) {
  test(`OAuth sign-in works when the app sets a no-referrer policy (${via})`, async ({
    page,
  }) => {
    if (via === "header") {
      await page.route("http://localhost:5176/**", async (route: Route) => {
        if (route.request().resourceType() !== "document") {
          return route.fallback();
        }
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: { ...response.headers(), "referrer-policy": "no-referrer" },
        });
      });
    } else {
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const meta = document.createElement("meta");
          meta.name = "referrer";
          meta.content = "no-referrer";
          document.head.prepend(meta);
        });
      });
    }
    await startMockSignIn(page);
    await page.locator("#continue").click();
    await expectSignedIn(page);
  });
}

test("OAuth sign-in from the cross-domain SPA ends signed in", async ({
  page,
}) => {
  await startMockSignIn(page);

  const verifyRequest = page.waitForRequest(VERIFY_PATH);
  await page.locator("#continue").click();

  // The callback hands the session to the SPA with a one-time token, which
  // the SPA redeems with the verifier stored when the flow started
  const verify = await verifyRequest;
  const body = verify.postDataJSON();
  expect(body.token).toEqual(expect.any(String));
  expect(body.verifier).toEqual(expect.any(String));
  expect((await verify.response())?.status()).toBe(200);

  await expectSignedIn(page);
  expect(page.url()).not.toContain("ott=");

  // Session survives a reload
  await page.reload();
  await expectSignedIn(page);
});

test("the one-time token can't be redeemed by another browser", async ({
  page,
  browser,
}) => {
  await startMockSignIn(page);

  // Hold the SPA's verify request in browser A, so the token isn't redeemed
  let resolveHeld: (route: Route) => void;
  const held = new Promise<Route>((resolve) => (resolveHeld = resolve));
  await page.route(VERIFY_PATH, (route) => resolveHeld(route));

  await page.locator("#continue").click();
  const heldRoute = await held;
  const { token, verifier } = heldRoute.request().postDataJSON();
  expect(token).toEqual(expect.any(String));
  expect(verifier).toEqual(expect.any(String));

  // Browser B opens the SPA with the stolen token
  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    const verifyResponseB = pageB.waitForResponse(VERIFY_PATH);
    await pageB.goto(`/?ott=${token}`);
    const responseB = await verifyResponseB;
    expect(responseB.status()).toBe(400);
    expect(responseB.request().postDataJSON().verifier).toBeUndefined();

    await expect(pageB.getByTestId("auth-unauthenticated")).toBeVisible({
      timeout: 30_000,
    });
    await pageB.reload();
    await expect(pageB.getByTestId("auth-unauthenticated")).toBeVisible({
      timeout: 30_000,
    });
    await expect(pageB.getByTestId("auth-authenticated")).toHaveCount(0);
  } finally {
    await contextB.close();
  }

  // The token was valid: browser A, which started the flow, redeems it
  const verifyResponseA = page.waitForResponse(VERIFY_PATH);
  await heldRoute.continue();
  expect((await verifyResponseA).status()).toBe(200);
  await page.unroute(VERIFY_PATH);
  await expectSignedIn(page);
});

test("a callback URL forwarded to another browser fails with state_mismatch", async ({
  page,
  browser,
}) => {
  const callbackUrl = await startMockSignIn(page);

  // Browser B gets the provider's callback URL (code + state) from browser A
  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    const callbackResponse = pageB.waitForResponse((res) =>
      res.url().startsWith(`${convexSiteUrl}/api/auth/callback/mock`)
    );
    await pageB.goto(callbackUrl);
    const callback = await callbackResponse;
    expect(callback.status()).toBe(302);
    const location = (await callback.headerValue("location")) ?? "";
    expect(location).toContain("error=state_mismatch");
    expect(location).not.toContain("ott=");
    expect(pageB.url()).toContain("error=state_mismatch");

    // No session anywhere in browser B
    const cookiesB = await contextB.cookies();
    expect(cookiesB.filter((c) => c.name.includes("session_token"))).toEqual(
      []
    );
    await pageB.goto("/");
    await expect(pageB.getByTestId("auth-unauthenticated")).toBeVisible({
      timeout: 30_000,
    });
    await expect(pageB.getByTestId("auth-authenticated")).toHaveCount(0);
  } finally {
    await contextB.close();
  }

  // The callback URL was valid: browser A, which started the flow, completes it
  await page.locator("#continue").click();
  await expectSignedIn(page);
});
