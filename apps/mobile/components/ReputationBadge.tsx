import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Polygon, Stop } from "react-native-svg";

import { useTheme } from "../theme/useTheme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReputationTier = "bronze" | "silver" | "gold" | "diamond";

export type ReputationBadgeVariant = "compact" | "full";

export interface ReputationBadgeProps {
  tier: ReputationTier;
  variant?: ReputationBadgeVariant;
  /** Optional override for the accessible label. */
  accessibilityLabel?: string;
}

// ---------------------------------------------------------------------------
// Tier colour tokens
// Design tokens are sourced from docs/design/tokens.json.  Tiers are mapped
// to brand/semantic palette colours so they work naturally in both light and
// dark mode without a separate dark-mode override — the hues are vivid enough
// to remain distinct on any surface.
// ---------------------------------------------------------------------------

interface TierTokens {
  /** Primary gradient start colour */
  gradientStart: string;
  /** Primary gradient end colour */
  gradientEnd: string;
  /** Inner shield colour */
  inner: string;
  /** Tier label shown in the "full" variant */
  label: string;
  /** Accessible name */
  name: string;
}

const TIER_TOKENS: Record<ReputationTier, TierTokens> = {
  bronze: {
    gradientStart: "#CD7F32",
    gradientEnd: "#8B4513",
    inner: "#E8A96A",
    label: "Bronze",
    name: "Bronze tier",
  },
  silver: {
    gradientStart: "#C0C0C0",
    gradientEnd: "#808080",
    inner: "#E8E8E8",
    label: "Silver",
    name: "Silver tier",
  },
  gold: {
    // accent: #F59E0B / accent-hover: #D97706 from design tokens
    gradientStart: "#F59E0B",
    gradientEnd: "#D97706",
    inner: "#FDE68A",
    label: "Gold",
    name: "Gold tier",
  },
  diamond: {
    // brand secondary cyan from design tokens
    gradientStart: "#06B6D4",
    gradientEnd: "#7C3AED",
    inner: "#BAE6FD",
    label: "Diamond",
    name: "Diamond tier",
  },
};

// ---------------------------------------------------------------------------
// SVG Badge
// A hexagonal shield shape rendered entirely with SVG primitives so no image
// assets are required.  The polygon points define a classic shield outline
// scaled to the requested size.
// ---------------------------------------------------------------------------

interface BadgeSvgProps {
  tier: ReputationTier;
  size: number;
}

function BadgeSvg({ tier, size }: BadgeSvgProps) {
  const tokens = TIER_TOKENS[tier];
  const gradientId = `grad-${tier}`;

  // Shield polygon points normalised to a 40×44 viewport, then scaled via
  // the SVG viewBox.  The outline traces: top-left → top-right → far-right
  // → bottom-point → far-left → back.
  const shieldPoints = "20,2 38,8 38,26 20,42 2,26 2,8";
  // Smaller inner shield for the layered look
  const innerPoints = "20,8 32,13 32,27 20,38 8,27 8,13";

  return (
    <Svg width={size} height={size * 1.1} viewBox="0 0 40 44" accessibilityRole="image">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={tokens.gradientStart} stopOpacity="1" />
          <Stop offset="1" stopColor={tokens.gradientEnd} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {/* Outer shield */}
      <Polygon
        points={shieldPoints}
        fill={`url(#${gradientId})`}
        stroke={tokens.gradientEnd}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Inner shield highlight */}
      <Polygon points={innerPoints} fill={tokens.inner} opacity={0.35} strokeLinejoin="round" />

      {/* Centre gem / accent dot */}
      <Circle cx="20" cy="23" r="5" fill={tokens.gradientStart} opacity={0.9} />
      <Circle cx="20" cy="23" r="3" fill="#FFFFFF" opacity={0.6} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/**
 * ReputationBadge — renders an SVG tier badge with compact or full variants.
 *
 * **Compact** variant: badge icon only (use in lists, avatars, cards).
 * **Full** variant: badge icon + tier label (use in profile headers, detail
 * views).
 *
 * Dark-mode compatible — colours are vivid hues that render well on both
 * light and dark surfaces.
 *
 * @example
 * <ReputationBadge tier="gold" variant="full" />
 */
export function ReputationBadge({
  tier,
  variant = "compact",
  accessibilityLabel,
}: ReputationBadgeProps) {
  const { theme } = useTheme();
  const tokens = TIER_TOKENS[tier];
  const a11yLabel = accessibilityLabel ?? tokens.name;

  if (variant === "compact") {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={a11yLabel}
        testID={`reputation-badge-${tier}-compact`}
      >
        <BadgeSvg tier={tier} size={24} />
      </View>
    );
  }

  // Full variant — icon + label pill
  return (
    <View
      style={[
        styles.fullContainer,
        {
          backgroundColor: theme.colors.surface.surface1,
          borderColor: theme.colors.surface.border,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
      testID={`reputation-badge-${tier}-full`}
    >
      <BadgeSvg tier={tier} size={20} />
      <Text style={[styles.label, { color: theme.colors.text.primary }]} numberOfLines={1}>
        {tokens.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fullContainer: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
