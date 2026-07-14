import { createContext, useContext, useEffect, useRef } from "react";
import type { FocusEventHandler, PointerEventHandler, ReactNode, RefObject } from "react";

type AcceptanceSurface = {
  element: HTMLElement;
  accept?: () => void;
  deepComplete?: () => void;
};

type AcceptanceContextValue = {
  register: (surface: AcceptanceSurface, primary: boolean) => () => void;
  activate: (surface: AcceptanceSurface) => void;
};

const AcceptanceContext = createContext<AcceptanceContextValue | null>(null);

export function MarketingInteractionProvider({ children }: { children: ReactNode }) {
  const activeSurface = useRef<AcceptanceSurface | null>(null);
  const primarySurface = useRef<AcceptanceSurface | null>(null);
  const lastOptionTap = useRef(0);
  const optionChorded = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key !== "Alt") optionChorded.current = true;
      if (!event.altKey || (event.key !== "Tab" && event.code !== "Tab")) return;
      const active = activeSurface.current;
      const surface = active?.accept ? active : primarySurface.current;
      if (!surface?.accept) return;
      event.preventDefault();
      activeSurface.current = surface;
      surface.accept();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      if (optionChorded.current) {
        optionChorded.current = false;
        lastOptionTap.current = 0;
        return;
      }
      const now = performance.now();
      const surface = activeSurface.current;
      if (surface?.deepComplete && lastOptionTap.current > 0 && now - lastOptionTap.current < 400) {
        event.preventDefault();
        lastOptionTap.current = 0;
        surface.deepComplete();
        return;
      }
      lastOptionTap.current = now;
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const value: AcceptanceContextValue = {
    register(surface, primary) {
      if (primary) primarySurface.current = surface;
      return () => {
        if (activeSurface.current === surface) activeSurface.current = null;
        if (primarySurface.current === surface) primarySurface.current = null;
      };
    },
    activate(surface) {
      activeSurface.current = surface;
    },
  };

  return <AcceptanceContext.Provider value={value}>{children}</AcceptanceContext.Provider>;
}

export function useAcceptanceSurface<T extends HTMLElement>(accept: () => void, primary = false, deepComplete?: () => void): {
  ref: RefObject<T | null>;
  onFocusCapture: FocusEventHandler<T>;
  onPointerOver: PointerEventHandler<T>;
} {
  const context = useContext(AcceptanceContext);
  if (!context) throw new Error("Acceptance surfaces must be inside MarketingInteractionProvider");
  const ref = useRef<T>(null);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const deepCompleteRef = useRef(deepComplete);
  deepCompleteRef.current = deepComplete;
  const surfaceRef = useRef<AcceptanceSurface | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const surface = { element, accept: () => acceptRef.current(), deepComplete: () => deepCompleteRef.current?.() };
    surfaceRef.current = surface;
    return context.register(surface, primary);
  }, [context, primary]);

  const activate = () => {
    if (surfaceRef.current) context.activate(surfaceRef.current);
  };

  return { ref, onFocusCapture: activate, onPointerOver: activate };
}
