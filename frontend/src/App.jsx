import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import VoiceIsland from './components/VoiceIsland';
import CommandPanel from './components/CommandPanel';
import { toolLabel } from './lib/toolLabels';
import { AudioEngine } from './lib/audioEngine';
import { MicLevel } from './lib/micLevel';
import { WakeListener, captureCommand, isSpeechSupported } from './lib/speech';

const BACKEND = '127.0.0.1:8000';

/**
 * UI modes.
 *
 *   HIDDEN    nothing on screen; wake listener armed
 *   TEXT      compact command bar (Alt+Space)
 *   CHAT      the bar, grown to hold a reply
 *   VOICE     top-center island: listening / thinking / speaking
 */
const MODE = { HIDDEN: 'HIDDEN', TEXT: 'TEXT', CHAT: 'CHAT', VOICE: 'VOICE' };

const WAKE_GREETINGS = [
  "Yeah?",
  "I'm listening.",
  "Go ahead.",
  "At your service.",
  "Ready when you are.",
  "What do you need?",
];

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };

// Outside Electron there is no Alt+Space to summon the overlay, so starting
// hidden would render a permanently blank page. Opening straight into the
// command bar makes `npm run dev` in a plain browser a usable way to work on
// the UI.
const IN_ELECTRON = typeof window !== 'undefined' && Boolean(window.electronAPI);

export default function App() {
  const [mode, setMode] = useState(IN_ELECTRON ? MODE.HIDDEN : MODE.TEXT);
  const [voicePhase, setVoicePhase] = useState('listening'); // listening|thinking|speaking
  const [status, setStatus] = useState('IDLE');              // IDLE|RUNNING|ERROR
  const [isConnected, setIsConnected] = useState(false);
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [activity, setActivity] = useState([]);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef(null);
  const contentRef = useRef(null);
  const replyEndRef = useRef(null);
  const abortRef = useRef(null);

  // Latest mode for callbacks that outlive their render (speech events fire
  // asynchronously and would otherwise close over a stale value).
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

  // Long-lived singletons. Recreating these per render would drop the
  // AudioContext and the mic stream on every state change.
  const audio = useRef(null);
  if (!audio.current) audio.current = new AudioEngine(BACKEND);
  const mic = useRef(null);
  if (!mic.current) mic.current = new MicLevel();
  const wake = useRef(null);

  // ------------------------------------------------------------------
  // Spectrum sources for the visualiser
  // ------------------------------------------------------------------
  const micSpectrum = useCallback(() => mic.current.spectrum(), []);
  const ttsSpectrum = useCallback(() => audio.current.spectrum(), []);

  // ------------------------------------------------------------------
  // Speaking state drives the island between "thinking" and "speaking"
  // ------------------------------------------------------------------
  useEffect(() => {
    return audio.current.subscribe((speaking) => {
      setVoicePhase((prev) => {
        if (speaking) return 'speaking';
        // Stopped speaking: fall back to thinking while the stream is still
        // running, otherwise the island is done.
        return prev === 'speaking' ? 'thinking' : prev;
      });
    });
  }, []);

  // ------------------------------------------------------------------
  // Panel height follows content, like Spotlight growing with results
  // ------------------------------------------------------------------
  const [contentHeight, setContentHeight] = useState(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setContentHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // ------------------------------------------------------------------
  // Voice flow
  // ------------------------------------------------------------------
  const startVoiceCapture = useCallback(async () => {
    // Stop the wake listener explicitly rather than relying on the mode effect.
    // Chromium allows one active SpeechRecognition at a time, and the effect
    // wouldn't run until after this render — long enough for the always-on
    // listener and the command capture to collide and abort each other.
    wake.current?.stop();

    setTranscript('');
    setVoicePhase('listening');
    setMode(MODE.VOICE);

    // Level metering runs alongside recognition so the bars track real speech.
    await mic.current.start();

    const spoken = await captureCommand({ onInterim: setTranscript });

    if (!spoken) {
      mic.current.stop();
      setTranscript('');
      setMode(MODE.HIDDEN);
      return;
    }

    setTranscript(spoken);
    mic.current.stop();
    setVoicePhase('thinking');
    dispatchQuery(spoken, { voice: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWake = useCallback(
    async (trailing) => {
      if (window.electronAPI) window.electronAPI.requestShow();
      audio.current.stop();

      setMode(MODE.VOICE);
      setVoicePhase('speaking');
      setReplyText('');
      setActivity([]);

      // "Hey TARS, what's the weather" — the command came with the wake phrase,
      // so skip the greeting and act on it directly. That's the difference
      // between a demo and something you'd actually use.
      if (trailing && trailing.split(/\s+/).length >= 2) {
        setTranscript(trailing);
        setVoicePhase('thinking');
        dispatchQuery(trailing, { voice: true });
        return;
      }

      const greeting = WAKE_GREETINGS[Math.floor(Math.random() * WAKE_GREETINGS.length)];
      await audio.current.speakAndWait(greeting);

      if (modeRef.current === MODE.VOICE) startVoiceCapture();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startVoiceCapture]
  );

  // ------------------------------------------------------------------
  // Wake listener — armed only while hidden
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isSpeechSupported()) {
      console.warn('[TARS] Speech recognition unavailable; wake word disabled.');
      return;
    }
    if (!wake.current) {
      wake.current = new WakeListener({
        onWake,
        onError: (msg) => console.warn('[TARS]', msg),
      });
    }

    // Only listen for "Hey TARS" when idle. Leaving it armed during a
    // conversation makes TARS wake itself on its own spoken replies.
    if (mode === MODE.HIDDEN) wake.current.start();
    else wake.current.stop();

    return () => wake.current?.stop();
  }, [mode, onWake]);

  // ------------------------------------------------------------------
  // Backend health
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch(`http://${BACKEND}/health`);
        if (!cancelled) setIsConnected(r.ok);
      } catch {
        if (!cancelled) setIsConnected(false);
      }
    };
    ping();
    const interval = setInterval(ping, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ------------------------------------------------------------------
  // Electron IPC
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onSummonText(() => {
      audio.current.stop();
      setMode((m) => (m === MODE.CHAT ? MODE.CHAT : MODE.TEXT));
      setStatus('IDLE');
      setTimeout(() => inputRef.current?.focus(), 80);
    });
    window.electronAPI.onSummonVoice(() => {
      audio.current.stop();
      startVoiceCapture();
    });
    // Registered once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell the main process when to pin the window to the top of the screen.
  useEffect(() => {
    window.electronAPI?.setVoiceMode?.(mode === MODE.VOICE);
  }, [mode]);

  // Hiding must also tear down audio and the mic, or TARS keeps talking to an
  // empty screen with the OS recording indicator still lit.
  useEffect(() => {
    if (mode !== MODE.HIDDEN) return;
    window.electronAPI?.hideOverlay?.();
    audio.current.stop();
    mic.current.stop();
    abortRef.current?.abort();
    setInputText('');
    setReplyText('');
    setTranscript('');
    setActivity([]);
    setPendingConfirm(null);
    setStatus('IDLE');
  }, [mode]);

  useEffect(() => {
    if (mode === MODE.CHAT) replyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replyText, mode]);

  // ------------------------------------------------------------------
  // Agent events
  // ------------------------------------------------------------------
  const handleAgentEvent = useCallback((evt) => {
    if (evt.type === 'tool_start') {
      setActivity((prev) => [...prev, { name: evt.name, label: toolLabel(evt.name), state: 'running' }]);
    } else if (evt.type === 'tool_result') {
      setActivity((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].name === evt.name && next[i].state === 'running') {
            next[i] = { ...next[i], state: evt.status === 'success' ? 'done' : 'failed' };
            break;
          }
        }
        return next;
      });
    } else if (evt.type === 'confirm') {
      setPendingConfirm({ id: evt.id, prompt: evt.prompt, name: evt.name });
      // A confirmation needs buttons, so surface the full panel even mid-voice.
      setMode(MODE.CHAT);
    }
  }, []);

  const respondToConfirm = useCallback(async (approved) => {
    const current = pendingConfirm;
    if (!current) return;
    setPendingConfirm(null);
    try {
      await fetch(`http://${BACKEND}/api/v1/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: current.id, approved }),
      });
    } catch (e) {
      console.error('[TARS] Confirmation failed to send', e);
    }
  }, [pendingConfirm]);

  // ------------------------------------------------------------------
  // Query dispatch
  // ------------------------------------------------------------------
  const dispatchQuery = useCallback(async (query, { voice = false } = {}) => {
    if (!query.trim()) return;

    setHistory((prev) => [query, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);

    // Typed queries grow the bar into the panel. Spoken ones stay on the
    // island — the answer is being read aloud, so a wall of text is noise.
    if (!voice) setMode(MODE.CHAT);

    setStatus('RUNNING');
    setReplyText('');
    setActivity([]);
    setPendingConfirm(null);
    audio.current.stop();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`http://${BACKEND}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: query }] }),
        signal: controller.signal,
      });
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let spokenBuffer = '';   // accumulates until a sentence boundary
      let fullBuffer = '';
      let lineBuffer = '';     // holds a partial SSE line split across chunks

      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          if (spokenBuffer.trim()) audio.current.speak(spokenBuffer.trim());
          setStatus('DONE');
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        // Keep the last (possibly incomplete) segment so we never JSON.parse a
        // half-received line and silently drop its token.
        lineBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '{}') continue;

          let data;
          try { data = JSON.parse(raw); } catch { continue; }

          if (data.chunk) {
            fullBuffer += data.chunk;
            setReplyText(fullBuffer);
            if (fullBuffer.includes('<display>')) setMode(MODE.CHAT);

            spokenBuffer += data.chunk;
            // Speak on sentence boundaries so playback starts early but never
            // mid-clause.
            const match = spokenBuffer.match(/([\s\S]*?[.!?])(?:\s+|$)([\s\S]*)/);
            if (match) {
              audio.current.speak(match[1].trim());
              spokenBuffer = match[2];
            } else if (spokenBuffer.length > 220) {
              audio.current.speak(spokenBuffer.trim());
              spokenBuffer = '';
            }
          } else if (data.event) {
            handleAgentEvent(data.event);
          } else if (data.detail) {
            setStatus('ERROR');
            setReplyText((p) => p + '\n[ERROR]: ' + data.detail);
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[TARS] Stream failed', e);
        setStatus('ERROR');
        setReplyText((p) => p + '\n[ERROR]: could not reach the backend.');
      }
    } finally {
      abortRef.current = null;
    }
  }, [handleAgentEvent]);

  // Once the reply is fully spoken, a voice session should end on its own.
  useEffect(() => {
    if (mode !== MODE.VOICE || status === 'RUNNING') return;
    const t = setTimeout(() => {
      if (modeRef.current === MODE.VOICE && !audio.current.isPlaying) setMode(MODE.HIDDEN);
    }, 2600);
    return () => clearTimeout(t);
  }, [mode, status, voicePhase]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const handleSubmit = (e) => {
    e.preventDefault();
    const q = inputText;
    setInputText('');
    dispatchQuery(q);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    audio.current.stop();
    setStatus('IDLE');
  };

  const handleClose = () => setMode(MODE.HIDDEN);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      // Escape must not silently abandon a held action — treat it as a denial
      // so the agent loop unblocks instead of waiting out its timeout.
      if (pendingConfirm) { respondToConfirm(false); return; }
      handleClose();
    } else if (e.key === 'ArrowUp' && history.length > 0 && historyIndex < history.length - 1) {
      const next = historyIndex + 1;
      setHistoryIndex(next);
      setInputText(history[next]);
    } else if (e.key === 'ArrowDown' && historyIndex > 0) {
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setInputText(history[next]);
    }
  };

  const toggleVoice = () => {
    if (mode === MODE.VOICE) { mic.current.stop(); setMode(MODE.HIDDEN); }
    else { audio.current.stop(); startVoiceCapture(); }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (mode === MODE.HIDDEN) return null;

  const expanded = mode === MODE.CHAT;

  return (
    <div
      className={`w-full h-full flex justify-center bg-transparent ${
        mode === MODE.VOICE ? 'items-start' : 'items-center'
      }`}
      onKeyDown={handleKeyDown}
      onClick={handleClose}
    >
      <AnimatePresence mode="wait">
        {mode === MODE.VOICE ? (
          <div key="voice" onClick={(e) => e.stopPropagation()}>
            <VoiceIsland
              mode={voicePhase}
              getSpectrum={voicePhase === 'speaking' ? ttsSpectrum : micSpectrum}
              transcript={transcript}
              caption={replyText}
              isMac={isMac}
              onClick={() => { mic.current.stop(); setMode(MODE.CHAT); }}
            />
          </div>
        ) : (
          <motion.div
            key="panel"
            onClick={(e) => e.stopPropagation()}
            // Rises and settles rather than zooming — matches how Spotlight and
            // Control Center arrive.
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{
              width: expanded ? 680 : 620,
              // Both states measure their own content rather than using a fixed
              // height. A hardcoded collapsed height silently clipped the input
              // row, and would break again under OS font scaling.
              height: expanded
                // Clamped: never taller than the 800px transparent shell hosts.
                ? Math.min(Math.max(contentHeight ?? 240, 190), 580)
                : (contentHeight ?? 76),
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={SPRING}
            style={{
              WebkitAppRegion: 'drag',
              borderRadius: 'var(--radius-panel)',
            }}
            className="glass-panel sheen relative flex flex-col overflow-hidden select-none
                       cursor-grab active:cursor-grabbing"
          >
            <CommandPanel
              expanded={expanded}
              inputText={inputText}
              onInputChange={setInputText}
              onSubmit={handleSubmit}
              onVoice={toggleVoice}
              onStop={handleStop}
              onClose={handleClose}
              onKeyDown={handleKeyDown}
              replyText={replyText}
              status={status}
              activity={activity}
              pendingConfirm={pendingConfirm}
              onConfirm={respondToConfirm}
              isConnected={isConnected}
              isListening={false}
              inputRef={inputRef}
              contentRef={contentRef}
              replyEndRef={replyEndRef}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
