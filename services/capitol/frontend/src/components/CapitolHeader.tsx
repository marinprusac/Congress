import { useNavigate } from "react-router-dom";
import { ChamberHeader, CapitolMark, ChamberMark } from "@congress/exhibit-ui";

export function CapitolHeader() {
  const navigate = useNavigate();

  return (
    <ChamberHeader
      icon={<CapitolMark className="h-8 w-8 text-ink" />}
      title="Capitol"
      ownChamber=""
      renderIcon={(chamber) => <ChamberMark name={chamber} />}
      navigate={(path) => navigate(path)}
    />
  );
}
