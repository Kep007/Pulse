import { useEffect, useState } from "react";
import { getBreakSchedule, setBreakSchedule } from "../../lib/tauri";
import type { BreakDay, BreakSchedule } from "../../lib/types";

const DAY_LABELS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

// "HH:MM" strings compare correctly as text.
function isValidDay(day: BreakDay) {
  return day.start < day.end;
}

export function BreakScheduleSetting() {
  const [schedule, setSchedule] = useState<BreakSchedule | null>(null);

  useEffect(() => {
    getBreakSchedule().then(setSchedule);
  }, []);

  // Saved on every valid change. While a day is mid-edit with start >= end
  // it's only kept locally (and flagged) — sending it would make the backend
  // reset that day to its defaults under the user's cursor.
  async function save(next: BreakSchedule) {
    setSchedule(next);
    if (next.days.every(isValidDay)) {
      setSchedule(await setBreakSchedule(next));
    }
  }

  function updateDay(index: number, patch: Partial<BreakDay>) {
    if (!schedule) {
      return;
    }
    const days = schedule.days.map((day, i) => (i === index ? { ...day, ...patch } : day));
    void save({ ...schedule, days });
  }

  return (
    <div className="settings-row settings-row-stacked break-schedule">
      <label className="break-schedule-header">
        <div>
          <strong>Pausa pranzo automatica</strong>
          <p>
            All'inizio della pausa Pulse si ferma da solo e ti chiede se stai facendo un extra; alla
            fine riprende il progetto di prima, anche se la pausa l'avevi messa tu. Se durante una
            pausa lavori per qualche minuto su un progetto, ti propone di riprendere da quando hai
            iniziato.
          </p>
        </div>
        <input
          type="checkbox"
          checked={schedule?.enabled ?? false}
          disabled={schedule === null}
          onChange={() => schedule && void save({ ...schedule, enabled: !schedule.enabled })}
        />
      </label>
      {schedule?.enabled && (
        <ul className="break-schedule-days">
          {schedule.days.map((day, index) => (
            <li
              key={DAY_LABELS[index]}
              className={!day.enabled ? "off" : isValidDay(day) ? undefined : "invalid"}
            >
              <label className="break-schedule-day">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={() => updateDay(index, { enabled: !day.enabled })}
                />
                <span>{DAY_LABELS[index]}</span>
              </label>
              <input
                type="time"
                value={day.start}
                disabled={!day.enabled}
                onChange={(event) => event.target.value && updateDay(index, { start: event.target.value })}
                aria-label={`${DAY_LABELS[index]}: inizio pausa`}
              />
              <span className="break-schedule-sep">–</span>
              <input
                type="time"
                value={day.end}
                disabled={!day.enabled}
                onChange={(event) => event.target.value && updateDay(index, { end: event.target.value })}
                aria-label={`${DAY_LABELS[index]}: fine pausa`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
