import { createQueryClient, PersistedQueryProvider } from "@congress/congress-ui";
import { App } from "@/App";
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
    <PersistedQueryProvider client={queryClient} namespace="capitol">
      <App />
    </PersistedQueryProvider>
  );
}
