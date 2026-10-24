/**
 * Shooting stars: small and rare — one every `minGap`–`maxGap` seconds at a random position and angle, with a short
 * tail that fades quickly. A painter (not its own canvas) so the sky stays a single composited layer: the starfield
 * calls `step()` after drawing its stars, full effects only.
 */
interface Meteor { x: number; y: number; vx: number; vy: number; life: number; tail: number }

export interface ShootingStars {
  step: (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, rgb: string) => void;
}

export function createShootingStars(minGap = 6, maxGap = 14, intensity = 1): ShootingStars {
  let meteor: Meteor | null = null;
  // the first one comes a little sooner
  let wait = minGap * 0.5 + Math.random() * (maxGap - minGap);
  return {
    step(ctx, w, h, dt, rgb) {
      if (!meteor) {
        wait -= dt;
        if (wait > 0) return;
        // random start in the upper part of the sky, heading down-left or down-right at 20–45°
        const dir = Math.random() < 0.5 ? -1 : 1;
        const ang = (20 + Math.random() * 25) * (Math.PI / 180);
        const speed = 380 + Math.random() * 260;
        meteor = {
          x: w * (0.15 + Math.random() * 0.7), y: h * Math.random() * 0.6,
          vx: Math.cos(ang) * speed * dir, vy: Math.sin(ang) * speed,
          life: 1, tail: 0.07 + Math.random() * 0.06,
        };
        wait = minGap + Math.random() * (maxGap - minGap);
      }
      const m = meteor;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt * 1.6;
      if (m.life <= 0 || m.x < -50 || m.x > w + 50 || m.y > h + 50) { meteor = null; return; }
      const a = Math.sin(Math.PI * Math.min(1, m.life)) * 0.75 * intensity;
      const tx = m.x - m.vx * m.tail, ty = m.y - m.vy * m.tail;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(${rgb}, ${a})`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = `rgba(${rgb}, ${a})`;
      ctx.fillRect(m.x - 0.75, m.y - 0.75, 1.5, 1.5);
    },
  };
}
