import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { createQueryClient, PersistedQueryProvider } from "@congress/congress-ui";
import { App } from "@/App";
import "./index.css";

const queryClient = createQueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <PersistedQueryProvider client={queryClient} namespace="deputy">
      <BrowserRouter basename={import.meta.env.PROD ? "/deputy" : "/"}>
        <App />
      </BrowserRouter>
    </PersistedQueryProvider>
  </StrictMode>
);
