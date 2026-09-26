import { Route, Routes } from "react-router-dom";
import { ChamberIndexRedirect, useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ItemViewPage } from "@/pages/ItemViewPage";
import { NewItemPage } from "@/pages/NewItemPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* No list page: this Chamber's exhibits reach Congress's home feed
            (src/feedRules.ts) and Search on their own, and "+" creates them -
            so "/<chamber>" goes home. */}
        <Route index element={<ChamberIndexRedirect />} />
        <Route path="i/:id" element={<ItemViewPage />} />
        <Route path="new" element={<NewItemPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
