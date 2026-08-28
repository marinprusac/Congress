import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ChatPage } from "@/pages/ChatPage";
import { DirectivesListPage } from "@/pages/DirectivesListPage";
import { DirectiveViewPage } from "@/pages/DirectiveViewPage";
import { NewDirectivePage } from "@/pages/NewDirectivePage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DirectivesListPage />} />
        <Route path="directives/new" element={<NewDirectivePage />} />
        <Route path="d/:id" element={<DirectiveViewPage />} />
        <Route path="chat" element={<ChatPage />} />
      </Route>
    </Routes>
  );
}
