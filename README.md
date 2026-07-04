# TARS

> A shared repo among us friends to learn by interacting and building together.

A lightweight, frameless **AI desktop assistant overlay** that floats over your screen on demand — summoned via a global hotkey (`Alt + Space`). Designed for both **macOS** and **Windows**, powered by a local FastAPI backend and Ollama.

---

## ✦ What it looks like

A single, compact **750 × 68 px** horizontal pill — pure glass, zero chrome. Think Siri meets TARS.
When the AI replies, the UI seamlessly scales downward to display a conversational response box.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ● SYS.READY  │  Awaiting automation query or terminal sequence...  │ 🎙️    │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Left** — Live telemetry dot + system status labels  
- **Center** — Transparent command input  
- **Right** — Voice Input Mic + Backend network bridge  

---

## ✦ Features

- **Live LLM Streaming (SSE)**: Fully asynchronous Server-Sent Events stream from the FastAPI backend to render tokens in real-time.
- **Dynamic UI Resizing**: The Electron shell automatically resizes to expand and collapse the reply box based on interaction state.
- **Tool Execution**: The LLM securely interfaces with your operating system. You can ask it to "Open File Explorer" or "Launch YouTube", and it will autonomously trigger the tool locally and summarize its actions!
- **System Tray Integration**: Quietly runs in your system tray without cluttering the taskbar.
- **Voice Input & Wake Word**: Fully **local** Speech-to-Text via faster-whisper — nothing is sent to the cloud. Say "TARS" to wake it, or use the mic button.
- **Glassmorphism 2.0**: Native Window 11 Acrylic and macOS HUD Vibrancy.

---

## ✦ Architecture

```
TARS/
├── frontend/
│   ├── electron/
│   │   ├── main.cjs    ← Main process (window, global shortcuts, tray)
│   │   └── preload.cjs ← Context bridge API for secure IPC
│   ├── src/
│   │   └── App.jsx     ← UI, talks to the backend directly via fetch/SSE
│   └── package.json    ← Vite + React + electron-builder config
└── Backend/
    ├── Main.py         ← FastAPI entry point (mounts chat_router + api_router)
    ├── api/            ← Routes (chat.py = live SSE/audio; router.py = v1 REST/WS)
    └── services/
        ├── llm.py      ← AsyncOpenAI integration with Tool Calling engine
        ├── voice.py    ← Local Whisper wake-word listener
        └── tools.py    ← OS execution layer (launch_app, set_volume, run_system_command)
```

---

## ✦ Running the Project

### 1. Backend
Requires `python 3.10+` and `uvicorn`. Ensure you have an Ollama instance running.

```bash
cd Backend
python -m venv ../.venv          # first time only

# Windows
..\.venv\Scripts\pip install -r requirements.txt
start_server.bat

# macOS / Linux
../.venv/bin/pip install -r requirements.txt
./start_server.sh
```
*(Runs on http://127.0.0.1:8000 — bound to loopback only, since the assistant can execute local shell commands)*

**macOS only — before first run:**
- Install PortAudio (`sounddevice` needs it): `brew install portaudio`
- The first time the backend accesses your mic (wake word / voice input), macOS
  will prompt for **Microphone** access — grant it to your terminal/Python.
- Reading the active window title uses `osascript`/System Events, which needs
  **Accessibility** permission (System Settings → Privacy & Security →
  Accessibility). Without it that feature degrades gracefully but silently.

### 2. Frontend (Electron)
Requires `node` and `npm`. The app lives entirely in `frontend/`.

```bash
cd frontend
npm install
npm run electron
```

On Windows/Linux the Electron app also tries to auto-spawn the Python backend
from the repo `.venv` (falling back to `python` on PATH); if that fails, just
start the backend manually as above.
*(Runs in the system tray. Use `Alt + Space` to summon!)*

For a production build: `npm run dist:win` or `npm run dist:mac`.

---

## ✦ Shared Ollama (host PC ↔ friend's Mac)

Everyone runs their **own** full TARS stack locally, so TARS controls *their*
machine (apps, volume, voice on their mic). Only the **LLM inference** is shared
— one person hosts Ollama, everyone else points their backend at it. This works
identically whether you're on the same Wi-Fi or in different cities, thanks to
[Tailscale](https://tailscale.com) (a zero-config private mesh VPN — each device
gets a stable `100.x.y.z` IP, encrypted, no port-forwarding).

**On the host (the PC running Ollama):**

1. Install Tailscale on both machines and log into the same tailnet.
2. Start Ollama bound to all interfaces so the tailnet can reach it (by default
   it only listens on `127.0.0.1`):
   ```powershell
   # Windows (PowerShell) — set the service env var, then restart Ollama
   setx OLLAMA_HOST "0.0.0.0:11434"
   # then quit Ollama from the tray and relaunch it
   ```
   ```bash
   # macOS / Linux
   launchctl setenv OLLAMA_HOST "0.0.0.0:11434"   # macOS; or export before `ollama serve`
   ```
3. Find the host's Tailscale IP: `tailscale ip -4` (e.g. `100.101.102.103`).

> ⚠️ Ollama has **no authentication**. Only expose it over Tailscale (or your
> LAN) — never a public tunnel/port-forward, or anyone can drive your GPU.

**On the friend's Mac** — copy `Backend/.env.example` to `Backend/.env` and set:

```env
OLLAMA_BASE_URL=http://100.101.102.103:11434   # the host's Tailscale IP
```

That's it — the Mac's backend now runs inference on the host's Ollama while
everything else stays local. On the same LAN you can substitute the host's local
IP (e.g. `192.168.1.20`) instead of the Tailscale one.

---

## ✦ IPC Event Reference

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `tars:dispatch` | renderer → main | `string` | User-submitted command query |
| `tars:hide` | renderer → main | — | Request to hide the overlay window |
| `tars:resize-window` | renderer → main | `integer` | Resizes the transparent shell |
| `tars:show` | main → renderer | — | Overlay shown — re-focus input |
| `tars:status` | main → renderer | `string` (key) | Status key: `IDLE` `RUNNING` `DONE` `ERROR` |
| `tars:reply-chunk` | main → renderer | `string` | A live text token from the LLM |
| `tars:reply-end` | main → renderer | — | Marks the end of a response stream |

---

## ✦ Keyboard Shortcuts

| Key | Action |
|---|---|
| `Alt+Space` | Global toggle: Show/Hide TARS from anywhere |
| `Enter` | Dispatch command to backend |
| `Escape` | Clear input, hide reply box, and hide overlay |
| `↑` / `↓` | Cycle command history (last 50) |
| `Ctrl+L` / `Cmd+L` | Clear input field and dismiss reply box |

---

## ✦ Contributing

This is a shared learning repo. PRs, experiments, and half-baked ideas are all welcome.  
Open an issue or push a branch — we figure it out together.
