import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const LOCAL_TIMEZONE = "Europe/Berlin";

export function formatDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: LOCAL_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
