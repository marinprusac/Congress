import { Route, Routes } from "react-router-dom";
import { ChamberIndexRedirect, useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { TaskEditorPage } from "@/pages/TaskEditorPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* No list page at the root any more - this Chamber's exhibits live in
            the home feed and Search - so "/<chamber>" goes home. */}
        <Route index element={<ChamberIndexRedirect />} />
        <Route path="t/:id" element={<TaskEditorPage />} />
        <Route path="new" element={<TaskEditorPage />} />
      </Route>
    </Routes>
  );
}
