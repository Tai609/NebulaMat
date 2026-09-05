import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyPermissionRequest } from "./systemNotification";

const notificationPlugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationPlugin);

describe("notifyPermissionRequest", () => {
  afterEach(() => {
    vi.clearAllMocks();
    notificationPlugin.isPermissionGranted.mockResolvedValue(true);
    notificationPlugin.requestPermission.mockResolvedValue("granted");
  });

  it("sends a native Tauri notification when permission is already granted", async () => {
    await expect(
      notifyPermissionRequest({ action: "bash", resources: ["npm install"] }),
    ).resolves.toBe(true);

    expect(notificationPlugin.requestPermission).not.toHaveBeenCalled();
    expect(notificationPlugin.sendNotification).toHaveBeenCalledWith({
      title: "NebulaMat needs your approval",
      body: "bash\nnpm install",
    });
  });

  it("requests native notification permission before sending", async () => {
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);
    notificationPlugin.requestPermission.mockResolvedValue("granted");

    await expect(
      notifyPermissionRequest({ action: "webfetch", resources: ["https://example.com"] }),
    ).resolves.toBe(true);

    expect(notificationPlugin.requestPermission).toHaveBeenCalledTimes(1);
    expect(notificationPlugin.sendNotification).toHaveBeenCalledWith({
      title: "NebulaMat needs your approval",
      body: "webfetch\nhttps://example.com",
    });
  });

  it("does not notify when native notification permission is denied", async () => {
    notificationPlugin.isPermissionGranted.mockResolvedValue(false);
    notificationPlugin.requestPermission.mockResolvedValue("denied");

    await expect(
      notifyPermissionRequest({ action: "bash", resources: ["rm -rf build/"] }),
    ).resolves.toBe(false);

    expect(notificationPlugin.sendNotification).not.toHaveBeenCalled();
  });
});
