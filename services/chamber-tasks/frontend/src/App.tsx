import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/exhibit-ui";
import { Layout } from "@/components/Layout";
import { TasksListPage } from "@/pages/TasksListPage";
import { TaskViewPage } from "@/pages/TaskViewPage";
import { NewTaskPage } from "@/pages/NewTaskPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WidgetPreviewPage } from "@/pages/WidgetPreviewPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      {/* No Layout chrome here — this route is embedded in an iframe as
          Capitol's homepage widget for this Chamber, not visited directly. */}
      <Route path="widget" element={<WidgetPreviewPage />} />
      <Route element={<Layout />}>
        <Route index element={<TasksListPage />} />
        <Route path="t/:id" element={<TaskViewPage />} />
        <Route path="new" element={<NewTaskPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
