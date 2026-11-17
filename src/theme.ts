import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "swaggy.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(dark: boolean) => void>();

let pref: ThemePref = readPref();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function getThemePref(): ThemePref {
  return pref;
}

export function isDark(): boolean {
  return pref === "dark" || (pref === "system" && media.matches);
}

export function onThemeChange(fn: (dark: boolean) => void) {
  listeners.add(fn);
}

function apply() {
  const root = document.documentElement;
  // Sin data-theme, el CSS sigue al sistema; con él, se fuerza.
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  const dark = isDark();
  // Swagger UI activa su tema oscuro con esta clase en <html>.
  root.classList.toggle("dark-mode", dark);
  listeners.forEach((fn) => fn(dark));
}

function syncWindow() {
  getCurrentWindow()
    .setTheme(pref === "system" ? null : pref)
    .catch(() => {});
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* sin almacenamiento */
  }
  apply();
  syncWindow();
}

export function initTheme() {
  apply();
  if (pref !== "system") syncWindow();
  media.addEventListener("change", () => {
    if (pref === "system") apply();
  });
}
