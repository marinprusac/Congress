// Builds the one shared copy of @congress/congress-ui - 4,800+ lines of
// exhibit chip/picker/NavPanel/ChamberLayout components that every Chamber
// (and this shell's own bundle) imports, so it stops getting recompiled
// into all nine remote entries plus this app's own bundle. Unlike react.ts,
// congress-ui is a real ESM source package (not CJS), so a plain star
// re-export is statically analyzable and works - see that file's comment
// for why it can't do the same. congress-ui's own source imports react/
// react-dom/react-router-dom/@tanstack/react-query bare, same as this
// build's react.ts/react-dom.ts/etc. entries do - since this is one
// multi-entry Rollup build, those resolve to the exact same on-disk
// packages either way, so Rollup already factors the shared internals into
// one common chunk underneath every entry here, congress-ui included. No
// `external` needed for this file specifically.
export * from "@congress/congress-ui";
