import { CreateShareForm } from "@congress/exhibit-ui";

export function FixedRoot() {
  return (
    <CreateShareForm
      fixedRoot={{ chamber: "notes", id: "note-9", name: "Congress Development" }}
      className="share-form"
    />
  );
}

export function WithRootPicker() {
  return <CreateShareForm className="share-form" />;
}
