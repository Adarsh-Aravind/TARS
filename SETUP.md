# TARS — Setup & Operations

Cross-platform desktop assistant. Runs on **Windows and macOS** from the same
source tree, with a Python/FastAPI backend and an Electron overlay.

---

## 1. Requirements

| | Minimum | Notes |
|---|---|---|
| Python | 3.10+ | 3.12 recommended |
| Node.js | 18+ | ships npm |
| RAM | 4 GB free | Whisper + Kokoro models load at startup |
| Disk | ~2 GB | mostly Chromium + ML models |

An LLM provider is also required — either a **Groq API key** (free tier, fast,
recommended) or a local **Ollama** install.

---

## 2. First run

### Windows
Double-click **`tars.bat`**, or from a terminal:
```
tars.bat
```

### macOS / Linux
```bash
chmod +x tars.command     # first time only
./tars.command
```
Then double-click `tars.command` in Finder from then on.

> **A `.bat` file cannot run on macOS.** `tars.bat` and `tars.command` are the
> two platform entry points; both delegate to `scripts/launch.py`, so behaviour
> is identical on either OS.

The launcher creates `.venv`, installs Python and npm dependencies, downloads
Chromium, builds the frontend, starts the backend, waits for it to become
healthy, then opens the overlay. First run takes several minutes; later runs
start in seconds.

### Launcher flags
```
tars.bat --dev         # Vite + Electron with hot reload
tars.bat --setup       # install and build, then exit
tars.bat --backend     # backend only (overlay elsewhere)
tars.bat --reinstall   # force dependency reinstall
```

---

## 3. Configure the LLM

Edit `Backend/.env` (created automatically on first run).

**Groq — recommended.** Get a key at <https://console.groq.com/keys>:
```env
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_...
```

**Ollama — fully local, no key, no cloud.** Tool calling needs a model that
supports it:
```env
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://localhost:11434
```

> The key currently in `Backend/.env` is marked as burned in a comment. Rotate
> it before relying on this.

---

## 4. Using it

| Trigger | Action |
|---|---|
| **"Hey TARS"** | Wake by voice — no hands, no shortcut |
| `Alt+Space` | Command bar (type) |
| `Shift+Alt+Space` | Voice input directly |
| `Esc` | Dismiss — or **deny** a pending confirmation |

TARS lives in the system tray / menu bar. Closing the window hides it; quit from
the tray menu.

### The two ways in

**Typing (`Alt+Space`).** A single command bar appears. Ask something and the
same bar grows downward into the reply — one continuous object, never a swap.
Activity chips show each tool as it runs. `↑`/`↓` walk your history.

**Voice ("Hey TARS").** A slim island appears at the top-center of the screen
and TARS answers out loud. It has three visual states:

| State | Reads |
|---|---|
| Listening | white bars driven by **your live microphone** |
| Thinking | amber, orbiting halo while the agent works |
| Speaking | blue bars driven by **the actual audio being played** |

The bars are wired to real `AnalyserNode` data, not a looping animation — they
go flat when you stop talking, which is how you can tell it is genuinely
hearing you. A live caption under the island echoes what it heard and what it
is saying.

Say **"Hey TARS, open YouTube"** in one breath and it skips the greeting and
acts immediately. Say just **"Hey TARS"** and it answers, then listens.

The wake phrase requires a greeting prefix ("hey", "ok", "hi", "yo") in front of
a TARS-like word. That is deliberate: matching bare "tars" fired constantly on
ordinary speech containing "start", "cars", or "stars". Common mishearings
("tarts", "czars", "stars") are all accepted after a prefix.

> Wake-word detection uses the browser Speech API, which in Chromium sends audio
> to Google's servers for transcription and needs a network connection. If you
> want a fully offline wake word, that requires a local model such as Porcupine
> or openWakeWord.

### Making it feel built in
1. **Start at login** — tray menu → *Start at login*. TARS boots hidden into the
   tray and is ready on `Alt+Space`.
2. **macOS permissions** — the first voice command and the first automation
   command each trigger a prompt. Grant, under *System Settings → Privacy & Security*:
   - **Microphone** → TARS (voice input)
   - **Accessibility** → TARS (media keys, window control)
   - **Automation** → TARS → System Events, Spotify, Music (`osascript` control)

   Without Accessibility and Automation, `media_control` and `power_control` fail
   silently at the OS level.
3. **Windows** — no extra permissions. If `Alt+Space` does nothing, another app
   owns the shortcut; check the backend console for a "could not register" warning.
4. **Packaged builds** — `cd frontend && npm run dist:win` (or `dist:mac`)
   produces an installer in `frontend/release/`.

---

## 5. What TARS can do

21 tools, all cross-platform:

| Area | Tools |
|---|---|
| Apps & web | `launch_app`, `open_website` |
| System | `set_volume`, `media_control`, `clipboard`, `notify`, `system_info`, `power_control` |
| Files | `find_files`, `read_file`, `write_file`, `move_file`, `delete_file` |
| Web | `web_search`, `fetch_page` |
| Browser | `browser_open`, `browser_click`, `browser_type`, `browser_read` |
| Shell | `run_shell` |
| Self | `set_personality` |

It is a real agent loop: up to **8** model→tools→model round trips per request,
so *"find my resume, open it, and turn the volume down"* is one instruction.

### Two ways to reach the web
- **`open_website`** deep-links into *your own* browser. `site='youtube',
  query='lofi'` lands on the search results page. This is the default and
  handles most requests.
- **`browser_*`** drives a **separate Chromium window that TARS owns**, with a
  persistent profile at `~/.tars/browser` so logins stick. Used only when a task
  needs real clicking or page reading. It is not your daily browser — logins and
  tabs are not shared.

---

## 6. Safety model

Policy: **confirm destructive only.**

Runs immediately: opening apps and URLs, volume, media, search, reading files,
system info, clipboard, and any shell command that looks read-only.

Held for approval: `delete_file`, `move_file`, `power_control`, overwriting an
existing file, and any `run_shell` command matching a destructive pattern
(`rm`, `del`, `Remove-Item`, `shutdown`, `mv`, `git push`, output redirection,
`curl | sh`, and others — see `Backend/services/tools/risk.py`).

When one is hit, the overlay shows an **Allow / Deny** prompt and the agent loop
blocks until you answer. Denying tells the model not to retry. No answer within
120 seconds cancels the action.

Additional hard limits:
- File tools are **confined to your home directory**; paths that escape it are
  refused before anything runs.
- `delete_file` moves to the **trash**, never a permanent delete, and refuses to
  run at all if `send2trash` is unavailable.
- The backend binds to **127.0.0.1** only. Do not expose it — it executes shell
  commands by design. Override `HOST` only if you understand that.

---

## 7. Operational notes

**Run the backend single-process.** Pending confirmations are held in memory in
`services/confirm.py`: the SSE stream parks a future there and `POST
/api/v1/confirm` resolves it. Split those across processes and every
confirmation fails with *"unknown or expired"*. Concretely:
- Auto-reload is **off by default**. `TARS_RELOAD=1` re-enables it for
  development, and a reload landing mid-turn will break that turn's confirmation.
- Never run with `--workers` greater than 1.

**Conversation memory** is per-session and in-process, trimmed to the last 12
turns. It does not survive a backend restart. `POST /api/v1/reset` clears it.

**Endpoints**: `GET /health`, `POST /api/v1/chat/stream` (SSE),
`POST /api/v1/confirm`, `POST /api/v1/reset`, `GET /api/v1/audio/tars-tts`.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach groq" | No/invalid `GROQ_API_KEY` in `Backend/.env` |
| "Cannot reach Ollama" | `ollama serve` not running |
| Confirmation says "unknown or expired" | Backend reloaded or multi-worker — see §7 |
| Overlay shows "Offline" | Backend not up; run `tars.bat --backend` and read the traceback |
| `Alt+Space` does nothing | Another app owns the shortcut |
| "Hey TARS" never wakes it | Mic permission denied, or no network (the Speech API needs one). Check the console for a TARS warning. |
| It wakes at random | Report the phrase — the matcher lives in `frontend/src/lib/speech.js` and is unit-testable |
| Listening bars stay flat | Mic blocked for level metering; recognition may still work. Grant microphone access. |
| Volume fails on Windows | `pip install pycaw comtypes` |
| `browser_*` unavailable | `playwright install chromium` |
| Media keys do nothing (macOS) | Grant Accessibility + Automation; browser-tab audio isn't controllable this way |
| TTS request hangs | Use `voices.bin` with `am_adam` — `voices.json`/`af_heart` 500s |
