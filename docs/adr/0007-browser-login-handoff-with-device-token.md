# Browser Login Handoff With Device Token

Tab's native app authenticates by opening the hosted web app, receiving a callback through a custom URL scheme, exchanging the callback code for a device-scoped API token, and storing that token in macOS Keychain. The web app owns account, pricing, subscription, and billing flows, while the native app uses the device token only to call product APIs such as suggestion generation.
