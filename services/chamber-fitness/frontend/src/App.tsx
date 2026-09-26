import { Route, Routes } from "react-router-dom";
import { ChamberIndexRedirect, useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { WorkoutViewPage } from "@/pages/WorkoutViewPage";
import { RoutineEditorPage } from "@/pages/RoutineEditorPage";
import { HealthPage } from "@/pages/HealthPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* No list page at the root any more - this Chamber's exhibits live in
            the home feed and Search - so "/<chamber>" goes home. */}
        <Route index element={<ChamberIndexRedirect />} />
        <Route path="workouts/:id" element={<WorkoutViewPage />} />
        <Route path="routines/new" element={<RoutineEditorPage />} />
        <Route path="routines/:id" element={<RoutineEditorPage />} />
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
