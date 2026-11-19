# Security policy

## What SquishHub can and can't do

- SquishHub **never sees private keys or seed phrases**. You sign everything in
  your own wallet: Anchor or WAX Cloud Wallet. The app can't move anything you
  haven't approved there.
- Every action is something a holder does with **their own** NFTs and tokens.
  The WAX smart contracts check each one against the account that signs it.
  There is no admin or owner function in this app.
- The Android app only asks for the `INTERNET` permission. Release builds turn
  off WebView remote debugging, plain-HTTP traffic and Android cloud backup.
- The Linux app shows the interface in a sandboxed window with no Node.js
  access. It serves its own files only on `127.0.0.1`, opens other websites in
  your normal browser, only allows pop-up windows for wallet sign-in, and hands
  Anchor's `esr:` links to the Anchor app.
- The app talks to public services only. It reads the WAX chain from public API
  nodes (`WAX_RPC_ENDPOINTS` and `ATOMIC_API_ENDPOINTS` in `src/config.js`) and
  loads NFT pictures from public IPFS gateways (`src/ui.js`). Like any website,
  those services see your IP address and what they serve you. There is no
  tracking or analytics, and no SquishHub server.

## Verifying a download

Each release includes `SHA256SUMS.txt`:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

The Android APK is signed with the SquishHub release key. Its certificate's
SHA-256 fingerprint is:

```
4D:B7:94:D8:93:57:AD:B3:90:79:0A:4E:39:04:FB:7B:65:84:C3:16:93:A8:01:20:D9:41:CC:2A:C1:EB:5D:95
```

Check it with `apksigner verify --print-certs squishhub-<version>.apk`
(Android build-tools). Android only installs an update over SquishHub if it is
signed with this same key, so a tampered copy can't replace a genuine one.

Only download SquishHub from this repository's
[Releases page](../../releases). Anyone offering it anywhere else, or asking
you to install a "SquishHub" that wants your seed phrase, is not us.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](../../security/advisories/new) for this
repository instead. Include steps to reproduce, and the affected version and
platform.

Never send anyone your private keys, seed phrase or wallet password, including
the SquishEyez team.
