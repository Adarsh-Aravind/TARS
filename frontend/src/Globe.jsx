import React, { useEffect, useRef } from 'react';

export default function Globe({ isListening = false, isProcessing = false }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const anglesRef = useRef({ x: 0.5, y: 0.5, z: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width;
    let height = canvas.height;
    
    // Support high DPI screens
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let time = 0;
    const numLatitudes = 9;   // parallel rings
    const numLongitudes = 9;  // meridian rings
    const pointsPerRing = 48; // smoothness of each ring

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      time += 0.015;

      // Base radius of the globe
      let baseRadius = 90;
      
      // Calculate dynamic pulsation based on state
      let pulse = Math.sin(time * 2.5) * 4;
      if (isListening) {
        // High frequency erratic pulse for listening
        pulse = Math.sin(time * 8) * 8 + (Math.random() - 0.5) * 4;
      } else if (isProcessing) {
        // Smooth fast pulse for processing
        pulse = Math.sin(time * 5.0) * 6;
      }
      
      const radius = baseRadius + pulse;

      // Update rotation angles
      if (isListening) {
        anglesRef.current.y += 0.012; // rotate faster when listening
        anglesRef.current.x += 0.003;
      } else if (isProcessing) {
        anglesRef.current.y += 0.025; // rotate fast when processing
        anglesRef.current.x += 0.005;
      } else {
        anglesRef.current.y += 0.004; // slow elegant idle rotation
        anglesRef.current.x = 0.4 + Math.sin(time * 0.5) * 0.1; // slow vertical nod
      }

      const { x: rx, y: ry } = anglesRef.current;
      const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
      const cosRy = Math.cos(ry), sinRy = Math.sin(ry);

      const centerX = width / 2;
      const centerY = height / 2;

      // Perspective variables
      const fov = 350; // field of view

      // We collect all lines to draw, so we can sort them by depth (Z-ordering)
      // or at least render them with appropriate opacity.
      // To make it look extremely high-tech, we draw rings in two passes:
      // back lines first (z < 0) with low opacity, front lines (z >= 0) with high opacity.
      const lines = [];

      // Helper to project 3D point to 2D
      const project = (lat, lon) => {
        // Spherical coordinates
        const phi = (lat * Math.PI) / 180;
        const theta = (lon * Math.PI) / 180;

        // Apply audio wave distortions to sphere surface if listening
        let r = radius;
        if (isListening) {
          // Distort coordinates along bands to simulate audio waves ripples
          r += Math.sin(phi * 6 + time * 10) * Math.cos(theta * 6 + time * 8) * 5;
        }

        const x3d = r * Math.sin(phi) * Math.cos(theta);
        const y3d = r * Math.cos(phi);
        const z3d = r * Math.sin(phi) * Math.sin(theta);

        // Rotate Y
        let x1 = x3d * cosRy - z3d * sinRy;
        let z1 = x3d * sinRy + z3d * cosRy;

        // Rotate X
        let y2 = y3d * cosRx - z1 * sinRx;
        let z2 = y3d * sinRx + z1 * cosRx;

        // Perspective scaling
        const scale = fov / (fov + z2);
        const x2d = centerX + x1 * scale;
        const y2d = centerY + y2 * scale;

        return { x: x2d, y: y2d, z: z2 };
      };

      // Draw latitude rings (horizontal bands)
      for (let i = 1; i < numLatitudes; i++) {
        const lat = (i * 180) / numLatitudes; // 0 to 180
        const ringPoints = [];
        for (let j = 0; j <= pointsPerRing; j++) {
          const lon = (j * 360) / pointsPerRing;
          ringPoints.push(project(lat, lon));
        }
        lines.push(ringPoints);
      }

      // Draw longitude rings (vertical segments)
      for (let i = 0; i < numLongitudes; i++) {
        const lon = (i * 360) / numLongitudes;
        const ringPoints = [];
        // Loop a full circle for each longitude line
        for (let j = 0; j <= pointsPerRing; j++) {
          const lat = (j * 180) / pointsPerRing;
          ringPoints.push(project(lat, lon));
        }
        lines.push(ringPoints);
      }

      // Draw a subtle outer halo vector ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 1.05, 0, 2 * Math.PI);
      ctx.strokeStyle = isListening 
        ? 'rgba(255, 255, 255, 0.15)' 
        : 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Render lines: We separate into back lines and front lines for realistic overlay
      // 1. Draw back segments first (fainter)
      ctx.lineWidth = 0.8;
      lines.forEach((points) => {
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          // If both points are in the background (z > 0 in this coordinate system, since larger z is away from camera)
          if (p1.z > 0 && p2.z > 0) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            // Back opacity
            const opacity = Math.max(0.04, 0.18 * (1 - (p1.z + p2.z) / (2 * radius)));
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.stroke();
          }
        }
      });

      // 2. Draw front segments (brighter white with glow)
      ctx.lineWidth = 1.2;
      lines.forEach((points) => {
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          // If at least one point is in the foreground (z <= 0)
          if (p1.z <= 0 || p2.z <= 0) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            // Front opacity (closer = brighter)
            const opacity = Math.min(0.85, 0.3 + 0.55 * (1 - (p1.z + p2.z) / (2 * -radius)));
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.stroke();
          }
        }
      });

      // Standard animation frame loop
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isListening, isProcessing]);

  return (
    <div className="relative flex items-center justify-center w-[300px] h-[300px] select-none cursor-pointer group">
      {/* 3D Wireframe Canvas */}
      <canvas
        ref={canvasRef}
        className="w-[300px] h-[300px] glow-globe transition-transform duration-500 ease-out group-hover:scale-105"
        style={{ width: '300px', height: '300px' }}
      />
      
      {/* Neumorphic shadow underneath the sphere */}
      <div 
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[160px] h-[16px] rounded-full blur-md bg-black/60 pointer-events-none transition-all duration-500"
        style={{
          boxShadow: '0 12px 24px rgba(0, 0, 0, 0.95), 0 0 10px rgba(255,255,255,0.01)',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 70%)'
        }}
      />
    </div>
  );
}
