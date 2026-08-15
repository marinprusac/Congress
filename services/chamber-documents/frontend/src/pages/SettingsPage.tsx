import { PageHeader } from "@congress/congress-ui";

export function SettingsPage() {
  return (
    <section>
      <PageHeader title="Settings" />
      <p className="font-mono text-sm text-dust">
        — Nothing configurable yet. The Documents Chamber has no settings of its own at this stage. —
      </p>
    </section>
  );
}
