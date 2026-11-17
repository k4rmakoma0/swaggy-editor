import { basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Format, SyntaxError } from "./api";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    lineHeight: "1.55",
  },
  ".cm-gutters": { borderRight: "none" },
});

export class Editor {
  readonly view: EditorView;
  private language = new Compartment();
  private theme = new Compartment();
  private format: Format = "yaml";

  constructor(
    parent: HTMLElement,
    private onChange: (text: string) => void,
    private onCursor: (line: number, column: number) => void,
  ) {
    this.view = new EditorView({ parent, state: this.createState("") });
    darkQuery.addEventListener("change", () => {
      this.view.dispatch({ effects: this.theme.reconfigure(this.themeExtension()) });
    });
  }

  private themeExtension(): Extension {
    return darkQuery.matches ? oneDark : [];
  }

  private languageExtension(): Extension {
    return this.format === "json" ? json() : yaml();
  }

  private createState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        EditorState.tabSize.of(2),
        lintGutter(),
        baseTheme,
        this.language.of(this.languageExtension()),
        this.theme.of(this.themeExtension()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.onChange(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) this.reportCursor(u.state);
        }),
      ],
    });
  }

  private reportCursor(state: EditorState) {
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    this.onCursor(line.number, pos - line.from + 1);
  }

  /** Carga un documento nuevo (reinicia el historial de deshacer). */
  load(text: string, format: Format) {
    this.format = format;
    this.view.setState(this.createState(text));
    this.reportCursor(this.view.state);
  }

  /** Reemplaza todo el contenido como una edición que se puede deshacer. */
  replace(text: string) {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
    });
  }

  setFormat(format: Format) {
    if (format === this.format) return;
    this.format = format;
    this.view.dispatch({ effects: this.language.reconfigure(this.languageExtension()) });
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  showSyntaxError(error: SyntaxError | null) {
    const diagnostics: Diagnostic[] = [];
    if (error) {
      const doc = this.view.state.doc;
      const lineNo = Math.min(Math.max(error.line ?? 1, 1), doc.lines);
      const line = doc.line(lineNo);
      const from = Math.min(line.from + Math.max((error.column ?? 1) - 1, 0), line.to);
      const to = from < line.to ? line.to : Math.min(from + 1, doc.length);
      diagnostics.push({ from, to, severity: "error", message: error.message });
    }
    this.view.dispatch(setDiagnostics(this.view.state, diagnostics));
  }

  goToLine(lineNo: number, column = 1) {
    const doc = this.view.state.doc;
    const line = doc.line(Math.min(Math.max(lineNo, 1), doc.lines));
    const pos = Math.min(line.from + Math.max(column - 1, 0), line.to);
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    this.view.focus();
  }

  focus() {
    this.view.focus();
  }
}
