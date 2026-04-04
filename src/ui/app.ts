import { flashAnim } from "./animations";
import { setSuggestCookie } from "./cookie";
import { DB, readCustomBangs } from "./db";
import { $ } from "./dom";
import { initLiquidMetal } from "./liquid-metal";
import { setupModal } from "./modal";
import { initSettings } from "./settings";

const db = new DB();

async function syncSuggestCookie() {
  const [settings, custom] = await Promise.all([
    db.getMultipleSettings(["suggest-provider", "default-bang", "suggest-url"]),
    readCustomBangs(db),
  ]);

  setSuggestCookie(
    settings[0] || "default",
    settings[1] || "g",
    settings[2] || "",
    custom
  );
}

function init() {
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
