import { flashAnim } from "./animations";
import { DB } from "./db";
import { initDnsLinks } from "./dns-links";
import { $ } from "./dom";
import { initLiquidMetal } from "./liquid-metal";
import { setupModal } from "./modal";
import { initSettings } from "./settings";

const db = new DB();

function init() {
  initDnsLinks(db);

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
