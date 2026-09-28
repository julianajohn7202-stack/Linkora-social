import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ThemeTokens } from "../theme/tokens";

export type TxToastKind = "pending" | "success" | "error";

export interface TxToastState {
  id: number;
  kind: TxToastKind;
  title: string;
  message?: string;
  txHash?: string;
}

interface TxToastProps {
  toast: TxToastState;
  onDismiss: () => void;
  /** Called with `true` while the user is touching the toast (pauses auto-dismiss) and `false` on release. */
  onPauseChange?: (paused: boolean) => void;
  theme: ThemeTokens;
}

/** Auto-dismiss delay in milliseconds for successful transactions. */
const AUTO_DISMISS_MS = 5000;

function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/** Returns the icon character and accessible label for each toast state. */
function getStateIcon(
  kind: TxToastKind,
  theme: ThemeTokens
): { node: React.ReactNode; label: string } {
  if (kind === "pending") {
    return {
      node: (
        <ActivityIndicator
          color={theme.colors.brand.primary}
          size="small"
          accessibilityLabel="Transaction pending"
        />
      ),
      label: "pending",
    };
  }

  if (kind === "success") {
    return {
      node: (
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: theme.colors.semantic.successLight },
          ]}
          accessibilityLabel="Transaction confirmed"
        >
          <Text
            style={[styles.iconText, { color: theme.colors.semantic.success }]}
            accessibilityElementsHidden
          >
            ✓
          </Text>
        </View>
      ),
      label: "confirmed",
    };
  }

  // error
  return {
    node: (
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: theme.colors.semantic.errorLight },
        ]}
        accessibilityLabel="Transaction failed"
      >
        <Text
          style={[styles.iconText, { color: theme.colors.semantic.error }]}
          accessibilityElementsHidden
        >
          ✕
        </Text>
      </View>
    ),
    label: "failed",
  };
}

export function TxToast({ toast, onDismiss, onPauseChange, theme }: TxToastProps) {
  const translateY = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const isPaused = useRef(false);

  const explorerUrl = useMemo(() => {
    if (!toast.txHash) return null;
    return `https://stellar.expert/explorer/public/tx/${encodeURIComponent(toast.txHash)}`;
  }, [toast.txHash]);

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 15,
        mass: 0.8,
        stiffness: 180,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  // Auto-dismiss after AUTO_DISMISS_MS on success
  useEffect(() => {
    if (toast.kind !== "success") return;

    const timer = setTimeout(() => {
      if (!isPaused.current) {
        onDismiss();
      }
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [toast.kind, onDismiss]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 8 || Math.abs(gestureState.dx) > 8,
        onPanResponderMove: (_, gestureState) => {
          translateY.setValue(Math.max(-24, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 60 || Math.abs(gestureState.dx) > 60) {
            onDismiss();
            return;
          }

          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 15,
            mass: 0.8,
            stiffness: 180,
          }).start();
        },
      }),
    [onDismiss, translateY]
  );

  const accentColor =
    toast.kind === "success"
      ? theme.colors.semantic.success
      : toast.kind === "error"
        ? theme.colors.semantic.error
        : theme.colors.brand.secondary;

  const { node: iconNode } = getStateIcon(toast.kind, theme);

  const stateLabel =
    toast.kind === "pending" ? "Transaction pending" :
    toast.kind === "success" ? "Transaction confirmed" :
    "Transaction failed";

  return (
    <Animated.View
      testID="toast"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${stateLabel}: ${toast.title}${toast.message ? `. ${toast.message}` : ""}`}
      style={[
        styles.toast,
        {
          backgroundColor: theme.colors.surface.surface1,
          borderColor: theme.colors.surface.border,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      {...panResponder.panHandlers}
      onTouchStart={() => {
        isPaused.current = true;
        onPauseChange?.(true);
      }}
      onTouchEnd={() => {
        isPaused.current = false;
        onPauseChange?.(false);
      }}
      onTouchCancel={() => {
        isPaused.current = false;
        onPauseChange?.(false);
      }}
    >
      {/* Left accent bar — colour communicates state */}
      <View style={[styles.accent, { backgroundColor: accentColor }]} />

      {/* State icon */}
      <View style={styles.iconWrap}>{iconNode}</View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.colors.text.primary }]}>{toast.title}</Text>
        {toast.message ? (
          <Text style={[styles.message, { color: theme.colors.text.secondary }]}>
            {toast.message}
          </Text>
        ) : null}
        {toast.kind === "success" && explorerUrl ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open Stellar Expert transaction"
            onPress={() => Linking.openURL(explorerUrl).catch(() => undefined)}
            style={styles.linkWrap}
          >
            <Text style={[styles.link, { color: theme.colors.brand.secondary }]}>
              {shortHash(toast.txHash ?? "")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss toast" onPress={onDismiss}>
        <Text style={[styles.dismiss, { color: theme.colors.text.secondary }]}>Dismiss</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: "rgba(0, 0, 0, 1)",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  accent: {
    width: 5,
    alignSelf: "stretch",
    borderRadius: 9999,
  },
  iconWrap: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
  linkWrap: {
    alignSelf: "flex-start",
  },
  link: {
    fontSize: 12,
    fontWeight: "700",
  },
  dismiss: {
    fontSize: 12,
    fontWeight: "600",
  },
});
