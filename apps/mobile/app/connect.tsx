import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";

import { WalletButton } from "../components/WalletButton";
import { useWallet } from "../hooks/useWallet";
import type { WalletProviderKind } from "../context/WalletContext";
import { useTheme } from "../theme/useTheme";
import { useNetworkContext } from "../context/NetworkContext";

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export default function ConnectScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { address, connected, disconnect, connect, error, state, wallet } = useWallet();
  const { network: appNetwork } = useNetworkContext();

  // A mismatch exists when the wallet is connected to a different network
  // than the one the app is currently configured to use.
  const walletNetwork = wallet.network;
  const hasMismatch =
    connected && walletNetwork !== null && walletNetwork !== appNetwork.id;

  const handleConnect = async (provider: WalletProviderKind) => {
    await connect(provider);
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  // ── Network mismatch view ────────────────────────────────────────────────
  if (hasMismatch) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.eyebrow}>Network mismatch</Text>
          <Text style={styles.title}>Networks don't match</Text>
          <Text style={styles.subtitle}>
            Your wallet is connected to a different network than the app expects.
            Switch your wallet to the correct network or disconnect and reconnect.
          </Text>

          <View
            style={styles.mismatchPanel}
            accessibilityRole="summary"
            accessibilityLabel={`Network mismatch: app is on ${appNetwork.label}, wallet is on ${walletNetwork}`}
          >
            <View style={styles.networkRow}>
              <Text style={styles.networkLabel}>App network</Text>
              <Text style={styles.networkValue}>{appNetwork.label}</Text>
            </View>
            <View style={styles.networkDivider} />
            <View style={styles.networkRow}>
              <Text style={styles.networkLabel}>Wallet network</Text>
              <Text style={[styles.networkValue, styles.networkMismatch]}>
                {walletNetwork}
              </Text>
            </View>
          </View>

          {/* Primary action: disconnect so the user can reconnect with the right network */}
          <WalletButton
            label="Disconnect and reconnect"
            accessibilityLabel="Disconnect wallet and return to connection screen"
            onPress={handleDisconnect}
            state={state}
            variant="danger"
            style={styles.action}
          />

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Normal connected / disconnected views ────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>Linkora Wallet</Text>
        <Text style={styles.title}>Connect your Stellar wallet</Text>
        <Text style={styles.subtitle}>
          Use Freighter in browser contexts or WalletConnect for mobile wallets.
        </Text>

        {connected && address ? (
          <View style={styles.connectedPanel}>
            <Text style={styles.panelLabel}>Connected address</Text>
            <Text style={styles.address}>{shortAddress(address)}</Text>
            <Text style={styles.provider}>
              {wallet.provider === "freighter" ? "Freighter" : "WalletConnect"}
            </Text>
            <WalletButton
              label="Continue"
              accessibilityLabel="Continue to feed"
              onPress={() => router.replace("/(tabs)/feed")}
              state={state}
              style={styles.action}
            />
            <WalletButton
              label="Disconnect"
              accessibilityLabel="Disconnect wallet"
              onPress={handleDisconnect}
              state={state}
              variant="danger"
            />
          </View>
        ) : (
          <View style={styles.buttonStack}>
            <WalletButton
              label="Connect Freighter"
              accessibilityLabel="Connect with Freighter wallet"
              onPress={() => handleConnect("freighter")}
              provider="freighter"
              state={state}
            />
            <WalletButton
              label="Connect WalletConnect"
              accessibilityLabel="Connect with WalletConnect wallet"
              onPress={() => handleConnect("walletconnect")}
              provider="walletconnect"
              state={state}
              variant="secondary"
            />
          </View>
        )}

        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    content: {
      flex: 1,
      padding: 24,
      justifyContent: "center",
    },
    eyebrow: {
      color: theme.colors.brand.secondary,
      fontSize: 12,
      fontWeight: "700",
      marginBottom: 8,
      textTransform: "uppercase",
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 30,
      fontWeight: "800",
      marginBottom: 10,
    },
    subtitle: {
      color: theme.colors.text.secondary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 28,
    },
    buttonStack: {
      gap: 12,
    },
    connectedPanel: {
      backgroundColor: theme.colors.surface.surface1,
      borderColor: theme.colors.surface.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
    },
    panelLabel: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      marginBottom: 6,
    },
    address: {
      color: theme.colors.text.primary,
      fontFamily: "monospace",
      fontSize: 16,
      fontWeight: "700",
    },
    provider: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      marginTop: 6,
      marginBottom: 16,
    },
    action: {
      marginBottom: 10,
    },
    errorBox: {
      backgroundColor: theme.colors.semantic.errorLight,
      borderColor: theme.colors.semantic.error,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      marginTop: 16,
    },
    errorText: {
      color: theme.colors.semantic.error,
      fontSize: 13,
    },
    // ── Mismatch panel ───────────────────────────────────────────────────────
    mismatchPanel: {
      backgroundColor: theme.colors.surface.surface1,
      borderColor: theme.colors.semantic.error,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
    },
    networkRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 6,
    },
    networkDivider: {
      height: 1,
      backgroundColor: theme.colors.surface.border,
      marginVertical: 4,
    },
    networkLabel: {
      color: theme.colors.text.secondary,
      fontSize: 13,
    },
    networkValue: {
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: "700",
    },
    networkMismatch: {
      color: theme.colors.semantic.error,
    },
  });
}
