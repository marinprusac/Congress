import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { EventSettingsListPage } from "@/pages/EventSettingsListPage";
import { EventSettingsDetailPage } from "@/pages/EventSettingsDetailPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<EventSettingsListPage />} />
        <Route path="events/:eventType" element={<EventSettingsDetailPage />} />
      </Route>
    </Routes>
  );
}
