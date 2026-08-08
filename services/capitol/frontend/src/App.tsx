import { WidgetGrid } from "@/components/WidgetGrid";
import { LoginGate, SignOutControl } from "@/components/LoginGate";
import { CapitolMark } from "@/components/icons";

export function App() {
  return (
    <LoginGate>
      <div className="min-h-screen bg-parchment text-ink">
        <header className="flex items-start justify-between border-b border-dust px-6 py-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-dust">Congress</p>
            <div className="flex items-center gap-3">
              <CapitolMark className="h-8 w-8 text-ink" />
              <h1 className="font-display text-4xl">Capitol</h1>
            </div>
          </div>
          <SignOutControl />
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <WidgetGrid />
        </main>
      </div>
    </LoginGate>
  );
}
