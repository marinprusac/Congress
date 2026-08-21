import { Route, Routes } from "react-router-dom";
import { useAppliedTheme } from "@congress/congress-ui";
import { Layout } from "@/components/Layout";
import { MapPage } from "@/pages/MapPage";
import { PlacesListPage } from "@/pages/PlacesListPage";
import { PlaceViewPage } from "@/pages/PlaceViewPage";
import { NewPlacePage } from "@/pages/NewPlacePage";
import { PendingVisitsPage } from "@/pages/PendingVisitsPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  useAppliedTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MapPage />} />
        <Route path="places" element={<PlacesListPage />} />
        <Route path="places/new" element={<NewPlacePage />} />
        {/* Matches exhibits.ts's urlFor("/p/:id") - the same path an Exhibit
            chip/global-search result navigates to, not "places/:id". */}
        <Route path="p/:id" element={<PlaceViewPage />} />
        <Route path="pending" element={<PendingVisitsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
