import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { markShellHosted, preventPinchZoom } from "@congress/congress-ui";
import { queryClient } from "@/lib/queryClient";
import { App } from "@/App";
import "./index.css";

// Capitol always acts as the shell (see ChamberHost) - this is what tells
// ChamberPicker/ChamberHeader it's safe to use <Link> for cross-app jumps
// here, not just for Capitol's own internal routes. Must run before the
// first render, and before any Chamber's remote entry could possibly mount.
markShellHosted();
preventPinchZoom();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
