import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TrackingProvider } from "./lib/TrackingContext";
import "./styles.css";

const HomeApp = lazy(() => import("./home/HomeApp").then((mod) => ({ default: mod.HomeApp })));
const ToastWindow = lazy(() =>
  import("./toast/ToastWindow").then((mod) => ({ default: mod.ToastWindow })),
);

const windowLabel = getCurrentWindow().label;

function Root() {
  if (windowLabel === "toast") {
    return (
      <Suspense fallback={null}>
        <ToastWindow />
      </Suspense>
    );
  }

  return (
    <TrackingProvider>
      {windowLabel === "home" ? (
        <Suspense fallback={null}>
          <HomeApp />
        </Suspense>
      ) : (
        <App />
      )}
    </TrackingProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
