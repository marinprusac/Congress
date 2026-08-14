import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/exhibit-ui";
import { Layout } from "@/components/Layout";
import { DocumentsListPage } from "@/pages/DocumentsListPage";
import { DocumentViewPage } from "@/pages/DocumentViewPage";
import { UploadDocumentPage } from "@/pages/UploadDocumentPage";
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
        <Route index element={<DocumentsListPage />} />
        <Route path="d/:id" element={<DocumentViewPage />} />
        <Route path="new" element={<UploadDocumentPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
