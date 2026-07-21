import { ActivityDetectionToggle } from "./ActivityDetectionToggle";
import { AutostartToggle } from "./AutostartToggle";
import { BrowserTrackingSetting } from "./BrowserTrackingSetting";
import { ConfirmShortcutSetting } from "./ConfirmShortcutSetting";
import { IdleTimeoutSetting } from "./IdleTimeoutSetting";
import { LockShortcutSetting } from "./LockShortcutSetting";
import { QuitButton } from "./QuitButton";
import { ResetDataButton } from "./ResetDataButton";
import { WidgetPositionSetting } from "./WidgetPositionSetting";
import { WidgetScaleSetting } from "./WidgetScaleSetting";

export function SettingsView() {
  return (
    <div className="settings-view">
      <WidgetPositionSetting />
      <WidgetScaleSetting />
      <AutostartToggle />
      <ActivityDetectionToggle />
      <BrowserTrackingSetting />
      <ConfirmShortcutSetting />
      <IdleTimeoutSetting />
      <LockShortcutSetting />
      <ResetDataButton />
      <QuitButton />
    </div>
  );
}
