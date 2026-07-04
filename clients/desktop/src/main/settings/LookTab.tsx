import { useEffect, useState } from "react";
import { type Appearance } from "../../theme/theme";
import { loadAppearanceStored, saveAppearance } from "../../shared/settings";
import { ThemeControls } from "../components/ThemeControls";

export function LookTab() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);

  useEffect(() => {
    void loadAppearanceStored().then(setAppearance);
  }, []);

  if (!appearance) return null;
  return (
    <ThemeControls
      appearance={appearance}
      onChange={(a) => {
        setAppearance(a);
        void saveAppearance(a);
      }}
    />
  );
}
