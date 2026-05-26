import { clsx, type ClassValue } from "./clsx";

/**
 * Concatenates Tailwind class names conditionally.
 * Thin wrapper over the local `clsx` helper.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(...inputs);
}
