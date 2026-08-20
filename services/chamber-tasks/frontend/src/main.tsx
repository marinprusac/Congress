import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { createQueryClient, preventPinchZoom, ToastHost, PersistedQueryProvider } from "@congress/congress-ui";
import { App } from "@/App";
import "./index.css";

preventPinchZoom();

const queryClient = createQueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <PersistedQueryProvider client={queryClient} namespace="tasks">
      <BrowserRouter basename={import.meta.env.PROD ? "/tasks" : "/"}>
        <App />
      </BrowserRouter>
      <ToastHost />
    </PersistedQueryProvider>
  </StrictMode>
);
