/**
 * Cross-platform notification helper.
 * Bridges Tauri desktop notifications (using standard Web Notification API)
 * and Android notifications (using the native AndroidNotification interface).
 */

export async function requestNotificationPermission(): Promise<boolean> {
  // 1. Android Native Permission Request
  if (typeof window !== "undefined" && (window as any).AndroidNotification) {
    try {
      return (window as any).AndroidNotification.requestPermission();
    } catch (e) {
      console.error("[NOTIFICATION] Failed requesting Android notification permission:", e);
    }
  }

  // 2. Desktop Notification Permission Request
  if (typeof window !== "undefined" && "Notification" in window) {
    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (e) {
      console.error("[NOTIFICATION] Failed requesting desktop notification permission:", e);
    }
  }

  return false;
}

export function showNotification(title: string, body: string): void {
  // 1. Android Notification
  if (typeof window !== "undefined" && (window as any).AndroidNotification) {
    try {
      (window as any).AndroidNotification.showNotification(title, body);
      return;
    } catch (e) {
      console.error("[NOTIFICATION] Failed to send Android notification:", e);
    }
  }

  // 2. Desktop Notification
  if (typeof window !== "undefined" && "Notification" in window) {
    try {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      } else {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            new Notification(title, { body });
          }
        });
      }
    } catch (e) {
      console.error("[NOTIFICATION] Failed to send desktop notification:", e);
    }
  }
}
