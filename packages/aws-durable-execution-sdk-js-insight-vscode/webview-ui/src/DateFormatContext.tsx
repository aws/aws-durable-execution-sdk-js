/**
 * Provides the user's preferred date/time display format (the "favorite") to
 * every DateView in the tree, plus a setter that persists it. Backed by the
 * `dateFormat` setting in App (synced to the host config via `saveSettings`).
 */
import { createContext, useContext } from "react";
import type { DateFormat, DateVariant } from "./types";

export interface DateFormatContextValue {
  format: DateFormat;
  setFormat: (format: DateFormat) => void;
  variant: DateVariant;
  setVariant: (variant: DateVariant) => void;
}

const DateFormatContext = createContext<DateFormatContextValue>({
  format: "local",
  setFormat: () => {},
  variant: "long",
  setVariant: () => {},
});

export const DateFormatProvider = DateFormatContext.Provider;

export function useDateFormat(): DateFormatContextValue {
  return useContext(DateFormatContext);
}
