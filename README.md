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
- **Voice Input**: Integrated Speech-to-Text via the Web Speech API *(Note: requires Google API keys for Electron on Windows, or a local Whisper endpoint)*.
- **Glassmorphism 2.0**: Native Window 11 Acrylic and macOS HUD Vibrancy.

---

## ✦ Architecture

```
TARS/
├── Electron/
│   ├── Main.js        ← Main process (Tray, Window resizing, SSE Parsing)
│   ├── Preload.js     ← Context bridge API for secure IPC
│   └── Package.json   ← Electron dependencies
├── frontend/
│   ├── overlay.html   ← Lean HTML shell (semantic, ARIA, CSP header)
│   ├── styles.css     ← Full design system (glassmorphism, animations)
│   └── renderer.js    ← UI input, IPC bridge, Web Speech API integration
└── Backend/
    ├── Main.py        ← FastAPI entry point
    ├── api/           ← Routes (SSE stream, audio stubs)
    └── services/      
        ├── llm.py     ← AsyncOpenAI integration with Tool Calling engine
        └── tools.py   ← OS execution layer (launch_app, set_volume)
```

---

## ✦ Running the Project

### 1. Backend
Requires `python 3.10+` and `uvicorn`. Ensure you have an Ollama instance running.
```bash
cd Backend
pip install -r requirements.txt
python Main.py
```
*(Runs on http://127.0.0.1:8000)*

### 2. Frontend (Electron)
Requires `node` and `npm`.
```bash
cd Electron
npm install
npm start
```
*(Runs in the system tray. Use `Alt + Space` to summon!)*

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
