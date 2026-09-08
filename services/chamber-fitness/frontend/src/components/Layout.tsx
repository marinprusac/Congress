import { Link, useLocation } from "react-router-dom";
import { ChamberLayout, ChamberMark, useShellHosted, resolveChamberPath } from "@congress/congress-ui";

// Workouts is the index route; Health is a second, equally-weighted section
// with no "default page" to collapse into - same reasoning as Map's own
// Places/Pending header links.
function FitnessHeaderLinks() {
  const { pathname } = useLocation();
  const shellHosted = useShellHosted();
  const links = [{ to: "/metrics", label: "Health" }];
  return (
    <>
      {links.map((link) => {
        const to = resolveChamberPath(link.to, "fitness", shellHosted);
        return (
          <Link
            key={link.to}
            to={to}
            className={pathname.startsWith(to) ? "chamber-header-link active" : "chamber-header-link"}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

export function Layout() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="fitness" className="h-8 w-8 text-ink" />}
      title="Fitness"
      ownChamber="fitness"
      extraActions={<FitnessHeaderLinks />}
    />
  );
}
