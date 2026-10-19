"use client";

import { createContext, useContext } from "react";

type DemoMode = { enabled: boolean; aiEnabled: boolean };
const Context = createContext<DemoMode>({ enabled: false, aiEnabled: false });

export function DemoModeProvider({ value, children }: { value: DemoMode; children: React.ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useDemoMode = () => useContext(Context);
