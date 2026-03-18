import { expect, type Page, test } from "@playwright/test";
import { encodeSuggestCookieValue } from "../../src/shared/suggest-cookie";

const GOOGLE_REDIRECT = /google\.com\/search\?q=hello/;
const GOOGLE_HOST = "https://www.google.com";
const CUSTOM_HOST = "https://example.com";

async function mockGoogleSearchRoute(page: Page): Promise<void> {
  await page.route(`${GOOGLE_HOST}/**`, (route) => {
    const url = route.request().url();
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: `mocked ${url}`,
    });
  });
}

async function mockCustomHostRoute(page: Page): Promise<void> {
  await page.route(`${CUSTOM_HOST}/**`, (route) => {
    const url = route.request().url();
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: `custom ${url}`,
    });
  });
}

async function ensureWarmController(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () =>
          "serviceWorker" in navigator &&
          navigator.serviceWorker.controller !== null,
        { timeout: 10_000 }
      );
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "");
      if (
        message.includes("interrupted by another navigation") ||
        message.includes("Execution context was destroyed")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("failed to establish service worker controller in warm mode");
}

async function navigateAndWaitForRedirect(
  page: Page,
  target: string,
  expectedUrl: RegExp
): Promise<void> {
  const navigation = page
    .goto(target, { waitUntil: "commit" })
    .catch((error) => {
      const message =
        error instanceof Error ? error.message : String(error ?? "");
      if (
        message.includes("ERR_ABORTED") ||
        message.includes("interrupted by another navigation")
      ) {
        return null;
      }
      throw error;
    });
  await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(expectedUrl);
  await navigation;
}

async function seedCustomBangs(
  page: Page,
  bangs: Array<{ trigger: string; name: string; url: string }>
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate(async (customBangs) => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("flashbang", 1);

          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("settings")) {
              db.createObjectStore("settings", { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains("custom-bangs")) {
              db.createObjectStore("custom-bangs", { keyPath: "trigger" });
            }
          };

          req.onerror = () => {
            reject(req.error ?? new Error("failed to open IndexedDB"));
          };

          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("custom-bangs", "readwrite");
            const store = tx.objectStore("custom-bangs");
            for (const bang of customBangs) {
              store.put(bang);
            }
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error ?? new Error("failed to write custom bangs"));
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error ?? new Error("custom bang transaction aborted"));
            };
          };
        });
      }, bangs);

      await page.evaluate(() => {
        navigator.serviceWorker.controller?.postMessage({ type: "invalidate" });
      });
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "");
      if (message.includes("Execution context was destroyed")) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("failed to seed custom bangs after retries");
}

test("suggest endpoint returns 400 when q parameter is missing", async ({
  request,
}) => {
  const response = await request.get("/suggest");
  expect(response.status()).toBe(400);
  await expect(response.text()).resolves.toContain("Missing q parameter");
});

test("suggest endpoint respects provider override via sp=none", async ({
  request,
}) => {
  const response = await request.get("/suggest", {
    params: { q: "hello", sp: "none" },
  });
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual(["hello", []]);
});

test("suggestions include custom bang entries from the suggest cookie", async ({
  page,
}) => {
  await page.goto("/");
  const customBang = "mycustombang";
  const query = "!mycustom";
  await page.evaluate(
    (suggestCookie) => {
      document.cookie = `suggest=${suggestCookie};path=/`;
    },
    encodeSuggestCookieValue("default", "g", "", [customBang])
  );

  const response = await page.evaluate(async (q) => {
    const res = await fetch(`/suggest?q=${encodeURIComponent(q)}`);
    return {
      status: res.status,
      payload: await res.json(),
    };
  }, query);
  expect(response.status).toBe(200);

  const payload = response.payload;
  expect(payload[0]).toBe(query);
  expect(payload[1]).toContain(`!${customBang}`);
});

test("warm redirect uses service worker controlled fetch path", async ({
  page,
}) => {
  await mockGoogleSearchRoute(page);
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(page, "/?q=%21g%20hello", GOOGLE_REDIRECT);
  expect(page.url()).toMatch(GOOGLE_REDIRECT);
});

test("warm redirect supports suffix bang syntax", async ({ page }) => {
  await mockGoogleSearchRoute(page);
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(page, "/?q=hello%20g%21", GOOGLE_REDIRECT);
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get("q")).toBe("hello");
});

test("warm redirect falls back to default search for unknown bangs", async ({
  page,
}) => {
  await mockGoogleSearchRoute(page);
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=%21zzzb%20hello",
    /google\.com\/search\?/
  );
  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe("www.google.com");
  expect(redirected.pathname).toBe("/search");
  expect(redirected.searchParams.get("q")).toBe("!zzzb hello");
});

test("warm redirect uses lucky URL for trailing bare bang", async ({
  page,
}) => {
  await mockGoogleSearchRoute(page);
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=hello%20%21",
    /google\.com\/search\?/
  );
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get("q")).toBe("hello");
  expect(redirected.searchParams.get("btnI")).toBe("1");
});

test("custom bang redirects to custom target", async ({ page }) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await seedCustomBangs(page, [
    {
      trigger: "mydocs",
      name: "My Docs",
      url: `${CUSTOM_HOST}/search?q={}`,
    },
  ]);

  await navigateAndWaitForRedirect(
    page,
    "/?q=%21mydocs%20hello",
    /example\.com\/search\?q=hello/
  );
  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe("example.com");
  expect(redirected.pathname).toBe("/search");
  expect(redirected.searchParams.get("q")).toBe("hello");
});

test("custom bang overrides built-in bang trigger", async ({ page }) => {
  await mockGoogleSearchRoute(page);
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await seedCustomBangs(page, [
    {
      trigger: "g",
      name: "Custom G",
      url: `${CUSTOM_HOST}/override?q={}`,
    },
  ]);

  await navigateAndWaitForRedirect(
    page,
    "/?q=%21g%20hello",
    /example\.com\/override\?q=hello/
  );
  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe("example.com");
  expect(redirected.pathname).toBe("/override");
  expect(redirected.searchParams.get("q")).toBe("hello");
});

test("custom bang with no term redirects to custom origin", async ({
  page,
}) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await seedCustomBangs(page, [
    {
      trigger: "mydocs",
      name: "My Docs",
      url: `${CUSTOM_HOST}/search?q={}`,
    },
  ]);

  await navigateAndWaitForRedirect(page, "/?q=%21mydocs", /example\.com/);
  const redirected = new URL(page.url());
  expect(redirected.origin).toBe(CUSTOM_HOST);
});

test("custom bang supports suffix syntax", async ({ page }) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await seedCustomBangs(page, [
    {
      trigger: "mydocs",
      name: "My Docs",
      url: `${CUSTOM_HOST}/search?q={}`,
    },
  ]);

  await navigateAndWaitForRedirect(
    page,
    "/?q=hello%20mydocs%21",
    /example\.com\/search\?q=hello/
  );
  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe("example.com");
  expect(redirected.searchParams.get("q")).toBe("hello");
});

test("custom bang persists after reload in the same context", async ({
  page,
}) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await seedCustomBangs(page, [
    {
      trigger: "mydocs",
      name: "My Docs",
      url: `${CUSTOM_HOST}/search?q={}`,
    },
  ]);

  await navigateAndWaitForRedirect(
    page,
    "/?q=%21mydocs%20first",
    /example\.com\/search\?q=first/
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=%21mydocs%20second",
    /example\.com\/search\?q=second/
  );
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get("q")).toBe("second");
});

test("cold-start redirect uses service worker message path before controller exists", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGoogleSearchRoute(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(
    await page.evaluate(() => {
      if (!("serviceWorker" in navigator)) {
        return null;
      }
      return navigator.serviceWorker.controller;
    })
  ).toBeNull();

  const target = "/?q=%21g%20hello";
  await Promise.all([
    page.waitForURL(/google\.com\/search\?q=hello/),
    page.goto(target, { waitUntil: "commit" }),
  ]);
  expect(await page.url()).toMatch(GOOGLE_REDIRECT);
  await context.close();
});
