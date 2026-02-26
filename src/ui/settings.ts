import { flashAnim, shakeAnim } from "./animations";
import { readFrecencyData, setSuggestCookie } from "./cookie";
import { setupCustomBangs } from "./custom-bangs";
import type { DB } from "./db";
import { setDnsLinks } from "./dns-links";
import { $, el } from "./dom";
import { notifySW } from "./sw-bridge";

export async function initSettings(db: DB) {
  const defaultInput = $<HTMLInputElement>("#default-bang");
  const suggestSelect = $<HTMLSelectElement>("#suggest-provider");
  const suggestUrlInput = $<HTMLInputElement>("#suggest-url");
  const luckySelect = $<HTMLSelectElement>("#lucky-provider");
  const luckyUrlInput = $<HTMLInputElement>("#lucky-url");

  const [defaultBang, savedProvider, savedUrl, savedLucky, savedLuckyUrl, fd] =
    await Promise.all([
      db.getSetting("default-bang").then((v) => v || "g"),
      db.getSetting("suggest-provider").then((v) => v || "default"),
      db.getSetting("suggest-url").then((v) => v || ""),
      db.getSetting("lucky-provider").then((v) => v || "default"),
      db.getSetting("lucky-url").then((v) => v || ""),
      readFrecencyData(db),
    ]);

  luckySelect.value = savedLucky;
  if (savedLucky === "custom") {
    luckyUrlInput.classList.remove("hidden");
  }
  if (savedLuckyUrl) {
    luckyUrlInput.value = savedLuckyUrl;
  }

  defaultInput.value = defaultBang;
  suggestSelect.value = savedProvider;
  if (savedProvider === "custom") {
    suggestUrlInput.classList.remove("hidden");
  }
  if (savedUrl) {
    suggestUrlInput.value = savedUrl;
  }

  setSuggestCookie(savedProvider, defaultBang, savedUrl, fd.frecent, fd.custom);

  const mod = await import("../generated/bangs-full.js");
  const full: Record<string, { s: string; d: string; u: string }> = mod.BANGS;
  $("#bang-status").textContent = full[defaultBang]?.s || "Unknown";
  $("#bang-count").textContent =
    `${Object.keys(full).length.toLocaleString()} bangs available`;

  defaultInput.addEventListener("change", async () => {
    const val = defaultInput.value.replace(/^!+/, "").toLowerCase().trim();
    if (full[val]) {
      await db.setSetting("default-bang", val);
      notifySW("invalidate");
      setSuggestCookie(
        suggestSelect.value,
        val,
        suggestUrlInput.value.trim(),
        fd.frecent,
        fd.custom
      );
      setDnsLinks(full[val].u);
      flashAnim(defaultInput);
      $("#bang-status").textContent = full[val].s;
      $("#bang-status").className = "text-sm text-success";
    } else {
      shakeAnim(defaultInput);
      $("#bang-status").textContent = "Unknown bang";
      $("#bang-status").className = "text-sm text-danger";
    }
  });

  suggestSelect.addEventListener("change", async () => {
    await db.setSetting("suggest-provider", suggestSelect.value);
    notifySW("invalidate");
    setSuggestCookie(
      suggestSelect.value,
      defaultInput.value,
      suggestUrlInput.value.trim(),
      fd.frecent,
      fd.custom
    );
    if (suggestSelect.value === "custom") {
      suggestUrlInput.classList.remove("hidden");
    } else {
      suggestUrlInput.classList.add("hidden");
    }
  });

  suggestUrlInput.addEventListener("change", async () => {
    const url = suggestUrlInput.value.trim();
    await db.setSetting("suggest-url", url);
    notifySW("invalidate");
    setSuggestCookie(
      suggestSelect.value,
      defaultInput.value,
      url,
      fd.frecent,
      fd.custom
    );
  });

  luckySelect.addEventListener("change", async () => {
    await db.setSetting("lucky-provider", luckySelect.value);
    notifySW("invalidate");
    if (luckySelect.value === "custom") {
      luckyUrlInput.classList.remove("hidden");
    } else {
      luckyUrlInput.classList.add("hidden");
    }
  });

  luckyUrlInput.addEventListener("change", async () => {
    await db.setSetting("lucky-url", luckyUrlInput.value.trim());
    notifySW("invalidate");
  });

  let timer: ReturnType<typeof setTimeout>;
  let cachedEntries: [string, { s: string; d: string; u: string }][] | null =
    null;
  $<HTMLInputElement>("#bang-search").addEventListener("input", (e) => {
    clearTimeout(timer);
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    if (!q) {
      $("#bang-results").replaceChildren();
      return;
    }
    timer = setTimeout(() => {
      if (!cachedEntries) {
        cachedEntries = Object.entries(full);
      }
      const hits = cachedEntries
        .filter(
          ([t, b]) =>
            t.includes(q) || b.s.toLowerCase().includes(q) || b.d.includes(q)
        )
        .sort((a, b) => {
          const as_ = a[0].startsWith(q) ? 0 : 1;
          const bs_ = b[0].startsWith(q) ? 0 : 1;
          return as_ - bs_ || a[0].length - b[0].length;
        })
        .slice(0, 20);
      const container = $("#bang-results");
      if (hits.length === 0) {
        container.replaceChildren(
          el(
            "div",
            "py-3 text-center text-sm text-text-secondary",
            "No matches"
          )
        );
      } else {
        container.replaceChildren(
          ...hits.map(([t, b]) => {
            const row = el(
              "div",
              "flex items-center gap-3 px-2.5 py-2 rounded-lg bg-bg-secondary mb-1"
            );
            row.append(
              el(
                "code",
                "px-1.5 py-0.5 rounded bg-bg-active text-xs min-w-15 text-center font-mono",
                `!${t}`
              ),
              el("span", "flex-1 text-[13px] font-medium", b.s),
              el(
                "span",
                "text-[11px] text-text-secondary max-w-30 overflow-hidden text-ellipsis whitespace-nowrap",
                b.d
              )
            );
            return row;
          })
        );
      }
    }, 200);
  });

  setupCustomBangs(db);

  $("#export-btn").addEventListener("click", async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flashbang-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $<HTMLInputElement>("#import-file").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      await db.importAll(data);
      notifySW("invalidate");
      $("#import-status").textContent = "Imported successfully";
      $("#import-status").className = "text-sm mt-2 block text-success";
      setTimeout(() => location.reload(), 1000);
    } catch {
      $("#import-status").textContent = "Invalid file";
      $("#import-status").className = "text-sm mt-2 block text-danger";
    }
  });
}
