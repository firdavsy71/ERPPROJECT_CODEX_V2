"use client";
import { createContext, useContext } from "react";
const RegionalContext = createContext("Asia/Tashkent");
export function RegionalProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: React.ReactNode;
}) {
  return (
    <RegionalContext.Provider value={timeZone}>
      {children}
    </RegionalContext.Provider>
  );
}
export function useBusinessTimeZone() {
  return useContext(RegionalContext);
}
