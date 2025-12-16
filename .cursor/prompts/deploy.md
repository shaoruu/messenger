---
description: Build and deploy Messenger app to /Applications
---

Build the Electron app and replace the existing Messenger.app in /Applications:

1. Run `npm run build` to compile TypeScript
2. Run `npm run dist -- --mac --arm64` to build the arm64 macOS app (DMG may fail, that's ok)
3. Remove the existing `/Applications/Messenger.app`
4. Copy `release/mac-arm64/Messenger.app` to `/Applications/`

Report success or failure.
