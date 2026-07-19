import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic } from 'lucide-react';
import AudioVisualizer from './AudioVisualizer';

const SPRING = { type: 'spring', stiffness: 400, damping: 34, mass: 0.85 };

const MODE_COPY = {
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'TARS',
};

/**
 * The top-center voice surface.
 *
 * One component covering all three voice states, because they must morph into
 * each other rather than unmount and remount — a hard swap between three
 * separate islands reads as flicker at the top of the screen.
 *
 * On macOS the island is solid black and pinned flush to y=0 so it merges into
 * the notch; everywhere else it floats as a frosted pill.
 */
export default function VoiceIsland({
  mode = 'listening',
  getSpectrum,
  transcript = '',
  caption = '',
  isMac = false,
  onClick,
}) {
  // While speaking, echo what TARS is saying; while listening, echo what it
  // heard. Both answer "is this thing working?" without the user needing to
  // open the full panel.
  const subtitle = mode === 'speaking' ? caption : transcript;

  const accent =
    mode === 'speaking' ? '#0A84FF'
    : mode === 'thinking' ? '#FF9F0A'
    : '#FFFFFF';

  return (
    <motion.div
      layout
      onClick={onClick}
      initial={{ opacity: 0, y: -14, scale: 0.94 }}
      animate={{ opacity: 1, y: isMac ? 0 : 10, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.94 }}
      transition={SPRING}
      style={{
        WebkitAppRegion: 'drag',
        borderRadius: isMac
          ? '0 0 var(--radius-island) var(--radius-island)'
          : 'var(--radius-island)',
        ...(isMac
          ? {
              background: '#000',
              border: 'none',
              boxShadow: '0 12px 34px rgba(0,0,0,0.6)',
            }
          : {}),
      }}
      className={`${isMac ? '' : 'glass-panel sheen'} relative flex flex-col items-center
                  overflow-hidden cursor-pointer select-none px-5 py-2.5`}
      title="Click to type instead"
    >
      <div className="flex items-center gap-3.5" style={{ WebkitAppRegion: 'no-drag' }}>
        {/* Status orb. The halo only breathes while actually listening — a
            permanently pulsing indicator stops carrying information. */}
        <div className="relative flex items-center justify-center w-[22px] h-[22px] shrink-0">
          {mode === 'listening' && (
            <span
              aria-hidden
              className="absolute inset-[-6px] rounded-full"
              style={{ background: accent, opacity: 0.5, animation: 'halo 2.4s ease-in-out infinite' }}
            />
          )}
          {mode === 'thinking' && (
            <span
              aria-hidden
              className="absolute inset-[-6px] rounded-full"
              style={{
                background: `conic-gradient(from 0deg, transparent, ${accent}, transparent)`,
                animation: 'orbit 1.1s linear infinite',
              }}
            />
          )}
          <span
            className="relative flex items-center justify-center w-[22px] h-[22px] rounded-full soft-raised"
            style={{ color: accent }}
          >
            <Mic size={12} strokeWidth={2.4} />
          </span>
        </div>

        {/* Reserve the physical notch width on macOS so nothing renders behind
            the cutout. Tune to your specific MacBook if needed. */}
        {isMac && <div aria-hidden className="w-[168px] shrink-0" />}

        <AudioVisualizer
          getSpectrum={getSpectrum}
          mode={mode}
          color={accent}
          width={124}
          height={22}
          barCount={24}
        />

        <span className="shrink-0 text-[11.5px] font-medium tracking-wide text-label-secondary">
          {MODE_COPY[mode]}
        </span>
      </div>

      {/* Live caption. Height is animated so the island grows into it instead
          of jumping. */}
      <AnimatePresence>
        {subtitle && (
          <motion.div
            key="subtitle"
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={SPRING}
            className="max-w-[440px] overflow-hidden"
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <p
              className={`text-[12.5px] leading-snug text-center line-clamp-2 ${
                mode === 'speaking' ? 'text-label' : 'text-label-secondary italic'
              }`}
            >
              {subtitle}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
