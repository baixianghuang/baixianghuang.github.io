/* ==========================================================================
   pixel-fx.js — interactive LED pixel matrix, reused across the site.

   A grid of square "pixels" is laid behind a host element. The dots sit
   dim until energy reaches them, then ignite in the site's tan/gold and
   radiate. Energy comes from three sources:
     • proximity   — dots near the cursor glow
     • ripples      — pointer movement (and autoplay) spawn expanding rings
     • autoplay     — a slow virtual cursor drifts across the box on its own,
                      so the header keeps breathing with no interaction

   Applied to the header bar (autoplay + idle shimmer) and to every social
   chip (glow on hover / keyboard focus). Pure canvas, no dependencies.
   Honors prefers-reduced-motion and only animates while there's something
   to show, then settles to a static frame.
   ========================================================================== */
(function () {
	"use strict";

	var reduceMotion = window.matchMedia &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	/* --- palette (from the CSS design tokens) ----------------------------- */
	var BASE = [20, 33, 61];      // --foreground  (#14213d) dim dots
	var GLOW = [181, 136, 99];    // --primary     (#b58863) warm glow
	var HOT  = [245, 217, 168];   // bright gold core at full intensity

	function lerp(a, b, t) { return a + (b - a) * t; }

	function mix(c1, c2, t) {
		return "rgb(" +
			Math.round(lerp(c1[0], c2[0], t)) + "," +
			Math.round(lerp(c1[1], c2[1], t)) + "," +
			Math.round(lerp(c1[2], c2[2], t)) + ")";
	}

	/* --- one pixel grid bound to a host element --------------------------- */
	function PixelGrid(host, opts) {
		opts = opts || {};

		var canvas = document.createElement("canvas");
		canvas.className = "pixel-fx-canvas";
		canvas.setAttribute("aria-hidden", "true");
		// Insert as the first child so it lands beneath the host's content.
		if (host.firstChild) host.insertBefore(canvas, host.firstChild);
		else host.appendChild(canvas);

		var ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) return;

		/* --- tunables (per-host via opts) --------------------------------- */
		var SPACING = opts.spacing || 13;          // px between dot centers
		var BASE_SIZE = opts.baseSize || 1.6;      // half-size of a resting dot
		var GLOW_SIZE = opts.glowSize || 2.6;      // extra half-size at full energy
		var POINTER_RADIUS = opts.pointerRadius || 120;
		var RIPPLE_SPEED = opts.rippleSpeed || 0.16;   // px per ms
		var RIPPLE_LIFE = opts.rippleLife || 1100;     // ms
		var RIPPLE_BAND = opts.rippleBand || 22;       // lit band thickness
		var MAX_RIPPLES = opts.maxRipples || 14;
		var IDLE_BASE = opts.idleBase != null ? opts.idleBase : 0.05;
		var IDLE_SHIMMER = !!opts.idleShimmer && !reduceMotion;
		var AUTOPLAY = !!opts.autoplay && !reduceMotion;
		var AUTO_RIPPLE_GAP = opts.autoRippleGap || 1500;  // ms between auto rings
		var FOCUS_GLOW = !!opts.focusGlow;

		var dots = [];                // {x, y, tw}
		var ripples = [];             // {x, y, born}
		var dpr = 1, cssW = 0, cssH = 0;
		var pointer = { x: -1e4, y: -1e4, inside: false };
		var lastSpawn = { x: -1e4, y: -1e4 };
		var lastAutoRipple = 0;
		var rafId = 0;

		/* --- build the grid sized to the host box ------------------------- */
		function layout() {
			var rect = host.getBoundingClientRect();
			cssW = Math.max(1, Math.round(rect.width));
			cssH = Math.max(1, Math.round(rect.height));
			dpr = Math.min(window.devicePixelRatio || 1, 2);

			canvas.width = Math.round(cssW * dpr);
			canvas.height = Math.round(cssH * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			var cols = Math.ceil(cssW / SPACING) + 1;
			var rows = Math.ceil(cssH / SPACING) + 1;
			var offX = (cssW - (cols - 1) * SPACING) / 2;
			var offY = (cssH - (rows - 1) * SPACING) / 2;

			dots.length = 0;
			for (var r = 0; r < rows; r++) {
				for (var c = 0; c < cols; c++) {
					dots.push({
						x: offX + c * SPACING,
						y: offY + r * SPACING,
						tw: (c * 0.7 + r * 1.3)   // per-dot phase for shimmer
					});
				}
			}
		}

		// Slow Lissajous drift of the autoplay "virtual cursor".
		function autoPointer(now) {
			return {
				x: cssW * (0.5 + 0.46 * Math.sin(now * 0.00011 + 0.6)),
				y: cssH * (0.5 + 0.40 * Math.sin(now * 0.00029 + 1.7))
			};
		}

		/* --- render pass --------------------------------------------------- */
		function frame(now) {
			rafId = 0;
			ctx.clearRect(0, 0, cssW, cssH);

			for (var i = ripples.length - 1; i >= 0; i--) {
				if (now - ripples[i].born > RIPPLE_LIFE) ripples.splice(i, 1);
			}

			// Pick the glow source: real cursor wins, else autoplay drifts.
			var gx, gy, glowing = false;
			if (pointer.inside) {
				gx = pointer.x; gy = pointer.y; glowing = true;
			} else if (AUTOPLAY) {
				var ap = autoPointer(now);
				gx = ap.x; gy = ap.y; glowing = true;
				if (now - lastAutoRipple > AUTO_RIPPLE_GAP) {
					lastAutoRipple = now;
					ripples.push({ x: gx, y: gy, born: now });
					if (ripples.length > MAX_RIPPLES) ripples.shift();
				}
			}

			var pr2 = POINTER_RADIUS * POINTER_RADIUS;

			for (var d = 0; d < dots.length; d++) {
				var dot = dots[d];
				var energy = 0;

				// 1) proximity glow
				if (glowing) {
					var dx = dot.x - gx, dy = dot.y - gy;
					var dist2 = dx * dx + dy * dy;
					if (dist2 < pr2) {
						var f = 1 - Math.sqrt(dist2) / POINTER_RADIUS;
						energy = f * f;
					}
				}

				// 2) radiating rings
				for (var k = 0; k < ripples.length; k++) {
					var rp = ripples[k];
					var age = now - rp.born;
					var radius = age * RIPPLE_SPEED;
					var rx = dot.x - rp.x, ry = dot.y - rp.y;
					var dr = Math.abs(Math.sqrt(rx * rx + ry * ry) - radius);
					if (dr < RIPPLE_BAND) {
						var band = 1 - dr / RIPPLE_BAND;
						var fade = 1 - age / RIPPLE_LIFE;
						var e = band * band * fade;
						if (e > energy) energy = e;
					}
				}

				// 3) faint idle level (optionally shimmering)
				var idle = IDLE_SHIMMER
					? IDLE_BASE + 0.035 * (0.5 + 0.5 * Math.sin(now * 0.0012 + dot.tw))
					: IDLE_BASE;

				var glow = energy > 1 ? 1 : energy;

				var alpha = 0.10 + idle * 0.6 + glow * 0.9;
				if (alpha > 1) alpha = 1;

				var color = glow < 0.5
					? mix(BASE, GLOW, glow / 0.5)
					: mix(GLOW, HOT, (glow - 0.5) / 0.5);

				var half = BASE_SIZE + GLOW_SIZE * glow;

				ctx.globalAlpha = alpha;
				ctx.fillStyle = color;
				if (glow > 0.12) {
					ctx.shadowColor = color;
					ctx.shadowBlur = 4 + glow * 16;     // the "radiate" halo
				} else {
					ctx.shadowBlur = 0;
				}

				ctx.fillRect(dot.x - half, dot.y - half, half * 2, half * 2);
			}

			ctx.globalAlpha = 1;
			ctx.shadowBlur = 0;

			// Keep animating only while there's motion/shimmer to show.
			if (pointer.inside || ripples.length > 0 || AUTOPLAY || IDLE_SHIMMER) {
				rafId = requestAnimationFrame(frame);
			}
		}

		function kick() { if (!rafId) rafId = requestAnimationFrame(frame); }

		/* --- pointer wiring ------------------------------------------------ */
		function spawnRipple(x, y) {
			if (reduceMotion) return;
			var mx = x - lastSpawn.x, my = y - lastSpawn.y;
			if (mx * mx + my * my < 100) return;   // need a little travel first
			lastSpawn.x = x; lastSpawn.y = y;
			ripples.push({ x: x, y: y, born: performance.now() });
			if (ripples.length > MAX_RIPPLES) ripples.shift();
		}

		function onMove(e) {
			var rect = host.getBoundingClientRect();
			pointer.x = e.clientX - rect.left;
			pointer.y = e.clientY - rect.top;
			pointer.inside = true;
			spawnRipple(pointer.x, pointer.y);
			kick();
		}

		function onLeave() {
			pointer.inside = false;
			pointer.x = -1e4;
			pointer.y = -1e4;
			kick();
		}

		host.addEventListener("pointermove", onMove, { passive: true });
		host.addEventListener("pointerleave", onLeave, { passive: true });

		// Keyboard focus lights the chip from its center.
		if (FOCUS_GLOW) {
			host.addEventListener("focus", function () {
				pointer.x = cssW / 2; pointer.y = cssH / 2; pointer.inside = true; kick();
			}, true);
			host.addEventListener("blur", onLeave, true);
		}

		var resizeTimer = 0;
		function onResize() {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(function () { layout(); kick(); }, 120);
		}
		window.addEventListener("resize", onResize, { passive: true });
		if (typeof ResizeObserver !== "undefined") {
			new ResizeObserver(onResize).observe(host);
		}

		layout();
		kick();
	}

	/* --- wire up the page -------------------------------------------------- */
	function init() {
		var header = document.querySelector(".header-bar");
		if (header) {
			PixelGrid(header, { autoplay: true, idleShimmer: true });
		}

		// Treat the social chips as "buttons".
		var buttons = document.querySelectorAll(".social a");
		for (var i = 0; i < buttons.length; i++) {
			PixelGrid(buttons[i], {
				spacing: 9,
				baseSize: 1.1,
				glowSize: 1.9,
				pointerRadius: 70,
				rippleSpeed: 0.12,
				rippleLife: 850,
				rippleBand: 14,
				maxRipples: 8,
				focusGlow: true
			});
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
