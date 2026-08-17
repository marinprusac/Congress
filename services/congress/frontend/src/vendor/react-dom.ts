// Same CJS-interop limitation as ./react.ts - see its comment. List kept in
// sync with `Object.keys(require("react-dom"))` for 19.2.8, minus the
// internal member @types/react-dom doesn't declare.
export {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} from "react-dom";
