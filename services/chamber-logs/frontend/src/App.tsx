import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { LogRulesListPage } from "@/pages/LogRulesListPage";
import { LogRuleViewPage } from "@/pages/LogRuleViewPage";
import { NewLogRulePage } from "@/pages/NewLogRulePage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LogRulesListPage />} />
        <Route path="r/:id" element={<LogRuleViewPage />} />
        <Route path="new" element={<NewLogRulePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
