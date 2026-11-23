"use client";

import { useState, useEffect } from "react";
import {
  fetchPreferencesFromServer,
  savePreferencesToBackend,
  registerServiceWorkerAndSubscribe,
  unsubscribeFromPush,
} from "../../services/pushNotification";

interface NotificationSettings {
  browserPushEnabled: boolean;
  newFollowers: boolean;
  newLikes: boolean;
  newComments: boolean;
  directMessages: boolean;
  poolActivity: boolean;
  governanceUpdates: boolean;
}

export function NotificationsSection({ address }: { address: string }) {
  const [settings, setSettings] = useState<NotificationSettings>({
    browserPushEnabled: false,
    newFollowers: true,
    newLikes: true,
    newComments: true,
    directMessages: true,
    poolActivity: true,
    governanceUpdates: true,
  });
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if browser supports push notifications
    if ("Notification" in window) {
      setPushSupported(true);
      setPushPermission(Notification.permission);
    }

    async function loadPreferences() {
      if (!address) return;
      setLoading(true);
      try {
        const serverPrefs = await fetchPreferencesFromServer(address);
        if (serverPrefs) {
          const serverSettings = serverPrefs.preferences ?? serverPrefs;
          setSettings({
            browserPushEnabled: serverSettings.browserPushEnabled ?? false,
            newFollowers: serverSettings.newFollowers ?? true,
            newLikes: serverSettings.newLikes ?? true,
            newComments: serverSettings.newComments ?? true,
            directMessages: serverSettings.directMessages ?? true,
            poolActivity: serverSettings.poolActivity ?? true,
            governanceUpdates: serverSettings.governanceUpdates ?? true,
          });
        }
      } catch (error) {
        console.warn(
          "Failed to load preferences from server, falling back to local storage:",
          error
        );
        // Load saved settings from localStorage as fallback
        const saved = localStorage.getItem("notification_settings");
        if (saved) {
          try {
            setSettings(JSON.parse(saved));
          } catch (e) {
            console.error("Failed to parse local notification settings:", e);
          }
        }
      } finally {
        setLoading(false);
      }
    }

    loadPreferences();
  }, [address]);

  async function handleTogglePush() {
    if (!pushSupported) return;

    let updatedPushEnabled = false;
    let subscription: PushSubscription | null = null;

    try {
      if (pushPermission === "granted") {
        // Disable push notifications
        updatedPushEnabled = false;
        await unsubscribeFromPush();
        setPushPermission("default");
      } else {
        // Request permission
        const permission = await Notification.requestPermission();
        setPushPermission(permission);
        if (permission === "granted") {
          updatedPushEnabled = true;
          subscription = await registerServiceWorkerAndSubscribe();
        }
      }

      const updatedSettings = { ...settings, browserPushEnabled: updatedPushEnabled };
      setSettings(updatedSettings);
      localStorage.setItem("notification_settings", JSON.stringify(updatedSettings));

      if (address) {
        await savePreferencesToBackend(address, updatedSettings, subscription);
      }
    } catch (error) {
      console.error("Failed to update push subscription settings:", error);
    }
  }

  async function handleToggleSetting(key: keyof NotificationSettings) {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    localStorage.setItem("notification_settings", JSON.stringify(updated));

    if (!address) return;
    try {
      let subscription: PushSubscription | null = null;
      if (updated.browserPushEnabled) {
        subscription = await registerServiceWorkerAndSubscribe();
      }
      await savePreferencesToBackend(address, updated, subscription);
    } catch (error) {
      console.error("Failed to save settings to server:", error);
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Notifications</h2>
      <p className="text-sm text-gray-600 mb-4">
        Configure which notifications you want to receive.
      </p>

      <div className="space-y-4">
        {/* Browser Push Notifications */}
        {pushSupported && (
          <div className="pb-4 border-b border-gray-200">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="toggle-browser-push"
                  className="block text-sm font-medium text-gray-900 cursor-pointer"
                >
                  Browser Push Notifications
                </label>
                <p className="text-xs text-gray-500 mt-0.5">
                  Receive notifications even when Linkora is not open
                </p>
              </div>
              <button
                id="toggle-browser-push"
                onClick={handleTogglePush}
                className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${
                  settings.browserPushEnabled ? "bg-violet-600" : "bg-gray-200"
                }`}
                role="switch"
                aria-checked={settings.browserPushEnabled}
                aria-label="Toggle Browser Push Notifications"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.browserPushEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Notification Types */}
        <div className="space-y-3">
          <NotificationToggle
            label="New Followers"
            description="When someone follows you"
            checked={settings.newFollowers}
            onChange={() => handleToggleSetting("newFollowers")}
          />
          <NotificationToggle
            label="New Likes"
            description="When someone likes your post"
            checked={settings.newLikes}
            onChange={() => handleToggleSetting("newLikes")}
          />
          <NotificationToggle
            label="New Comments"
            description="When someone comments on your post"
            checked={settings.newComments}
            onChange={() => handleToggleSetting("newComments")}
          />
          <NotificationToggle
            label="Direct Messages"
            description="When you receive a new DM"
            checked={settings.directMessages}
            onChange={() => handleToggleSetting("directMessages")}
          />
          <NotificationToggle
            label="Pool Activity"
            description="When there's activity in your pools"
            checked={settings.poolActivity}
            onChange={() => handleToggleSetting("poolActivity")}
          />
          <NotificationToggle
            label="Governance Updates"
            description="When there are new proposals or votes"
            checked={settings.governanceUpdates}
            onChange={() => handleToggleSetting("governanceUpdates")}
          />
        </div>
      </div>
    </section>
  );
}

interface NotificationToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function NotificationToggle({ label, description, checked, onChange }: NotificationToggleProps) {
  // Derive a stable id from the label so the <label> element can reference
  // the switch — clicking anywhere on the label text activates only this control.
  const id = `toggle-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2">
      {/* Label section grows and wraps naturally; min-w-0 prevents overflow. */}
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="block text-sm font-medium text-gray-900 cursor-pointer"
        >
          {label}
        </label>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      {/* Switch is flex-shrink-0 so it never collapses at narrow widths. */}
      <button
        id={id}
        onClick={onChange}
        className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${
          checked ? "bg-violet-600" : "bg-gray-200"
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
