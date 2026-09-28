import type { ReactNode } from "react";
import { ActivityDetectionToggle } from "./ActivityDetectionToggle";
import { AutostartToggle } from "./AutostartToggle";
import { BreakScheduleSetting } from "./BreakScheduleSetting";
import { BrowserTrackingSetting } from "./BrowserTrackingSetting";
import { ConfirmShortcutSetting } from "./ConfirmShortcutSetting";
import { DayRecapSetting } from "./DayRecapSetting";
import { IdleTimeoutSetting } from "./IdleTimeoutSetting";
import { LockShortcutSetting } from "./LockShortcutSetting";
import { QuitButton } from "./QuitButton";
import { ResetDataButton } from "./ResetDataButton";
import { SyncSetting } from "./SyncSetting";
import { ThemeSetting } from "./ThemeSetting";
import { WidgetPositionSetting } from "./WidgetPositionSetting";
import { WidgetScaleSetting } from "./WidgetScaleSetting";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsView() {
  return (
    <div className="settings-view">
      <Section title="Aspetto">
        <ThemeSetting />
        <WidgetPositionSetting />
        <WidgetScaleSetting />
      </Section>
      <Section title="Tracciamento">
        <AutostartToggle />
        <ActivityDetectionToggle />
        <BrowserTrackingSetting />
        <IdleTimeoutSetting />
      </Section>
      <Section title="Pause e promemoria">
        <BreakScheduleSetting />
        <DayRecapSetting />
      </Section>
      <Section title="Scorciatoie">
        <ConfirmShortcutSetting />
        <LockShortcutSetting />
      </Section>
      <Section title="Sincronizzazione">
        <SyncSetting />
      </Section>
      <Section title="Dati">
        <ResetDataButton />
        <QuitButton />
      </Section>
    </div>
  );
}
