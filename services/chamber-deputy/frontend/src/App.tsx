import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ChatPage } from "@/pages/ChatPage";
import { DirectivesListPage } from "@/pages/DirectivesListPage";
import { DirectiveViewPage } from "@/pages/DirectiveViewPage";
import { NewDirectivePage } from "@/pages/NewDirectivePage";
import { RunHistoryPage } from "@/pages/RunHistoryPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ChatPage />} />
        <Route path="directives" element={<DirectivesListPage />} />
        <Route path="directives/new" element={<NewDirectivePage />} />
        <Route path="d/:id" element={<DirectiveViewPage />} />
        <Route path="runs" element={<RunHistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
