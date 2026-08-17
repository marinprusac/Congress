import type { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ArgsEditorProps {
  tool: Tool | undefined;
  argsTemplate: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  inputClassName: string;
}

// One text field per top-level property in the selected tool's own JSON
// Schema input - flat schemas only (v1), each value {{payload.x}}
// interpolated then JSON.parsed when that succeeds (see this Chamber's own
// eventPoller.ts buildArgs) so a plain number/boolean/object typed in
// (or produced by interpolation) comes through as its real type rather than
// always a string. No schema-aware coercion beyond that.
export function ArgsEditor({ tool, argsTemplate, onChange, inputClassName }: ArgsEditorProps) {
  if (!tool) return null;

  const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = new Set(tool.inputSchema.required ?? []);
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return <p className="mb-4 font-mono text-xs text-dust">This tool takes no arguments.</p>;
  }

  function setKey(key: string, value: string) {
    onChange({ ...argsTemplate, [key]: value });
  }

  return (
    <div className="mb-4 space-y-3">
      {keys.map((key) => {
        const property = properties[key];
        return (
          <div key={key}>
            <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-dust">
              {key}
              {required.has(key) ? " *" : ""}
              {property?.type ? ` (${property.type})` : ""}
            </label>
            <input
              value={argsTemplate[key] ?? ""}
              onChange={(e) => setKey(key, e.target.value)}
              placeholder={property?.description ?? "e.g. {{payload.x}}"}
              className={inputClassName}
            />
          </div>
        );
      })}
    </div>
  );
}
