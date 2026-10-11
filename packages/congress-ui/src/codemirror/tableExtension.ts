import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { splitExhibitText } from "../textSegments.js";
import type { ExhibitEditorRuntimeRef } from "./runtime.js";

export type TableAlign = "left" | "center" | "right" | null;
export interface ParsedTable {
  header: string[];
  align: TableAlign[];
  rows: string[][];
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

export function parseTable(text: string): ParsedTable | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = splitTableRow(lines[1]!);
  if (!delim.every((c) => /^:?-+:?$/.test(c))) return null;
  const align = delim.map<TableAlign>((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
  const header = splitTableRow(lines[0]!);
  const rows = lines.slice(2).map((l) => {
    const cells = splitTableRow(l);
    while (cells.length < header.length) cells.push("");
    return cells.slice(0, header.length);
  });
  return { header, align, rows };
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

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly table: ParsedTable,
    private readonly runtime: ExhibitEditorRuntimeRef,
    private readonly from: number
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.source === other.source && this.from === other.from;
  }

  private fillCell(cell: HTMLElement, text: string): void {
    for (const seg of splitExhibitText(text)) {
      if (seg.type === "text") {
        renderInline(cell, seg.value);
        continue;
      }
      const result = this.runtime.current.resultsByToken.get(seg.token);
      const chip = document.createElement("span");
      chip.className = "exhibit-chip";
      chip.textContent = result && "name" in result && result.name ? result.name : seg.label;
      cell.append(chip);
    }
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    const table = document.createElement("table");
    const mkRow = (cells: string[], tag: "th" | "td") => {
      const tr = document.createElement("tr");
      cells.forEach((text, i) => {
        const c = document.createElement(tag);
        const a = this.table.align[i];
        if (a) c.style.textAlign = a;
        this.fillCell(c, text);
        tr.append(c);
      });
      return tr;
    };
    const thead = document.createElement("thead");
    thead.append(mkRow(this.table.header, "th"));
    const tbody = document.createElement("tbody");
    for (const r of this.table.rows) tbody.append(mkRow(r, "td"));
    table.append(thead, tbody);
    wrap.append(table);
    // Clicking reveals the raw source for editing (no-op when read-only).
    wrap.addEventListener("mousedown", (e) => {
      if (view.state.readOnly) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildTables(state: EditorState, runtime: ExhibitEditorRuntimeRef): DecorationSet {
  const sel = state.selection.main;
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return;
      // Raw source stays visible while the cursor/selection touches the table.
      if (sel.from <= node.to && sel.to >= node.from) return false;
      const source = state.doc.sliceString(node.from, node.to);
      const parsed = parseTable(source);
      if (!parsed) return false;
      const widget = new TableWidget(source, parsed, runtime, node.from);
      out.push(Decoration.replace({ widget, block: true }).range(node.from, node.to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

// Block replace decorations must come from a state field, not a ViewPlugin.
export function createTableExtension(runtime: ExhibitEditorRuntimeRef): Extension {
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
