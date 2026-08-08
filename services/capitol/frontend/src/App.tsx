import { ChamberLedger } from "@/components/ChamberLedger";

export function App() {
  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-dust px-6 py-8">
        <p className="font-mono text-xs uppercase tracking-widest text-dust">Congress</p>
        <h1 className="font-display text-4xl">Capitol</h1>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <ChamberLedger />
      </main>
    </div>
  );
}
