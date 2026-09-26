import { Outlet } from "react-router-dom";
import { NavPanel, ChamberHeader, ChamberMark, useShellHosted } from "@congress/congress-ui";

export function Layout() {
  const shellHosted = useShellHosted();

  return (
    <div className="chamber-shell">
      {!shellHosted && <NavPanel current="deputy" currentLabel="Deputy" />}
      <ChamberHeader icon={<ChamberMark name="deputy" className="h-8 w-8 text-ink" />} title="Deputy" ownChamber="deputy" />
      <main className="chamber-main">
        <Outlet />
      </main>
    </div>
  );
}
