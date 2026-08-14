import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/exhibit-ui";
import { WidgetGrid } from "@/components/WidgetGrid";
import { LoginGate } from "@/components/LoginGate";
import { CapitolHeader } from "@/components/CapitolHeader";
import { SharesPage } from "@/pages/SharesPage";
import { SharedViewPage } from "@/pages/SharedViewPage";
import { SettingsPage } from "@/pages/SettingsPage";

function Home() {
  return (
    <div className="min-h-screen bg-parchment text-ink">
      <CapitolHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <WidgetGrid />
      </main>
    </div>
  );
}

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      {/* Deliberately outside LoginGate - a share recipient has no Congress
          login at all, and never should need one to reach this page. */}
      <Route path="/shared/:token" element={<SharedViewPage />} />
      <Route
        path="/shares"
        element={
          <LoginGate>
            <SharesPage />
          </LoginGate>
        }
      />
      <Route
        path="/settings"
        element={
          <LoginGate>
            <SettingsPage />
          </LoginGate>
        }
      />
      <Route
        path="/"
        element={
          <LoginGate>
            <Home />
          </LoginGate>
        }
      />
    </Routes>
  );
}
