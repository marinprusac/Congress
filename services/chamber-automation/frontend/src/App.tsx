import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { AutomationsListPage } from "@/pages/AutomationsListPage";
import { AutomationViewPage } from "@/pages/AutomationViewPage";
import { NewAutomationPage } from "@/pages/NewAutomationPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AutomationsListPage />} />
        <Route path="a/:id" element={<AutomationViewPage />} />
        <Route path="new" element={<NewAutomationPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
