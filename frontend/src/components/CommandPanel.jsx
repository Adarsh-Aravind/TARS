import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, ArrowUp, WifiOff, X, Square } from 'lucide-react';

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };

/**
 * The typed-input surface.
 *
 * Collapsed it is a single bar, exactly the affordance Alt+Space should
 * produce. Once a reply starts streaming the same element grows to hold it —
 * the panel is never torn down and rebuilt, so the transition is one continuous
 * object rather than a swap.
 */
export default function CommandPanel({
  expanded,
  inputText,
  onInputChange,
  onSubmit,
  onVoice,
  onStop,
  onClose,
  onKeyDown,
  replyText,
  status,
  activity,
  pendingConfirm,
  onConfirm,
  isConnected,
  isListening,
  inputRef,
  contentRef,
  replyEndRef,
}) {
  const [focused, setFocused] = React.useState(false);
  const busy = status === 'RUNNING';

  return (
    <motion.div
      ref={contentRef}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full flex flex-col px-4 pt-3.5 pb-3.5"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {/* Header only exists once there's a conversation to head. */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="header"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
            className="flex items-center justify-between mb-2.5 overflow-hidden"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: busy ? 'var(--color-state-busy)' : 'var(--color-state-active)',
                  boxShadow: `0 0 8px ${busy ? 'var(--color-state-busy)' : 'var(--color-state-active)'}`,
                }}
              />
              <span className="text-[11px] font-semibold tracking-[0.08em] text-label-secondary">
                TARS
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!isConnected && (
                <span
                  className="flex items-center gap-1.5 text-[11px]"
                  style={{ color: 'var(--color-state-error)' }}
                  title="Cannot reach the backend"
                >
                  <WifiOff size={11} />
                  Offline
                </span>
              )}
              <button
                onClick={onClose}
                className="flex items-center justify-center w-6 h-6 rounded-full text-label-tertiary
                           hover:text-label hover:bg-white/10 transition-colors cursor-pointer"
                title="Hide (Esc)"
              >
                <X size={13} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent activity — what it's actually doing, step by step. */}
      <AnimatePresence>
        {activity.length > 0 && (
          <motion.div
            key="activity"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
            className="flex flex-wrap gap-1.5 mb-2.5 overflow-hidden"
          >
            {activity.map((a, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.9, y: 3 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={SPRING}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]
                           soft-raised text-label-secondary"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background:
                      a.state === 'done' ? 'var(--color-state-active)'
                      : a.state === 'failed' ? 'var(--color-state-error)'
                      : 'var(--color-accent)',
                    animation: a.state === 'running' ? 'halo 1.4s ease-in-out infinite' : 'none',
                  }}
                />
                {a.label}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Destructive action held for approval. */}
      <AnimatePresence>
        {pendingConfirm && (
          <motion.div
            key="confirm"
            layout
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={SPRING}
            className="w-full overflow-hidden"
          >
            <div
              className="p-3 rounded-2xl"
              style={{
                background: 'rgba(255,69,58,0.10)',
                border: '0.5px solid rgba(255,69,58,0.45)',
                boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.12), 0 0 20px -6px rgba(255,69,58,0.5)',
              }}
            >
              <div className="text-[12.5px] text-label mb-2.5 leading-snug select-text">
                {pendingConfirm.prompt}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onConfirm(true)}
                  autoFocus
                  className="px-3.5 py-1.5 rounded-xl text-[12px] font-semibold text-white cursor-pointer
                             transition-transform active:scale-[0.97]"
                  style={{
                    background: 'linear-gradient(145deg, #FF6259, #D9342A)',
                    boxShadow: '-1px -1px 3px rgba(255,255,255,0.16), 2px 3px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  Allow
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  className="px-3.5 py-1.5 rounded-xl text-[12px] font-medium text-label
                             soft-raised cursor-pointer transition-transform active:scale-[0.97]"
                >
                  Deny
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply. */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="reply"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
            className="w-full overflow-hidden"
          >
            <div className="w-full overflow-y-auto no-scrollbar pr-1 max-h-[360px] mb-3.5
                            text-label text-[14.5px] leading-[1.58] select-text">
              {replyText ? (
                <div className="whitespace-pre-wrap">
                  {replyText.replace(/<display>/g, '\n').replace(/<\/display>/g, '\n')}
                  {busy && <span className="cursor-blink" />}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-label-tertiary select-none">
                  {busy ? 'Working on it…' : isListening ? 'Listening…' : 'Ask anything.'}
                </div>
              )}
              <div ref={replyEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input row. */}
      <form
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        className={`relative flex items-center w-full gap-2 px-2 py-1.5 ${
          expanded ? `soft-inset ${focused ? 'soft-inset-focused' : ''}` : ''
        }`}
        style={{ borderRadius: 'var(--radius-field)' }}
      >
        <button
          type="button"
          onClick={onVoice}
          className={`flex items-center justify-center w-9 h-9 shrink-0 cursor-pointer
                      transition-transform active:scale-[0.94] ${
            isListening ? 'soft-accent text-white' : 'soft-raised text-label-secondary hover:text-label'
          }`}
          style={{ borderRadius: 'var(--radius-control)' }}
          title={isListening ? 'Stop listening' : 'Voice input'}
        >
          <Mic size={15} strokeWidth={2.2} />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={isListening ? 'Listening…' : 'Ask TARS anything'}
          disabled={isListening}
          className="flex-1 bg-transparent border-0 outline-none ring-0 shadow-none text-label
                     text-[15px] px-1.5 h-9 placeholder:text-label-tertiary"
          autoFocus
        />

        {/* Send doubles as stop while a reply streams, so there's always an
            escape hatch from a long answer. */}
        <button
          type={busy ? 'button' : 'submit'}
          onClick={busy ? onStop : undefined}
          disabled={!busy && !inputText.trim()}
          className={`flex items-center justify-center w-9 h-9 shrink-0 cursor-pointer
                      transition-all active:scale-[0.94] ${
            busy || inputText.trim()
              ? 'soft-accent text-white'
              : 'soft-raised text-label-tertiary cursor-default'
          }`}
          style={{ borderRadius: 'var(--radius-control)' }}
          title={busy ? 'Stop' : 'Send'}
        >
          {busy ? <Square size={12} fill="currentColor" /> : <ArrowUp size={16} strokeWidth={2.4} />}
        </button>
      </form>
    </motion.div>
  );
}
