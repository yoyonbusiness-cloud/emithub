Emit

**Private, peer-to-peer file sharing. No intermediate servers, no accounts, zero-knowledge encryption.**

---

## Features

- **P2P Transfer** — Direct device-to-device file transfer powered by WebRTC DataChannels.
- **Direct-to-Disk Saving** — Streams large files (500MB–50GB+) straight to the hard drive in real time via File System Access API with minimal RAM usage.
- **End-to-End Encryption** — Client-side AES-GCM + ECDH/HKDF zero-knowledge encryption.
- **Local Nearby Drop** — Instant discovery and transfer between devices on the same Wi-Fi network without manual room codes.
- **Chunked Resume** — Interrupted transfers automatically resume from the last saved chunk instead of restarting.
- **Folder Support** — Recursively bundle and send entire folder structures.
- **Hosted Drop** — Generate encrypted temporary download links for asynchronous or offline sharing.
- **Themes & Customization** — Multiple curated themes (including dark, light, midnight, lo-fi), custom color picker, and real-time audio visualizers.

---

## Quick Start

**Requirements:** Node.js 18+

```bash
git clone https://github.com/yoyonbusiness-cloud/emithub.git
cd emithub
npm install
npm start
```

Then open `http://localhost:3000` in your browser. Open it on two devices on the same Wi-Fi network, or expose via a tunnel (e.g. Cloudflare Tunnel, ngrok) for cross-network peer-to-peer transfers.

---

## How It Works

1. **Create a Vault** — One device initializes an ephemeral workspace room.
2. **Join** — The receiving device connects with the room code (and optional security passphrase).
3. **Drop Files** — Drag-and-drop files or folders, select via file picker, or paste directly with `Ctrl+V`.
4. **Save** — Direct-to-Disk streams incoming chunks straight to the receiver's drive.

Workspaces are completely ephemeral. When participants disconnect or the room is destroyed, all session state and keys are wiped.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Transport | WebRTC DataChannels |
| Signaling | Socket.IO |
| Encryption | Web Crypto API (ECDH + HKDF + AES-GCM) |
| Streaming | Streams API & File System Access API |
| Compression | JSZip (folder bundling) |
| Server | Node.js + Express |

---

## License

MIT © 2026 Yoyon
