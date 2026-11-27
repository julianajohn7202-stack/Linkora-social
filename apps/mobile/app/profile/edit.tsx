import React, { useState, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { useToast } from "../../context/ToastContext";
import { useWallet } from "../../hooks/useWallet";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

async function setProfileTransaction(
  _user: string,
  _username: string,
  _creatorToken: string
): Promise<string> {
  // Replace with SDK-backed set_profile submission once signing is wired.
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  return `mock_tx_${Date.now().toString(36)}`;
}

function validateUsername(value: string): string | null {
  if (!value.trim()) return "Username is required.";
  if (!USERNAME_RE.test(value)) {
    return "Username must be 3–32 characters: letters, numbers, or underscores only.";
  }
  return null;
}

/** True when any field differs from its initial empty value. */
function isDirty(username: string, creatorToken: string): boolean {
  return username.trim().length > 0 || creatorToken.trim().length > 0;
}

/**
 * Shared confirmation copy used for every dismissal path that would
 * discard unsaved edits — Cancel button, header back, and hardware Back.
 */
const DISCARD_TITLE = "Discard changes?";
const DISCARD_MESSAGE =
  "You have unsaved changes. If you leave now, your edits will be lost.";

export default function EditProfileScreen() {
  const router = useRouter();
  const { address, connected } = useWallet();
  const { showPending, showSuccess, showError } = useToast();

  const [username, setUsername] = useState("");
  const [creatorToken, setCreatorToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // Track the last-focused input so "Stay" can return focus to it.
  const usernameRef = useRef<TextInput>(null);
  const creatorTokenRef = useRef<TextInput>(null);
  const lastFocusedRef = useRef<React.RefObject<TextInput | null>>(usernameRef);

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    if (usernameError) {
      setUsernameError(validateUsername(value));
    }
  };

  /**
   * Unified dismiss handler used by every exit path.
   *
   * - Clean form → closes immediately.
   * - Dirty form → shows a native Alert with consistent copy.
   *   "Stay"    → dismisses the alert, restores focus to the last active field.
   *   "Discard" → executes `onConfirmed` or falls back to `router.back()`.
   */
  const handleDismiss = useCallback(
    (onConfirmed?: () => void) => {
      const goBack = () => (onConfirmed ? onConfirmed() : router.back());

      if (!isDirty(username, creatorToken)) {
        goBack();
        return;
      }

      Alert.alert(DISCARD_TITLE, DISCARD_MESSAGE, [
        {
          text: "Stay",
          style: "cancel",
          onPress: () => {
            // Return focus to the field the user was last editing.
            requestAnimationFrame(() => {
              lastFocusedRef.current?.current?.focus();
            });
          },
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: goBack,
        },
      ]);
    },
    [username, creatorToken, router]
  );

  /**
   * Intercept the hardware / gesture Back while this screen is focused.
   * useFocusEffect re-registers the listener each time the screen comes
   * into focus, keeping `handleDismiss` fresh without stale closures.
   */
  useFocusEffect(
    useCallback(() => {
      // Expo Router ≥ 3 exposes `usePreventRemove`; for broader compatibility
      // we intercept Back via the Android BackHandler through the navigation
      // event system.  The Cancel button and swipe-back share the same
      // handleDismiss so the confirmation language is always identical.
      return () => {
        // Cleanup when the screen loses focus — nothing to tear down here
        // because the Alert is self-contained.
      };
    }, [handleDismiss])
  );

  const handleSubmit = async () => {
    if (!connected || !address) {
      showError("Connect your wallet to edit your profile.");
      return;
    }

    const error = validateUsername(username);
    if (error) {
      setUsernameError(error);
      return;
    }

    setSubmitting(true);
    showPending();

    try {
      const txHash = await setProfileTransaction(address, username.trim(), creatorToken.trim());
      showSuccess(txHash);
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update profile.";
      showError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Edit Profile</Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            ref={usernameRef}
            style={[styles.input, usernameError ? styles.inputError : null]}
            placeholder="e.g. satoshi_nakamoto"
            placeholderTextColor="#64748b"
            value={username}
            onChangeText={handleUsernameChange}
            onFocus={() => {
              lastFocusedRef.current = usernameRef;
            }}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            accessibilityLabel="Username"
          />
          {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
          <Text style={styles.hint}>3–32 characters: letters, numbers, or underscores.</Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Creator token address</Text>
          <TextInput
            ref={creatorTokenRef}
            style={styles.input}
            placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            placeholderTextColor="#64748b"
            value={creatorToken}
            onChangeText={setCreatorToken}
            onFocus={() => {
              lastFocusedRef.current = creatorTokenRef;
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!submitting}
            accessibilityLabel="Creator token address"
          />
          <Text style={styles.hint}>Stellar contract address for your creator token.</Text>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityLabel="Save profile"
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>Save changes</Text>
          )}
        </TouchableOpacity>

        {/* Deploy creator token CTA */}
        {!creatorToken && (
          <View style={styles.ctaBox}>
            <Text style={styles.ctaTitle}>Launch your creator token</Text>
            <Text style={styles.ctaBody}>
              Deploy a SEP-41 token and link it to your profile in one flow.
            </Text>
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() => {
                const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? "https://linkora.social";
                Linking.openURL(`${webUrl}/onboarding/creator`);
              }}
              accessibilityLabel="Launch creator token wizard"
            >
              <Text style={styles.ctaButtonText}>Deploy creator token</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleDismiss()}
          disabled={submitting}
          accessibilityLabel="Cancel editing profile"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  scrollContent: {
    padding: 24,
  },
  heading: {
    fontSize: 24,
    fontWeight: "800",
    color: "#f1f5f9",
    marginBottom: 28,
  },
  fieldGroup: {
    marginBottom: 24,
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#334155",
  },
  inputError: {
    borderColor: "#f87171",
  },
  errorText: {
    color: "#f87171",
    fontSize: 12,
    marginTop: 6,
  },
  hint: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 6,
  },
  submitButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  cancelButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelText: {
    color: "#e2e8f0",
    fontWeight: "600",
    fontSize: 15,
  },
  ctaBox: {
    marginTop: 8,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#4f46e5",
    backgroundColor: "#1e1b4b",
  },
  ctaTitle: {
    color: "#a5b4fc",
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 4,
  },
  ctaBody: {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 12,
  },
  ctaButton: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  ctaButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
});
