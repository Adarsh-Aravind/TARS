import React, { useEffect, useRef } from 'react';

/**
 * Audio-reactive bar visualiser.
 *
 * Draws whatever `getSpectrum()` returns — mic input while listening, TTS
 * output while speaking. Because it reads live analyser data rather than
 * replaying a fixed keyframe loop, it goes flat when you stop talking, which is
 * the entire point: it tells you TARS is genuinely hearing you.
 *
 * Rendering runs on a canvas rather than animated DOM nodes. 24 bars at 60fps
 * is 1,440 style recalculations a second through the compositor; on a
 * transparent always-on-top window that is visible jank.
 */
export default function AudioVisualizer({
  getSpectrum,
  mode = 'listening',   // 'listening' | 'speaking' | 'thinking'
  width = 132,
  height = 26,
  barCount = 24,
  color,
}) {
  const canvasRef = useRef(null);
  // Displayed values, eased toward the incoming spectrum each frame. Raw
  // analyser output is far too twitchy to render directly.
  const levels = useRef(new Array(barCount).fill(0));
  const phase = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const accent = color || (mode === 'speaking' ? '#0A84FF' : 'rgba(255,255,255,0.92)');
    let frame;

    const render = () => {
      phase.current += 0.05;
      const spectrum = getSpectrum ? getSpectrum() : [];

      ctx.clearRect(0, 0, width, height);

      const gap = 3;
      const barWidth = Math.max(1.5, (width - gap * (barCount - 1)) / barCount);
      const mid = height / 2;

      for (let i = 0; i < barCount; i++) {
        let target = spectrum[i] ?? 0;

        if (mode === 'thinking') {
          // No audio to read while the model works — show a travelling wave so
          // the island still reads as alive rather than frozen.
          target = 0.18 + 0.3 * Math.abs(Math.sin(phase.current - i * 0.28));
        } else {
          // Taper the edges so the shape reads as a considered form rather than
          // a raw meter clipped at both ends.
          const edge = Math.sin((i / (barCount - 1)) * Math.PI);
          target *= 0.35 + 0.65 * edge;
        }

        // Asymmetric easing: rise fast so speech onset feels instant, fall slow
        // so the bars don't strobe between syllables.
        const current = levels.current[i];
        const ease = target > current ? 0.45 : 0.14;
        levels.current[i] = current + (target - current) * ease;

        const value = levels.current[i];
        const barHeight = Math.max(barWidth, value * height);
        const x = i * (barWidth + gap);
        const y = mid - barHeight / 2;

        // Idle bars stay faintly visible so the control never looks broken.
        ctx.globalAlpha = 0.28 + value * 0.72;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frame);
  }, [getSpectrum, mode, width, height, barCount, color]);

  return <canvas ref={canvasRef} aria-hidden className="block" />;
}
