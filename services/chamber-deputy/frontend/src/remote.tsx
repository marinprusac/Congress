import type { ComponentType } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, PersistedQueryProvider } from "@congress/congress-ui";
import { App } from "@/App";
import { widgets as rawWidgets } from "@/widgets";
import "./index.css";

const queryClient = createQueryClient();

// The entry Capitol's shell (ChamberHost) dynamically imports and renders
// directly into its own React tree - see vite.remote.config.ts for how this
// gets built as a standalone ES module sharing the shell's React/router/
// query-client instances instead of bundling its own. No BrowserRouter here
// (unlike main.tsx's standalone boot): the shell already supplies one, and
// App's routes are relative, so they resolve correctly nested under
// whatever prefix the shell's route matched. Keeps this Chamber's own
// QueryClient, same as standalone mode, so its cache stays isolated from
// every other Chamber's.
export default function Remote() {
  return (
    <PersistedQueryProvider client={queryClient} namespace="deputy">
      <App />
    </PersistedQueryProvider>
  );
}

// Capitol's canvas resolves a widget component straight out of this same
// remote entry (via the shared loadRemoteModule) rather than navigating to a
// URL - see src/manifest.ts's `widgets` array for the id -> entry mapping.
// Wrapped in this Chamber's own QueryClientProvider here, same reason
// Remote() wraps App above - Capitol's canvas mounts these bare, with no
// idea which Chamber's query cache each one needs.
function withQueryClient(Widget: ComponentType): ComponentType {
  return function WrappedWidget() {
    return (
      <QueryClientProvider client={queryClient}>
        <Widget />
      </QueryClientProvider>
    );
  };
}

export const widgets: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(rawWidgets).map(([id, Widget]) => [id, withQueryClient(Widget)])
);
