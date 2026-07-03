import { useEffect, useRef, useState } from "react";
import { IconCheck } from "../components/icons";
import { listActivityTypes, setActiveActivity } from "../lib/tauri";
import type { ActivityTypeDto } from "../lib/types";

type ActivityPickerProps = {
  activeActivityId: number | null;
  onClose: () => void;
};

export function ActivityPicker({ activeActivityId, onClose }: ActivityPickerProps) {
  const [activityTypes, setActivityTypes] = useState<ActivityTypeDto[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listActivityTypes().then(setActivityTypes);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  function choose(activityTypeId: number | null) {
    void setActiveActivity(activityTypeId);
    onClose();
  }

  return (
    <div className="picker" ref={rootRef} role="listbox" aria-label="Seleziona attività">
      <button
        type="button"
        className={activeActivityId === null ? "picker-item active" : "picker-item"}
        onClick={() => choose(null)}
      >
        <span>Nessuna attività</span>
        {activeActivityId === null && <IconCheck size={14} />}
      </button>
      {activityTypes.map((activityType) => (
        <button
          key={activityType.id}
          type="button"
          className={activityType.id === activeActivityId ? "picker-item active" : "picker-item"}
          onClick={() => choose(activityType.id)}
        >
          <span>{activityType.name}</span>
          {activityType.id === activeActivityId && <IconCheck size={14} />}
        </button>
      ))}
    </div>
  );
}
