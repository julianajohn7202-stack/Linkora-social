# Mobile Developer Guide

Comprehensive guide for developing, building, and deploying the Linkora mobile application with React Native and Expo.

## Prerequisites

- Node.js >= 18
- pnpm >= 8
- Expo CLI (`npm install -g expo-cli` or `npx expo`)
- iOS Simulator (macOS with Xcode) or Android Emulator (Android Studio)

## Getting Started

1. Navigate to the mobile application directory:
   ```bash
   cd apps/mobile
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start the Expo development server:
   ```bash
   pnpm start
   ```

## Running on Simulators

### iOS Simulator
Press `i` in the Expo terminal interface, or run:
```bash
pnpm ios
```

### Android Emulator
Press `a` in the Expo terminal interface, or run:
```bash
pnpm android
```

## EAS Builds

The project is configured for Expo Application Services (EAS) via `eas.json`.

1. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Configure environment credentials:
   ```bash
   eas secret:create
   ```

3. Trigger development or production build:
   ```bash
   eas build --profile development --platform all
   eas build --profile production --platform all
   ```

## Related Specifications
- [Mobile UI Spec](../design/MOBILE_SPEC.md)
- [Design System](../design/README.md)
- [Mini Apps Bridge API](../mini-apps/BRIDGE_API.md)
