import { flashAnim } from "./animations";
import { setSuggestCookie } from "./cookie";
import { DB } from "./db";
import { initDnsLinks } from "./dns-links";
import { $ } from "./dom";
import { initLiquidMetal } from "./liquid-metal";
import { setupModal } from "./modal";
import { initSettings } from "./settings";

const db = new DB();

async function syncSuggestCookie() {
  const [provider, trigger, url, frecencyRaw, customBangs] = await Promise.all([
    db.getSetting("suggest-provider").then((v) => v || "default"),
    db.getSetting("default-bang").then((v) => v || "g"),
    db.getSetting("suggest-url").then((v) => v || ""),
    db.getSetting("frecency"),
    db.getAllCustomBangs(),
  ]);

  // Format frecency: top 8 by count, as "trigger:count" strings
  let frecent: string[] = [];
  if (frecencyRaw) {
    try {
      const counts: Record<string, number> = JSON.parse(frecencyRaw);
      frecent = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([t, c]) => `${t}:${c}`);
    } catch {
      /* ignore corrupt data */
    }
  }

  const custom = customBangs.map((b) => b.trigger);

  setSuggestCookie(provider, trigger, url, frecent, custom);
}

function init() {
  initDnsLinks(db);

  syncSuggestCookie();

  $<HTMLInputElement>("#setup-url").value = `${location.origin}?q=%s`;

  const metal = initLiquidMetal(
    $<HTMLCanvasElement>("#metal-canvas"),
    "flashbang"
  );
  $(".wordmark").classList.add("has-shader");

  $("#copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(
      $<HTMLInputElement>("#setup-url").value
    );
    flashAnim($<HTMLInputElement>("#setup-url"));
    metal.flash();
    $("#copy-btn").textContent = "Copied!";
    setTimeout(() => ($("#copy-btn").textContent = "Copy"), 1500);
  });

  const { openModal } = setupModal(() => initSettings(db));

  if (location.pathname === "/settings") {
    openModal();
    history.replaceState(null, "", "/");
  }
}

init();
