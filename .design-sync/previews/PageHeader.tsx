import { PageHeader } from "@congress/congress-ui";

// Real usage, ported verbatim - every Chamber's Settings/New pages open with
// this: chamber-notes/SettingsPage.tsx uses "Settings", chamber-tasks/
// NewTaskPage.tsx uses "New Task".

export function Settings() {
  return <PageHeader title="Settings" />;
}

export function NewTask() {
  return <PageHeader title="New Task" />;
}
