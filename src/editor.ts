import { basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { Format, SyntaxError } from "./api";
import { isDark, onThemeChange } from "./theme";

/**
 * Tema del editor. Todos los colores salen de variables CSS (`--ed-*` y `--syn-*`
 * en styles.css), así que el mismo tema sirve para claro y oscuro.
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13.5px",
    color: "var(--ed-text)",
    backgroundColor: "var(--ed-bg)",
  },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    lineHeight: "1.65",
  },
  ".cm-content": { caretColor: "var(--ed-cursor)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--ed-cursor)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--ed-selection) !important" },
  ".cm-activeLine": { backgroundColor: "var(--ed-active-line)" },
  ".cm-gutters": {
    backgroundColor: "var(--ed-bg)",
    color: "var(--ed-gutter)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "40px" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--ed-active-line)",
    color: "var(--ed-gutter-active)",
  },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--ed-gutter)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--muted)",
    padding: "0 6px",
    borderRadius: "4px",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--ed-bracket)",
    outline: "1px solid var(--ed-bracket-border)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--ed-match)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--ed-search)",
    outline: "1px solid var(--ed-search-border)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--ed-search-current)" },
  ".cm-panels": {
    backgroundColor: "var(--chrome)",
    color: "var(--text)",
    borderColor: "var(--border)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel input, .cm-panel button": { fontSize: "12px" },
  ".cm-textfield": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border-strong)",
    borderRadius: "5px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "5px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "var(--shadow)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--ed-selection)",
    color: "var(--text)",
  },
  ".cm-diagnostic": { padding: "6px 10px" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--danger)",
    textUnderlineOffset: "3px",
  },
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--syn-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: t.number, color: "var(--syn-number)" },
  { tag: [t.bool, t.null], color: "var(--syn-literal)" },
  { tag: [t.lineComment, t.comment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.labelName, t.typeName], color: "var(--syn-anchor)" },
  { tag: [t.keyword, t.meta], color: "var(--syn-keyword)" },
  { tag: [t.separator, t.punctuation, t.brace, t.squareBracket], color: "var(--syn-punct)" },
  { tag: t.content, color: "var(--ed-text)" },
]);

export class Editor {
  readonly view: EditorView;
  private language = new Compartment();
  private darkFlag = new Compartment();
  private format: Format = "yaml";

  constructor(
    parent: HTMLElement,
    private onChange: (text: string) => void,
    private onCursor: (line: number, column: number) => void,
  ) {
    this.view = new EditorView({ parent, state: this.createState("") });
    onThemeChange((dark) => {
      this.view.dispatch({ effects: this.darkFlag.reconfigure(EditorView.darkTheme.of(dark)) });
    });
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
        editorTheme,
        syntaxHighlighting(highlight),
        this.darkFlag.of(EditorView.darkTheme.of(isDark())),
        this.language.of(this.languageExtension()),
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
