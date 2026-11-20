/**
 * charts.js — High-DPI Interactive Scientific Charting Engine for Taller 5
 * Zero external dependencies: Canvas 2D + SVG, crisp Retina scaling, interactive tooltips,
 * dual Y-axis, shaded phases, error bars, jittered boxplots, heatmaps & Markov SVG.
 */

(function () {
  const tooltipEl = () => document.getElementById("chart-tooltip");

  function showTooltip(evt, html) {
    const tt = tooltipEl();
    if (!tt) return;
    tt.innerHTML = html;
    tt.style.display = "block";
    const pad = 14;
    const rect = tt.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 10) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 10) y = evt.clientY - rect.height - pad;
    tt.style.left = Math.max(8, x) + "px";
    tt.style.top = Math.max(8, y) + "px";
  }

  function hideTooltip() {
    const tt = tooltipEl();
    if (tt) tt.style.display = "none";
  }

  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width || 560));
    const h = Math.max(180, Math.floor(rect.height || 300));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function bindHover(canvas, onMove, onLeave, onClick) {
    if (canvas._t5Handlers) {
      canvas.removeEventListener("mousemove", canvas._t5Handlers.move);
      canvas.removeEventListener("mouseleave", canvas._t5Handlers.leave);
      if (canvas._t5Handlers.click) canvas.removeEventListener("click", canvas._t5Handlers.click);
    }
    const move = (e) => {
      const rect = canvas.getBoundingClientRect();
      onMove(e, e.clientX - rect.left, e.clientY - rect.top);
    };
    const leave = () => {
      hideTooltip();
      if (onLeave) onLeave();
    };
    const click = onClick
      ? (e) => {
          const rect = canvas.getBoundingClientRect();
          onClick(e, e.clientX - rect.left, e.clientY - rect.top);
        }
      : null;
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseleave", leave);
    if (click) canvas.addEventListener("click", click);
    canvas._t5Handlers = { move, leave, click };
  }

  function niceTicks(minVal, maxVal, count = 5) {
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return [0, 1];
    if (Math.abs(maxVal - minVal) < 1e-9) {
      return [minVal - 1, minVal, minVal + 1];
    }
    const step = (maxVal - minVal) / count;
    const ticks = [];
    for (let i = 0; i <= count; i++) ticks.push(minVal + step * i);
    return ticks;
  }

  function drawStar(ctx, cx, cy, r, fill, stroke = "#0f253c") {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================================
  // 1. INTERACTIVE MULTI-LINE CHART (with dual Y-axis, phases, stars, crosshair)
  // =========================================================================
  function renderLineChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderLineChart(canvas, cfg);

    const series = cfg.series || [];
    const rightSeries = cfg.rightSeries || [];
    const hasRight = rightSeries.length > 0;
    const nPts = Math.max(
      1,
      ...series.map((s) => (s.values ? s.values.length : 0)),
      ...rightSeries.map((s) => (s.values ? s.values.length : 0))
    );
    const xStart = cfg.xStart ?? 1;

    // Auto Y bounds
    let yMin = cfg.yMin;
    let yMax = cfg.yMax;
    if (yMin == null || yMax == null) {
      const allV = series.flatMap((s) => s.values || []).filter(Number.isFinite);
      const lo = allV.length ? Math.min(...allV) : 0;
      const hi = allV.length ? Math.max(...allV) : 1;
      const pad = Math.max((hi - lo) * 0.1, 0.05);
      if (yMin == null) yMin = lo - pad;
      if (yMax == null) yMax = hi + pad;
    }

    let ryMin = cfg.ryMin;
    let ryMax = cfg.ryMax;
    if (hasRight && (ryMin == null || ryMax == null)) {
      const allR = rightSeries.flatMap((s) => s.values || []).filter(Number.isFinite);
      const lo = allR.length ? Math.min(...allR) : -1;
      const hi = allR.length ? Math.max(...allR) : 1;
      const pad = Math.max((hi - lo) * 0.12, 0.08);
      if (ryMin == null) ryMin = lo - pad;
      if (ryMax == null) ryMax = hi + pad;
    }

    let hoverIdx = null;

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const legendItems = [...series, ...rightSeries];
      const legendRows = Math.ceil(legendItems.length / Math.max(1, Math.floor((w - 60) / 185)));
      const topPad = 14 + (cfg.hideLegend ? 0 : Math.min(legendRows, 3) * 18 + 6);
      const pad = {
        left: cfg.padLeft ?? 54,
        right: hasRight ? 54 : 18,
        top: topPad,
        bottom: 38,
      };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;

      const xOf = (i) => pad.left + (nPts <= 1 ? pw / 2 : (i / (nPts - 1)) * pw);
      const yOf = (v) => pad.top + ph - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ph;
      const ryOf = (v) => pad.top + ph - ((v - ryMin) / Math.max(1e-9, ryMax - ryMin)) * ph;

      ctx.clearRect(0, 0, w, h);

      // Shaded vertical spans (e.g., 3 phases)
      if (cfg.vSpans) {
        cfg.vSpans.forEach((sp) => {
          const x1 = xOf(Math.max(0, sp.from - xStart));
          const x2 = xOf(Math.min(nPts - 1, sp.to - xStart));
          ctx.fillStyle = sp.color;
          ctx.fillRect(x1, pad.top, x2 - x1, ph);
          if (sp.label) {
            ctx.fillStyle = sp.textColor || "#334155";
            ctx.font = "700 10.5px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(sp.label, (x1 + x2) / 2, pad.top + 14);
          }
        });
      }

      // Gridlines & Left Y-axis ticks
      const yTicks = niceTicks(yMin, yMax, cfg.yTicksCount ?? 5);
      ctx.font = "11px JetBrains Mono, monospace";
      yTicks.forEach((tv) => {
        const y = yOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();

        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(tv.toFixed(cfg.yDecimals ?? 2), pad.left - 8, y);
      });

      // Right Y-axis ticks
      if (hasRight) {
        const rTicks = niceTicks(ryMin, ryMax, 5);
        rTicks.forEach((tv) => {
          const y = ryOf(tv);
          ctx.fillStyle = "#c2410c";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(tv.toFixed(2), pad.left + pw + 7, y);
        });
      }

      // X-axis ticks
      const xStep = Math.max(1, Math.round((nPts - 1) / Math.min(8, Math.max(2, Math.floor(pw / 64)))));
      ctx.fillStyle = "#5b6f86";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < nPts; i += xStep) {
        const x = xOf(i);
        ctx.strokeStyle = "#eef2f7";
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ph);
        ctx.stroke();
        ctx.fillText(String(xStart + i), x, pad.top + ph + 6);
      }
      // Ensure final x label
      if ((nPts - 1) % xStep > xStep * 0.45) {
        ctx.fillText(String(xStart + nPts - 1), xOf(nPts - 1), pad.top + ph + 6);
      }

      // Axes frame
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.left, pad.top, pw, ph);

      // Axis labels
      ctx.fillStyle = "#334155";
      ctx.font = "600 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      if (cfg.xLabel) ctx.fillText(cfg.xLabel, pad.left + pw / 2, h - 3);

      if (cfg.yLabel) {
        ctx.save();
        ctx.translate(13, pad.top + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(cfg.yLabel, 0, 0);
        ctx.restore();
      }
      if (hasRight && cfg.ryLabel) {
        ctx.save();
        ctx.translate(w - 6, pad.top + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#c2410c";
        ctx.fillText(cfg.ryLabel, 0, 0);
        ctx.restore();
      }

      // Horizontal reference lines
      (cfg.hLines || []).forEach((hl) => {
        const y = hl.right ? ryOf(hl.y) : yOf(hl.y);
        if (y < pad.top || y > pad.top + ph) return;
        ctx.save();
        ctx.strokeStyle = hl.color || "#334155";
        ctx.lineWidth = hl.width || 1.2;
        ctx.setLineDash(hl.dash || [4, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        if (hl.label) {
          ctx.fillStyle = hl.color || "#334155";
          ctx.font = "600 10.5px Inter, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(hl.label, pad.left + pw - 6, y - 3);
        }
        ctx.restore();
      });

      // Vertical reference lines
      (cfg.vLines || []).forEach((vl) => {
        const idx = vl.x - xStart;
        if (idx < 0 || idx > nPts - 1) return;
        const x = xOf(idx);
        ctx.save();
        ctx.strokeStyle = vl.color || "#475569";
        ctx.lineWidth = 1.25;
        ctx.setLineDash(vl.dash || [3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ph);
        ctx.stroke();
        if (vl.label) {
          ctx.fillStyle = vl.color || "#334155";
          ctx.font = "600 10.5px Inter, sans-serif";
          ctx.textAlign = x > pad.left + pw * 0.7 ? "right" : "left";
          ctx.textBaseline = "top";
          ctx.fillText(vl.label, x + (x > pad.left + pw * 0.7 ? -4 : 4), pad.top + 4);
        }
        ctx.restore();
      });

      // Highlight active turn marker (from duel scrubber)
      if (cfg.activeTurn != null) {
        const idx = cfg.activeTurn - xStart;
        if (idx >= 0 && idx < nPts) {
          const x = xOf(idx);
          ctx.save();
          ctx.strokeStyle = "#0f253c";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x, pad.top);
          ctx.lineTo(x, pad.top + ph);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw series helper
      function drawSeriesList(list, mapY) {
        list.forEach((s) => {
          const vals = s.values || [];
          if (!vals.length) return;
          ctx.save();
          ctx.beginPath();
          ctx.rect(pad.left, pad.top, pw, ph);
          ctx.clip();

          // Optional area fill
          if (s.fillArea) {
            ctx.beginPath();
            ctx.moveTo(xOf(0), mapY(vals[0]));
            for (let i = 1; i < vals.length; i++) ctx.lineTo(xOf(i), mapY(vals[i]));
            ctx.lineTo(xOf(vals.length - 1), pad.top + ph);
            ctx.lineTo(xOf(0), pad.top + ph);
            ctx.closePath();
            ctx.fillStyle = s.fillArea;
            ctx.fill();
          }

          ctx.strokeStyle = s.color || "#1565c0";
          ctx.lineWidth = s.width || 2.1;
          if (s.dashed) ctx.setLineDash([6, 4]);
          ctx.beginPath();
          vals.forEach((v, i) => {
            const x = xOf(i);
            const y = mapY(v);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.setLineDash([]);

          if (s.markers || vals.length <= 32) {
            ctx.fillStyle = s.color || "#1565c0";
            for (let i = 0; i < vals.length; i++) {
              ctx.beginPath();
              ctx.arc(xOf(i), mapY(vals[i]), s.markerRadius || 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Optional star point (e.g. first D turn vs Defector)
          if (s.starTurn != null && s.starVal != null) {
            const sx = xOf(s.starTurn - xStart);
            const sy = mapY(s.starVal);
            drawStar(ctx, sx, sy, 6.5, s.color || "#1565c0");
            ctx.fillStyle = s.color || "#0f253c";
            ctx.font = "700 10.5px JetBrains Mono, monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "bottom";
            ctx.fillText(`t=${s.starTurn}`, sx + 7, sy - 3);
          }
          ctx.restore();
        });
      }

      drawSeriesList(series, yOf);
      if (hasRight) drawSeriesList(rightSeries, ryOf);

      // Optional text annotations inside chart
      (cfg.annotations || []).forEach((an) => {
        ctx.fillStyle = an.color || "#334155";
        ctx.font = "700 11px Inter, sans-serif";
        ctx.textAlign = an.align || "left";
        ctx.textBaseline = "middle";
        ctx.fillText(an.text, pad.left + pw * an.rx, pad.top + ph * an.ry);
      });

      // Top Legend
      if (!cfg.hideLegend && legendItems.length) {
        let lx = pad.left;
        let ly = 12;
        ctx.font = "600 10.8px Inter, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        legendItems.forEach((s) => {
          const textW = ctx.measureText(s.label).width + 26;
          if (lx + textW > w - 12 && lx > pad.left) {
            lx = pad.left;
            ly += 17;
          }
          ctx.strokeStyle = s.color || "#1565c0";
          ctx.lineWidth = 2.4;
          ctx.save();
          if (s.dashed) ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + 15, ly);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#2c3e50";
          ctx.fillText(s.label, lx + 19, ly);
          lx += textW + 8;
        });
      }

      // Hover crosshair
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < nPts) {
        const hx = xOf(hoverIdx);
        ctx.save();
        ctx.strokeStyle = "rgba(15, 37, 60, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, pad.top);
        ctx.lineTo(hx, pad.top + ph);
        ctx.stroke();
        ctx.restore();

        series.forEach((s) => {
          if (hoverIdx < (s.values || []).length) {
            const hy = yOf(s.values[hoverIdx]);
            if (hy >= pad.top && hy <= pad.top + ph) {
              ctx.beginPath();
              ctx.arc(hx, hy, 4, 0, Math.PI * 2);
              ctx.fillStyle = s.color;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
            }
          }
        });
        rightSeries.forEach((s) => {
          if (hoverIdx < (s.values || []).length) {
            const hy = ryOf(s.values[hoverIdx]);
            if (hy >= pad.top && hy <= pad.top + ph) {
              ctx.beginPath();
              ctx.arc(hx, hy, 4, 0, Math.PI * 2);
              ctx.fillStyle = s.color;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
            }
          }
        });
      }

      canvas._plotMeta = { pad, pw, ph, nPts, xStart };
    }

    draw();

    bindHover(
      canvas,
      (evt, mx, my) => {
        const m = canvas._plotMeta;
        if (!m) return;
        if (mx < m.pad.left || mx > m.pad.left + m.pw || my < m.pad.top || my > m.pad.top + m.ph) {
          if (hoverIdx != null) {
            hoverIdx = null;
            draw();
          }
          hideTooltip();
          return;
        }
        const frac = (mx - m.pad.left) / Math.max(1, m.pw);
        const idx = Math.max(0, Math.min(m.nPts - 1, Math.round(frac * (m.nPts - 1))));
        if (idx !== hoverIdx) {
          hoverIdx = idx;
          draw();
        }
        const xTitle = `${cfg.xTooltipPrefix || "Turno"} ${m.xStart + idx}`;
        const rows = [];
        series.forEach((s) => {
          if (idx < (s.values || []).length) {
            rows.push(
              `<div class="tt-row"><span style="color:${s.color}">● ${s.label}</span><span>${Number(s.values[idx]).toFixed(cfg.tooltipDecimals ?? 3)}</span></div>`
            );
          }
        });
        rightSeries.forEach((s) => {
          if (idx < (s.values || []).length) {
            rows.push(
              `<div class="tt-row"><span style="color:${s.color}">◆ ${s.label}</span><span>${Number(s.values[idx]).toFixed(3)}</span></div>`
            );
          }
        });
        showTooltip(evt, `<div class="tt-title">${xTitle}</div>${rows.join("")}`);
      },
      () => {
        if (hoverIdx != null) {
          hoverIdx = null;
          draw();
        }
      },
      cfg.onPointClick
        ? (evt, mx) => {
            const m = canvas._plotMeta;
            if (!m || mx < m.pad.left || mx > m.pad.left + m.pw) return;
            const frac = (mx - m.pad.left) / Math.max(1, m.pw);
            const idx = Math.max(0, Math.min(m.nPts - 1, Math.round(frac * (m.nPts - 1))));
            cfg.onPointClick(m.xStart + idx);
          }
        : null
    );
  }

  // =========================================================================
  // 2. VERTICAL BAR CHART (Single or Grouped, with error bars & annotations)
  // =========================================================================
  function renderVerticalBarChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderVerticalBarChart(canvas, cfg);

    const categories = cfg.categories || [];
    const groups = cfg.groups || []; // [{ label, color, values: [], stds?: [], tags?: [] }]
    const nCat = categories.length;
    const nGrp = groups.length;
    const yMin = cfg.yMin ?? 0;
    const allVals = groups.flatMap((g) => g.values.map((v, i) => v + (g.stds ? g.stds[i] || 0 : 0)));
    const yMax = cfg.yMax ?? Math.max(1, ...allVals) * 1.18;

    let hitRects = [];

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const showLegend = !cfg.hideLegend && nGrp > 1;
      const pad = { left: 48, right: 16, top: showLegend ? 36 : 18, bottom: cfg.padBottom ?? 52 };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;
      const yOf = (v) => pad.top + ph - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ph;

      ctx.clearRect(0, 0, w, h);
      hitRects = [];

      // Grid
      const yTicks = niceTicks(yMin, yMax, 5);
      ctx.font = "11px JetBrains Mono, monospace";
      yTicks.forEach((tv) => {
        const y = yOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(tv.toFixed(cfg.yDecimals ?? 1), pad.left - 7, y);
      });

      // Bars
      const slotW = pw / Math.max(1, nCat);
      const innerW = slotW * (nGrp === 1 ? 0.64 : 0.78);
      const barW = innerW / Math.max(1, nGrp);

      for (let c = 0; c < nCat; c++) {
        const slotLeft = pad.left + c * slotW + (slotW - innerW) / 2;
        for (let g = 0; g < nGrp; g++) {
          const grp = groups[g];
          const val = grp.values[c] ?? 0;
          const std = grp.stds ? grp.stds[c] || 0 : 0;
          const bx = slotLeft + g * barW;
          const by = yOf(val);
          const bh = Math.max(1, yOf(yMin) - by);
          const col = Array.isArray(grp.colors) ? grp.colors[c] : grp.color;

          ctx.fillStyle = col || "#1565c0";
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(bx + 1, by, Math.max(2, barW - 2), bh, [4, 4, 0, 0]) : ctx.rect(bx + 1, by, Math.max(2, barW - 2), bh);
          ctx.fill();

          if (std > 0) {
            const cx = bx + barW / 2;
            const yTop = yOf(val + std);
            const yBot = yOf(Math.max(yMin, val - std));
            ctx.strokeStyle = "#1e293b";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(cx, yTop);
            ctx.lineTo(cx, yBot);
            ctx.moveTo(cx - 4, yTop);
            ctx.lineTo(cx + 4, yTop);
            ctx.moveTo(cx - 4, yBot);
            ctx.lineTo(cx + 4, yBot);
            ctx.stroke();
          }

          if (cfg.showBarValues) {
            const cx = bx + barW / 2;
            const topY = yOf(val + std) - 4;
            ctx.fillStyle = "#0f253c";
            ctx.font = "700 10px JetBrains Mono, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            const tag = grp.tags && grp.tags[c] ? ` ${grp.tags[c]}` : "";
            ctx.fillText(val.toFixed(cfg.valDecimals ?? 3), cx, topY - (tag ? 11 : 0));
            if (tag) {
              ctx.fillStyle = "#475569";
              ctx.fillText(tag.trim(), cx, topY);
            }
          }

          hitRects.push({
            x: bx,
            y: by - 8,
            w: barW,
            h: bh + 8,
            cat: categories[c].replace(/\n/g, " "),
            group: grp.label || "",
            val,
            std,
            tag: grp.tags ? grp.tags[c] : "",
            color: col,
          });
        }

        // Category label (multiline support)
        const lines = String(categories[c]).split("\n");
        ctx.fillStyle = "#334155";
        ctx.font = "600 10.5px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        lines.forEach((ln, li) => {
          ctx.fillText(ln, pad.left + c * slotW + slotW / 2, pad.top + ph + 6 + li * 13);
        });

        // Optional per-category top badge (e.g. pi_0 = C)
        if (cfg.categoryTags && cfg.categoryTags[c]) {
          const maxInCat = Math.max(...groups.map((g) => g.values[c] || 0));
          ctx.fillStyle = "#0f3a66";
          ctx.font = "700 10.8px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(cfg.categoryTags[c], pad.left + c * slotW + slotW / 2, yOf(maxInCat) - 5);
        }
      }

      // Horizontal reference line (e.g. Tit For Tat 2.560)
      (cfg.hLines || []).forEach((hl) => {
        const y = yOf(hl.y);
        ctx.save();
        ctx.strokeStyle = hl.color || "#0f253c";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        if (hl.label) {
          ctx.fillStyle = hl.color || "#0f253c";
          ctx.font = "600 10.5px Inter, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(hl.label, pad.left + pw - 4, y - 3);
        }
        ctx.restore();
      });

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(pad.left, pad.top, pw, ph);

      if (cfg.yLabel) {
        ctx.save();
        ctx.translate(13, pad.top + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = "#334155";
        ctx.font = "600 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(cfg.yLabel, 0, 0);
        ctx.restore();
      }

      if (showLegend) {
        let lx = pad.left;
        const ly = 13;
        ctx.font = "600 10.8px Inter, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        groups.forEach((g) => {
          const tw = ctx.measureText(g.label).width + 24;
          ctx.fillStyle = g.color;
          ctx.fillRect(lx, ly - 5, 11, 10);
          ctx.fillStyle = "#2c3e50";
          ctx.fillText(g.label, lx + 15, ly);
          lx += tw + 8;
        });
      }
    }

    draw();

    bindHover(canvas, (evt, mx, my) => {
      const hit = hitRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
      if (!hit) {
        hideTooltip();
        return;
      }
      const stdTxt = hit.std > 0 ? ` ± ${hit.std.toFixed(3)}` : "";
      const tagTxt = hit.tag ? `<div class="tt-row"><span>Posición</span><span>${hit.tag}</span></div>` : "";
      showTooltip(
        evt,
        `<div class="tt-title">${hit.cat}</div>
         <div class="tt-row"><span style="color:${hit.color}">■ ${hit.group || "Valor"}</span><span>${hit.val.toFixed(3)}${stdTxt}</span></div>
         ${tagTxt}`
      );
    });
  }

  // =========================================================================
  // 3. HORIZONTAL RANKING BAR CHART (Axelrod 1980, Harper 41, Mega 175)
  // =========================================================================
  function renderHorizontalBarChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderHorizontalBarChart(canvas, cfg);

    const items = cfg.items || []; // [{ label, value, std, color, bold, meta }]
    const xMin = cfg.xMin ?? 0;
    const xMax = cfg.xMax ?? 3.2;
    let hitRows = [];

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = { left: cfg.padLeft ?? 168, right: 56, top: 10, bottom: 30 };
      const pw = Math.max(80, w - pad.left - pad.right);
      const ph = Math.max(80, h - pad.top - pad.bottom);
      const xOf = (v) => pad.left + ((Math.max(xMin, v) - xMin) / Math.max(1e-9, xMax - xMin)) * pw;

      ctx.clearRect(0, 0, w, h);
      hitRows = [];

      // Vertical grid
      const xTicks = niceTicks(xMin, xMax, 5);
      ctx.font = "10.5px JetBrains Mono, monospace";
      xTicks.forEach((tv) => {
        const x = xOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + ph);
        ctx.stroke();
        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(tv.toFixed(1), x, pad.top + ph + 4);
      });

      const n = items.length;
      const rowH = ph / Math.max(1, n);
      const barH = Math.max(4, rowH * 0.72);

      items.forEach((it, idx) => {
        const cy = pad.top + idx * rowH + rowH / 2;
        const by = cy - barH / 2;
        const bx1 = xOf(it.value);
        const bw = Math.max(2, bx1 - pad.left);

        ctx.fillStyle = it.color || "#94a3b8";
        ctx.fillRect(pad.left, by, bw, barH);
        ctx.strokeStyle = "rgba(15,37,60,0.28)";
        ctx.lineWidth = 0.7;
        ctx.strokeRect(pad.left, by, bw, barH);

        if (it.std && it.std > 0) {
          const ex1 = xOf(it.value - it.std);
          const ex2 = xOf(it.value + it.std);
          ctx.strokeStyle = "#0f253c";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(ex1, cy);
          ctx.lineTo(ex2, cy);
          ctx.moveTo(ex1, cy - 3);
          ctx.lineTo(ex1, cy + 3);
          ctx.moveTo(ex2, cy - 3);
          ctx.lineTo(ex2, cy + 3);
          ctx.stroke();
        }

        // Left label
        ctx.fillStyle = it.bold ? it.color : "#334155";
        ctx.font = `${it.bold ? "700" : "500"} ${n > 20 ? 10 : 10.8}px Inter, sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const trunc = it.label.length > 29 ? it.label.slice(0, 28) + "…" : it.label;
        ctx.fillText(trunc, pad.left - 7, cy);

        // Right value label
        if (cfg.showAllValues || it.bold || idx < 2 || idx === n - 1 || it.showValue) {
          const vx = xOf(it.value + (it.std || 0)) + 4;
          ctx.fillStyle = it.bold ? "#0f253c" : "#475569";
          ctx.font = `${it.bold ? "700" : "500"} 10px JetBrains Mono, monospace`;
          ctx.textAlign = "left";
          ctx.fillText(it.valueLabel || it.value.toFixed(3), vx, cy);
        }

        hitRows.push({ y: pad.top + idx * rowH, h: rowH, item: it });
      });

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(pad.left, pad.top, pw, ph);

      if (cfg.xLabel) {
        ctx.fillStyle = "#334155";
        ctx.font = "600 10.8px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(cfg.xLabel, pad.left + pw / 2, h - 1);
      }
    }

    draw();

    bindHover(canvas, (evt, mx, my) => {
      const hit = hitRows.find((r) => my >= r.y && my <= r.y + r.h);
      if (!hit) {
        hideTooltip();
        return;
      }
      const it = hit.item;
      const stdStr = it.std ? ` ± ${it.std.toFixed(3)}` : "";
      const extra = it.extra ? `<div class="tt-row"><span>Detalle</span><span>${it.extra}</span></div>` : "";
      showTooltip(
        evt,
        `<div class="tt-title">${it.fullLabel || it.label}</div>
         <div class="tt-row"><span style="color:${it.color}">● Puntaje</span><span>${it.value.toFixed(3)}${stdStr} pts/r</span></div>
         ${extra}`
      );
    });
  }

  // =========================================================================
  // 4. BOXPLOT WITH JITTERED SEED DOTS (fig_torneos_10seeds_5agentes panel 6)
  // =========================================================================
  function renderBoxplotChart(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderBoxplotChart(canvas, cfg);

    const groups = cfg.groups || []; // [{ label, color, values: [] }]
    const allV = groups.flatMap((g) => g.values || []);
    const yMin = cfg.yMin ?? Math.min(...allV) - 0.1;
    const yMax = cfg.yMax ?? Math.max(...allV) + 0.12;
    let hitBoxes = [];

    function quantile(sorted, q) {
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
    }

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = { left: 50, right: 16, top: 22, bottom: 48 };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;
      const yOf = (v) => pad.top + ph - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ph;

      ctx.clearRect(0, 0, w, h);
      hitBoxes = [];

      const yTicks = niceTicks(yMin, yMax, 5);
      ctx.font = "10.5px JetBrains Mono, monospace";
      yTicks.forEach((tv) => {
        const y = yOf(tv);
        ctx.strokeStyle = "#e8eef5";
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
        ctx.fillStyle = "#5b6f86";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(tv.toFixed(2), pad.left - 7, y);
      });

      const slotW = pw / Math.max(1, groups.length);
      const boxW = Math.min(44, slotW * 0.5);

      groups.forEach((g, idx) => {
        const vals = [...(g.values || [])].sort((a, b) => a - b);
        if (!vals.length) return;
        const cx = pad.left + idx * slotW + slotW / 2;
        const minV = vals[0];
        const maxV = vals[vals.length - 1];
        const q1 = quantile(vals, 0.25);
        const med = quantile(vals, 0.5);
        const q3 = quantile(vals, 0.75);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);

        // Whiskers
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, yOf(minV));
        ctx.lineTo(cx, yOf(maxV));
        ctx.moveTo(cx - boxW * 0.32, yOf(minV));
        ctx.lineTo(cx + boxW * 0.32, yOf(minV));
        ctx.moveTo(cx - boxW * 0.32, yOf(maxV));
        ctx.lineTo(cx + boxW * 0.32, yOf(maxV));
        ctx.stroke();

        // Box Q1-Q3
        const yQ3 = yOf(q3);
        const yQ1 = yOf(q1);
        ctx.fillStyle = g.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(cx - boxW / 2, yQ3, boxW, Math.max(2, yQ1 - yQ3));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#0f253c";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx - boxW / 2, yQ3, boxW, Math.max(2, yQ1 - yQ3));

        // Median
        ctx.strokeStyle = "#0f253c";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx - boxW / 2, yOf(med));
        ctx.lineTo(cx + boxW / 2, yOf(med));
        ctx.stroke();

        // Individual jittered seed dots
        g.values.forEach((v, sIdx) => {
          const offset = g.values.length > 1 ? ((sIdx / (g.values.length - 1)) - 0.5) * boxW * 0.65 : 0;
          ctx.beginPath();
          ctx.arc(cx + offset, yOf(v), 2.7, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(15, 37, 60, 0.72)";
          ctx.fill();
        });

        // White diamond mean marker
        const my = yOf(mean);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#0f253c";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, my - 4.5);
        ctx.lineTo(cx + 4.5, my);
        ctx.lineTo(cx, my + 4.5);
        ctx.lineTo(cx - 4.5, my);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Top mean ± std annotation
        ctx.fillStyle = "#0f253c";
        ctx.font = "700 9.8px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const annY = Math.max(pad.top + 18, yOf(maxV) - 5);
        ctx.fillText(mean.toFixed(3), cx, annY - 10);
        ctx.fillStyle = "#475569";
        ctx.fillText(`±${std.toFixed(3)}`, cx, annY);

        // X label
        const lines = String(g.label).split("\n");
        ctx.fillStyle = "#1e293b";
        ctx.font = "700 10px Inter, sans-serif";
        ctx.textBaseline = "top";
        lines.forEach((ln, li) => ctx.fillText(ln, cx, pad.top + ph + 6 + li * 12));

        hitBoxes.push({ x: cx - slotW / 2, w: slotW, g, mean, std, minV, maxV, med });
      });

      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(pad.left, pad.top, pw, ph);
    }

    draw();

    bindHover(canvas, (evt, mx) => {
      const hit = hitBoxes.find((b) => mx >= b.x && mx <= b.x + b.w);
      if (!hit) {
        hideTooltip();
        return;
      }
      const seedsHtml = hit.g.values
        .map((v, i) => `s${i}:${v.toFixed(3)}`)
        .join(" · ");
      showTooltip(
        evt,
        `<div class="tt-title">${hit.g.label.replace(/\n/g, " ")}</div>
         <div class="tt-row"><span>Media ± DE</span><span>${hit.mean.toFixed(3)} ± ${hit.std.toFixed(3)}</span></div>
         <div class="tt-row"><span>Min / Med / Max</span><span>${hit.minV.toFixed(3)} / ${hit.med.toFixed(3)} / ${hit.maxV.toFixed(3)}</span></div>
         <div style="margin-top:4px;font-size:10.5px;color:#cbd5e1;font-family:var(--font-mono)">${seedsHtml}</div>`
      );
    });
  }

  // =========================================================================
  // 5. INTERACTIVE HEATMAP (8x4 Matrices, Policy Mutation, Clickable H2H)
  // =========================================================================
  function colorYlGnBu(t) {
    const v = Math.max(0, Math.min(1, t));
    const stops = [
      [255, 255, 217],
      [199, 233, 180],
      [65, 182, 196],
      [34, 94, 168],
      [12, 44, 132],
    ];
    const scaled = v * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(scaled));
    const f = scaled - idx;
    const c0 = stops[idx];
    const c1 = stops[idx + 1];
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
    return `rgb(${r},${g},${b})`;
  }

  function colorPayoff(val, minV = 0.5, maxV = 3.5) {
    const t = Math.max(0, Math.min(1, (val - minV) / Math.max(1e-6, maxV - minV)));
    const stops = [
      [214, 48, 49],
      [245, 158, 11],
      [254, 249, 195],
      [74, 222, 128],
      [21, 128, 61],
    ];
    const scaled = t * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(scaled));
    const f = scaled - idx;
    const c0 = stops[idx];
    const c1 = stops[idx + 1];
    return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},${Math.round(c0[1] + (c1[1] - c0[1]) * f)},${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
  }

  function renderHeatmap(canvas, cfg) {
    if (!canvas) return;
    canvas._lastRender = () => renderHeatmap(canvas, cfg);

    const matrix = cfg.matrix || [];
    const rowLabels = cfg.rowLabels || [];
    const colLabels = cfg.colLabels || [];
    const nRows = matrix.length;
    const nCols = nRows ? matrix[0].length : 0;
    const mode = cfg.mode || "prob"; // "prob" | "binary" | "payoff"

    let gridMeta = null;

    function draw() {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = {
        left: cfg.padLeft ?? (mode === "payoff" ? 132 : 76),
        right: 12,
        top: cfg.padTop ?? (mode === "payoff" ? 86 : 24),
        bottom: cfg.padBottom ?? 22,
      };
      const pw = Math.max(60, w - pad.left - pad.right);
      const ph = Math.max(60, h - pad.top - pad.bottom);
      const cw = pw / Math.max(1, nCols);
      const ch = ph / Math.max(1, nRows);
      gridMeta = { pad, cw, ch, nRows, nCols };

      ctx.clearRect(0, 0, w, h);

      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const val = matrix[r][c];
          if (mode === "binary") {
            ctx.fillStyle = val === 1 ? "#2e7d32" : "#d32f2f";
          } else if (mode === "payoff") {
            ctx.fillStyle = colorPayoff(val, cfg.minVal ?? 0.5, cfg.maxVal ?? 3.3);
          } else {
            ctx.fillStyle = colorYlGnBu(val);
          }
          const x = pad.left + c * cw;
          const y = pad.top + r * ch;
          ctx.fillRect(x, y, cw + 0.4, ch + 0.4);

          if (cfg.showValues && cw >= 24 && ch >= 14) {
            const darkBg =
              mode === "binary" ||
              (mode === "prob" && val > 0.55) ||
              (mode === "payoff" && (val < 1.05 || val > 2.95));
            ctx.fillStyle = darkBg ? "#ffffff" : "#0f253c";
            ctx.font = `700 ${cw < 36 ? 9.5 : 10.8}px JetBrains Mono, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(val.toFixed(cfg.decimals ?? 2), x + cw / 2, y + ch / 2);
          }
        }
      }

      // Optional white divider lines (e.g., policy mutation rivals)
      (cfg.dividers || []).forEach((rowIdx) => {
        const y = pad.top + rowIdx * ch;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
      });

      // Row labels
      ctx.fillStyle = "#1e293b";
      ctx.font = `${nRows > 14 ? 9.5 : 10.5}px JetBrains Mono, monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      rowLabels.forEach((lbl, r) => {
        const txt = lbl.length > 21 ? lbl.slice(0, 20) + "…" : lbl;
        ctx.fillText(txt, pad.left - 6, pad.top + r * ch + ch / 2);
      });

      // Column labels
      if (mode === "payoff") {
        ctx.fillStyle = "#1e293b";
        ctx.font = "600 10px Inter, sans-serif";
        colLabels.forEach((lbl, c) => {
          ctx.save();
          ctx.translate(pad.left + c * cw + cw / 2, pad.top - 6);
          ctx.rotate(-Math.PI / 3.2);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          const txt = lbl.length > 16 ? lbl.slice(0, 15) + "…" : lbl;
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        });
      } else {
        ctx.fillStyle = "#334155";
        ctx.font = "700 10.5px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = mode === "binary" ? "top" : "bottom";
        const step = nCols > 12 ? 5 : 1;
        for (let c = 0; c < nCols; c += step) {
          const yPos = mode === "binary" ? pad.top + ph + 5 : pad.top - 5;
          ctx.fillText(colLabels[c] ?? String(c + 1), pad.left + c * cw + cw / 2, yPos);
        }
      }

      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad.left, pad.top, pw, ph);
    }

    draw();

    bindHover(
      canvas,
      (evt, mx, my) => {
        if (!gridMeta) return;
        const { pad, cw, ch, nRows, nCols } = gridMeta;
        const c = Math.floor((mx - pad.left) / cw);
        const r = Math.floor((my - pad.top) / ch);
        if (r < 0 || r >= nRows || c < 0 || c >= nCols) {
          hideTooltip();
          return;
        }
        const val = matrix[r][c];
        const rName = rowLabels[r] || `Fila ${r}`;
        const cName = colLabels[c] || `Col ${c + 1}`;
        let valText = val.toFixed(3);
        if (mode === "binary") valText = val === 1 ? "Cooperar (C)" : "Traicionar (D)";
        const clickHint = cfg.onCellClick
          ? `<div style="margin-top:4px;font-size:10.5px;color:#7cc4fa">Clic para analizar este duelo 1v1 →</div>`
          : "";
        showTooltip(
          evt,
          `<div class="tt-title">${rName} × ${cName}</div>
           <div class="tt-row"><span>${cfg.valueLabel || "Valor"}</span><span>${valText}</span></div>
           ${clickHint}`
        );
      },
      null,
      cfg.onCellClick
        ? (evt, mx, my) => {
            if (!gridMeta) return;
            const { pad, cw, ch, nRows, nCols } = gridMeta;
            const c = Math.floor((mx - pad.left) / cw);
            const r = Math.floor((my - pad.top) / ch);
            if (r >= 0 && r < nRows && c >= 0 && c < nCols) {
              cfg.onCellClick(r, c);
            }
          }
        : null
    );
  }

  // =========================================================================
  // 6. INTERACTIVE SVG: GARY EXPECTIMAX TREE WITH LIVE NODE VALUES + MARKOV CHAIN
  // =========================================================================
  function renderGaryMarkovSVG(container, stateData) {
    if (!container) return;
    const E = stateData.E || [0.9, 0.85, 0.0, 0.0];
    const V = stateData.v_markov || [50, 30, 30, 20];
    const LH = stateData.leaf_h || [0, 0, 0, 0];
    const fc = stateData.f_c ?? 3.0;
    const fd = stateData.f_d ?? 1.2;
    const pCurrC = stateData.p_c ?? 0.5;
    const pCurrD = stateData.p_d ?? (1 - pCurrC);
    const valCC = stateData.val_cc ?? 3.0;
    const valCD = stateData.val_cd ?? 0.0;
    const valDC = stateData.val_dc ?? 5.0;
    const valDD = stateData.val_dd ?? 1.0;
    const currSt = stateData.current_state || "Apertura";
    const isOpening = Boolean(stateData.is_opening);
    const horizon = stateData.horizon ?? 4;
    const gamma = stateData.gamma ?? 0.95;
    const pcc = E[0].toFixed(2), qcc = (1 - E[0]).toFixed(2);
    const pcd = E[1].toFixed(2), qcd = (1 - E[1]).toFixed(2);
    const pdc = E[2].toFixed(2), qdc = (1 - E[2]).toFixed(2);
    const pdd = E[3].toFixed(2), qdd = (1 - E[3]).toFixed(2);
    const chooseC = fc >= fd;

    container.innerHTML = `
      <svg viewBox="0 0 960 340" width="100%" style="max-height:345px;display:block;font-family:Inter,sans-serif">
        <defs>
          <marker id="arr-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#2e7d32"/>
          </marker>
          <marker id="arr-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#c62828"/>
          </marker>
        </defs>

        <!-- LEFT: EXPECTIMAX LIVE CALCULATION TREE -->
        <rect x="8" y="8" width="446" height="324" rx="12" fill="#f9fbfd" stroke="#d8e3ef"/>
        <text x="231" y="30" text-anchor="middle" font-size="12.5" font-weight="700" fill="#0f253c">
          Cálculo Expectimax en Raíz (H=${horizon}, ${Math.pow(4, horizon)} hojas, γ=${gamma.toFixed(2)})
        </text>

        <!-- Root MAX -->
        <rect x="151" y="42" width="160" height="36" rx="8" fill="#0f3a66"/>
        <text x="231" y="57" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">
          NODO MAX · Estado: ${currSt}
        </text>
        <text x="231" y="71" text-anchor="middle" font-size="10" font-family="JetBrains Mono,monospace" fill="#93c5fd">
          ${isOpening ? "Turno 1: Regla Nice (C)" : `p(C|${currSt})=${pCurrC.toFixed(2)} | p(D)=${pCurrD.toFixed(2)}`}
        </text>

        <!-- Root to Chance C / Chance D -->
        <line x1="196" y1="78" x2="122" y2="114" stroke="${chooseC ? "#2e7d32" : "#cbd5e1"}" stroke-width="${chooseC ? 3.2 : 1.6}"/>
        <line x1="266" y1="78" x2="340" y2="114" stroke="${!chooseC ? "#c62828" : "#cbd5e1"}" stroke-width="${!chooseC ? 3.2 : 1.6}"/>

        <rect x="44" y="114" width="156" height="48" rx="9" fill="${chooseC ? "#e8f5e9" : "#f1f5f9"}" stroke="${chooseC ? "#2e7d32" : "#94a3b8"}" stroke-width="${chooseC ? 2.4 : 1.1}"/>
        <text x="122" y="133" text-anchor="middle" font-size="11.5" font-weight="700" fill="${chooseC ? "#1b5e20" : "#475569"}">
          ${chooseC ? "✓ " : ""}Acción C (Chance)
        </text>
        <text x="122" y="151" text-anchor="middle" font-size="12" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">
          f̄(C) = ${fc.toFixed(4)}
        </text>

        <rect x="262" y="114" width="156" height="48" rx="9" fill="${!chooseC ? "#ffebee" : "#f1f5f9"}" stroke="${!chooseC ? "#c62828" : "#94a3b8"}" stroke-width="${!chooseC ? 2.4 : 1.1}"/>
        <text x="340" y="133" text-anchor="middle" font-size="11.5" font-weight="700" fill="${!chooseC ? "#b71c1c" : "#475569"}">
          ${!chooseC ? "✓ " : ""}Acción D (Chance)
        </text>
        <text x="340" y="151" text-anchor="middle" font-size="12" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">
          f̄(D) = ${fd.toFixed(4)}
        </text>

        <!-- Sub-branches with exact p and 1-p labels -->
        <line x1="94" y1="162" x2="66" y2="206" stroke="#2e7d32" stroke-width="1.6"/>
        <text x="64" y="186" text-anchor="end" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#166534">×${pCurrC.toFixed(2)}</text>

        <line x1="150" y1="162" x2="176" y2="206" stroke="#c62828" stroke-width="1.6"/>
        <text x="176" y="186" text-anchor="start" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#991b1b">×${pCurrD.toFixed(2)}</text>

        <line x1="312" y1="162" x2="286" y2="206" stroke="#2e7d32" stroke-width="1.6"/>
        <text x="285" y="186" text-anchor="end" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#166534">×${pCurrC.toFixed(2)}</text>

        <line x1="368" y1="162" x2="396" y2="206" stroke="#c62828" stroke-width="1.6"/>
        <text x="396" y="186" text-anchor="start" font-size="9.8" font-family="JetBrains Mono,monospace" fill="#991b1b">×${pCurrD.toFixed(2)}</text>

        <!-- 4 Depth-1 Outcome Nodes with REAL calculated sub-tree values -->
        <rect x="20" y="206" width="94" height="44" rx="7" fill="#dcfce7" stroke="#2e7d32"/>
        <text x="67" y="223" text-anchor="middle" font-size="10.5" font-weight="700" fill="#166534">CC (R=+3)</text>
        <text x="67" y="240" text-anchor="middle" font-size="10.8" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">v=${valCC.toFixed(3)}</text>

        <rect x="128" y="206" width="94" height="44" rx="7" fill="#fee2e2" stroke="#dc2626"/>
        <text x="175" y="223" text-anchor="middle" font-size="10.5" font-weight="700" fill="#991b1b">CD (S=+0)</text>
        <text x="175" y="240" text-anchor="middle" font-size="10.8" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">v=${valCD.toFixed(3)}</text>

        <rect x="240" y="206" width="94" height="44" rx="7" fill="#dbeafe" stroke="#1d4ed8"/>
        <text x="287" y="223" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1e40af">DC (T=+5)</text>
        <text x="287" y="240" text-anchor="middle" font-size="10.8" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">v=${valDC.toFixed(3)}</text>

        <rect x="348" y="206" width="94" height="44" rx="7" fill="#ffedd5" stroke="#ea580c"/>
        <text x="395" y="223" text-anchor="middle" font-size="10.5" font-weight="700" fill="#9a3412">DD (P=+1)</text>
        <text x="395" y="240" text-anchor="middle" font-size="10.8" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">v=${valDD.toFixed(3)}</text>

        <!-- Bottom Decision Summary Banner -->
        <rect x="20" y="264" width="422" height="54" rx="8" fill="${chooseC ? "#ecfdf5" : "#fef2f2"}" stroke="${chooseC ? "#16a34a" : "#dc2626"}"/>
        <text x="231" y="283" text-anchor="middle" font-size="11" font-family="JetBrains Mono,monospace" font-weight="700" fill="#0f253c">
          f̄(C) = ${pCurrC.toFixed(2)}×${valCC.toFixed(2)} + ${pCurrD.toFixed(2)}×${valCD.toFixed(2)} = ${fc.toFixed(3)}   |   f̄(D) = ${pCurrC.toFixed(2)}×${valDC.toFixed(2)} + ${pCurrD.toFixed(2)}×${valDD.toFixed(2)} = ${fd.toFixed(3)}
        </text>
        <text x="231" y="304" text-anchor="middle" font-size="11.5" font-weight="700" fill="${chooseC ? "#166534" : "#991b1b"}">
          Decisión: ${chooseC ? "COOPERAR (C)" : "TRAICIONAR (D)"}   (margen Δf̄ = ${(fc - fd) >= 0 ? "+" : ""}${(fc - fd).toFixed(4)} pts/ronda)
        </text>

        <!-- RIGHT: 4-STATE MARKOV CHAIN (P_TFT(E_t)) -->
        <rect x="468" y="8" width="484" height="324" rx="12" fill="#f9fbfd" stroke="#d8e3ef"/>
        <text x="710" y="30" text-anchor="middle" font-size="12.5" font-weight="700" fill="#0f253c">
          Heurística Terminal en Hojas: Cadena de Markov P_TFT(Eₜ)
        </text>

        <!-- Edges of P_TFT -->
        <path d="M 568 92 C 524 38, 620 38, 602 88" fill="none" stroke="#2e7d32" stroke-width="2" marker-end="url(#arr-g)"/>
        <text x="574" y="54" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" font-weight="700" fill="#1b5e20">p_CC=${pcc}</text>

        <path d="M 622 114 L 774 114" fill="none" stroke="#c62828" stroke-width="1.8" marker-end="url(#arr-r)"/>
        <text x="698" y="106" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" fill="#b71c1c">1−p_CC=${qcc}</text>

        <path d="M 784 142 L 622 224" fill="none" stroke="#2e7d32" stroke-width="1.8" marker-end="url(#arr-g)"/>
        <text x="734" y="192" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" fill="#1b5e20">p_CD=${pcd}</text>

        <path d="M 818 148 L 818 212" fill="none" stroke="#c62828" stroke-width="1.8" marker-end="url(#arr-r)"/>
        <text x="866" y="184" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" fill="#b71c1c">1−p_CD=${qcd}</text>

        <path d="M 586 212 L 586 148" fill="none" stroke="#2e7d32" stroke-width="1.8" marker-end="url(#arr-g)"/>
        <text x="536" y="184" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" fill="#1b5e20">p_DC=${pdc}</text>

        <path d="M 620 214 L 780 134" fill="none" stroke="#c62828" stroke-width="1.4" stroke-dasharray="4,3" marker-end="url(#arr-r)"/>
        <text x="664" y="164" text-anchor="middle" font-size="10" font-family="JetBrains Mono,monospace" fill="#991b1b">1−p_DC=${qdc}</text>

        <path d="M 774 248 L 622 248" fill="none" stroke="#2e7d32" stroke-width="1.8" marker-end="url(#arr-g)"/>
        <text x="698" y="264" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" fill="#1b5e20">p_DD=${pdd}</text>

        <path d="M 848 264 C 902 308, 912 222, 858 236" fill="none" stroke="#c62828" stroke-width="2" marker-end="url(#arr-r)"/>
        <text x="896" y="286" text-anchor="middle" font-size="10.5" font-family="JetBrains Mono,monospace" font-weight="700" fill="#b71c1c">1−p_DD=${qdd}</text>

        <!-- 4 State Nodes with V_Markov and leaf_h -->
        <g transform="translate(586,116)">
          <circle r="34" fill="#dcfce7" stroke="${currSt === "CC" ? "#0f253c" : "#2e7d32"}" stroke-width="${currSt === "CC" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14532d">CC</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#166534">V=${V[0].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[0].toFixed(1)}</text>
        </g>

        <g transform="translate(818,116)">
          <circle r="34" fill="#fee2e2" stroke="${currSt === "CD" ? "#0f253c" : "#c62828"}" stroke-width="${currSt === "CD" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#7f1d1d">CD</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#991b1b">V=${V[1].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[1].toFixed(1)}</text>
        </g>

        <g transform="translate(586,246)">
          <circle r="34" fill="#dbeafe" stroke="${currSt === "DC" ? "#0f253c" : "#1565c0"}" stroke-width="${currSt === "DC" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e3a8a">DC</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#1d4ed8">V=${V[2].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[2].toFixed(1)}</text>
        </g>

        <g transform="translate(818,246)">
          <circle r="34" fill="#ffedd5" stroke="${currSt === "DD" ? "#0f253c" : "#ef6c00"}" stroke-width="${currSt === "DD" ? 3.5 : 2}"/>
          <text y="-9" text-anchor="middle" font-size="11.5" font-weight="700" fill="#7c2d12">DD</text>
          <text y="6" text-anchor="middle" font-size="9.5" font-family="JetBrains Mono,monospace" fill="#c2410c">V=${V[3].toFixed(1)}</text>
          <text y="19" text-anchor="middle" font-size="9" font-family="JetBrains Mono,monospace" fill="#334155">h=${LH[3].toFixed(1)}</text>
        </g>

        <text x="710" y="316" text-anchor="middle" font-size="10.5" fill="#475569">
          V = (I − γP)⁻¹PR  ·  h = γ^H · V (inyectado en cada hoja)  ·  Borde negro = estado actual
        </text>
      </svg>
    `;
  }

  // Responsive redraw on window resize
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll("canvas").forEach((cv) => {
        if (cv._lastRender && cv.offsetParent !== null) cv._lastRender();
      });
    }, 140);
  });

  window.T5Charts = {
    renderLineChart,
    renderVerticalBarChart,
    renderHorizontalBarChart,
    renderBoxplotChart,
    renderHeatmap,
    renderGaryMarkovSVG,
  };
})();
