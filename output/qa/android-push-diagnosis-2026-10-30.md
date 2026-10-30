# Android push diagnosis — 30 October 2026

## Confirmed evidence

- Testers report missing device alerts on APK 52 installed October 29.
- The last seven days contain 85 failed Android delivery rows: 72 generic provider errors and 13 expired alerts. These are delivery rows, not distinct users. All 11 recent retrievable provider receipts contain FCM HTTP 403 `SENDER_ID_MISMATCH`, hidden inside Expo DeveloperError details.
- Inspected the actual APK 52 and APK 56 artifacts with aapt2. Both embed Firebase project `yrdly-470221`, sender `399225255875`, application `com.yrdly`, and EAS project `e7a4c0a6-f56c-4822-b2aa-e6c0eae694cf`. EAS FCM credential metadata names the same Firebase project. Do not claim that the APK or stored credential project is definitively wrong.
- No registered device row has refreshed since October 27. Existing rows can therefore represent stale tokens; a fresh device registration and delivery receipt are needed to confirm recovery.

## Reproduced code defect and fix

The token-change callback called registration without using its event token. Registration fetched the native token, which the installed Expo Android SDK emits back through the same callback; getExpoPushTokenAsync fetched it again. A regression harness running the actual hook reproduced 18 native reads from one startup. Expo documents this infinite-loop pattern in its PushTokenListener reference.

The hook now passes the listener token into Expo registration, fetches a native token only when needed, serializes concurrent registration, and processes a token rotation arriving during an exchange. Failed persistence can retry on foreground, and unmounted hooks stop writing.

The Android workflow now validates the Firebase project/sender/application before embedding google-services.json. It previously accepted any parseable JSON, including a different sender. This guard prevents future configuration drift; it is not a claim that the current APK config was wrong.

The delivery worker now preserves `SENDER_ID_MISMATCH` from nested FCM receipts instead of retaining only Expo’s generic malformed-request message. Regenerated the browser notification-routing bundle to match its existing TypeScript source while checking notification regressions.

## Verification and remaining release work

- 74 mobile registration/build-guard/routing tests passed.
- 77 web receipt/notification-routing/worker tests passed.
- Mobile TypeScript and targeted lint passed with existing warnings only.
- No credentials were changed, no financial action occurred, and no test notification was sent to another person.
- A new APK containing this fix is required. APK 56 does not contain it.
- After installation, confirm a fresh registration timestamp and correct account/device ownership, then use an authorized tester to verify foreground/background delivery and inspect its provider receipt. A successful provider receipt alone does not prove display on the phone.
- The sender mismatch is a confirmed delivery failure. The loop is a confirmed registration defect. Their causal relationship and complete delivery recovery remain unproven until this device check.

Sources: https://docs.expo.dev/versions/latest/sdk/notifications/#pushtokenlistenertoken and https://docs.expo.dev/push-notifications/sending-notifications/#push-receipt-errors
