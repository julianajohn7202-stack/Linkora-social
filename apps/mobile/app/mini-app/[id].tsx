import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";

import {
  createBridgeSession,
  createMiniAppBridge,
  type BridgeRequest,
} from "../../mini-apps/bridge";
import { BridgeError } from "../../mini-apps/permissions";
import { PostApproval } from "../../mini-apps/PostApproval";
import { useInstalledApps } from "../../mini-apps/store";

const BRIDGE_INJECTION = `
(function() {
  if (window.LinkoraBridge) return;
  var documentId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  var callbacks = Object.create(null);
  var nextId = 1;

  function bridgeError(failure) {
    var error = new Error(failure.message);
    error.name = "BridgeError";
    error.code = failure.code;
    error.requestId = failure.requestId;
    return error;
  }

  window.LinkoraBridge = {
    call: function(method, payload) {
      var id = nextId++;
      return new Promise(function(resolve, reject) {
        callbacks[id] = { resolve: resolve, reject: reject };
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            documentId: documentId, id: id, method: method, payload: payload
          }));
        } catch (_) {
          delete callbacks[id];
          reject(bridgeError({ code: "RequestFailed", message: "Could not send host request", requestId: id }));
        }
      });
    },
    _handleResponse: function(responseDocumentId, id, failure, result) {
      if (responseDocumentId !== documentId) return;
      var callback = callbacks[id];
      if (!callback) return;
      delete callbacks[id];
      if (failure) callback.reject(bridgeError(failure));
      else callback.resolve(result);
    }
  };

  window.addEventListener("pagehide", function() {
    Object.keys(callbacks).forEach(function(key) {
      var id = Number(key);
      window.LinkoraBridge._handleResponse(documentId, id, {
        code: "AppClosed", message: "The mini app closed", requestId: id
      });
    });
  });
})();
true;
`;

type Approval = {
  content: string;
  resolve: (result: { postId: string; content: string }) => void;
  reject: (error: BridgeError) => void;
};

export default function MiniAppHostScreen() {
  const { id, name, entry } = useLocalSearchParams<{ id: string; name: string; entry: string }>();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const pendingApproval = useRef<Approval | null>(null);

  const { apps } = useInstalledApps();
  const app = useMemo(() => apps.find((a) => a.id === id), [apps, id]);

  const session = useMemo(() => {
    const bridge =
      app &&
      createMiniAppBridge({
        permissions: app.permissions,
        handlers: {
          "post.create": (payload) => {
            if (pendingApproval.current) {
              throw new BridgeError("MethodUnavailable", "Another post approval is already open");
            }
            const content = typeof payload === "string" ? payload : "";
            return new Promise<{ postId: string; content: string }>((resolve, reject) => {
              const request = { content, resolve, reject };
              pendingApproval.current = request;
              setApproval(request);
            });
          },
        },
      });
    return createBridgeSession(async (method, payload) => {
      if (!bridge) throw new BridgeError("MethodUnavailable", "The mini app host is unavailable");
      return bridge.call(method, payload);
    });
  }, [app]);

  const settleApproval = useCallback((failure: BridgeError | null, content = "") => {
    const request = pendingApproval.current;
    if (!request) return;
    pendingApproval.current = null;
    setApproval(null);
    if (failure) {
      request.reject(failure);
    } else {
      const postId = `post_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      request.resolve({ postId, content });
    }
  }, []);

  const closeRequests = useCallback(() => {
    session.close();
    settleApproval(new BridgeError("AppClosed", "The mini app closed"));
  }, [session, settleApproval]);

  useEffect(() => closeRequests, [closeRequests]);

  const dismissApproval = useCallback(() => {
    settleApproval(new BridgeError("UserRejected", "Post approval was dismissed"));
  }, [settleApproval]);

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      let request: BridgeRequest;
      try {
        request = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!request || !Number.isSafeInteger(request.id) || typeof request.documentId !== "string") {
        return;
      }

      void session.dispatch(request, (failure, result) => {
        let args: string;
        try {
          args = JSON.stringify([request.documentId, request.id, failure, result]);
        } catch {
          args = JSON.stringify([
            request.documentId,
            request.id,
            {
              code: "RequestFailed",
              message: "Could not serialize host response",
              requestId: request.id,
            },
          ]);
        }
        webviewRef.current?.injectJavaScript(
          `window.LinkoraBridge && window.LinkoraBridge._handleResponse.apply(null, ${args});true;`
        );
      });
    },
    [session]
  );

  const handleReload = useCallback(() => {
    closeRequests();
    setLoading(true);
    setError(null);
    webviewRef.current?.reload();
  }, [closeRequests]);

  if (!app) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Mini app not found</Text>
          <Text style={styles.errorText}>Could not find app with id "{id}".</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        source={{ uri: entry }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadStart={closeRequests}
        onLoadEnd={() => setLoading(false)}
        onError={(syntheticEvent) => {
          closeRequests();
          const { description } = syntheticEvent.nativeEvent;
          setLoading(false);
          setError(description);
        }}
        injectedJavaScript={BRIDGE_INJECTION}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator color="#6366f1" />
          </View>
        )}
      />
      {approval && (
        <Modal visible animationType="slide" onRequestClose={dismissApproval}>
          <PostApproval
            initialContent={approval.content}
            onDismiss={dismissApproval}
            onConfirm={(content) => settleApproval(null, content)}
          />
        </Modal>
      )}
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>Failed to load</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleReload}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#6366f1" size="large" />
          <Text style={styles.muted}>Loading {name ?? "Mini App"}...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorTitle: {
    color: "#fecaca",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  muted: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 10,
  },
  retryButton: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
