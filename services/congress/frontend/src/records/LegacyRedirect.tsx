import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

// A bookmarked retired-Chamber URL (/notes/n/5, /calendar/e/1/cal/evt)
// opens the record its import made instead.
export function LegacyRedirect({
  chamber,
  idPrefix,
  noun,
  idFrom,
}: {
  chamber: string;
  idPrefix: string;
  noun: string;
  // Builds the old id from several URL parts (default: the :id param).
  idFrom?: (params: Record<string, string | undefined>) => string;
}) {
  const params = useParams();
  const id = idFrom ? idFrom(params) : (params.id ?? "");
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/congress/exhibits/legacy/${chamber}/${idPrefix}${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setMissing(true);
        const { id: recordId } = (await res.json()) as { id: string };
        navigate(`/e/${recordId}`, { replace: true });
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [chamber, idPrefix, id, navigate]);

  return (
    <main className="chamber-main">
      <p className="font-mono text-sm text-dust">{missing ? `— This ${noun} no longer exists —` : `Opening ${noun} —`}</p>
    </main>
  );
}
