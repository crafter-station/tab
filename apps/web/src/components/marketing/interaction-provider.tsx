import { createContext, useContext, useEffect, useRef } from "react";
import type { FocusEventHandler, PointerEventHandler, ReactNode, RefObject } from "react";

type AcceptanceSurface = {
  element: HTMLElement;
  accept: () => void;
};

type AcceptanceContextValue = {
  register: (surface: AcceptanceSurface, primary: boolean) => () => void;
  activate: (surface: AcceptanceSurface) => void;
};

const AcceptanceContext = createContext<AcceptanceContextValue | null>(null);

export function MarketingInteractionProvider({ children }: { children: ReactNode }) {
  const activeSurface = useRef<AcceptanceSurface | null>(null);
  const primarySurface = useRef<AcceptanceSurface | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "Tab" && event.code !== "Tab")) return;
      const surface = activeSurface.current ?? primarySurface.current;
      if (!surface) return;
      event.preventDefault();
      activeSurface.current = surface;
      surface.accept();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
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

export function useAcceptanceSurface<T extends HTMLElement>(accept: () => void, primary = false): {
  ref: RefObject<T | null>;
  onFocusCapture: FocusEventHandler<T>;
  onPointerOver: PointerEventHandler<T>;
} {
  const context = useContext(AcceptanceContext);
  if (!context) throw new Error("Acceptance surfaces must be inside MarketingInteractionProvider");
  const ref = useRef<T>(null);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const surfaceRef = useRef<AcceptanceSurface | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const surface = { element, accept: () => acceptRef.current() };
    surfaceRef.current = surface;
    return context.register(surface, primary);
  }, [context, primary]);

  const activate = () => {
    if (surfaceRef.current) context.activate(surfaceRef.current);
  };

  return { ref, onFocusCapture: activate, onPointerOver: activate };
}
