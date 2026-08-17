import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { DocumentsListPage } from "@/pages/DocumentsListPage";
import { DocumentViewPage } from "@/pages/DocumentViewPage";
import { UploadDocumentPage } from "@/pages/UploadDocumentPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DocumentsListPage />} />
        <Route path="d/:id" element={<DocumentViewPage />} />
        <Route path="new" element={<UploadDocumentPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
