import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { WorkoutsListPage } from "@/pages/WorkoutsListPage";
import { WorkoutViewPage } from "@/pages/WorkoutViewPage";
import { HealthPage } from "@/pages/HealthPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WorkoutsListPage />} />
        <Route path="workouts/:id" element={<WorkoutViewPage />} />
        {/* Not "health" - that path is reserved by the Chamber contract's
            own liveness check (GET /health, proxied straight to the
            backend in dev and mounted ahead of the SPA fallback in prod),
            so a route by that name would never actually render this page. */}
        <Route path="metrics" element={<HealthPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
