import { useEffect, useState } from "react";

export function useElapsedSeconds(
  segmentStartedAt: string | undefined,
  isPaused: boolean,
  baselineSeconds = 0,
) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!segmentStartedAt) {
      setElapsed(0);
      return;
    }

    const startedAt = new Date(segmentStartedAt).getTime();

    function tick() {
      setElapsed(Math.max(0, baselineSeconds + Math.floor((Date.now() - startedAt) / 1000)));
    }

    tick();

    if (isPaused) {
      return;
    }

    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [segmentStartedAt, isPaused, baselineSeconds]);

  return elapsed;
}
