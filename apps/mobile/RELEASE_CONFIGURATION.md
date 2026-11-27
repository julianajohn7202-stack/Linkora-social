# Mobile release configuration

Run Expo and EAS commands from `apps/mobile` after installing workspace dependencies with `pnpm install --frozen-lockfile` at the repository root. [eas.json](./eas.json) requires EAS CLI 9.0.0 or newer. Use a current EAS CLI and sign in to the Expo project account to inspect its hosted variables.

## EAS profiles

| Profile             | Purpose and effective distribution                                                                                                                            | EAS environment                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `build.development` | Internal developer build with `developmentClient: true`, intended for use with Metro. Check that `expo-dev-client` is installed before building this profile. | `development`                                                          |
| `build.preview`     | Internal QA build. Android produces an installable APK. iOS uses internal device distribution.                                                                | `preview`                                                              |
| `build.production`  | Store release. The empty profile uses EAS defaults, including store distribution and an Android App Bundle.                                                   | `production`                                                           |
| `submit.production` | Submits an existing release build to the selected store using EAS Submit defaults and the store credentials supplied during submission or configured in EAS.  | Build-time variables come from the profile that produced the artifact. |

The build profiles define neither `environment` nor `env`. Current EAS Build selects the hosted environment from distribution and the development client flag. Profile names happen to match the resulting environments. Check project and account variables in the selected EAS environment. Local Expo CLI uses standard `.env` files in the mobile project. To reproduce a hosted environment locally, use `eas env:pull --environment preview` (or substitute the intended environment) after checking whether it would overwrite local values. [EAS environment selection](https://docs.expo.dev/eas/environment-variables/usage/)

## Public configuration

[app.json](./app.json) supplies the shared Expo config, including the `linkora` scheme, `social.linkora.app` for both app identifiers, the iOS associated domain, and the Expo Router plugin.

| Variable                               | Mobile consumer                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_INDEXER_URL`              | Indexer requests, including sync and creator analytics. Several consumers default to `http://localhost:3001` and push registration requires a configured URL. Use an endpoint reachable from the target device. |
| `EXPO_PUBLIC_WEB_URL`                  | Profile link base, defaulting to `https://linkora.social`.                                                                                                                                                      |
| `EXPO_PUBLIC_POOL_EVENTS_WS_URL`       | Pool events WebSocket endpoint.                                                                                                                                                                                 |
| `EXPO_PUBLIC_ORACLE_API_URL`           | Analytics card endpoint fallback.                                                                                                                                                                               |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect initialization.                                                                                                                                                                                   |

Treat `EXPO_PUBLIC_*` values as readable by app users. Keep private credentials in server or build tooling. Expo inlines direct `process.env.EXPO_PUBLIC_*` references. The analytics card's bracket lookup and WalletConnect's indirect lookup require special attention on a built device because Expo's standard inlining only handles direct dot notation. [Expo variable syntax](https://docs.expo.dev/guides/environment-variables/)

## Inspect before release

```sh
cd apps/mobile
eas config --platform android --profile preview
eas config --platform ios --profile preview
eas env:list --environment preview
pnpm exec expo config --type public
```

Repeat with `development` and `production`. Compare the resolved distribution and app identifiers with the table, and confirm the hosted endpoints belong to the intended deployment. The Expo command prints the public app config using the local environment. Confirm bundle-time variables separately on an installed build by exercising the relevant flows and checking which service receives the requests. The [mobile CI workflow](../../.github/workflows/mobile-check.yml) runs TypeScript and Jest for mobile changes. [EAS CLI reference](https://docs.expo.dev/eas/cli/)
