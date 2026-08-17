import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { ItemsListPage } from "@/pages/ItemsListPage";
import { ItemViewPage } from "@/pages/ItemViewPage";
import { NewItemPage } from "@/pages/NewItemPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ItemsListPage />} />
        <Route path="i/:id" element={<ItemViewPage />} />
        <Route path="new" element={<NewItemPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
