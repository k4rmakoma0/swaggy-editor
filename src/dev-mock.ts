/**
 * Solo para desarrollo: simula el backend de Tauri para poder abrir la interfaz
 * en un navegador normal (`npm run dev`). No se incluye en la compilación final.
 * La lógica real (y completa) vive en `src-tauri/src/spec.rs`.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { load, dump } from "js-yaml";
import type { Analysis, Format } from "./api";

function parse(content: string, format: Format): unknown {
  return format === "json" ? JSON.parse(content) : load(content);
}

function serialize(value: unknown, format: Format): string {
  return format === "json" ? JSON.stringify(value, null, 2) + "\n" : dump(value, { lineWidth: -1 });
}

function analyze(content: string, format: Format): Analysis {
  if (!content.trim()) {
    return { format, spec: null, syntaxError: null, issues: [{ severity: "error", message: "El documento está vacío", path: "" }], info: null };
  }
  try {
    const spec = parse(content, format) as Record<string, any>;
    const kind = spec?.openapi ? `OpenAPI ${spec.openapi}` : spec?.swagger ? `Swagger ${spec.swagger}` : null;
    const ops = Object.values(spec?.paths ?? {}).reduce<number>(
      (n, item: any) => n + Object.keys(item ?? {}).filter((k) => ["get", "put", "post", "delete", "patch", "head", "options", "trace"].includes(k)).length,
      0,
    );
    return {
      format,
      spec,
      syntaxError: null,
      issues: kind ? [] : [{ severity: "error", message: "Falta el campo `openapi` o `swagger`", path: "" }],
      info: { kind, title: spec?.info?.title ?? null, version: spec?.info?.version ?? null, operations: ops },
    };
  } catch (e: any) {
    const line = e?.mark?.line != null ? e.mark.line + 1 : null;
    const column = e?.mark?.column != null ? e.mark.column + 1 : null;
    return { format, spec: null, syntaxError: { message: String(e?.reason ?? e?.message ?? e), line, column }, issues: [], info: null };
  }
}

mockWindows("main");
mockIPC(
  (cmd, args: any) => {
    switch (cmd) {
      case "analyze":
        return analyze(args.content, args.format);
      case "convert":
        return serialize(parse(args.content, args.from), args.to);
      case "format_document":
        return serialize(parse(args.content, args.format), args.format);
      case "take_pending_file":
        return null;
      case "read_file":
      case "write_file":
        throw "Acceso a archivos no disponible en el navegador";
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);
