import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@congress/exhibit-ui";
import { App } from "@/App";
import "./index.css";

const queryClient = createQueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.PROD ? "/documents" : "/"}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
