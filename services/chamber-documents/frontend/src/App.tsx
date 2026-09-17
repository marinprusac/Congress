import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { DocumentsListPage } from "@/pages/DocumentsListPage";
import { DocumentEditorPage } from "@/pages/DocumentEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DocumentsListPage />} />
        <Route path="d/:id" element={<DocumentEditorPage />} />
        <Route path="new" element={<DocumentEditorPage />} />
      </Route>
    </Routes>
  );
}
