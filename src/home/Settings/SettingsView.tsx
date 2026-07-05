import { ActivityDetectionToggle } from "./ActivityDetectionToggle";
import { AutostartToggle } from "./AutostartToggle";
import { ConfirmShortcutSetting } from "./ConfirmShortcutSetting";
import { QuitButton } from "./QuitButton";
import { ResetDataButton } from "./ResetDataButton";
import { WidgetPositionSetting } from "./WidgetPositionSetting";

export function SettingsView() {
  return (
    <div className="settings-view">
      <WidgetPositionSetting />
      <AutostartToggle />
      <ActivityDetectionToggle />
      <ConfirmShortcutSetting />
      <ResetDataButton />
      <QuitButton />
    </div>
  );
}
