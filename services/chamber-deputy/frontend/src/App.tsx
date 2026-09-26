import { Route, Routes } from "react-router-dom";
import { ChamberIndexRedirect, useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { DirectiveEditorPage } from "@/pages/DirectiveEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* No list page at the root any more - this Chamber's exhibits live in
            the home feed and Search - so "/<chamber>" goes home. */}
        <Route index element={<ChamberIndexRedirect />} />
        <Route path="directives/new" element={<DirectiveEditorPage />} />
        <Route path="d/:id" element={<DirectiveEditorPage />} />
      </Route>
    </Routes>
  );
}
