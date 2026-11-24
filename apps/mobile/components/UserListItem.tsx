import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";

import { useTheme } from "../theme/useTheme";

export interface UserItem {
  address: string;
  username: string;
}

interface UserListItemProps {
  user: UserItem;
  /** Navigate to the user's profile. */
  onPress: (user: UserItem) => void;
  /**
   * When provided, a Follow / Following button is rendered separately from
   * the row tap target so screen readers can activate them independently.
   */
  onFollow?: (user: UserItem) => void;
  /** Current follow state; controls button label and style. */
  isFollowing?: boolean;
  /** Disables the follow button while a request is in-flight. */
  followLoading?: boolean;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function UserListItem({
  user,
  onPress,
  onFollow,
  isFollowing = false,
  followLoading = false,
}: UserListItemProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    /*
     * Outer View is not a tap target — it just provides the row boundary.
     * This keeps the profile-nav Pressable and the Follow Pressable as two
     * fully independent focusable elements for screen readers.
     */
    <View style={styles.row}>
      {/* ── Profile tap target ─────────────────────────────────────── */}
      <Pressable
        style={styles.profileArea}
        onPress={() => onPress(user)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${user.username} profile`}
      >
        <View style={styles.avatar} accessibilityElementsHidden>
          <Text style={styles.avatarText}>{user.username.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.content}>
          {/*
           * numberOfLines is intentionally omitted so text can wrap when
           * the system font scale is large (accessibility text sizes).
           */}
          <Text style={styles.title}>{user.username}</Text>
          <Text style={styles.subtitle}>{shortAddress(user.address)}</Text>
        </View>
      </Pressable>

      {/* ── Follow action (optional) ────────────────────────────────── */}
      {onFollow && (
        <Pressable
          style={({ pressed }) => [
            styles.followBtn,
            isFollowing ? styles.followingBtn : styles.unfollowedBtn,
            pressed && styles.followBtnPressed,
            followLoading && styles.followBtnDisabled,
          ]}
          onPress={() => onFollow(user)}
          disabled={followLoading}
          accessibilityRole="button"
          accessibilityLabel={
            isFollowing ? `Unfollow ${user.username}` : `Follow ${user.username}`
          }
          accessibilityState={{ disabled: followLoading }}
        >
          {followLoading ? (
            <ActivityIndicator
              size="small"
              color={isFollowing ? theme.colors.brand.primary : theme.colors.text.onBrand}
            />
          ) : (
            <Text
              style={[
                styles.followText,
                isFollowing ? styles.followingText : styles.unfollowedText,
              ]}
            >
              {isFollowing ? "Following" : "Follow"}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      /*
       * alignItems: "center" keeps the follow button vertically centred when
       * text wraps to multiple lines. The profile area stretches to fill
       * remaining width via flex: 1 on its content view.
       */
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.surface.border,
      minHeight: 68,
    },
    profileArea: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      /*
       * marginRight gives the follow button breathing room without pushing
       * the profile label off-screen at narrow widths.
       */
      marginRight: 8,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.brand.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
      /*
       * flexShrink: 0 ensures the avatar never collapses when the username
       * is long or the font scale is large.
       */
      flexShrink: 0,
    },
    avatarText: {
      color: theme.colors.text.onBrand,
      fontSize: 16,
      fontWeight: "800",
    },
    content: {
      flex: 1,
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 15,
      fontWeight: "700",
      /*
       * No numberOfLines constraint — text wraps naturally at large font
       * scales instead of being clipped or truncated.
       */
    },
    subtitle: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontFamily: "monospace",
      marginTop: 2,
    },
    followBtn: {
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 7,
      minWidth: 86,
      alignItems: "center",
      justifyContent: "center",
      /*
       * flexShrink: 0 prevents the button from collapsing when the username
       * label is long.
       */
      flexShrink: 0,
    },
    unfollowedBtn: {
      backgroundColor: theme.colors.brand.primary,
    },
    followingBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: theme.colors.brand.primary,
    },
    followBtnPressed: {
      opacity: 0.7,
    },
    followBtnDisabled: {
      opacity: 0.5,
    },
    followText: {
      fontSize: 13,
      fontWeight: "700",
    },
    unfollowedText: {
      color: theme.colors.text.onBrand,
    },
    followingText: {
      color: theme.colors.brand.primary,
    },
  });
}
