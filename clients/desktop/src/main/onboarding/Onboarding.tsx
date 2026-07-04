import { useState } from "react";
import { saveServerVersion } from "../../shared/settings";
import { AppearanceStep } from "./AppearanceStep";
import { ServerStep } from "./ServerStep";
import { SignInStep } from "./SignInStep";

export interface OnboardingProps {
  mode?: "fresh" | "reauth";
  initialServer?: string;
  notice?: string;
  onComplete(): void;
}

export function Onboarding({ mode = "fresh", initialServer, notice, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(mode === "reauth" && initialServer ? 2 : 1);
  const [baseUrl, setBaseUrl] = useState(initialServer ?? "");
  const [signInMode, setSignInMode] = useState<"signin" | "create" | "reauth">(
    mode === "reauth" ? "reauth" : "signin",
  );

  return (
    <div className="app onboarding">
      <header className="header">
        <span>
          <span aria-hidden>⧉</span> <span>CrossClipper</span>
        </span>
        <span className="text-muted">step {step}/3</span>
      </header>
      {step === 1 && (
        <ServerStep
          initialUrl={baseUrl}
          onNext={(url, probe) => {
            setBaseUrl(url);
            setSignInMode(probe.registrationOpen ? "create" : mode === "reauth" ? "reauth" : "signin");
            void saveServerVersion(probe.version);
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <SignInStep baseUrl={baseUrl} mode={signInMode} notice={notice} onDone={() => setStep(3)} />
      )}
      {step === 3 && <AppearanceStep onFinish={onComplete} />}
    </div>
  );
}
