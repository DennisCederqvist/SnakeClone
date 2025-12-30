// Renderer.js – Tron-style + grid + mat + powerups + specials + hazards
import { COLORS } from "./Config.js";
import { PowerUpType } from "./PowerUps.js";

export class Renderer {
  constructor(canvas, cols, rows, cellSize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;

    this.canvas.width = this.cols * this.cellSize;
    this.canvas.height = this.rows * this.cellSize;
  }

  render(state) {
    const ctx = this.ctx;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawGrid();

    ctx.strokeStyle = COLORS.borderStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, this.cols * this.cellSize, this.rows * this.cellSize);

    // Hazards (holes)
    if (state.hazards?.length) {
      for (const h of state.hazards) this.drawHazard(h);
    }

    // Specials (bonus/mirror)
    if (state.specials?.length) {
      for (const s of state.specials) this.drawSpecial(s);
    }

    // Regular powerups
    if (state.powerUps?.length) {
      for (const p of state.powerUps) this.drawPowerUp(p);
    }

    // Food
    if (state.foods?.length) {
      for (const food of state.foods) {
        const fx = (food.x + 0.5) * this.cellSize;
        const fy = (food.y + 0.5) * this.cellSize;

        const rOuter = Math.max(4, this.cellSize * 0.30);
        const rInner = Math.max(2, this.cellSize * 0.14);

        ctx.save();

        ctx.beginPath();
        ctx.arc(fx, fy, rOuter, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 255, 255, 0.18)";
        ctx.shadowColor = "rgba(0, 255, 255, 0.8)";
        ctx.shadowBlur = Math.max(6, this.cellSize * 0.6);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(fx, fy, rInner, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200, 255, 255, 0.95)";
        ctx.fill();

        ctx.restore();
      }
    }

    // Snakes
    if (state.snakes?.length) {
      for (const snake of state.snakes) {
        const segments = snake.segments;
        if (!segments || segments.length < 2) continue;

        const toPx = (p) => ({
          x: (p.x + 0.5) * this.cellSize,
          y: (p.y + 0.5) * this.cellSize,
        });

        const points = segments.map(toPx);
        const ortho = this._makeOrthoPath(points);

        // Default = singleplayer cyan (original)
        const glow = snake.mpColorGlow ?? "rgba(0, 255, 255, 0.85)";
        const core = snake.mpColorBody ?? "rgba(200, 255, 255, 0.95)";

        ctx.save();

        ctx.beginPath();
        ctx.moveTo(ortho[0].x, ortho[0].y);
        for (let i = 1; i < ortho.length; i++) ctx.lineTo(ortho[i].x, ortho[i].y);

        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
        ctx.miterLimit = 2;

        ctx.strokeStyle = "rgba(0, 255, 255, 0.22)";
        ctx.lineWidth = Math.max(2, this.cellSize * 0.34);
        ctx.shadowColor = glow;
        ctx.shadowBlur = Math.max(6, this.cellSize * 0.7);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(2, this.cellSize * 0.16);
        ctx.stroke();

        ctx.restore();

        const headPx = toPx(segments[0]);

        let angle = 0;
        if (segments.length >= 2) {
          const h = segments[0];
          const n = segments[1];
          angle = Math.atan2(h.y - n.y, h.x - n.x);
        }

        const headW = this.cellSize * 0.60;
        const headH = this.cellSize * 0.34;
        const radius = Math.max(4, this.cellSize * 0.18);

        ctx.save();
        ctx.translate(headPx.x, headPx.y);
        ctx.rotate(angle);

        ctx.shadowColor = glow;
        ctx.shadowBlur = Math.max(6, this.cellSize * 0.6);

        ctx.fillStyle = "rgba(0, 255, 255, 0.28)";
        ctx.strokeStyle = core;
        ctx.lineWidth = 2;

        roundRect(ctx, -headW / 2, -headH / 2, headW, headH, radius);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
        roundRect(
          ctx,
          -headW / 2 + 3,
          -headH / 2 + 3,
          headW * 0.35,
          headH - 6,
          Math.max(3, radius * 0.65)
        );
        ctx.fill();

        ctx.restore();
      }
    }
  }

  drawHazard(h) {
    const ctx = this.ctx;
    const x = (h.x + 0.5) * this.cellSize;
    const y = (h.y + 0.5) * this.cellSize;

    const rOuter = Math.max(6, this.cellSize * 0.30);
    const rInner = Math.max(3, this.cellSize * 0.16);

    ctx.save();

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(x, y, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 60, 60, 0.10)";
    ctx.shadowColor = "rgba(255, 60, 60, 0.65)";
    ctx.shadowBlur = Math.max(6, this.cellSize * 0.55);
    ctx.fill();

    // Dark core "hole"
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, rInner, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fill();

    // Small highlight
    ctx.beginPath();
    ctx.arc(x - rInner * 0.25, y - rInner * 0.25, Math.max(2, rInner * 0.25), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();

    ctx.restore();
  }

  drawSpecial(s) {
    // Bonus & Mirror ritas som “diamant”-rutor men med egen färg
    const ctx = this.ctx;
    const px = (s.x + 0.5) * this.cellSize;
    const py = (s.y + 0.5) * this.cellSize;

    let glow = "rgba(0,255,0,0.85)";
    let fill = "rgba(0,255,0,0.18)";
    let core = "rgba(220,255,220,0.95)";

    if (s.type === PowerUpType.BONUS || s.type === "bonus") {
      glow = "rgba(0, 255, 120, 0.85)";
      fill = "rgba(0, 255, 120, 0.16)";
      core = "rgba(220, 255, 235, 0.95)";
    } else if (s.type === PowerUpType.MIRROR || s.type === "mirror") {
      glow = "rgba(255, 0, 255, 0.90)";
      fill = "rgba(255, 0, 255, 0.16)";
      core = "rgba(255, 225, 255, 0.98)";
    }

    let r = Math.max(5, this.cellSize * 0.22);

    if (s.type === PowerUpType.BONUS || s.type === "bonus") {
      r = Math.max(7, this.cellSize * 0.30);   // större bonus
    } else if (s.type === PowerUpType.MIRROR || s.type === "mirror") {
      r = Math.max(6, this.cellSize * 0.22);   // normal mirror (eller justera)
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 4);

    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = Math.max(6, this.cellSize * 0.6);
    ctx.fillRect(-r, -r, r * 2, r * 2);

    ctx.shadowBlur = 0;
    ctx.fillStyle = core;
    ctx.fillRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.9);

    ctx.restore();
  }

  drawPowerUp(p) {
    const ctx = this.ctx;

    const px = (p.x + 0.5) * this.cellSize;
    const py = (p.y + 0.5) * this.cellSize;

    let glow = "rgba(255,255,0,0.85)";
    let fill = "rgba(255,255,0,0.20)";
    let core = "rgba(255,255,220,0.95)";

    if (p.type === PowerUpType.SPEED) {
      glow = "rgba(255, 255, 0, 0.85)";
      fill = "rgba(255, 255, 0, 0.18)";
      core = "rgba(255, 255, 220, 0.95)";
    } else if (p.type === PowerUpType.SLOW) {
      glow = "rgba(0, 140, 255, 0.85)";
      fill = "rgba(0, 140, 255, 0.18)";
      core = "rgba(210, 240, 255, 0.95)";
    } else if (p.type === PowerUpType.GHOST) {
      glow = "rgba(180, 90, 255, 0.85)";
      fill = "rgba(180, 90, 255, 0.18)";
      core = "rgba(240, 220, 255, 0.95)";
    } else if (p.type === PowerUpType.SHRINK) {
      glow = "rgba(255, 0, 0, 0.85)";
      fill = "rgba(175, 90, 255, 0.36)";
      core = "rgba(95, 169, 253, 0.95)";
    }

    const r = Math.max(5, this.cellSize * 0.22);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 4);

    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = Math.max(6, this.cellSize * 0.6);
    ctx.fillRect(-r, -r, r * 2, r * 2);

    ctx.shadowBlur = 0;
    ctx.fillStyle = core;
    ctx.fillRect(-r * 0.45, -r * 0.45, r * 0.9, r * 0.9);

    ctx.restore();
  }

  drawGrid() {
    const ctx = this.ctx;

    ctx.save();

    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.strokeStyle = COLORS.gridLine ?? "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.shadowColor = COLORS.gridGlow ?? "rgba(0, 255, 255, 0.12)";
    ctx.shadowBlur = Math.max(2, this.cellSize * 0.12);

    for (let c = 0; c < this.cols; c++) {
      const x = (c + 0.5) * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let r = 0; r < this.rows; r++) {
      const y = (r + 0.5) * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  _makeOrthoPath(points) {
    if (!points || points.length < 2) return points ?? [];
    const ortho = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const prev = ortho[ortho.length - 1];
      const cur = points[i];

      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;

      if (dx !== 0 && dy !== 0) {
        const before = ortho.length >= 2 ? ortho[ortho.length - 2] : null;

        if (before) {
          const lastDx = prev.x - before.x;
          const lastDy = prev.y - before.y;

          if (lastDx !== 0) ortho.push({ x: cur.x, y: prev.y });
          else if (lastDy !== 0) ortho.push({ x: prev.x, y: cur.y });
          else ortho.push({ x: cur.x, y: prev.y });
        } else {
          ortho.push({ x: cur.x, y: prev.y });
        }
      }

      ortho.push(cur);
    }

    return ortho;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
