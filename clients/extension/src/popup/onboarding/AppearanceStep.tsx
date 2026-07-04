import { useState } from "react";
import { DEFAULT_APPEARANCE, type Appearance } from "../../theme/theme";
import { saveAppearance } from "../../shared/settings";
import { ThemeControls } from "../components/ThemeControls";

export function AppearanceStep({ onFinish }: { onFinish(): void }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  const finish = async (persist: boolean) => {
    if (persist) await saveAppearance(appearance);
    onFinish();
  };

  return (
    <div className="onboarding-step">
      <h2>Appearance</h2>
      <ThemeControls appearance={appearance} onChange={setAppearance} />
      <footer className="card-actions">
        <button onClick={() => void finish(false)}>Skip</button>
        <button onClick={() => void finish(true)}>Start using CrossClipper</button>
      </footer>
    </div>
  );
}
