import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import {
  api,
  fileName,
  formatFromPath,
  replaceExtension,
  type Analysis,
  type Format,
} from "./api";
import { Editor } from "./editor";
import { Preview } from "./preview";
import { NEW_API_YAML } from "./templates";
import { getThemePref, initTheme, setThemePref, type ThemePref } from "./theme";

type Mode = "view" | "split" | "edit";

interface Doc {
  path: string | null;
  format: Format;
  /** Contenido tal como está en disco (o el inicial si no se ha guardado). */
  savedText: string;
}

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const STORAGE = { mode: "swaggy.mode", split: "swaggy.split", recent: "swaggy.recent" };
const FILE_FILTERS = [
  { name: "OpenAPI / Swagger", extensions: ["yaml", "yml", "json"] },
  { name: "Todos los archivos", extensions: ["*"] },
];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let doc: Doc | null = null;
let mode: Mode = "split";
let analysis: Analysis | null = null;
let analyzeSeq = 0;
let analyzeTimer: number | undefined;
let hasRenderedPreview = false;

let editor: Editor;
let preview: Preview;

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

function isDirty(): boolean {
  return doc !== null && editor.getText() !== doc.savedText;
}

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------

let toastTimer: number | undefined;
function toast(text: string, kind: "info" | "error" = "info") {
  const el = $("#toast");
  el.textContent = text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = ""), kind === "error" ? 6000 : 2600);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function updateTitle() {
  const name = doc ? (doc.path ? fileName(doc.path) : "Sin título") : "";
  const dirty = isDirty();
  $("#doc-name").textContent = name;
  $("#doc-name").title = doc?.path ?? "Documento sin guardar";
  $("#dirty-dot").classList.toggle("on", dirty);
  const title = doc ? `${dirty ? "● " : ""}${name} — Swaggy Editor` : "Swaggy Editor";
  document.title = title;
  getCurrentWindow().setTitle(title).catch(() => {});
}

function updateFormatSwitch() {
  document.querySelectorAll<HTMLButtonElement>("#format-switch button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.format === doc?.format));
  });
  $("#status-format").textContent = doc ? doc.format.toUpperCase() : "";
}

function setMode(next: Mode) {
  mode = next;
  document.body.dataset.mode = next;
  document.querySelectorAll<HTMLButtonElement>("#mode-switch button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.mode === next));
  });
  storageSet(STORAGE.mode, next);
  if (doc && next !== "view") editor.focus();
}

const THEME_LABELS: Record<ThemePref, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Oscuro",
};
const THEME_ORDER: ThemePref[] = ["system", "light", "dark"];

function setTheme(next: ThemePref) {
  setThemePref(next);
  renderThemeButton();
}

function cycleTheme() {
  const i = THEME_ORDER.indexOf(getThemePref());
  const next = THEME_ORDER[(i + 1) % THEME_ORDER.length];
  setTheme(next);
  toast(`Tema: ${THEME_LABELS[next]}`);
}

function renderThemeButton() {
  const pref = getThemePref();
  $("#theme-icon").setAttribute("href", `#i-theme-${pref}`);
  const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length];
  $("#btn-theme").title = `Tema: ${THEME_LABELS[pref]} · clic para ${THEME_LABELS[next].toLowerCase()}`;
}

function applyTooltips() {
  document.querySelectorAll<HTMLElement>("[data-tip]").forEach((el) => {
    const key = el.dataset.key;
    let shortcut = "";
    if (key && key.length === 1) shortcut = `${MOD}${key}`;
    else if (key) shortcut = IS_MAC ? key : key.replace("⇧", "Shift+").replace("⌥", "Alt+");
    el.title = shortcut ? `${el.dataset.tip} (${shortcut})` : el.dataset.tip!;
  });
}

// ---------------------------------------------------------------------------
// Análisis y vista previa
// ---------------------------------------------------------------------------

function scheduleAnalyze(delay = 250) {
  clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(runAnalyze, delay);
}

async function runAnalyze() {
  if (!doc) return;
  const seq = ++analyzeSeq;
  try {
    const result = await api.analyze(editor.getText(), doc.format);
    if (seq !== analyzeSeq) return; // llegó una respuesta más nueva
    applyAnalysis(result);
  } catch (e) {
    toast(`Error al analizar: ${errorText(e)}`, "error");
  }
}

function applyAnalysis(a: Analysis) {
  analysis = a;
  editor.showSyntaxError(a.syntaxError);

  const renderable = a.spec !== null && !!a.info?.kind;
  if (renderable) {
    try {
      preview.render(a.spec!);
      hasRenderedPreview = true;
    } catch (e) {
      console.error(e);
    }
  }

  let problem: string | null = null;
  if (a.syntaxError) {
    const where = a.syntaxError.line ? ` (línea ${a.syntaxError.line})` : "";
    problem = `Error de sintaxis${where}: ${a.syntaxError.message}`;
  } else if (!renderable) {
    problem =
      a.issues.find((i) => i.severity === "error")?.message ??
      "El documento no es una especificación OpenAPI/Swagger";
  }

  const banner = $("#preview-banner");
  const empty = $("#preview-empty");
  const previewEl = $("#preview");
  if (problem && hasRenderedPreview) {
    banner.hidden = false;
    $("#preview-banner-text").textContent = `Mostrando la última versión válida. ${problem}`;
    empty.hidden = true;
    previewEl.hidden = false;
  } else if (problem) {
    banner.hidden = true;
    empty.hidden = false;
    previewEl.hidden = true;
    $("#preview-empty-text").textContent = problem;
  } else {
    banner.hidden = true;
    empty.hidden = true;
    previewEl.hidden = false;
  }

  renderStatus();
  renderProblems();
}

function renderStatus() {
  const info = analysis?.info;
  const kind = $("#status-kind");
  kind.textContent = info?.kind ?? (analysis?.syntaxError ? "Error de sintaxis" : "Desconocido");
  kind.classList.toggle("bad", !info?.kind);

  const title = [info?.title, info?.version ? `v${info.version}` : null].filter(Boolean).join(" · ");
  $("#status-title").textContent = title;
  $("#status-ops").textContent = info
    ? `${info.operations} ${info.operations === 1 ? "operación" : "operaciones"}`
    : "";

  const errors =
    (analysis?.syntaxError ? 1 : 0) +
    (analysis?.issues.filter((i) => i.severity === "error").length ?? 0);
  const warnings = analysis?.issues.filter((i) => i.severity === "warning").length ?? 0;
  const btn = $("#status-problems");
  btn.className = `status-btn ${errors ? "has-errors" : warnings ? "has-warnings" : "ok"}`;
  btn.innerHTML =
    errors || warnings
      ? `<svg><use href="#i-alert"/></svg>${errors}<svg><use href="#i-warn"/></svg>${warnings}`
      : `<svg><use href="#i-check"/></svg>Sin problemas`;
}

function renderProblems() {
  const list = $("#problems-list");
  list.replaceChildren();
  if (!analysis) return;

  const add = (severity: "error" | "warning", message: string, where: string, onClick: () => void) => {
    const li = document.createElement("li");
    li.className = severity;
    li.innerHTML = `<svg><use href="#i-${severity === "error" ? "alert" : "warn"}"/></svg>`;
    const msg = document.createElement("span");
    msg.textContent = message;
    const loc = document.createElement("span");
    loc.className = "muted";
    loc.textContent = where;
    li.append(msg, loc);
    li.addEventListener("click", onClick);
    list.append(li);
  };

  const err = analysis.syntaxError;
  if (err) {
    add("error", err.message, err.line ? `línea ${err.line}` : "", () =>
      revealInEditor(err.line ?? 1, err.column ?? 1),
    );
  }
  for (const issue of analysis.issues) {
    add(issue.severity, issue.message, issue.path || "/", () => {
      const line = locatePointer(editor.getText(), issue.path, doc!.format);
      revealInEditor(line ?? 1, 1);
    });
  }
  if (!list.children.length) {
    const li = document.createElement("li");
    li.className = "empty muted";
    li.textContent = "No se encontraron problemas.";
    list.append(li);
  }
}

function toggleProblems(force?: boolean) {
  const panel = $("#problems");
  panel.hidden = force !== undefined ? !force : !panel.hidden;
}

function revealInEditor(line: number, column: number) {
  if (mode === "view") setMode("split");
  editor.goToLine(line, column);
}

/**
 * Busca de forma aproximada la línea que corresponde a un JSON Pointer,
 * siguiendo cada clave en orden dentro del texto.
 */
function locatePointer(text: string, pointer: string, format: Format): number | null {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cursor = 0;
  let found = -1;
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) continue;
    const esc = seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re =
      format === "json"
        ? new RegExp(`"${esc}"\\s*:`, "g")
        : new RegExp(`(^|[\\s{,-])(["']?)${esc}\\2\\s*:`, "gm");
    re.lastIndex = cursor;
    const m = re.exec(text);
    if (!m) break;
    found = m.index + (format === "yaml" ? m[1].length : 0);
    cursor = m.index + m[0].length;
  }
  if (found < 0) return null;
  return text.slice(0, found).split("\n").length;
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

function loadDoc(next: Doc) {
  doc = next;
  analysis = null;
  hasRenderedPreview = false;
  preview.reset();
  editor.load(next.savedText, next.format);
  document.body.classList.remove("no-doc");
  updateTitle();
  updateFormatSwitch();
  clearTimeout(analyzeTimer);
  runAnalyze();
  if (next.path) addRecent(next.path);
  if (mode !== "view") editor.focus();
}

async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const name = doc?.path ? fileName(doc.path) : "el documento sin título";
  return ask(`Hay cambios sin guardar en ${name}. ¿Quieres descartarlos?`, {
    title: "Cambios sin guardar",
    kind: "warning",
    okLabel: "Descartar",
    cancelLabel: "Cancelar",
  });
}

async function newDoc(format: Format) {
  if (!(await confirmDiscard())) return;
  const text = format === "yaml" ? NEW_API_YAML : await api.convert(NEW_API_YAML, "yaml", "json");
  loadDoc({ path: null, format, savedText: text });
}

async function openPath(path: string) {
  if (doc?.path === path && !isDirty()) return;
  if (!(await confirmDiscard())) return;
  try {
    const file = await api.readFile(path);
    loadDoc({ path: file.path, format: file.format, savedText: file.content });
  } catch (e) {
    removeRecent(path);
    toast(errorText(e), "error");
  }
}

async function openDialog() {
  const selected = await open({ multiple: false, directory: false, filters: FILE_FILTERS });
  if (typeof selected === "string") await openPath(selected);
}

async function saveDoc(): Promise<boolean> {
  if (!doc) return false;
  if (!doc.path) return saveDocAs();
  const text = editor.getText();
  try {
    await api.writeFile(doc.path, text);
  } catch (e) {
    toast(errorText(e), "error");
    return false;
  }
  doc.savedText = text;
  updateTitle();
  toast(`Guardado ${fileName(doc.path)}`);
  return true;
}

function suggestedName(format: Format): string {
  const slug = (analysis?.info?.title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "openapi"}.${format === "json" ? "json" : "yaml"}`;
}

async function saveDocAs(): Promise<boolean> {
  if (!doc) return false;
  const current = doc;
  const preferred =
    current.format === "json"
      ? { name: "JSON", extensions: ["json"] }
      : { name: "YAML", extensions: ["yaml", "yml"] };
  const path = await save({
    defaultPath: current.path ?? suggestedName(current.format),
    filters: [preferred, FILE_FILTERS[0]],
  });
  if (!path) return false;

  let text = editor.getText();
  const target = formatFromPath(path) ?? current.format;
  if (target !== current.format) {
    try {
      text = await api.convert(text, current.format, target);
    } catch (e) {
      toast(`No se pudo convertir a ${target.toUpperCase()}: ${errorText(e)}`, "error");
      return false;
    }
    current.format = target;
    editor.setFormat(target);
    editor.replace(text);
  }

  try {
    await api.writeFile(path, text);
  } catch (e) {
    toast(errorText(e), "error");
    return false;
  }
  current.path = path;
  current.savedText = text;
  addRecent(path);
  updateTitle();
  updateFormatSwitch();
  toast(`Guardado ${fileName(path)}`);
  return true;
}

function hasYamlComments(text: string): boolean {
  return /(^|\s)#/m.test(text);
}

async function confirmLosingComments(action: string): Promise<boolean> {
  if (doc?.format !== "yaml" || !hasYamlComments(editor.getText())) return true;
  return ask(`Los comentarios del YAML se perderán al ${action}. ¿Continuar?`, {
    title: "Se perderán los comentarios",
    kind: "warning",
    okLabel: "Continuar",
    cancelLabel: "Cancelar",
  });
}

async function convertTo(target: Format) {
  if (!doc || doc.format === target) return;
  if (!(await confirmLosingComments("convertir"))) return;
  let out: string;
  try {
    out = await api.convert(editor.getText(), doc.format, target);
  } catch (e) {
    toast(`No se puede convertir: ${errorText(e)}`, "error");
    return;
  }
  doc.format = target;
  editor.setFormat(target);
  editor.replace(out);
  if (doc.path) doc.path = replaceExtension(doc.path, target);
  updateTitle();
  updateFormatSwitch();
  toast(
    `Convertido a ${target.toUpperCase()}` +
      (doc.path ? `. Al guardar se creará ${fileName(doc.path)}` : ""),
  );
}

async function formatDocument() {
  if (!doc) return;
  if (!(await confirmLosingComments("formatear"))) return;
  const text = editor.getText();
  try {
    const out = await api.formatDocument(text, doc.format);
    if (out === text) toast("El documento ya está formateado");
    else editor.replace(out);
  } catch (e) {
    toast(`No se puede formatear: ${errorText(e)}`, "error");
  }
}

async function quit() {
  if (await confirmDiscard()) await getCurrentWindow().destroy();
}

// ---------------------------------------------------------------------------
// Recientes
// ---------------------------------------------------------------------------

function getRecent(): string[] {
  try {
    const list = JSON.parse(storageGet(STORAGE.recent) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function setRecent(list: string[]) {
  storageSet(STORAGE.recent, JSON.stringify(list.slice(0, 8)));
  renderRecent();
}

function addRecent(path: string) {
  setRecent([path, ...getRecent().filter((p) => p !== path)]);
}

function removeRecent(path: string) {
  setRecent(getRecent().filter((p) => p !== path));
}

function renderRecent() {
  const list = getRecent();
  $("#recent").hidden = list.length === 0;
  const ul = $("#recent-list");
  ul.replaceChildren(
    ...list.map((path) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "recent-item";
      const name = document.createElement("strong");
      name.textContent = fileName(path);
      const dir = document.createElement("span");
      dir.className = "muted";
      dir.textContent = path.slice(0, path.length - fileName(path).length);
      btn.append(name, dir);
      btn.title = path;
      btn.addEventListener("click", () => openPath(path));
      li.append(btn);
      return li;
    }),
  );
}

// ---------------------------------------------------------------------------
// Divisor redimensionable
// ---------------------------------------------------------------------------

function setupDivider() {
  const workspace = $("#workspace");
  const divider = $("#divider");
  const saved = Number(storageGet(STORAGE.split));
  if (saved >= 20 && saved <= 80) workspace.style.setProperty("--split", `${saved}%`);

  let pct = saved || 50;
  divider.addEventListener("pointerdown", (e) => {
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  });
  divider.addEventListener("pointermove", (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const rect = workspace.getBoundingClientRect();
    pct = Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100));
    workspace.style.setProperty("--split", `${pct}%`);
  });
  const end = (e: PointerEvent) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    divider.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing");
    storageSet(STORAGE.split, pct.toFixed(1));
  };
  divider.addEventListener("pointerup", end);
  divider.addEventListener("pointercancel", end);
  divider.addEventListener("dblclick", () => {
    pct = 50;
    workspace.style.setProperty("--split", "50%");
    storageSet(STORAGE.split, "50");
  });
}

// ---------------------------------------------------------------------------
// Comandos (menú nativo y botones)
// ---------------------------------------------------------------------------

function runCommand(id: string) {
  switch (id) {
    case "new":
      return newDoc(doc?.format ?? "yaml");
    case "open":
      return openDialog();
    case "save":
      return saveDoc();
    case "save_as":
      return saveDocAs();
    case "quit":
      return quit();
    case "mode_view":
      return setMode("view");
    case "mode_split":
      return setMode("split");
    case "mode_edit":
      return setMode("edit");
    case "format":
      return formatDocument();
    case "to_json":
      return convertTo("json");
    case "to_yaml":
      return convertTo("yaml");
    case "problems":
      return doc && toggleProblems();
    case "theme_system":
      return setTheme("system");
    case "theme_light":
      return setTheme("light");
    case "theme_dark":
      return setTheme("dark");
  }
}

function bindUi() {
  const on = (sel: string, fn: () => unknown) => $(sel).addEventListener("click", () => fn());
  on("#btn-new", () => runCommand("new"));
  on("#btn-open", openDialog);
  on("#btn-save", saveDoc);
  on("#btn-format", formatDocument);
  on("#btn-theme", cycleTheme);
  on("#welcome-open", openDialog);
  on("#welcome-new-yaml", () => newDoc("yaml"));
  on("#welcome-new-json", () => newDoc("json"));
  on("#status-problems", () => toggleProblems());
  on("#problems-close", () => toggleProblems(false));
  on("#preview-banner-go", () => {
    const e = analysis?.syntaxError;
    if (e) revealInEditor(e.line ?? 1, e.column ?? 1);
    else toggleProblems(true);
  });
  on("#preview-empty-go", () => {
    const e = analysis?.syntaxError;
    revealInEditor(e?.line ?? 1, e?.column ?? 1);
    if (!e) toggleProblems(true);
  });

  document.querySelectorAll<HTMLButtonElement>("#mode-switch button").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode as Mode)),
  );
  document.querySelectorAll<HTMLButtonElement>("#format-switch button").forEach((b) =>
    b.addEventListener("click", () => convertTo(b.dataset.format as Format)),
  );
}

async function bindNative() {
  await listen<string>("menu", (e) => runCommand(e.payload));
  await listen<string>("open-file", (e) => openPath(e.payload));

  await getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await confirmDiscard())) event.preventDefault();
  });

  const overlay = $("#drop-overlay");
  await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") overlay.hidden = false;
    else overlay.hidden = true;
    if (p.type === "drop" && p.paths.length) {
      const path = p.paths.find((x) => formatFromPath(x)) ?? p.paths[0];
      openPath(path);
    }
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function boot() {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    // Permite probar la interfaz en un navegador normal durante el desarrollo.
    await import("./dev-mock");
  }

  initTheme();
  renderThemeButton();

  editor = new Editor(
    $("#editor-pane"),
    () => {
      updateTitle();
      scheduleAnalyze();
    },
    (line, col) => {
      $("#status-cursor").textContent = `Ln ${line}, Col ${col}`;
    },
  );
  preview = new Preview($("#preview"));

  const savedMode = storageGet(STORAGE.mode);
  setMode(savedMode === "view" || savedMode === "edit" ? savedMode : "split");
  applyTooltips();
  setupDivider();
  bindUi();
  renderRecent();
  updateTitle();

  try {
    await bindNative();
  } catch (e) {
    console.warn("Integración nativa no disponible", e);
  }

  const pending = await api.takePendingFile().catch(() => null);
  if (pending) await openPath(pending);
}

boot();
