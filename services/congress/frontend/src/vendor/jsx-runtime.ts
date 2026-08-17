// Same CJS-interop limitation as ./react.ts - see its comment. List kept in
// sync with `Object.keys(require("react/jsx-runtime"))` for 19.2.8. Needed
// because @vitejs/plugin-react's automatic JSX transform imports from this
// specifier in every .tsx file, including every Chamber's.
export { Fragment, jsx, jsxs } from "react/jsx-runtime";
