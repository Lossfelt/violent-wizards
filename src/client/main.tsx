import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// PROTOTYPE: dev-only UI exploration at ?prototype. Remove with src/client/prototype.
const showPrototype =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("prototype");
const UiPrototype = lazy(() =>
  import("./prototype/UiPrototype").then((module) => ({ default: module.UiPrototype })),
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {showPrototype ? (
      <Suspense fallback={null}>
        <UiPrototype />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
