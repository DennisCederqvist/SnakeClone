// Renderer.js – ansvarar för att rita spelplan, mat och alla ormar (Tron-style, sharp 90° turns)

import { COLORS } from "./Config.js";

export class Renderer {
  constructor(canvas, cols, rows, cellSize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;

    // Sätt canvas storlek efter grid
    this.canvas.width = this.cols * this.cellSize;
    this.canvas.height = this.rows * this.cellSize;
  }

  render(state) {
    const ctx = this.ctx;

    // Bakgrund
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Ram runt spelplanen
    ctx.strokeStyle = COLORS.borderStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, this.cols * this.cellSize, this.rows * this.cellSize);

    // === MAT (neon-orb) ===
    if (state.foods && state.foods.length > 0) {
      for (const food of state.foods) {
        const fx = (food.x + 0.5) * this.cellSize;
        const fy = (food.y + 0.5) * this.cellSize;

        const rOuter = Math.max(4, this.cellSize * 0.30);
        const rInner = Math.max(2, this.cellSize * 0.14);

        ctx.save();

        // yttre glow
        ctx.beginPath();
        ctx.arc(fx, fy, rOuter, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 255, 255, 0.18)";
        ctx.shadowColor = "rgba(0, 255, 255, 0.8)";
        ctx.shadowBlur = Math.max(6, this.cellSize * 0.6);
        ctx.fill();

        // inre kärna
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(fx, fy, rInner, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200, 255, 255, 0.95)";
        ctx.fill();

        ctx.restore();
      }
    }

    // === ORMAR (Tron trail + head) ===
    if (state.snakes && state.snakes.length > 0) {
      for (const snake of state.snakes) {
        const segments = snake.segments;
        if (!segments || segments.length < 2) continue;

        const toPx = (p) => ({
          x: (p.x + 0.5) * this.cellSize,
          y: (p.y + 0.5) * this.cellSize,
        });

        // --- TRAIL (Tron: alltid 90° hörn, inga diagonaler) ---
        const points = segments.map(toPx);
        const ortho = this._makeOrthoPath(points);

        ctx.save();

        ctx.beginPath();
        ctx.moveTo(ortho[0].x, ortho[0].y);
        for (let i = 1; i < ortho.length; i++) {
          ctx.lineTo(ortho[i].x, ortho[i].y);
        }

        // Skarpa hörn (retro Tron)
        ctx.lineCap = "butt";     // testa "square" om du vill
        ctx.lineJoin = "miter";   // skarpa 90° hörn
        ctx.miterLimit = 2;

        // Yttre glow-lager
        ctx.strokeStyle = "rgba(0, 255, 255, 0.22)";
        ctx.lineWidth = Math.max(2, this.cellSize * 0.34);
        ctx.shadowColor = "rgba(0, 255, 255, 0.85)";
        ctx.shadowBlur = Math.max(6, this.cellSize * 0.7);
        ctx.stroke();

        // Inre kärna (bright line)
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(200, 255, 255, 0.95)";
        ctx.lineWidth = Math.max(2, this.cellSize * 0.16);
        ctx.stroke();

        ctx.restore();

        // --- HEAD (liten lightcycle) ---
        const headPx = toPx(segments[0]);

        // Räkna ut riktning utifrån första två segmenten
        // (förväntar sig grid-steg, men funkar även med interpolation)
        let angle = 0;
        if (segments.length >= 2) {
          const h = segments[0];
          const n = segments[1];
          const dx = h.x - n.x;
          const dy = h.y - n.y;
          angle = Math.atan2(dy, dx);
        }

        const headW = this.cellSize * 0.60;
        const headH = this.cellSize * 0.34;
        const radius = Math.max(4, this.cellSize * 0.18);

        ctx.save();
        ctx.translate(headPx.x, headPx.y);
        ctx.rotate(angle);

        // Glow runt head
        ctx.shadowColor = "rgba(0, 255, 255, 0.9)";
        ctx.shadowBlur = Math.max(6, this.cellSize * 0.6);

        // Body
        ctx.fillStyle = "rgba(0, 255, 255, 0.28)";
        ctx.strokeStyle = "rgba(200, 255, 255, 0.95)";
        ctx.lineWidth = 2;

        roundRect(ctx, -headW / 2, -headH / 2, headW, headH, radius);
        ctx.fill();

        // Stroke utan extra blur (krispigt)
        ctx.shadowBlur = 0;
        ctx.stroke();

        // Liten highlight/visor
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

  /**
   * Bygger en ortogonal (endast horisontell/vertikal) punktlista från input.
   * Om två punkter är diagonala (både x och y skiljer), så lägger vi in ett L-hörn.
   */
  _makeOrthoPath(points) {
    if (!points || points.length < 2) return points ?? [];

    const ortho = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const prev = ortho[ortho.length - 1];
      const cur = points[i];

      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;

      // diagonal => lägg in ett L-hörn
      if (dx !== 0 && dy !== 0) {
        const before = ortho.length >= 2 ? ortho[ortho.length - 2] : null;

        if (before) {
          const lastDx = prev.x - before.x;
          const lastDy = prev.y - before.y;

          // kom vi in horisontellt? gå horisontellt först
          if (lastDx !== 0) {
            ortho.push({ x: cur.x, y: prev.y });
          } else if (lastDy !== 0) {
            // kom vi in vertikalt? gå vertikalt först
            ortho.push({ x: prev.x, y: cur.y });
          } else {
            // fallback
            ortho.push({ x: cur.x, y: prev.y });
          }
        } else {
          // fallback: horisontellt först
          ortho.push({ x: cur.x, y: prev.y });
        }
      }

      ortho.push(cur);
    }

    return ortho;
  }
}

// Helper: rundad rektangel (egen implementation för kompatibilitet)
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
