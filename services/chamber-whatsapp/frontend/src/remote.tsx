import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@congress/congress-ui";
import { App } from "@/App";
import "./index.css";

const queryClient = createQueryClient();

// Mounted by Congress's shell (ChamberHost) - see vite.remote.config.ts.
// No `settings` or `views` export: nothing to configure, and the chat list
// has no feed card (WhatsApp stays out of the home feed).
export default function Remote() {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}
