import { AutostartToggle } from "./AutostartToggle";
import { ConfirmShortcutSetting } from "./ConfirmShortcutSetting";
import { QuitButton } from "./QuitButton";
import { ResetDataButton } from "./ResetDataButton";

export function SettingsView() {
  return (
    <div className="settings-view">
      <AutostartToggle />
      <ConfirmShortcutSetting />
      <ResetDataButton />
      <QuitButton />
    </div>
  );
}
