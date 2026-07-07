import { useEffect, useState } from "react";
import { getAppRoute, type ControlAppRoute } from "./routes";
import { OnboardingSurface } from "./surfaces/OnboardingSurface";
import { SettingsSurface } from "./surfaces/SettingsSurface";

export function App() {
  const [route, setRoute] = useState<ControlAppRoute>(() => getAppRoute());

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
  return <SettingsSurface />;
}
