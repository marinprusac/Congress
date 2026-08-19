## Congress design conventions

Congress is a self-hosted productivity system: **Capitol** (the hub — homepage, global search, Exhibit Sharing) plus independent **Chambers** (Notes, Calendar, Documents, Tasks). Every screen you build with these components should read as part of that one system — plain, editorial, monospace-accented, never a generic SaaS look.

### Wrapping and setup

Two providers are required or components fail outright:

```tsx
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

const queryClient = new QueryClient();

<QueryClientProvider client={queryClient}>
  <BrowserRouter>{/* your screen */}</BrowserRouter>
</QueryClientProvider>
```

- **`QueryClientProvider`** — nearly every component fetches through `useQuery` (search, sharing, Connections panels, the Chamber registry). Without it: "No QueryClient set" crash.
- **`BrowserRouter`** (or any Router) — `ChamberLayout`, `ChamberPicker`, and `GlobalExhibitSearch` use `Link`/`useLocation`/`useNavigate`. Without it: "useNavigate() may be used only in the context of a Router" crash.

`ChamberLayout` is the full page shell (header + `<Outlet/>` + the `ChamberPicker` nav) — mount it as a layout route, not a one-off block. It expects an `icon` (a `ChamberMark`), a `title`, `navLinks` (`{to, label}[]`), `ownChamber` (a chamber id string), and `renderIcon={getChamberIcon}`.

### The styling idiom

Tailwind v4 utilities for layout/spacing, plus a small set of Congress-specific named classes for the recurring compound widgets (share popovers, exhibit chips, chamber nav). Both come from the same stylesheet — never invent new utility or component class names; use what's below or read `styles.css` for more.

**Theme tokens** (`@theme` in `styles.css`, referenced as CSS vars or matching Tailwind utilities):

| Token | Use |
|---|---|
| `--color-parchment` (`bg-parchment`) | page/panel background |
| `--color-ink` (`text-ink`) | primary text |
| `--color-slate` (`text-slate`) | secondary text |
| `--color-dust` (`text-dust`, `border-dust`) | muted text, hairline borders |
| `--color-accent` (`text-accent`, `border-accent`) | links, active state, primary actions |
| `--color-alert` (`text-alert`) | destructive/error |
| `--font-display` (`font-display`, Fraunces) | headings, titles |
| `--font-body` (default sans, IBM Plex Sans) | prose |
| `--font-mono` (`font-mono`, IBM Plex Mono) | labels, nav, metadata, buttons — Congress uses mono for nearly all UI chrome, not just code |

Typical chrome text is `font-mono text-xs uppercase tracking-wide text-dust` (nav links, field labels, timestamps) — that combination appears throughout, not just in one place.

**Named component classes** (compose these rather than rebuilding the pattern in raw utilities):

| Class | For |
|---|---|
| `.chamber-shell`, `.chamber-header`, `.chamber-main` | the page shell `ChamberLayout` renders — reach for the component, not these classes directly, unless extending it |
| `.chamber-picker-link` / `.chamber-picker-capitol-link` / `.chamber-picker-subnav` | sidebar nav rows — Capitol's own row is visually larger/display-font, every Chamber row is plain mono |
| `.share-control`, `.share-control-popover`, `.share-field`, `.share-submit` | the share-button-and-popover pattern (`ShareControl`, `CreateShareForm`, `EditShareModal` all use this) |
| `.exhibit-chip` | inline reference chips (`ExhibitChip`) — pill-shaped, icon + name, with `data-exhibit-state="resolved"|"deleted"|"unavailable"` driving muted/strikethrough variants |
| `.exhibit-sharing-badge` | the small pill badge showing an exhibit is shared, with `data-sharing-state="direct"|"inherited"` |

Borders are hairline (`border-dust`), radii are sharp/near-zero (this system does not use rounded cards), spacing is generous vertical rhythm with thin horizontal dividers rather than boxed cards.

### Where the truth lives

Read `styles.css` (and its `@import` closure, including `_ds_bundle.css`) before styling anything — it's the actual compiled stylesheet every one of these previews renders against, not a summary. Each component's own `.prompt.md` under `components/<group>/<Name>/` documents its exact props and real usage composition.

### Example: a Chamber page

```tsx
import { ChamberLayout, ChamberMark, getChamberIcon, ExhibitSharingBadge, ShareControl } from "@congress/congress-ui";

function NotesChamber() {
  return (
    <ChamberLayout
      icon={<ChamberMark name="notes" className="h-8 w-8 text-ink" />}
      title="Notes"
      navLinks={[
        { to: "/", label: "All Notes" },
        { to: "/new", label: "New" },
        { to: "/settings", label: "Settings" },
      ]}
      ownChamber="notes"
      renderIcon={getChamberIcon}
    />
  );
}

function NoteHeader({ noteId, title }: { noteId: string; title: string }) {
  return (
    <div className="mb-6 flex items-center justify-between border-b border-dust pb-4">
      <h2 className="flex items-center gap-3 font-display text-3xl text-ink">
        {title}
        <ExhibitSharingBadge exhibitId={noteId} className="exhibit-sharing-badge" />
      </h2>
      <ShareControl chamber="notes" exhibitId={noteId} exhibitName={title} />
    </div>
  );
}
```
