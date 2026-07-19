import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Send, WifiOff, X } from 'lucide-react';
import Globe from './Globe';

export default function App() {
  const [uiState, setUiState] = useState('IDLE');
  const [status, setStatus] = useState('IDLE'); 
  const [isConnected, setIsConnected] = useState(false);
  const [backendAddress] = useState('127.0.0.1:8000');
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);

  const inputRef = useRef(null);
  const replyEndRef = useRef(null);
  const contentRef = useRef(null);

  // Panel height follows its content (like Spotlight growing with results)
  // instead of sitting at a fixed size with a void under short replies.
  const [contentHeight, setContentHeight] = useState(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContentHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [uiState]);
  const uiStateRef = useRef(uiState);  // latest uiState for async callbacks
  uiStateRef.current = uiState;
  
  const audioQueue = useRef([]);
  const isPlaying = useRef(false);
  const audioContext = useRef(null);
  const currentAudioSource = useRef(null);
  const audioGeneration = useRef(0); // bumped by stopAudio() to invalidate in-flight fetches

  // macOS renders the listening island as a solid-black notch-blended bar;
  // every other platform gets a floating frosted-glass pill.
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

  const readyAudioBuffers = useRef([]);
  const isFetching = useRef(false);

  const stopAudio = () => {
     audioQueue.current = [];
     readyAudioBuffers.current = [];
     audioGeneration.current += 1; // any in-flight playNextAudio() call becomes stale
     if (currentAudioSource.current) {
         try { currentAudioSource.current.stop(); } catch {}
         currentAudioSource.current = null;
     }
     isPlaying.current = false;
  };

  const processAudioQueue = async () => {
     if (isFetching.current || audioQueue.current.length === 0) return;
     isFetching.current = true;
     
     if (!audioContext.current) {
         audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
     }
     
     while (audioQueue.current.length > 0) {
         const text = audioQueue.current.shift();
         const genId = audioGeneration.current;
         try {
             const response = await fetch(`http://${backendAddress}/api/v1/audio/tars-tts?text=${encodeURIComponent(text)}`);
             if (audioGeneration.current !== genId) continue;
             const arrayBuffer = await response.arrayBuffer();
             if (audioGeneration.current !== genId) continue;
             const audioBuffer = await audioContext.current.decodeAudioData(arrayBuffer);
             if (audioGeneration.current !== genId) continue;
             
             readyAudioBuffers.current.push(audioBuffer);
             
             if (!isPlaying.current) playNextAudio();
         } catch (e) {
             console.error("Audio fetch error", e);
         }
     }
     isFetching.current = false;
  };

  const playNextAudio = () => {
    if (isPlaying.current || readyAudioBuffers.current.length === 0) return;
    isPlaying.current = true;
    
    if (!audioContext.current) {
        audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    const audioBuffer = readyAudioBuffers.current.shift();
    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.current.destination);
    currentAudioSource.current = source;
    
    source.onended = () => {
        currentAudioSource.current = null;
        isPlaying.current = false;
        playNextAudio();
    };
    source.start(0);
  };

  const speakText = (text) => {
    // Strip <display> tags, markdown, and [...] brackets completely to avoid speaking scaffolding
    const cleanText = text
      .replace(/<display>[\s\S]*?<\/display>/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_~`#]/g, '')
      .trim();
      
    if (!cleanText) return;
    audioQueue.current.push(cleanText);
    processAudioQueue();
  };

  // Speak a single line and resolve only once it has finished playing. Used for
  // the wake-word greeting so we can hold off on recording the command until
  // TARS has stopped talking (otherwise the greeting bleeds into the mic).
  const playClipAndWait = (text) =>
    new Promise((resolve) => {
      (async () => {
        const cleanText = (text || '').trim();
        if (!cleanText) return resolve();
        try {
          if (!audioContext.current) {
            audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          const response = await fetch(
            `http://${backendAddress}/api/v1/audio/tars-tts?text=${encodeURIComponent(cleanText)}`
          );
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext.current.decodeAudioData(arrayBuffer);
          const source = audioContext.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.current.destination);
          currentAudioSource.current = source;
          source.onended = () => {
            currentAudioSource.current = null;
            resolve();
          };
          source.start(0);
        } catch (e) {
          console.error('Greeting play error', e);
          resolve();
        }
      })();
    });

  // A few TARS-flavored acknowledgements, à la Google Assistant's chime.
  const WAKE_GREETINGS = [
    "Yeah?",
    "I'm listening.",
    "Go ahead.",
    "TARS online. What do you need?",
    "At your service.",
    "Ready when you are.",
  ];

  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser.");
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = async (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const text = (finalTranscript || interimTranscript).toLowerCase().trim();
      
      // Check for wake word if we are in IDLE
      if (uiStateRef.current === 'IDLE' && /\b(tars|tar|tarz|taz|tarss|tares|tarce|tarts)\b/.test(text)) {
         recognition.stop();
         
         if (window.electronAPI) window.electronAPI.requestShow();
         stopAudio();
         setUiState('VOICE_LISTENING');
         
         const greeting = WAKE_GREETINGS[Math.floor(Math.random() * WAKE_GREETINGS.length)];
         await playClipAndWait(greeting);
         
         if (uiStateRef.current === 'VOICE_LISTENING') {
            listenViaBackend();
         }
      }
    };

    recognition.onend = () => {
      // Auto-restart if we're in IDLE and it stopped unexpectedly
      if (uiStateRef.current === 'IDLE' && isListeningRef.current) {
        try { recognition.start(); } catch (e) {}
      }
    };

    if (uiState === 'IDLE') {
       isListeningRef.current = true;
       try { recognition.start(); } catch (e) {}
    } else {
       isListeningRef.current = false;
       try { recognition.stop(); } catch (e) {}
    }

    return () => {
      isListeningRef.current = false;
      try { recognition.stop(); } catch (e) {}
    }
  }, [uiState]);

  const listenViaBackend = () => {
    setStatus('LISTENING');
    stopAudio();
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('IDLE');
      setUiState(prev => prev === 'VOICE_LISTENING' ? 'IDLE' : prev);
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    let hasResult = false;
    
    recognition.onresult = (event) => {
      hasResult = true;
      const text = event.results[0][0].transcript;
      setStatus('IDLE');
      if (text && text.trim()) {
        setInputText(text);
        dispatchQuery(text);
      } else {
        setUiState(prev => prev === 'VOICE_LISTENING' ? 'IDLE' : prev);
      }
    };
    
    recognition.onerror = (e) => {
       console.error("Speech recognition error:", e);
       setStatus('ERROR');
       setTimeout(() => setStatus('IDLE'), 2000);
       setUiState(prev => prev === 'VOICE_LISTENING' ? 'IDLE' : prev);
    };
    
    recognition.onend = () => {
       if (!hasResult) {
          setStatus('IDLE');
          setUiState(prev => prev === 'VOICE_LISTENING' ? 'IDLE' : prev);
       }
    };
    
    try {
      recognition.start();
    } catch(e) {
      console.error(e);
      setStatus('ERROR');
      setUiState(prev => prev === 'VOICE_LISTENING' ? 'IDLE' : prev);
    }
  };

  // Poll connection status
  useEffect(() => {
    const interval = setInterval(async () => {
       try {
         await fetch(`http://${backendAddress}/docs`);
         setIsConnected(true);
       } catch {
         setIsConnected(false);
       }
    }, 5000);
    return () => clearInterval(interval);
  }, [backendAddress]);

  // Listen to Electron IPC Events
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onSummonText(() => {
        stopAudio();
        setUiState('TEXT_INPUT');
        setStatus('IDLE');
        setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 100);
      });

      window.electronAPI.onSummonVoice(() => {
        stopAudio();
        setUiState('VOICE_LISTENING');
        listenViaBackend();
      });
    }
    // Register IPC listeners once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom of replies
  useEffect(() => {
    if (replyEndRef.current && uiState === 'EXPANDED_CHAT') {
      replyEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [replyText, uiState]);

  // If hidden, notify main process to hide window
  useEffect(() => {
    if (uiState === 'IDLE' && window.electronAPI) {
      window.electronAPI.hideOverlay();
      stopAudio();
      setInputText('');
      setReplyText('');
    }
  }, [uiState]);

  // Drive the main-process "voice mode": slide the window to the top-center of
  // the screen (notch on macOS) and pin it open while we're listening or idle.
  useEffect(() => {
    window.electronAPI?.setVoiceMode?.(uiState === 'VOICE_LISTENING' || uiState === 'IDLE');
  }, [uiState]);

  // Dispatch query to backend
  const dispatchQuery = async (query) => {
    if (!query.trim()) return;

    setHistory((prev) => [query, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);

    // Default to EXPANDED_CHAT if they typed it. If voice, stay in voice until <display>
    if (uiState !== 'VOICE_LISTENING') {
      setUiState('EXPANDED_CHAT');
    }
    
    setStatus('RUNNING');
    setReplyText('');
    stopAudio(); // Stop old speech

    try {
      const response = await fetch(`http://${backendAddress}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: query }] })
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      let sentenceBuffer = "";
      let fullBuffer = "";
      let lineBuffer = "";  // holds a partial SSE line split across network chunks

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
           setStatus('DONE');
           if (sentenceBuffer.trim()) {
               speakText(sentenceBuffer.trim());
           }
           break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        // Keep the last (possibly incomplete) segment for the next read so we
        // never JSON.parse a half-received line and silently drop its token.
        lineBuffer = lines.pop();

        for (const line of lines) {
           if (line.startsWith('data: ')) {
               const dataStr = line.replace('data: ', '').trim();
               if (dataStr === '{}') continue; 
               try {
                  const data = JSON.parse(dataStr);
                  if (data.chunk) {
                     fullBuffer += data.chunk;
                     
                     // Detect screen display request
                     if (fullBuffer.includes('<display>')) {
                        setUiState('EXPANDED_CHAT');
                     }
                     
                     setReplyText(fullBuffer);

                     // Buffer speech chunks
                     sentenceBuffer += data.chunk;
                     
                     // Speak on punctuation boundaries for natural flow. Keep trailing punctuation!
                     const match = sentenceBuffer.match(/([\s\S]*?[.!?])(?:\s+|$)([\s\S]*)/);
                     if (match) {
                         speakText(match[1].trim());
                         sentenceBuffer = match[2];
                     } else if (sentenceBuffer.length > 200) {
                         // Emergency split if too long without punctuation
                         speakText(sentenceBuffer.trim());
                         sentenceBuffer = "";
                     }
                  } else if (data.detail) {
                     setStatus('ERROR');
                     setReplyText(prev => prev + "\n[ERROR]: " + data.detail);
                  }
               } catch {}
           }
        }
      }
    } catch (e) {
      console.error(e);
      setStatus('ERROR');
    }
  };

  const toggleVoiceInput = () => {
    if (status === 'LISTENING') {
       // Backend doesn't support manual abort yet, so we just wait
    } else {
       stopAudio(); // Stop TARS's own playback first so it doesn't bleed into the mic
       listenViaBackend();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    dispatchQuery(inputText);
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setUiState('IDLE');
    } else if (e.key === 'ArrowUp' && (uiState === 'TEXT_INPUT' || uiState === 'EXPANDED_CHAT')) {
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        setInputText(history[nextIndex]);
      }
    } else if (e.key === 'ArrowDown' && (uiState === 'TEXT_INPUT' || uiState === 'EXPANDED_CHAT')) {
      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setInputText(history[nextIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputText('');
      }
    }
  };

  const handleClose = (e) => {
    e.stopPropagation();
    setUiState('IDLE');
  };

  // Human copy, not console output. "PROCESSING" / "SYS.READY" reads as sci-fi
  // set dressing; Apple's HUDs say what is happening in plain words.
  const getStatusLabel = () => {
    switch (status) {
      case 'RUNNING': return 'Thinking';
      case 'LISTENING': return 'Listening';
      case 'ERROR': return 'Something went wrong';
      case 'DONE':
      default: return 'Ready';
    }
  };

  const statusDotColor = {
    RUNNING: 'var(--color-state-busy)',
    LISTENING: 'var(--color-accent)',
    ERROR: 'var(--color-state-error)',
  }[status] || 'var(--color-state-active)';

  // Apple's HUD spring: settles quickly, no perceptible bounce. A HUD that
  // wobbles on entry feels like a toy.
  const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };

  if (uiState === 'IDLE') return null;

  return (
    <div
      className={`w-full h-full flex justify-center bg-transparent ${
        uiState === 'VOICE_LISTENING' ? 'items-start' : 'items-center'
      }`}
      onKeyDown={handleKeyDown}
      onClick={handleClose}
    >
      <motion.div
        // NOTE: no `layout` prop. Width/height are animated explicitly below,
        // and framer's layout projection would visually move the panel while
        // its children still lay out in the un-projected box — which silently
        // clipped the header off the top of the panel.
        onClick={(e) => e.stopPropagation()}
        // Enters by rising and settling, not by zooming — matches how Spotlight
        // and Control Center arrive.
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={
          uiState === 'TEXT_INPUT'
            ? { width: 620, height: 60, scale: 1, opacity: 1, y: 0 }
            : uiState === 'EXPANDED_CHAT'
            ? {
                width: 660,
                // Clamped: never smaller than the header+input can occupy,
                // never taller than the 800px transparent shell can host.
                height: Math.min(Math.max(contentHeight ?? 240, 190), 560),
                scale: 1, opacity: 1, y: 0,
              }
            : uiState === 'VOICE_LISTENING'
            ? { width: isMac ? 380 : 320, height: 52, scale: 1, opacity: 1, y: isMac ? 0 : 10 }
            : { opacity: 0 }
        }
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ ...SPRING, layout: SPRING }}
        style={{
          WebkitAppRegion: 'drag',
          // Radius is per-state: on macOS the listening island keeps a square
          // top edge (flush under the notch) with rounded bottom corners.
          borderRadius:
            uiState === 'VOICE_LISTENING'
              ? (isMac ? '0 0 var(--radius-island) var(--radius-island)' : 'var(--radius-island)')
              : 'var(--radius-panel)',
          // macOS listening island: solid black so it merges with the notch.
          ...(uiState === 'VOICE_LISTENING' && isMac
            ? { background: '#000', border: 'none', boxShadow: '0 10px 28px rgba(0,0,0,0.55)' }
            : {}),
        }}
        className={`${
          uiState === 'VOICE_LISTENING' && isMac ? '' : 'glass-panel'
        } relative flex flex-col items-center justify-center overflow-hidden select-none ${
          uiState === 'VOICE_LISTENING' ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        <AnimatePresence mode="wait">
          {uiState === 'VOICE_LISTENING' && (
            <motion.div
              key="voice-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ WebkitAppRegion: 'no-drag' }}
              className={`w-full h-full flex items-center px-5 ${
                isMac ? 'justify-between' : 'justify-center gap-3'
              }`}
              onClick={() => setUiState('TEXT_INPUT')}
              title="Click to type instead"
            >
              {/* Mic + live equalizer, grouped so they stay to one side of the
                  notch on macOS. */}
              <div className="flex items-center gap-3.5 shrink-0">
                {/* Mic with a slow breathing ring — presence without anxiety. */}
                <div className="relative flex items-center justify-center">
                  <span
                    aria-hidden
                    className="absolute inset-[-7px] rounded-full"
                    style={{
                      background: 'var(--color-accent)',
                      animation: 'breathe 2.6s ease-in-out infinite',
                    }}
                  />
                  <Mic size={15} className="relative text-white/95" />
                </div>

                {/* Monochrome levels. A rainbow gradient reads as a media
                    player; Apple keeps voice input achromatic so the accent
                    stays meaningful. */}
                <div className="flex items-end justify-center gap-[3px] h-4">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <motion.span
                      key={i}
                      className="w-[2.5px] h-full rounded-full bg-white/85"
                      style={{ transformOrigin: 'bottom' }}
                      animate={{ scaleY: [0.22, 1, 0.38, 0.82, 0.28] }}
                      transition={{
                        duration: 1.15,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: i * 0.085,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Reserve the physical notch width on macOS so nothing renders
                  behind the cutout. Tune 170px to your specific MacBook. */}
              {isMac && <div aria-hidden className="w-[170px] shrink-0" />}

              <span className="shrink-0 text-[12px] font-medium text-label-secondary select-none">
                Listening
              </span>
            </motion.div>
          )}

          {(uiState === 'TEXT_INPUT' || uiState === 'EXPANDED_CHAT') && (
            <motion.div
              key="panel-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              ref={contentRef}
              style={{ WebkitAppRegion: 'no-drag' }}
              className={`w-full flex flex-col cursor-default select-text ${
                uiState === 'EXPANDED_CHAT' ? 'p-5' : 'h-full px-3 py-2 justify-center'
              }`}
            >
              {uiState === 'EXPANDED_CHAT' && (
                <>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b-[0.5px] border-hairline text-[12px]">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-[7px] h-[7px] rounded-full ${
                          status === 'RUNNING' || status === 'LISTENING' ? 'animate-pulse' : ''
                        }`}
                        style={{ background: statusDotColor }}
                      />
                      <span className="font-medium text-label">{getStatusLabel()}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Connection is only worth surfacing when it's broken —
                          a healthy state needs no badge. */}
                      {!isConnected && (
                        <span
                          className="flex items-center gap-1.5 text-[11px]"
                          style={{ color: 'var(--color-state-error)' }}
                          title={`Cannot reach backend at ${backendAddress}`}
                        >
                          <WifiOff size={11} />
                          Offline
                        </span>
                      )}
                      <button
                        onClick={handleClose}
                        className="flex items-center justify-center w-6 h-6 rounded-full text-label-tertiary hover:text-label hover:bg-white/10 transition-colors cursor-pointer"
                        title="Hide overlay"
                        style={{ WebkitAppRegion: 'no-drag' }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="w-full overflow-y-auto no-scrollbar pr-1 max-h-[380px] mb-4 text-label text-[14.5px] leading-[1.55] select-text">
                    {replyText ? (
                      <div className="whitespace-pre-wrap">
                        {/* Format <display> tags cleanly if shown */}
                        {replyText.replace(/<display>/g, '\n').replace(/<\/display>/g, '\n')}
                        {status === 'RUNNING' && <span className="cursor-blink" />}
                      </div>
                    ) : (
                      <div className="text-label-tertiary select-none">
                        {status === 'LISTENING' ? 'Listening…' : 'Ask anything.'}
                      </div>
                    )}
                    <div ref={replyEndRef} />
                  </div>
                </>
              )}

              <form
                onSubmit={handleSubmit}
                style={{ borderRadius: 'var(--radius-field)', WebkitAppRegion: 'no-drag' }}
                className={`relative flex items-center w-full gap-1 ${
                  // In the compact state the panel *is* the search bar — nesting a
                  // second bordered field inside it reads as a redundant frame.
                  // The well only appears once there's a transcript above it.
                  uiState === 'EXPANDED_CHAT'
                    ? `px-2 py-1.5 glass-field ${inputFocused ? 'glass-field-focused' : ''}`
                    : 'px-2.5 py-1.5 bg-transparent'
                }`}
              >
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className={`flex items-center justify-center w-8 h-8 shrink-0 transition-colors duration-200 cursor-pointer ${
                    status === 'LISTENING'
                      ? 'text-white pulse-mic-icon'
                      : 'text-label-secondary hover:text-label hover:bg-white/8'
                  }`}
                  style={{
                    borderRadius: 'var(--radius-control)',
                    ...(status === 'LISTENING'
                      ? { background: 'var(--color-accent)' }
                      : {}),
                  }}
                  title={status === 'LISTENING' ? 'Stop listening' : 'Voice input'}
                >
                  <Mic size={15} />
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder={status === 'LISTENING' ? 'Listening…' : 'Ask TARS anything'}
                  disabled={status === 'LISTENING'}
                  className="flex-1 bg-transparent border-0 outline-none ring-0 shadow-none text-label text-[15px] px-1.5 h-8 placeholder:text-label-tertiary"
                  autoFocus
                />

                {/* Send only materializes once there's something to send —
                    a permanently dimmed button is visual noise. */}
                <AnimatePresence>
                  {inputText.trim() && status !== 'LISTENING' && (
                    <motion.button
                      type="submit"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.14 }}
                      style={{ background: 'var(--color-accent)', borderRadius: 'var(--radius-control)' }}
                      className="flex items-center justify-center w-8 h-8 shrink-0 text-white cursor-pointer hover:brightness-110 transition-[filter]"
                      title="Send"
                    >
                      <Send size={14} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </form>

              {uiState === 'EXPANDED_CHAT' && (
                <div className="flex items-center justify-end gap-3 mt-2.5 text-[11px] text-label-tertiary select-none">
                  <span><kbd className="font-sans">esc</kbd> to dismiss</span>
                  <span><kbd className="font-sans">↑↓</kbd> history</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* The globe is an ambient presence indicator, not decoration — it only
            belongs on screen while TARS is actually listening or thinking.
            Hanging it under a resting panel just read as a stray artifact. */}
        {(status === 'LISTENING' || status === 'RUNNING') && (
           <Globe isListening={status === 'LISTENING'} isProcessing={status === 'RUNNING'} />
        )}
      </motion.div>
    </div>
  );
}
