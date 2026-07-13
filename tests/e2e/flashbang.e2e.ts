import { expect, type Page, test } from "@playwright/test";
import { encodeSuggestCookieValue } from "../../src/shared/suggest-cookie";

const GOOGLE_REDIRECT = /google\.com\/search\?q=hello/;
const GOOGLE_HOST = "https://www.google.com";
const DDG_HOST = "https://duckduckgo.com";
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

async function mockDuckDuckGoRoute(page: Page): Promise<void> {
  await page.route(`${DDG_HOST}/**`, (route) => {
    const url = route.request().url();
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: `ddg ${url}`,
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
  bangs: Array<{
    trigger: string;
    name: string;
    url: string;
    regex?: string;
    encoding?: "percent" | "plus" | "raw";
    snap?: string;
  }>
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

async function openSettingsModal(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.click("#gear-btn");
  await expect(page.locator("#settings-modal")).toHaveAttribute(
    "aria-hidden",
    "false"
  );
}

async function submitCustomBangForm(page: Page): Promise<void> {
  await page.evaluate(() => {
    const form = document.querySelector("#add-bang-form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("custom bang form not found");
    }
    form.requestSubmit();
  });
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

test("Firefox locks cookie-backed suggestion settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          (
            window as typeof window & { copiedSuggestionUrl?: string }
          ).copiedSuggestionUrl = value;
          return Promise.resolve();
        },
      },
    });
  });

  await openSettingsModal(page);

  await expect(page.locator("#suggest-provider")).toBeDisabled();
  await expect(page.locator("#suggest-provider")).toHaveValue("google");
  await expect(page.locator("#suggest-provider")).toHaveClass(/select-locked/);
  await expect(page.locator("#suggest-url")).toBeDisabled();
  await expect(page.locator("#suggest-firefox-note")).toBeVisible();
  await expect(page.locator("#suggest-firefox-note")).toContainText(
    "Firefox does not send cookies for suggestions"
  );
  const origin = new URL(page.url()).origin;
  await expect(page.locator("#suggest-firefox-url")).toHaveText(
    `${origin}/suggest?q=%s&sp=google`
  );
  await expect(page.locator("#suggest-firefox-url span")).toHaveText("google");
  const providerPicker = page.locator("#suggest-firefox-provider-picker");
  await expect(providerPicker).toContainText("google");
  await providerPicker.hover();
  await expect(page.locator("#suggest-firefox-provider-menu")).toBeVisible();
  await page
    .locator('#suggest-firefox-provider-menu [data-provider="startpage"]')
    .click();
  const expectedUrl = `${origin}/suggest?q=%s&sp=startpage`;
  await expect(page.locator("#suggest-provider")).toHaveValue("google");
  await expect(page.locator("#suggest-firefox-url")).toHaveText(expectedUrl);
  await expect(page.locator("#suggest-firefox-url span")).toHaveText(
    "startpage"
  );
  await expect(providerPicker).toContainText("startpage");
  await providerPicker.click();
  await expect(page.locator("#suggest-firefox-provider-menu")).toBeVisible();
  await providerPicker.click();
  await expect(page.locator("#suggest-firefox-provider-menu")).toBeHidden();
  await page.locator("#suggest-firefox-url").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { copiedSuggestionUrl?: string })
            .copiedSuggestionUrl
      )
    )
    .toBe(expectedUrl);
});

test("suggest endpoint rewrites malformed suggest cookie context", async ({
  request,
}) => {
  const response = await request.get("/suggest", {
    params: { q: "!g" },
    headers: { Cookie: "suggest=custom,g,|f:%E0%A4%A" },
  });

  expect(response.status()).toBe(200);
  const setCookie = response.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain("suggest=custom,g,");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Secure");

  const payload = await response.json();
  expect(payload[0]).toBe("!g");
});

test("opensearch endpoint uses request origin in generated templates", async ({
  request,
}) => {
  const response = await request.get("/opensearch.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain(
    "application/opensearchdescription+xml"
  );

  const origin = new URL(response.url()).origin;
  const xml = await response.text();
  expect(xml).toContain(`${origin}/icon.svg`);
  expect(xml).toContain(`${origin}/?q={searchTerms}`);
  expect(xml).toContain(`${origin}/suggest?q={searchTerms}`);
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

test("settings persist default bang and affect fallback redirects", async ({
  page,
}) => {
  await mockDuckDuckGoRoute(page);
  await ensureWarmController(page);
  await openSettingsModal(page);

  await page.fill("#default-bang", "ddg");
  await page.dispatchEvent("#default-bang", "change");

  await expect
    .poll(() => page.evaluate(() => document.cookie))
    .toContain("suggest=default,ddg,");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(page, "/?q=hello", /duckduckgo\.com\/\?q=/);

  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe("duckduckgo.com");
  expect(redirected.searchParams.get("q")).toBe("hello");
});

test("default provider labels follow the selected bang", async ({ page }) => {
  await openSettingsModal(page);

  const luckyDefault = page.locator("#lucky-default-display");
  const suggestDefault = page.locator("#suggest-default-display");
  await expect(luckyDefault).toHaveText(/Match bang\s*Google/);
  await expect(suggestDefault).toHaveText(/Match bang\s*Google/);

  await page.fill("#default-bang", "google");
  await page.dispatchEvent("#default-bang", "change");
  await expect(luckyDefault).toHaveText(/Match bang\s*Google/);
  await expect(suggestDefault).toHaveText(/Match bang\s*Google/);

  await page.fill("#default-bang", "s");
  await page.dispatchEvent("#default-bang", "change");
  await expect(luckyDefault).toHaveText(/Fallback\s*DuckDuckGo/);
  await expect(suggestDefault).toHaveText(/Match bang\s*Startpage/);

  await page.fill("#default-bang", "w");
  await page.dispatchEvent("#default-bang", "change");
  await expect(luckyDefault).toHaveText(/Fallback\s*DuckDuckGo/);
  await expect(suggestDefault).toHaveText(/Fallback\s*None/);

  await page.selectOption("#suggest-provider", "google");
  await expect(suggestDefault).toBeHidden();
  await page.selectOption("#suggest-provider", "default");
  await expect(suggestDefault).toBeVisible();
});

test("settings persist suggest provider none across reload", async ({
  page,
  request,
}) => {
  await openSettingsModal(page);

  await page.selectOption("#suggest-provider", "none");
  await expect
    .poll(() => page.evaluate(() => document.cookie))
    .toContain("suggest=none,");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const cookie = await page.evaluate(() => document.cookie);
  expect(cookie).toContain("suggest=none,");

  const response = await request.get("/suggest", {
    params: { q: "hello" },
    headers: { Cookie: cookie },
  });
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual(["hello", []]);
});

test("settings persist custom bang creation across reload", async ({
  page,
}) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await openSettingsModal(page);

  await page.fill('input[name="shortcut"]', "mydocs");
  await page.fill('input[name="name"]', "My Docs");
  await page.fill('input[name="url"]', `${CUSTOM_HOST}/search?q={}`);
  await submitCustomBangForm(page);
  await expect(page.locator("#custom-list")).toContainText("!mydocs");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
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

test("settings reject invalid custom bang URL format", async ({ page }) => {
  await openSettingsModal(page);
  await expect(page.locator("#custom-list")).toContainText(
    "No custom bangs yet"
  );

  await page.fill('input[name="shortcut"]', "bad");
  await page.fill('input[name="name"]', "Bad");
  await page.fill('input[name="url"]', "https://example.com/search");
  await submitCustomBangForm(page);

  await expect(page.locator("#custom-list")).toContainText(
    "No custom bangs yet"
  );
});

test("settings create and execute a custom capture bang", async ({ page }) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await openSettingsModal(page);

  await page.fill('input[name="shortcut"]', "trurl");
  await page.fill('input[name="name"]', "Translate URL");
  await page.fill('input[name="url"]', `${CUSTOM_HOST}/translate/$1?target=$2`);
  await page.locator("#add-bang-form details summary").click();
  await page.fill('input[name="regex"]', "(\\w+)\\s+(.*)");
  await page.selectOption('select[name="encoding"]', "percent");
  await submitCustomBangForm(page);
  await expect(page.locator("#custom-list")).toContainText("!trurl");
  await expect(page.locator("#custom-list")).toContainText("regex");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=%21trurl%20ja%20https%3A%2F%2Fexample.org%2Farticle",
    /example\.com\/translate\/ja/
  );
  const redirected = new URL(page.url());
  expect(redirected.pathname).toBe("/translate/ja");
  expect(redirected.searchParams.get("target")).toBe(
    "https://example.org/article"
  );
});

test("settings create and execute a custom snap target", async ({ page }) => {
  await mockGoogleSearchRoute(page);
  await openSettingsModal(page);

  await page.fill('input[name="shortcut"]', "snapdocs");
  await page.fill('input[name="name"]', "Snap Docs");
  await page.fill('input[name="url"]', `${CUSTOM_HOST}/search?q={}`);
  await page.locator("#add-bang-form details summary").click();
  await page.fill('input[name="snap"]', "example.com/docs");
  await submitCustomBangForm(page);
  await expect(page.locator("#custom-list")).toContainText("!snapdocs");
  await expect(page.locator("#custom-list")).toContainText("snap");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=%40snapdocs%20arrays",
    /google\.com\/search/
  );
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get("q")).toBe("arrays site:example.com/docs");
});

test("settings edit and rename an existing custom bang", async ({ page }) => {
  await mockCustomHostRoute(page);
  await mockGoogleSearchRoute(page);
  await ensureWarmController(page);
  await seedCustomBangs(page, [
    {
      trigger: "before",
      name: "Before",
      url: `${CUSTOM_HOST}/before?q={}`,
      snap: "example.com/before",
    },
  ]);
  await openSettingsModal(page);

  const row = page.locator("#custom-list").filter({ hasText: "!before" });
  await row.getByRole("button", { name: "edit" }).click();
  await expect(page.locator('input[name="shortcut"]')).toHaveValue("before");
  await expect(page.locator('input[name="name"]')).toHaveValue("Before");
  await expect(page.locator('input[name="url"]')).toHaveValue(
    `${CUSTOM_HOST}/before?q={}`
  );
  await expect(page.locator('input[name="snap"]')).toHaveValue(
    "example.com/before"
  );
  await expect(page.locator("#add-bang-form details")).toHaveAttribute(
    "open",
    ""
  );
  await expect(page.locator("#custom-bang-submit")).toHaveText("Save Changes");
  await expect(page.locator("#custom-bang-cancel")).toBeVisible();

  await page.fill('input[name="name"]', "Discarded");
  await page.click("#custom-bang-cancel");
  await expect(page.locator('input[name="shortcut"]')).toHaveValue("");
  await expect(page.locator("#custom-bang-submit")).toHaveText("Add Bang");
  await expect(page.locator("#custom-bang-cancel")).toBeHidden();
  await expect(page.locator("#custom-list")).toContainText("Before");

  await row.getByRole("button", { name: "edit" }).click();
  await page.fill('input[name="shortcut"]', "after");
  await page.fill('input[name="name"]', "After");
  await page.fill('input[name="url"]', `${CUSTOM_HOST}/after?q={}`);
  await page.fill('input[name="snap"]', "example.com/after");
  await submitCustomBangForm(page);

  await expect(page.locator("#custom-list")).toContainText("!after");
  await expect(page.locator("#custom-list")).not.toContainText("!before");
  await expect(page.locator("#custom-bang-submit")).toHaveText("Add Bang");
  await expect(page.locator("#custom-bang-cancel")).toBeHidden();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=%40after%20updated",
    /google\.com\/search/
  );
  expect(new URL(page.url()).searchParams.get("q")).toBe(
    "updated site:example.com/after"
  );
});

test("settings persist custom lucky URL across reload", async ({ page }) => {
  await mockCustomHostRoute(page);
  await ensureWarmController(page);
  await openSettingsModal(page);

  await page.selectOption("#lucky-provider", "custom");
  await page.fill("#lucky-url", `${CUSTOM_HOST}/lucky?q={}`);
  await page.dispatchEvent("#lucky-url", "change");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureWarmController(page);
  await navigateAndWaitForRedirect(
    page,
    "/?q=hello%20%21",
    /example\.com\/lucky\?q=hello/
  );

  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe("example.com");
  expect(redirected.pathname).toBe("/lucky");
  expect(redirected.searchParams.get("q")).toBe("hello");
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
  try {
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
  } finally {
    await context.close();
  }
});
