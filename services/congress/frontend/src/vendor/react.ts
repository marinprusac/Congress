// `export * from "react"` doesn't work here: react's package is CommonJS,
// and Vite/Rollup's CJS interop can't statically enumerate its exports for
// a re-export-everything star export (confirmed by testing - it silently
// produces an empty chunk). Naming each export explicitly gives Rollup a
// concrete list to resolve off the CJS namespace object, which does work.
// List kept in sync with `Object.keys(require("react"))` for the pinned
// version (19.2.8), minus a few internal/unstable members @types/react
// doesn't declare (and nothing should be importing anyway) - re-run that
// if the version bumps and something's missing.
//
// A default export is needed on top of that named list for any dependency
// still doing `import React from "react"` (react-leaflet's own internals,
// at minimum) - `import * as React from "react"` at a real import site (as
// opposed to a blind `export *` re-export) is something Rollup's CJS
// interop *can* resolve, since it's synthesizing a namespace object here
// rather than statically enumerating names to re-export.
import * as React from "react";
export default React;
export {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  act,
  cache,
  cacheSignal,
  captureOwnerStack,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} from "react";
