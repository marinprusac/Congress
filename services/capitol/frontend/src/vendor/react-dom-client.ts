// Same CJS-interop limitation as ./react.ts - see its comment. `version` is
// present at runtime (`Object.keys(require("react-dom/client"))`) but not in
// @types/react-dom's declarations, so it's omitted here too.
export { createRoot, hydrateRoot } from "react-dom/client";
