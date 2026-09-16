import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ChatPage } from "@/pages/ChatPage";
import { DirectivesListPage } from "@/pages/DirectivesListPage";
import { DirectiveEditorPage } from "@/pages/DirectiveEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DirectivesListPage />} />
        <Route path="directives/new" element={<DirectiveEditorPage />} />
        <Route path="d/:id" element={<DirectiveEditorPage />} />
        <Route path="chat" element={<ChatPage />} />
      </Route>
    </Routes>
  );
}
