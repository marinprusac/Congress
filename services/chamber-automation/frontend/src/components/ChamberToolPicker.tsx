import { useQuery } from "@tanstack/react-query";
import { fetchRegistry } from "@congress/congress-ui";
import { fetchChamberTools } from "@/lib/api";

interface ChamberToolPickerProps {
  targetChamber: string;
  toolName: string;
  onChamberChange: (chamber: string) => void;
  onToolChange: (tool: string) => void;
  selectClassName: string;
}

// Mirrors TriggerEventPicker's chamber+X pattern on the action side: which
// Chamber, then which of its own callable tools - a live tools/list call
// (see lib/api.ts's fetchChamberTools), not a declared manifest catalog
// like events, since MCP already gives every tool a full input schema for
// free.
export function ChamberToolPicker({ targetChamber, toolName, onChamberChange, onToolChange, selectClassName }: ChamberToolPickerProps) {
  const registryQuery = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const toolsQuery = useQuery({
    queryKey: ["chamber-tools", targetChamber],
    queryFn: () => fetchChamberTools(targetChamber),
    enabled: !!targetChamber,
  });

  const chambers = (registryQuery.data ?? []).filter((c) => c.status === "active");
  const tools = toolsQuery.data ?? [];
  const selectedTool = tools.find((t) => t.name === toolName);

  function selectChamber(chamber: string) {
    onChamberChange(chamber);
    onToolChange("");
  }

  return (
    <div>
      <div className="flex gap-2">
        <select
          value={targetChamber}
          onChange={(e) => selectChamber(e.target.value)}
          disabled={registryQuery.isLoading}
          className={selectClassName}
          aria-label="Target chamber"
        >
          <option value="" disabled>
            {registryQuery.isLoading ? "Loading —" : "— Chamber —"}
          </option>
          {chambers.map((chamber) => (
            <option key={chamber.name} value={chamber.name}>
              {chamber.displayName}
            </option>
          ))}
        </select>

        <select
          value={toolName}
          onChange={(e) => onToolChange(e.target.value)}
          disabled={!targetChamber || toolsQuery.isLoading}
          className={selectClassName}
          aria-label="Tool"
        >
          <option value="" disabled>
            {toolsQuery.isLoading ? "Loading —" : toolsQuery.data === null ? "— Chamber unreachable —" : "— Tool —"}
          </option>
          {!selectedTool && toolName && <option value={toolName}>{toolName} (not currently offered)</option>}
          {tools.map((tool) => (
            <option key={tool.name} value={tool.name}>
              {tool.title ?? tool.name}
            </option>
          ))}
        </select>
      </div>
      {selectedTool?.description && <p className="mt-1 font-mono text-xs text-dust">{selectedTool.description}</p>}
    </div>
  );
}
