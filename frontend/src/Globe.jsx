import React, { useEffect, useRef } from 'react';

export default function Globe({ isListening, isProcessing }) {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Scale for high DPI
    const dpr = window.devicePixelRatio || 1;
    const size = 120; // 60px radius
    
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    
    ctx.scale(dpr, dpr);
    
    let animationFrameId;
    let time = 0;
    
    const render = () => {
      // Speed changes based on state
      const speed = isProcessing ? 0.05 : isListening ? 0.02 : 0.005;
      time += speed;
      
      ctx.clearRect(0, 0, size, size);
      
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2 - 2;
      
      // Pulse effect
      const pulse = isListening ? Math.sin(time * 2) * 2 : 0;
      const currentR = r + pulse;
      
      ctx.strokeStyle = isProcessing 
        ? 'rgba(251, 191, 36, 0.6)' // amber
        : isListening 
        ? 'rgba(244, 114, 182, 0.8)' // pink
        : 'rgba(255, 255, 255, 0.3)'; // white
      
      ctx.lineWidth = 1;
      
      // Draw outer circle
      ctx.beginPath();
      ctx.arc(cx, cy, currentR, 0, Math.PI * 2);
      ctx.stroke();
      
      // Draw latitudes (horizontal ellipses)
      for (let i = 1; i < 5; i++) {
        const yOffset = (i / 5) * currentR;
        const width = Math.sqrt(currentR * currentR - yOffset * yOffset);
        
        ctx.beginPath();
        ctx.ellipse(cx, cy - yOffset, width, width * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.ellipse(cx, cy + yOffset, width, width * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Draw longitudes (vertical ellipses)
      for (let i = 0; i < 6; i++) {
        const angle = time + (i * Math.PI) / 6;
        const width = Math.abs(Math.cos(angle) * currentR);
        
        ctx.beginPath();
        ctx.ellipse(cx, cy, width, currentR, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      animationFrameId = requestAnimationFrame(render);
    };
    
    render();
    
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isListening, isProcessing]);
  
  return (
    <div className="flex justify-center items-start w-full pointer-events-none absolute top-full left-0 z-0 overflow-hidden h-[60px]">
      <div className="relative -top-[60px]">
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
  );
}
