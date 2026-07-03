import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Send, Wifi, WifiOff, X, ArrowLeft } from 'lucide-react';
import Globe from './Globe';

export default function App() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState('IDLE'); // IDLE, RUNNING, DONE, ERROR, LISTENING
  const [isConnected, setIsConnected] = useState(false);
  const [backendAddress, setBackendAddress] = useState('127.0.0.1:8000');
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef(null);
  const replyEndRef = useRef(null);
  const recognitionRef = useRef(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setStatus('LISTENING');
      };

      rec.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        setStatus('IDLE');
        // Auto-dispatch query upon voice completion
        if (transcript.trim()) {
          dispatchQuery(transcript);
        }
      };

      rec.onerror = (err) => {
        console.error('Speech recognition error:', err);
        setStatus('ERROR');
        setTimeout(() => setStatus('IDLE'), 2000);
      };

      rec.onend = () => {
        // If we didn't transition to running, go back to idle
        setStatus((prev) => (prev === 'LISTENING' ? 'IDLE' : prev));
      };

      recognitionRef.current = rec;
    }
  }, []);

  // Listen to Electron IPC Events
  useEffect(() => {
    if (window.electronAPI) {
      // 1. Connection states
      window.electronAPI.onConnectionState((connected) => {
        setIsConnected(connected);
      });

      // 2. Network address updates
      window.electronAPI.onNetworkUpdate((addr) => {
        setBackendAddress(addr);
      });

      // 3. Status updates from backend stream
      window.electronAPI.onStatusUpdate((key) => {
        setStatus(key);
      });

      // 4. Streamed replies
      window.electronAPI.onReplyChunk((chunk) => {
        setReplyText((prev) => prev + chunk);
        setStatus('RUNNING');
      });

      window.electronAPI.onReplyEnd(() => {
        setStatus('DONE');
        if (inputRef.current) inputRef.current.focus();
      });

      // 5. Stream errors
      window.electronAPI.onError((msg) => {
        setStatus('ERROR');
        setReplyText((prev) => prev + `\n[ERROR]: ${msg}`);
      });

      // 6. When the overlay is summoned, focus the input
      window.electronAPI.onOverlayShow(() => {
        if (isExpanded && inputRef.current) {
          inputRef.current.focus();
        }
      });
    } else {
      // Mock connection for browser preview
      setIsConnected(true);
    }
  }, [isExpanded]);

  // Scroll to bottom of replies
  useEffect(() => {
    if (replyEndRef.current) {
      replyEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [replyText]);

  // Dispatch query to backend
  const dispatchQuery = (query) => {
    if (!query.trim()) return;

    // Add to history
    setHistory((prev) => [query, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);

    setStatus('RUNNING');
    setReplyText('');

    if (window.electronAPI) {
      window.electronAPI.dispatch(query);
    } else {
      // Mock Browser response
      console.log('Dispatching query (browser mode):', query);
      let count = 0;
      const response = `TARS Simulation: Received "${query}". The system is running in browser preview. Please launch in Electron to test real FastAPI streaming.`;
      const interval = setInterval(() => {
        const words = response.split(' ');
        if (count < words.length) {
          setReplyText((prev) => prev + (count === 0 ? '' : ' ') + words[count]);
          count++;
        } else {
          clearInterval(interval);
          setStatus('DONE');
        }
      }, 100);
    }
  };

  // Toggle Voice Input
  const toggleVoiceInput = () => {
    if (status === 'LISTENING') {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
  };

  // Handle Form Submit
  const handleSubmit = (e) => {
    e.preventDefault();
    dispatchQuery(inputText);
    setInputText('');
  };

  // Handle Global Shortcuts
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (isExpanded) {
        setIsExpanded(false);
      } else if (window.electronAPI) {
        window.electronAPI.hideOverlay();
      }
    } else if (e.key === 'ArrowUp' && isExpanded) {
      // Navigate History Up
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        setInputText(history[nextIndex]);
      }
    } else if (e.key === 'ArrowDown' && isExpanded) {
      // Navigate History Down
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
    if (window.electronAPI) {
      window.electronAPI.hideOverlay();
    }
  };

  const handleBackToGlobe = (e) => {
    e.stopPropagation();
    setIsExpanded(false);
  };

  // Status mapping
  const getStatusLabel = () => {
    switch (status) {
      case 'RUNNING': return 'PROCESSING';
      case 'LISTENING': return 'LISTENING';
      case 'DONE': return 'READY';
      case 'ERROR': return 'ERROR';
      default: return 'IDLE';
    }
  };

  return (
    <div 
      className="w-full h-full flex items-center justify-center bg-transparent"
      onKeyDown={handleKeyDown}
    >
      <motion.div
        layout
        initial={{ borderRadius: 150, width: 300, height: 300, scale: 0.8, opacity: 0 }}
        animate={
          isExpanded
            ? {
                borderRadius: '40px 16px 40px 16px',
                width: 640,
                height: 420,
                scale: 1,
                opacity: 1,
              }
            : {
                borderRadius: 150,
                width: 300,
                height: 300,
                scale: 1,
                opacity: 1,
              }
        }
        transition={{
          type: 'spring',
          stiffness: 240,
          damping: 24,
          layout: { duration: 0.35, type: 'spring', stiffness: 220, damping: 24 }
        }}
        // Enable dragging the window from empty spaces
        style={{ WebkitAppRegion: 'drag' }}
        className="glassmorphic-panel relative flex flex-col items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
      >
        <AnimatePresence mode="wait">
          {!isExpanded ? (
            /* ── INITIAL STATE: ROTATING GLOBE NODE ── */
            <motion.div
              key="globe-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsExpanded(true)}
              style={{ WebkitAppRegion: 'no-drag' }}
              className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
            >
              {/* Globe Rendering */}
              <Globe isListening={status === 'LISTENING'} isProcessing={status === 'RUNNING'} />
              
              {/* Floating IDLE indicators inside circle */}
              <div className="absolute bottom-6 flex items-center gap-2 px-3 py-1 rounded-full border border-white/5 bg-black/40 text-[9px] font-mono tracking-widest text-white/50">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                HEY TARS
              </div>
            </motion.div>
          ) : (
            /* ── INTERACTION STATE: GLASSMORPHIC TEXT & MIC PANEL ── */
            <motion.div
              key="panel-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: 0.15 }}
              style={{ WebkitAppRegion: 'no-drag' }}
              className="w-full h-full flex flex-col p-6 cursor-default select-text"
            >
              {/* Header Telemetry Row */}
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2 text-[10px] font-mono tracking-wider text-cyber-muted">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={handleBackToGlobe}
                    className="hover:text-white transition-colors p-0.5 rounded hover:bg-white/5 cursor-pointer"
                    title="Return to Globe"
                  >
                    <ArrowLeft size={12} />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      status === 'RUNNING' ? 'bg-amber-400 animate-pulse' :
                      status === 'LISTENING' ? 'bg-pink-400 animate-ping' :
                      status === 'ERROR' ? 'bg-red-400' : 'bg-white/60'
                    }`} />
                    <span className="text-white/80">{getStatusLabel()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Connection Node */}
                  <div className="flex items-center gap-1.5">
                    {isConnected ? (
                      <Wifi size={10} className="text-emerald-400" />
                    ) : (
                      <WifiOff size={10} className="text-red-400" />
                    )}
                    <span>{backendAddress}</span>
                  </div>
                  
                  {/* Close button */}
                  <button 
                    onClick={handleClose}
                    className="hover:text-white transition-colors cursor-pointer"
                    title="Hide Overlay"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* Streaming Output / Response Area */}
              <div className="flex-1 w-full overflow-y-auto no-scrollbar pr-1 min-h-[120px] mb-4 text-white font-mono text-[13px] leading-relaxed select-text selection:bg-white/10">
                {replyText ? (
                  <div className="whitespace-pre-wrap">
                    {replyText}
                    {status === 'RUNNING' && <span className="cursor-blink" />}
                  </div>
                ) : (
                  <div className="text-cyber-muted italic select-none">
                    {status === 'LISTENING' ? 'Listening to voice...' : 'Awaiting prompt sequence...'}
                  </div>
                )}
                <div ref={replyEndRef} />
              </div>

              {/* Input Row */}
              <form 
                onSubmit={handleSubmit}
                className="relative flex items-center w-full rounded-2xl border border-white/10 bg-black/60 shadow-[inset_-2px_-2px_6px_rgba(0,0,0,0.8),_inset_2px_2px_4px_rgba(255,255,255,0.03)] px-4 py-2.5 transition-all duration-300 focus-within:border-white/20"
              >
                {/* Voice Activation Indicator / Toggle Button */}
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className={`flex items-center justify-center p-2 rounded-xl border border-white/5 transition-all duration-300 cursor-pointer ${
                    status === 'LISTENING' 
                      ? 'bg-white/10 border-white/30 text-white pulse-mic-icon' 
                      : 'bg-white/5 text-cyber-muted hover:text-white hover:bg-white/10'
                  }`}
                  title={status === 'LISTENING' ? 'Stop Listening' : 'Voice Input'}
                >
                  <Mic size={16} />
                </button>

                {/* Minimal text input field */}
                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={status === 'LISTENING' ? 'Listening...' : 'Type query or sequence...'}
                  disabled={status === 'LISTENING'}
                  className="flex-1 bg-transparent border-0 outline-none ring-0 shadow-none text-white placeholder-cyber-muted font-sans text-sm ml-3.5 mr-2 h-8"
                  autoFocus
                />

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!inputText.trim() || status === 'LISTENING'}
                  className={`flex items-center justify-center p-2 rounded-xl border border-white/5 bg-white/5 transition-all duration-300 ${
                    inputText.trim() && status !== 'LISTENING'
                      ? 'text-white hover:text-black hover:bg-white border-white/20 cursor-pointer'
                      : 'text-cyber-muted cursor-not-allowed opacity-50'
                  }`}
                >
                  <Send size={14} />
                </button>
              </form>

              {/* Keyboard shortcut footer */}
              <div className="flex items-center justify-between mt-3 text-[9px] font-mono text-cyber-muted select-none">
                <div>TARS v1.0.0</div>
                <div className="flex gap-2">
                  <span><kbd className="px-1 bg-white/5 rounded border border-white/10">ESC</kbd> dismiss</span>
                  <span>·</span>
                  <span><kbd className="px-1 bg-white/5 rounded border border-white/10">↑↓</kbd> history</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
