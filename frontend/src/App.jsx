import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Send, Wifi, WifiOff, X, ArrowLeft } from 'lucide-react';

export default function App() {
  const [uiState, setUiState] = useState('HIDDEN'); 
  const [status, setStatus] = useState('IDLE'); 
  const [isConnected, setIsConnected] = useState(false);
  const [backendAddress, setBackendAddress] = useState('127.0.0.1:8000');
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef(null);
  const replyEndRef = useRef(null);
  
  // No longer using webkitSpeechRecognition - relying on backend for listening
  
  const speakText = (text) => {
    // Strip out <display>...</display> tags from spoken text
    const cleanText = text.replace(/<display>[\s\S]*?<\/display>/g, '').trim();
    if (!cleanText) return;
    
    // Stop any existing speech before starting new sentence
    // (Optional: can be removed if you want seamless continuous talking, 
    // but useful if user interrupts)
    const utterance = new SpeechSynthesisUtterance(cleanText);
    window.speechSynthesis.speak(utterance);
  };

  const listenViaBackend = async () => {
    setStatus('LISTENING');
    try {
      const res = await fetch(`http://${backendAddress}/api/v1/audio/listen`);
      const data = await res.json();
      setStatus('IDLE');
      if (data.text && data.text.trim()) {
        setInputText(data.text);
        dispatchQuery(data.text);
      } else {
        // If we were in voice mode and they said nothing, hide
        setUiState(prev => prev === 'VOICE_LISTENING' ? 'HIDDEN' : prev);
      }
    } catch (e) {
      console.error('Audio listen error:', e);
      setStatus('ERROR');
      setTimeout(() => setStatus('IDLE'), 2000);
      setUiState(prev => prev === 'VOICE_LISTENING' ? 'HIDDEN' : prev);
    }
  };

  // Background Wake Word Event Listener
  useEffect(() => {
    const eventSource = new EventSource(`http://${backendAddress}/api/v1/events`);
    
    eventSource.addEventListener('wakeup', () => {
      console.log('WAKEUP EVENT RECEIVED');
      // Tell electron to unhide the window
      if (window.electronAPI) window.electronAPI.requestShow();
      
      // Stop current speech
      window.speechSynthesis.cancel();
      
      setUiState('VOICE_LISTENING');
      
      // Start listening via backend
      listenViaBackend();
    });

    eventSource.onerror = () => setIsConnected(false);
    eventSource.onopen = () => setIsConnected(true);

    return () => eventSource.close();
  }, [backendAddress]);

  // Listen to Electron IPC Events
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onSummonText(() => {
        window.speechSynthesis.cancel();
        setUiState('TEXT_INPUT');
        setStatus('IDLE');
        setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 100);
      });

      window.electronAPI.onSummonVoice(() => {
        window.speechSynthesis.cancel();
        setUiState('VOICE_LISTENING');
        listenViaBackend();
      });
    }
  }, []);

  // Scroll to bottom of replies
  useEffect(() => {
    if (replyEndRef.current && uiState === 'EXPANDED_CHAT') {
      replyEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [replyText, uiState]);

  // If hidden, notify main process to hide window
  useEffect(() => {
    if (uiState === 'HIDDEN' && window.electronAPI) {
      window.electronAPI.hideOverlay();
      window.speechSynthesis.cancel();
      setInputText('');
      setReplyText('');
    }
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
    window.speechSynthesis.cancel(); // Stop old speech

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
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
           setStatus('DONE');
           if (sentenceBuffer.trim()) {
               speakText(sentenceBuffer.trim());
           }
           break;
        }
        
        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n');
        
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
                     
                     // Speak on punctuation boundaries for natural flow
                     if (/[.!?]\s/.test(sentenceBuffer) || sentenceBuffer.length > 120) {
                         speakText(sentenceBuffer.trim());
                         sentenceBuffer = "";
                     }
                  } else if (data.detail) {
                     setStatus('ERROR');
                     setReplyText(prev => prev + "\n[ERROR]: " + data.detail);
                  }
               } catch(e) {}
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
      setUiState('HIDDEN');
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
    setUiState('HIDDEN');
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'RUNNING': return 'PROCESSING';
      case 'LISTENING': return 'LISTENING';
      case 'DONE': return 'READY';
      case 'ERROR': return 'ERROR';
      default: return 'IDLE';
    }
  };

  if (uiState === 'HIDDEN') return null;

  return (
    <div 
      className="w-full h-full flex items-center justify-center bg-transparent"
      onKeyDown={handleKeyDown}
      onClick={handleClose}
    >
      <motion.div
        layout
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={
          uiState === 'TEXT_INPUT'
            ? { borderRadius: '8px', width: 640, height: 64, scale: 1, opacity: 1, y: 0 }
            : uiState === 'EXPANDED_CHAT'
            ? { borderRadius: '8px', width: 640, height: 420, scale: 1, opacity: 1, y: 0 }
            : uiState === 'VOICE_LISTENING'
            ? { borderRadius: '60px', width: 120, height: 120, scale: 1, opacity: 1, y: -250 }
            : { opacity: 0 }
        }
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30,
          layout: { duration: 0.4, type: 'spring', stiffness: 280, damping: 28 }
        }}
        style={{ WebkitAppRegion: 'drag' }}
        className="glassmorphic-panel relative flex flex-col items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
      >
        <AnimatePresence mode="wait">
          {uiState === 'VOICE_LISTENING' && (
            <motion.div
              key="voice-state"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3 }}
              style={{ WebkitAppRegion: 'no-drag' }}
              className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
              onClick={() => setUiState('TEXT_INPUT')}
            >
              <div className="relative w-16 h-16 flex items-center justify-center">
                <motion.div 
                  className="absolute inset-0 rounded-full bg-blue-500/40 mix-blend-screen blur-md"
                  animate={{ scale: [1, 1.5, 1], rotate: [0, 90, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div 
                  className="absolute inset-0 rounded-full bg-purple-500/40 mix-blend-screen blur-md"
                  animate={{ scale: [1.2, 0.8, 1.2], rotate: [0, -90, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div 
                  className="absolute inset-0 rounded-full bg-pink-500/40 mix-blend-screen blur-md"
                  animate={{ scale: [0.9, 1.3, 0.9], rotate: [45, -45, 45] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <Mic size={24} className="relative z-10 text-white drop-shadow-lg" />
              </div>
            </motion.div>
          )}

          {(uiState === 'TEXT_INPUT' || uiState === 'EXPANDED_CHAT') && (
            <motion.div
              key="panel-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ WebkitAppRegion: 'no-drag' }}
              className={`w-full h-full flex flex-col cursor-default select-text ${
                uiState === 'EXPANDED_CHAT' ? 'p-5' : 'px-3 py-2 justify-center'
              }`}
            >
              {uiState === 'EXPANDED_CHAT' && (
                <>
                  <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2 text-[10px] font-mono tracking-wider text-cyber-muted">
                    <div className="flex items-center gap-3">
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
                      <div className="flex items-center gap-1.5">
                        {isConnected ? (
                          <Wifi size={10} className="text-emerald-400" />
                        ) : (
                          <WifiOff size={10} className="text-red-400" />
                        )}
                        <span>{backendAddress}</span>
                      </div>
                      <button 
                        onClick={handleClose}
                        className="hover:text-white transition-colors cursor-pointer"
                        title="Hide Overlay"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 w-full overflow-y-auto no-scrollbar pr-1 min-h-[120px] mb-4 text-white font-mono text-[13px] leading-relaxed select-text selection:bg-white/10">
                    {replyText ? (
                      <div className="whitespace-pre-wrap">
                        {/* Format <display> tags cleanly if shown */}
                        {replyText.replace(/<display>/g, '\n--- Display Render ---\n').replace(/<\/display>/g, '\n----------------------\n')}
                        {status === 'RUNNING' && <span className="cursor-blink" />}
                      </div>
                    ) : (
                      <div className="text-cyber-muted italic select-none">
                        {status === 'LISTENING' ? 'Listening to voice...' : 'Awaiting prompt sequence...'}
                      </div>
                    )}
                    <div ref={replyEndRef} />
                  </div>
                </>
              )}

              <form 
                onSubmit={handleSubmit}
                className="relative flex items-center w-full rounded-md border border-white/10 bg-black/60 shadow-[inset_-1px_-1px_3px_rgba(0,0,0,0.8),_inset_1px_1px_2px_rgba(255,255,255,0.03)] px-3 py-1.5 transition-all duration-300 focus-within:border-white/20"
              >
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className={`flex items-center justify-center p-1.5 rounded-md border transition-all duration-300 cursor-pointer ${
                    status === 'LISTENING' 
                      ? 'bg-white/10 border-white/30 text-white pulse-mic-icon shadow-[inset_1px_1px_2px_rgba(255,255,255,0.1),_0_0_8px_rgba(255,255,255,0.2)]' 
                      : 'bg-transparent border-transparent text-cyber-muted hover:text-white hover:bg-white/5'
                  }`}
                  title={status === 'LISTENING' ? 'Stop Listening' : 'Voice Input'}
                >
                  <Mic size={14} />
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={status === 'LISTENING' ? 'Listening...' : 'Type query or sequence...'}
                  disabled={status === 'LISTENING'}
                  className="flex-1 bg-transparent border-0 outline-none ring-0 shadow-none text-white placeholder-cyber-muted font-sans text-[13px] ml-3 mr-2 h-7"
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={!inputText.trim() || status === 'LISTENING'}
                  className={`flex items-center justify-center p-1.5 rounded-md border transition-all duration-300 ${
                    inputText.trim() && status !== 'LISTENING'
                      ? 'text-white hover:text-black hover:bg-white border-white/20 cursor-pointer shadow-[0_0_8px_rgba(255,255,255,0.1)]'
                      : 'border-transparent bg-transparent text-cyber-muted cursor-not-allowed opacity-50'
                  }`}
                >
                  <Send size={12} />
                </button>
              </form>

              {uiState === 'EXPANDED_CHAT' && (
                <div className="flex items-center justify-between mt-3 text-[9px] font-mono text-cyber-muted select-none">
                  <div>TARS v1.0.0</div>
                  <div className="flex gap-2">
                    <span><kbd className="px-1 bg-white/5 rounded border border-white/10">ESC</kbd> dismiss</span>
                    <span>·</span>
                    <span><kbd className="px-1 bg-white/5 rounded border border-white/10">↑↓</kbd> history</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
