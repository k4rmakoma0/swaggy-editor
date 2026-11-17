import { invoke } from "@tauri-apps/api/core";

export type Format = "json" | "yaml";

export interface SyntaxError {
  message: string;
  line: number | null;
  column: number | null;
}

export interface Issue {
  severity: "error" | "warning";
  message: string;
  /** JSON Pointer del nodo afectado. */
  path: string;
}

export interface SpecInfo {
  kind: string | null;
  title: string | null;
  version: string | null;
  operations: number;
}

export interface Analysis {
  format: Format;
  spec: Record<string, unknown> | null;
  syntaxError: SyntaxError | null;
  issues: Issue[];
  info: SpecInfo | null;
}

export interface OpenedFile {
  path: string;
  content: string;
  format: Format;
}

export const api = {
  analyze: (content: string, format: Format) =>
    invoke<Analysis>("analyze", { content, format }),
  convert: (content: string, from: Format, to: Format) =>
    invoke<string>("convert", { content, from, to }),
  formatDocument: (content: string, format: Format) =>
    invoke<string>("format_document", { content, format }),
  readFile: (path: string) => invoke<OpenedFile>("read_file", { path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("write_file", { path, content }),
  takePendingFile: () => invoke<string | null>("take_pending_file"),
};

export function formatFromPath(path: string): Format | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "json") return "json";
  if (ext === "yaml" || ext === "yml") return "yaml";
  return null;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function replaceExtension(path: string, format: Format): string {
  const ext = format === "json" ? "json" : "yaml";
  return /\.[^.\\/]+$/.test(path) ? path.replace(/\.[^.\\/]+$/, `.${ext}`) : `${path}.${ext}`;
}
