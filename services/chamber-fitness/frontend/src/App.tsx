import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { WorkoutsListPage } from "@/pages/WorkoutsListPage";
import { WorkoutViewPage } from "@/pages/WorkoutViewPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<WorkoutsListPage />} />
        <Route path="workouts/:id" element={<WorkoutViewPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
