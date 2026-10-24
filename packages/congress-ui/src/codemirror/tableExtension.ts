import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { splitRecordText } from "../textSegments.js";
import type { RecordEditorRuntimeRef } from "./runtime.js";

export type TableAlign = "left" | "center" | "right" | null;
export interface ParsedTable {
  header: string[];
  align: TableAlign[];
  rows: string[][];
  // False for a bare `| a | b |` block with no `|---|` row; kept that way on edit.
  hasDelimiter: boolean;
}

// Splits one table line on unescaped pipes, ignoring the optional outer ones.
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isDelimiterRow = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

export function parseTable(text: string): ParsedTable | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = splitTableRow(lines[0]!);
  const second = splitTableRow(lines[1]!);
  const hasDelimiter = isDelimiterRow(second);
  const align = (hasDelimiter ? second : header.map(() => "")).map<TableAlign>((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
  const rows = lines.slice(hasDelimiter ? 2 : 1).map((l) => {
    const cells = splitTableRow(l);
    while (cells.length < header.length) cells.push("");
    return cells.slice(0, header.length);
  });
  return { header, align, rows, hasDelimiter };
}

const escapeCell = (c: string) => c.replace(/\n/g, " ").replace(/\|/g, "\\|").trim();

export function serializeTable(t: ParsedTable): string {
  const row = (cells: string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  const delim = t.align.map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---"));
  const out = [row(t.header)];
  if (t.hasDelimiter) out.push(`| ${delim.join(" | ")} |`);
  for (const r of t.rows) out.push(row(r));
  return out.join("\n");
}

// Consecutive `| ... |` lines (2+) form a table candidate.
const PIPE_LINE = /^\s*\|.*\|\s*$/;
export function findPipeRuns(lines: string[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!PIPE_LINE.test(lines[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && PIPE_LINE.test(lines[j + 1]!)) j++;
    if (j > i) runs.push({ start: i, end: j });
    i = j + 1;
  }
  return runs;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function renderInline(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) parent.append(text.slice(last, at));
    const tok = m[0];
    const el = document.createElement(tok.startsWith("`") ? "code" : tok.startsWith("**") ? "strong" : "em");
    el.textContent = tok.replace(/^(`|\*\*|\*)|(`|\*\*|\*)$/g, "");
    parent.append(el);
    last = at + tok.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

interface DomState {
  from: number;
  to: number;
  hasDelimiter: boolean;
  align: TableAlign[];
}
const domState = new WeakMap<HTMLElement, DomState>();

// Reads the table back out of the widget DOM (each cell keeps its raw text in data-raw).
function readDom(wrap: HTMLElement): ParsedTable | null {
  const st = domState.get(wrap);
  if (!st) return null;
  const rowsOf = (sel: string) =>
    [...wrap.querySelectorAll<HTMLTableRowElement>(sel)].map((tr) =>
      [...tr.children].map((c) => (c as HTMLElement).dataset.raw ?? "")
    );
  const header = rowsOf("thead tr")[0] ?? [];
  return { header, align: st.align, rows: rowsOf("tbody tr"), hasDelimiter: st.hasDelimiter };
}

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly table: ParsedTable,
    private readonly runtime: RecordEditorRuntimeRef,
    private readonly from: number,
    private readonly to: number
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.source === other.source && this.from === other.from;
  }

  // Our own edit already put the new text in the DOM; keep it (and the caret).
  updateDOM(dom: HTMLElement): boolean {
    const st = domState.get(dom);
    const current = readDom(dom);
    if (!st || !current || serializeTable(current) !== this.source) return false;
    st.from = this.from;
    st.to = this.to;
    return true;
  }

  private show(cell: HTMLElement, raw: string): void {
    cell.replaceChildren();
    for (const seg of splitRecordText(raw)) {
      if (seg.type === "text") {
        renderInline(cell, seg.value);
        continue;
      }
      const result = this.runtime.current.resultsByToken.get(seg.token);
      const chip = document.createElement("span");
      chip.className = "record-chip";
      chip.textContent = result && "name" in result && result.name ? result.name : seg.label;
      cell.append(chip);
    }
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    const editable = !view.state.readOnly;
    domState.set(wrap, { from: this.from, to: this.to, hasDelimiter: this.table.hasDelimiter, align: this.table.align });

    const commit = () => {
      const t = readDom(wrap);
      const st = domState.get(wrap);
      if (!t || !st) return;
      const text = serializeTable(t);
      if (view.state.doc.sliceString(st.from, st.to) === text) return;
      view.dispatch({ changes: { from: st.from, to: st.to, insert: text }, userEvent: "input" });
    };

    const mkCell = (raw: string, tag: "th" | "td", col: number) => {
      const c = document.createElement(tag);
      const a = this.table.align[col];
      if (a) c.style.textAlign = a;
      c.dataset.raw = raw;
      this.show(c, raw);
      if (!editable) return c;
      c.contentEditable = "plaintext-only";
      c.spellcheck = false;
      c.addEventListener("focus", () => {
        c.textContent = c.dataset.raw ?? "";
        // Caret to the end for keyboard focus; a click then repositions it.
        const range = document.createRange();
        range.selectNodeContents(c);
        range.collapse(false);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      });
      c.addEventListener("input", () => {
        c.dataset.raw = (c.textContent ?? "").replace(/\n/g, " ");
        commit();
      });
      c.addEventListener("blur", () => this.show(c, c.dataset.raw ?? ""));
      c.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== "Tab") return;
        e.preventDefault();
        const cells = [...wrap.querySelectorAll<HTMLElement>("th, td")];
        const cols = this.table.header.length;
        const idx = cells.indexOf(c);
        let next = e.key === "Tab" ? (e.shiftKey ? idx - 1 : idx + 1) : idx + cols;
        if (next >= cells.length) {
          // Past the last cell: append an empty row.
          const tr = document.createElement("tr");
          for (let i = 0; i < cols; i++) tr.append(mkCell("", "td", i));
          wrap.querySelector("tbody")!.append(tr);
          commit();
          next = e.key === "Tab" ? cells.length : idx + cols;
        }
        if (next < 0) return;
        const target = [...wrap.querySelectorAll<HTMLElement>("th, td")][next];
        target?.focus();
      });
      c.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain").replace(/\s*\n\s*/g, " ") ?? "";
        document.execCommand("insertText", false, text);
      });
      return c;
    };

    const mkRow = (cells: string[], tag: "th" | "td") => {
      const tr = document.createElement("tr");
      cells.forEach((raw, i) => tr.append(mkCell(raw, tag, i)));
      return tr;
    };
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.append(mkRow(this.table.header, "th"));
    const tbody = document.createElement("tbody");
    for (const r of this.table.rows) tbody.append(mkRow(r, "td"));
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  // The cells handle their own events; CM must not move its selection.
  ignoreEvent(): boolean {
    return true;
  }
}

function buildTables(state: EditorState, runtime: RecordEditorRuntimeRef): DecorationSet {
  const sel = state.selection.main;
  const doc = state.doc;
  const lines = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  const tree = syntaxTree(state);
  const out: Range<Decoration>[] = [];
  for (const run of findPipeRuns(lines)) {
    const from = doc.line(run.start + 1).from;
    const to = doc.line(run.end + 1).to;
    // Raw source stays visible while the cursor/selection touches the table.
    if (sel.from <= to && sel.to >= from) continue;
    let inCode = false;
    for (let n = tree.resolveInner(from, 1); n; n = n.parent as typeof n) {
      if (n.name === "FencedCode" || n.name === "CodeBlock") inCode = true;
      if (!n.parent) break;
    }
    if (inCode) continue;
    const source = doc.sliceString(from, to);
    const parsed = parseTable(source);
    if (!parsed) continue;
    // Widgets compare against the normalized text, so re-serialize for eq/updateDOM.
    const widget = new TableWidget(serializeTable(parsed), parsed, runtime, from, to);
    out.push(Decoration.replace({ widget, block: true }).range(from, to));
  }
  return Decoration.set(out, true);
}

// Block replace decorations must come from a state field, not a ViewPlugin.
export function createTableExtension(runtime: RecordEditorRuntimeRef): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildTables(state, runtime),
    update(value, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
        return buildTables(tr.state, runtime);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
