interface NavigatorHints {
  hardwareConcurrency?: number;
  /** Chromium only, in GB, rounded down. */
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/**
 * True for devices that should skip decorative GPU work: few cores, little memory,
 * or Data Saver on. Unknown values (Safari, Firefox) count as capable.
 */
export function isLowEndDevice(nav: NavigatorHints = navigator): boolean {
  if (nav.connection?.saveData) return true;
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) return true;
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return true;
  return false;
}
