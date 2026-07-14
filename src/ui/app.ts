import { setSuggestCookie } from "./cookie";
import { DB, readCustomBangs } from "./db";
import { $ } from "./dom";
import { initHome } from "./home/index";
import { initLiquidMetal } from "./liquid-metal";
import { setupDialog } from "./modal";
import { initSettings } from "./settings/index";

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

  initLiquidMetal($<HTMLCanvasElement>("#metal-canvas"), "flashbang");
  $(".wordmark").classList.add("has-shader");
  initHome(db);

  const { openDialog } = setupDialog({
    closeButton: $("#modal-close"),
    modal: $("#settings-modal"),
    onFirstOpen: () => void initSettings(db),
    openButton: $("#gear-btn"),
  });

  if (location.pathname === "/settings") {
    openDialog();
    history.replaceState(null, "", "/");
  }
}

init();
