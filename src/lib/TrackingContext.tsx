import { listen } from "@tauri-apps/api/event";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getCurrentState } from "./tauri";
import type { TrackingState } from "./types";

const TrackingContext = createContext<TrackingState | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrackingState | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentState().then((initial) => {
      if (!cancelled) {
        setState(initial);
      }
    });

    listen<TrackingState>("state-changed", (event) => {
      setState(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return <TrackingContext.Provider value={state}>{children}</TrackingContext.Provider>;
}

export function useTrackingState() {
  return useContext(TrackingContext);
}
