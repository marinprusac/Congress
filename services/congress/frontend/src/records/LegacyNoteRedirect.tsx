import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

// A bookmarked /notes/n/:id opens the note's record instead.
export function LegacyNoteRedirect() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/congress/exhibits/legacy/notes/note-${encodeURIComponent(id)}`)
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
  }, [id, navigate]);

  return (
    <main className="chamber-main">
      <p className="font-mono text-sm text-dust">{missing ? "— This note no longer exists —" : "Opening note —"}</p>
    </main>
  );
}
