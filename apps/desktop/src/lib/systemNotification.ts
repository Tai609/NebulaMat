import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export interface PermissionNotificationInput {
  action: string;
  resources: string[];
}

function permissionBody(input: PermissionNotificationInput): string {
  const firstResource = input.resources[0];
  return firstResource ? `${input.action}\n${firstResource}` : input.action;
}

export async function notifyPermissionRequest(input: PermissionNotificationInput): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return false;

  try {
    sendNotification({
      title: "NebulaMat needs your approval",
      body: permissionBody(input),
    });
    return true;
  } catch {
    return false;
  }
}
