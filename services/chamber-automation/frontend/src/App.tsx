import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { AutomationsListPage } from "@/pages/AutomationsListPage";
import { AutomationEditorPage } from "@/pages/AutomationEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AutomationsListPage />} />
        <Route path="a/:id" element={<AutomationEditorPage />} />
        <Route path="new" element={<AutomationEditorPage />} />
      </Route>
    </Routes>
  );
}
