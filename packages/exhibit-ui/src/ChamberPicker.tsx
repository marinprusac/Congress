import { useQuery } from "@tanstack/react-query";
import { fetchRegistry } from "./registry.js";
import { ChamberMark, CapitolMark } from "./ChamberMarks.js";

interface ChamberPickerProps {
  // "capitol" or a Chamber's manifest name - which entry is highlighted as
  // the one currently open.
  current: string;
}

// Persistent way to jump directly between Capitol and any Chamber, instead
// of round-tripping through the homepage - a fixed sidebar on desktop, a
// fixed bottom bar on mobile (stacked below a Chamber's own
// .chamber-mobile-nav, see styles.css). Plain <a> links, not <Link>, since
// every Chamber (and Capitol) is a fully separate app instance.
export function ChamberPicker({ current }: ChamberPickerProps) {
  const { data } = useQuery({ queryKey: ["congress", "registry"], queryFn: fetchRegistry });
  const chambers = (data ?? []).filter((c) => c.status === "active");

  return (
    <>
      <nav className="chamber-picker-desktop" aria-label="Chambers">
        <a
          href="/"
          className={current === "capitol" ? "chamber-picker-link active" : "chamber-picker-link"}
          title="Capitol"
        >
          <CapitolMark className="chamber-picker-icon" />
        </a>
        {chambers.map((chamber) => (
          <a
            key={chamber.name}
            href={chamber.routes.home}
            className={current === chamber.name ? "chamber-picker-link active" : "chamber-picker-link"}
            title={chamber.displayName}
          >
            <ChamberMark name={chamber.name} className="chamber-picker-icon" />
          </a>
        ))}
      </nav>

      <nav className="chamber-picker-mobile" aria-label="Chambers">
        <a
          href="/"
          className={current === "capitol" ? "chamber-picker-mobile-link active" : "chamber-picker-mobile-link"}
        >
          <CapitolMark className="chamber-picker-icon" />
          {current === "capitol" && <span className="chamber-picker-mobile-label">Capitol</span>}
        </a>
        {chambers.map((chamber) => (
          <a
            key={chamber.name}
            href={chamber.routes.home}
            className={
              current === chamber.name ? "chamber-picker-mobile-link active" : "chamber-picker-mobile-link"
            }
          >
            <ChamberMark name={chamber.name} className="chamber-picker-icon" />
            {current === chamber.name && <span className="chamber-picker-mobile-label">{chamber.displayName}</span>}
          </a>
        ))}
      </nav>
    </>
  );
}
