"use client";

import { useEffect, useRef } from "react";

type Particle = {
  homeX: number;
  homeY: number;
  driftAmp: number;
  driftSpeed: number;
  phase: number;
  size: number;
  alpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

/**
 * 夜空粒子层：布满白色发光微粒，鼠标划过时被推开，移开后弹回原位。
 * 监听挂在父容器上（事件冒泡），canvas 自身不拦截任何指针事件。
 */
export function ParticleField({
  className,
  density = 1800,
  maxCount = 340,
}: {
  className?: string;
  density?: number;
  maxCount?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let raf = 0;
    const mouse = { x: -9999, y: -9999, active: false };
    const REPEL_RADIUS = 130;

    // 发光贴图只画一次，循环里反复 drawImage，比逐粒 shadowBlur 便宜得多
    const sprite = document.createElement("canvas");
    sprite.width = 32;
    sprite.height = 32;
    const spriteCtx = sprite.getContext("2d");
    if (spriteCtx) {
      const glow = spriteCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
      glow.addColorStop(0, "rgba(255,255,255,0.95)");
      glow.addColorStop(0.25, "rgba(222,236,255,0.55)");
      glow.addColorStop(1, "rgba(190,214,255,0)");
      spriteCtx.fillStyle = glow;
      spriteCtx.fillRect(0, 0, 32, 32);
    }

    const spawn = () => {
      const count = Math.min(
        maxCount,
        Math.max(70, Math.round((width * height) / density)),
      );
      particles = Array.from({ length: count }, () => {
        const homeX = Math.random() * width;
        const homeY = Math.random() * height;
        return {
          homeX,
          homeY,
          driftAmp: 3 + Math.random() * 8,
          driftSpeed: 0.15 + Math.random() * 0.35,
          phase: Math.random() * Math.PI * 2,
          size: 0.7 + Math.random() * 1.7,
          alpha: 0.3 + Math.random() * 0.55,
          twinkleSpeed: 0.5 + Math.random() * 1.4,
          twinklePhase: Math.random() * Math.PI * 2,
          x: homeX,
          y: homeY,
          vx: 0,
          vy: 0,
        };
      });
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn();
      if (reduced) draw(0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        const homeX = p.homeX + Math.sin(time * p.driftSpeed + p.phase) * p.driftAmp;
        const homeY =
          p.homeY + Math.cos(time * p.driftSpeed * 0.8 + p.phase) * p.driftAmp;
        if (!reduced) {
          // 弹簧回位 + 阻尼，叠加鼠标斥力
          let ax = (homeX - p.x) * 0.018;
          let ay = (homeY - p.y) * 0.018;
          if (mouse.active) {
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < REPEL_RADIUS * REPEL_RADIUS) {
              const dist = Math.sqrt(distSq) || 1;
              const force = (1 - dist / REPEL_RADIUS) * 2.6;
              ax += (dx / dist) * force;
              ay += (dy / dist) * force;
            }
          }
          p.vx = (p.vx + ax) * 0.9;
          p.vy = (p.vy + ay) * 0.9;
          p.x += p.vx;
          p.y += p.vy;
        } else {
          p.x = homeX;
          p.y = homeY;
        }
        const twinkle = reduced
          ? 1
          : 0.65 + 0.35 * Math.sin(time * p.twinkleSpeed + p.twinklePhase);
        const s = p.size * 4;
        ctx.globalAlpha = p.alpha * twinkle;
        ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    };

    const loop = (time: number) => {
      draw(time / 1000);
      raf = requestAnimationFrame(loop);
    };

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      mouse.x = x;
      mouse.y = y;
      mouse.active = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    };
    const onLeave = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    if (!reduced) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [density, maxCount]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
