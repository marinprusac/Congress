import { useState } from "react";
import { Canvas } from "@/components/Canvas";

export function HomePage() {
  const [editing, setEditing] = useState(false);
  return <Canvas editing={editing} onToggleEditing={() => setEditing((e) => !e)} />;
}
