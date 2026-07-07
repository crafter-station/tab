import { SectionCard } from "@tabb/ui";
import { useEffect, useState } from "react";
import { getAppRoute, type AppRoute } from "./routes";
import { OverlaySurface } from "./surfaces/OverlaySurface";
import { OnboardingSurface } from "./surfaces/OnboardingSurface";

function SettingsPlaceholder() {
  return (
    <main className="desktop-shell desktop-shell--centered">
      <SectionCard className="section-card--narrow">
        <p className="eyebrow">Tabb Settings</p>
        <h1>Settings are moving into React.</h1>
        <p className="lede">
          This routed renderer is ready for the next migration phase. The production settings window still uses the
          existing settings surface for now.
        </p>
      </SectionCard>
    </main>
  );
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => getAppRoute());

  useEffect(() => {
    const syncRoute = () => setRoute(getAppRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    document.body.dataset.surface = route;
    return () => {
      delete document.body.dataset.surface;
    };
  }, [route]);

  if (route === "onboarding") return <OnboardingSurface />;
  if (route === "settings") return <SettingsPlaceholder />;

  return <OverlaySurface />;
}
