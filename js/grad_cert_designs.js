/*
 * SoMAp Graduation Certificate Designs (2026+)
 * --------------------------------------------
 * Two completely different landscape A4 designs (1123 x 794 css px):
 *   - 'preunit' : Little Graduates — warm, joyful, refined (Pre-Primary).
 *   - 'class7'  : Primary Completion — navy / burgundy / gold-foil prestige.
 *
 * Presentation only. Data comes from js/graduation.js exactly as before.
 * Everything is drawn with HTML + SVG data-URI images so html2canvas renders
 * it faithfully (no CSS filters, masks or background-clip:text — html2canvas
 * ignores those). Photo brightening, face-biased cropping and the oval/circle
 * mask are baked into the photo with a canvas before render.
 */
(function (window) {
  'use strict';

  const W = 1123;
  const H = 794;
  const SOMAP_LOGO = '../images/somap-logo.png';
  const SOMAP_LOGO_FALLBACK = '../images/somap-logo.png.jpg';

  const FONT_FACES = [
    '700 40px "Cinzel"', '500 20px "Cinzel"', '700 40px "Cinzel Decorative"',
    'italic 500 20px "Cormorant Garamond"', '600 20px "Cormorant Garamond"', '500 20px "Cormorant Garamond"',
    '400 40px "Pinyon Script"', '700 40px "Fredoka"', '600 20px "Fredoka"',
    '800 20px "Nunito"', '700 20px "Nunito"', '400 40px "Pacifico"',
  ];

  // ---------- small helpers ----------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function svgUri(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  function f(n) { return Math.round(n * 10) / 10; }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function formalDate(date) {
    const d = date instanceof Date ? date : new Date();
    const month = d.toLocaleString('en-GB', { month: 'long' });
    return { day: ordinal(d.getDate()), month, year: d.getFullYear(), short: d.toLocaleDateString('en-GB') };
  }

  function toTitleCase(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
      .replace(/(^|[\s'-])([a-zÀ-ɏ])/g, (m, p, c) => p + c.toUpperCase());
  }

  function kindFor(className) {
    const cls = String(className || '').toLowerCase();
    if (/baby|middle|pre\s*-?\s*unit|preunit|preparatory|nursery|kg|kindergarten/.test(cls)) return 'preunit';
    return 'class7';
  }

  // ---------- fonts ----------
  let fontsPromise = null;
  function ensureFonts() {
    if (fontsPromise) return fontsPromise;
    if (!document.fonts || !document.fonts.load) {
      fontsPromise = Promise.resolve(true);
      return fontsPromise;
    }
    fontsPromise = Promise.race([
      Promise.all(FONT_FACES.map((face) => document.fonts.load(face).catch(() => null)))
        .then(() => document.fonts.ready).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 9000)),
    ]);
    return fontsPromise;
  }
  function fontsMissing() {
    if (!document.fonts || !document.fonts.check) return [];
    return [['Cinzel', '700'], ['Pinyon Script', '400'], ['Fredoka', '700'], ['Pacifico', '400'], ['Cormorant Garamond', '500'], ['Nunito', '700']]
      .filter(([fam, wt]) => !document.fonts.check(`${wt} 20px "${fam}"`)).map(([fam]) => fam);
  }

  // ---------- images ----------
  function loadImage(src, crossOrigin = true) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      if (crossOrigin && !/^data:|^blob:/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function imageToDataUrl(src) {
    if (!src) return '';
    if (/^data:/.test(src)) return src;
    const img = await loadImage(src);
    if (!img) return '';
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch (_) {
      return src; // tainted: let html2canvas try with useCORS
    }
  }

  /**
   * Crop a portrait to w x h (cover), biased towards the upper-middle where
   * faces sit in passport photos, gently brighten (1.08) and lift contrast
   * (1.05), then clip to an ellipse. Returns a PNG data URL at 3x resolution.
   */
  async function preparePortrait(src, w, h, opts = {}) {
    const scale = 3;
    const img = await loadImage(src);
    if (!img) return '';
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const ratio = Math.max(cw / iw, ch / ih);
    const sw = cw / ratio;
    const sh = ch / ratio;
    const sx = (iw - sw) / 2;
    const focusY = opts.focusY == null ? 0.32 : opts.focusY; // portrait faces sit high
    const sy = Math.max(0, Math.min(ih - sh, (ih - sh) * focusY));
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cw / 2, ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    ctx.restore();
    try {
      const data = ctx.getImageData(0, 0, cw, ch);
      const px = data.data;
      const brightness = 1.08;
      const contrast = 1.05;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        for (let k = 0; k < 3; k += 1) {
          let v = px[i + k] / 255;
          v = ((v - 0.5) * contrast + 0.5) * brightness;
          px[i + k] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
        }
      }
      ctx.putImageData(data, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (_) {
      return ''; // cross-origin photo without CORS headers
    }
  }

  /** Logo baked into a white disc (contain-fit) so html2canvas never has to clip or object-fit it. */
  async function makeCrest(src, size) {
    const img = await loadImage(src);
    if (!img) return '';
    const scale = 3;
    const px = size * scale;
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();
    const inner = px * 0.84;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const r = Math.min(inner / iw, inner / ih);
    const w = iw * r;
    const h = ih * r;
    ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
    try { return canvas.toDataURL('image/png'); } catch (_) { return ''; }
  }

  function crestHtml(url, size, ring) {
    return `<div style="position:relative;display:inline-block;width:${size + 8}px;height:${size + 8}px;border-radius:50%;background:${ring};box-shadow:0 4px 10px rgba(15,31,69,.22);">
      <div style="position:absolute;left:4px;top:4px;width:${size}px;height:${size}px;border-radius:50%;background:#ffffff;"></div>
      ${url ? `<img src="${esc(url)}" alt="" style="position:absolute;left:4px;top:4px;width:${size}px;height:${size}px;"/>` : ''}
    </div>`;
  }

  // ---------- SVG generators ----------
  /** Points + outward normals along a rounded rectangle (x,y,w,h,r) sampled every `step` px. */
  function roundedRectSamples(x, y, w, h, r, step) {
    const segs = [];
    const straightH = w - 2 * r;
    const straightV = h - 2 * r;
    const arc = (Math.PI * r) / 2;
    const total = 2 * straightH + 2 * straightV + 4 * arc;
    const n = Math.max(200, Math.round(total / step));
    for (let i = 0; i < n; i += 1) {
      let s = (i / n) * total;
      let px; let py; let nx; let ny;
      const corner = (cx, cy, a0, t) => {
        const a = a0 + (t / r);
        return [cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)];
      };
      if (s < straightH) { px = x + r + s; py = y; nx = 0; ny = -1; }
      else if ((s -= straightH) < arc) { [px, py, nx, ny] = corner(x + w - r, y + r, -Math.PI / 2, s); }
      else if ((s -= arc) < straightV) { px = x + w; py = y + r + s; nx = 1; ny = 0; }
      else if ((s -= straightV) < arc) { [px, py, nx, ny] = corner(x + w - r, y + h - r, 0, s); }
      else if ((s -= arc) < straightH) { px = x + w - r - s; py = y + h; nx = 0; ny = 1; }
      else if ((s -= straightH) < arc) { [px, py, nx, ny] = corner(x + r, y + h - r, Math.PI / 2, s); }
      else if ((s -= arc) < straightV) { px = x; py = y + h - r - s; nx = -1; ny = 0; }
      else { s -= straightV; [px, py, nx, ny] = corner(x + r, y + r, Math.PI, s); }
      segs.push([px, py, nx, ny, i / n]);
    }
    return segs;
  }

  /** Guilloché band: interlaced sine strands riding a rounded-rect path. */
  function guillocheBand({ x, y, w, h, r, amp, strands, cycles, stroke, width, opacity = 1, step = 2.4, harmonic = 0 }) {
    const pts = roundedRectSamples(x, y, w, h, r, step);
    let out = '';
    for (let k = 0; k < strands; k += 1) {
      const phase = (Math.PI * 2 * k) / strands;
      let d = '';
      pts.forEach(([px, py, nx, ny, t], i) => {
        const a = t * Math.PI * 2 * cycles + phase;
        const off = amp * (Math.sin(a) * (1 - harmonic) + Math.sin(a * 2.0 + phase) * harmonic);
        d += `${i ? 'L' : 'M'}${f(px + nx * off)} ${f(py + ny * off)}`;
      });
      out += `<path d="${d}Z" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
    }
    return out;
  }

  /** Spirograph rosette (epitrochoid-like) centred at cx,cy. */
  function rosette({ cx, cy, R, amp, petals, strands, stroke, width, opacity = 1 }) {
    let out = '';
    const N = 720;
    for (let k = 0; k < strands; k += 1) {
      const rot = (Math.PI * 2 * k) / (strands * petals);
      let d = '';
      for (let i = 0; i <= N; i += 1) {
        const t = (i / N) * Math.PI * 2;
        const rr = R + amp * Math.sin(petals * t);
        d += `${i ? 'L' : 'M'}${f(cx + rr * Math.cos(t + rot))} ${f(cy + rr * Math.sin(t + rot))}`;
      }
      out += `<path d="${d}Z" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
    }
    return out;
  }

  function starPolygon(cx, cy, outer, inner, points, rot = -Math.PI / 2) {
    let d = '';
    for (let i = 0; i < points * 2; i += 1) {
      const rr = i % 2 === 0 ? outer : inner;
      const a = rot + (i * Math.PI) / points;
      d += `${i ? 'L' : 'M'}${f(cx + rr * Math.cos(a))} ${f(cy + rr * Math.sin(a))}`;
    }
    return `${d}Z`;
  }

  const GOLD_DEFS = `
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a6420"/><stop offset=".22" stop-color="#d9b356"/>
      <stop offset=".45" stop-color="#fff0b8"/><stop offset=".62" stop-color="#c99a3a"/>
      <stop offset=".85" stop-color="#f3d27a"/><stop offset="1" stop-color="#7d5a1a"/>
    </linearGradient>
    <linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9c7425"/><stop offset=".5" stop-color="#f7e2a0"/><stop offset="1" stop-color="#9c7425"/>
    </linearGradient>
    <radialGradient id="goldR" cx=".38" cy=".32" r=".75">
      <stop offset="0" stop-color="#fff4c7"/><stop offset=".35" stop-color="#e6c065"/>
      <stop offset=".75" stop-color="#b8892f"/><stop offset="1" stop-color="#7a5717"/>
    </radialGradient>`;

  // ---------- cached art (built once per page load) ----------
  const ART = {};

  function class7FrameArt() {
    if (ART.class7Frame) return ART.class7Frame;
    const navy = '#0f1f45';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>${GOLD_DEFS}
        <radialGradient id="parch" cx=".5" cy=".45" r=".75">
          <stop offset="0" stop-color="#fffdf6"/><stop offset=".7" stop-color="#fbf5e4"/><stop offset="1" stop-color="#efe2c2"/>
        </radialGradient>
        <linearGradient id="navyG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0b1838"/><stop offset=".5" stop-color="${navy}"/><stop offset="1" stop-color="#0a1533"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fffdf6"/>
      <rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="14" fill="url(#navyG)"/>
      ${guillocheBand({ x: 27, y: 27, w: W - 54, h: H - 54, r: 8, amp: 7.5, strands: 6, cycles: 220, stroke: '#d9b356', width: 0.55, opacity: 0.9 })}
      ${guillocheBand({ x: 27, y: 27, w: W - 54, h: H - 54, r: 8, amp: 5, strands: 4, cycles: 147, stroke: '#7fa0d9', width: 0.4, opacity: 0.45, harmonic: 0.35 })}
      <rect x="44" y="44" width="${W - 88}" height="${H - 88}" rx="6" fill="url(#parch)"/>
      <rect x="44" y="44" width="${W - 88}" height="${H - 88}" rx="6" fill="none" stroke="url(#gold)" stroke-width="3"/>
      <rect x="53" y="53" width="${W - 106}" height="${H - 106}" rx="3" fill="none" stroke="#9c7425" stroke-width="0.9"/>
      <rect x="57" y="57" width="${W - 114}" height="${H - 114}" rx="2" fill="none" stroke="#7a1f2b" stroke-width="0.6" opacity=".55"/>
      ${rosette({ cx: W / 2, cy: H / 2 + 22, R: 205, amp: 30, petals: 18, strands: 9, stroke: '#b8892f', width: 0.5, opacity: 0.12 })}
      ${rosette({ cx: W / 2, cy: H / 2 + 22, R: 128, amp: 22, petals: 12, strands: 7, stroke: navy, width: 0.45, opacity: 0.07 })}
      ${[[57, 57, 0], [W - 57, 57, 90], [W - 57, H - 57, 180], [57, H - 57, 270]].map(([cx, cy, rot]) => `
        <g transform="translate(${cx} ${cy}) rotate(${rot})">
          <path d="M0 0 L74 0 M0 0 L0 74" stroke="url(#gold)" stroke-width="2.6" fill="none"/>
          <path d="M9 9 L52 9 M9 9 L9 52" stroke="#9c7425" stroke-width=".9" fill="none"/>
          <path d="M22 22 C 40 20, 50 28, 46 38 C 43 45, 34 42, 37 36" stroke="url(#gold)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
          <path d="M22 22 C 20 40, 28 50, 38 46 C 45 43, 42 34, 36 37" stroke="url(#gold)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
          <path d="M52 9 q8 0 12 -4 M9 52 q0 8 -4 12" stroke="#9c7425" stroke-width=".9" fill="none"/>
          <path d="M16 4 L28 16 L16 28 L4 16 Z" fill="#7a1f2b" stroke="url(#gold)" stroke-width="1.4"/>
          <circle cx="16" cy="16" r="2.6" fill="#f7e2a0"/>
        </g>`).join('')}
    </svg>`;
    ART.class7Frame = svgUri(svg);
    return ART.class7Frame;
  }

  function class7SealArt() {
    if (ART.class7Seal) return ART.class7Seal;
    const c = 80;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="200" viewBox="0 0 160 200">
      <defs>${GOLD_DEFS}
        <linearGradient id="rib" x1="0" x2="1"><stop offset="0" stop-color="#5c1520"/><stop offset=".5" stop-color="#9b2a3a"/><stop offset="1" stop-color="#5c1520"/></linearGradient>
        <path id="sealTxt" d="M ${c - 50} ${c} a 50 50 0 1 1 100 0 a 50 50 0 1 1 -100 0"/>
      </defs>
      <path d="M58 120 L40 196 L56 184 L66 198 L78 128 Z" fill="url(#rib)"/>
      <path d="M102 120 L120 196 L104 184 L94 198 L82 128 Z" fill="url(#rib)"/>
      <path d="${starPolygon(c, c, 76, 69, 36)}" fill="url(#goldR)" stroke="#7a5717" stroke-width=".8"/>
      <circle cx="${c}" cy="${c}" r="63" fill="none" stroke="#fff3c4" stroke-width="1.2" opacity=".8"/>
      <circle cx="${c}" cy="${c}" r="60" fill="url(#goldR)" stroke="#8a6420" stroke-width="1"/>
      ${rosette({ cx: c, cy: c, R: 30, amp: 7, petals: 14, strands: 6, stroke: '#7a5717', width: 0.5, opacity: 0.55 })}
      <circle cx="${c}" cy="${c}" r="41" fill="none" stroke="#7a5717" stroke-width=".9" opacity=".7"/>
      <text font-family="Georgia, 'Times New Roman', serif" font-size="10.5" font-weight="700" letter-spacing="2.4" fill="#5e4210">
        <textPath href="#sealTxt" startOffset="0">★ PRIMARY EDUCATION ★ OFFICIAL SEAL OF EXCELLENCE</textPath>
      </text>
      <path d="${starPolygon(c, c, 16, 7, 5)}" fill="#7a1f2b" stroke="#fff0b8" stroke-width="1"/>
    </svg>`;
    ART.class7Seal = svgUri(svg);
    return ART.class7Seal;
  }

  function laurelArt(color1 = '#b8892f', color2 = '#e6c065') {
    const key = `laurel-${color1}-${color2}`;
    if (ART[key]) return ART[key];
    const cx = 100; const cy = 100; const R = 74;
    let stems = '';
    let leaves = '';
    [1, -1].forEach((side) => {
      let d = '';
      for (let i = 0; i <= 30; i += 1) {
        const th = Math.PI / 2 - side * (0.25 + (i / 30) * 2.35);
        d += `${i ? 'L' : 'M'}${f(cx + R * Math.cos(th))} ${f(cy + R * Math.sin(th))}`;
      }
      stems += `<path d="${d}" stroke="${color1}" stroke-width="2.2" fill="none"/>`;
      for (let i = 0; i < 10; i += 1) {
        const th = Math.PI / 2 - side * (0.4 + i * 0.235);
        const rr = R + (i % 2 ? 7 : -7);
        const x = cx + rr * Math.cos(th);
        const y = cy + rr * Math.sin(th);
        const deg = (th * 180) / Math.PI + 90 + side * (i % 2 ? -28 : 28);
        leaves += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="12.5" ry="4.8" transform="rotate(${f(deg)} ${f(x)} ${f(y)})" fill="${i % 2 ? color1 : color2}"/>`;
      }
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      ${stems}${leaves}
      <circle cx="100" cy="176" r="4" fill="#7a1f2b"/>
    </svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }

  function portraitFrameArt(w, h, kind) {
    const key = `pframe-${kind}-${w}x${h}`;
    if (ART[key]) return ART[key];
    const pad = 12;
    const cx = w / 2 + pad;
    const cy = h / 2 + pad;
    let svg;
    if (kind === 'class7') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}">
        <defs>${GOLD_DEFS}</defs>
        <ellipse cx="${cx}" cy="${cy}" rx="${w / 2 + 9}" ry="${h / 2 + 9}" fill="none" stroke="url(#gold)" stroke-width="5"/>
        <ellipse cx="${cx}" cy="${cy}" rx="${w / 2 + 3}" ry="${h / 2 + 3}" fill="none" stroke="#0f1f45" stroke-width="2"/>
        <ellipse cx="${cx}" cy="${cy}" rx="${w / 2 + 11.5}" ry="${h / 2 + 11.5}" fill="none" stroke="#7a1f2b" stroke-width=".8"/>
      </svg>`;
    } else {
      const colors = ['#ff8a7a', '#ffc94d', '#f6c56b', '#f4a58a', '#e9a23b'];
      const R = w / 2 + 9;
      let dots = '';
      const n = 28;
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        dots += `<circle cx="${f(cx + R * Math.cos(a))}" cy="${f(cy + R * Math.sin(a))}" r="3.4" fill="${colors[i % colors.length]}"/>`;
      }
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}">
        <circle cx="${cx}" cy="${cy}" r="${w / 2 + 3}" fill="none" stroke="#ffffff" stroke-width="6"/>
        <circle cx="${cx}" cy="${cy}" r="${w / 2 + 3}" fill="none" stroke="#ffd9c9" stroke-width="1.2"/>
        ${dots}
      </svg>`;
    }
    ART[key] = svgUri(svg);
    return ART[key];
  }

  // ---------- Pre-Unit art ----------
  const PASTEL = { coral: '#ff8a7a', sun: '#ffc94d', mint: '#f6c56b', sky: '#f4a58a', lilac: '#e9a23b', plum: '#8f3a22', teal: '#1f8a8a', ink: '#22304f' };

  function preunitFrameArt() {
    if (ART.preFrame) return ART.preFrame;
    const colors = [PASTEL.coral, PASTEL.sun, PASTEL.mint, PASTEL.sky, PASTEL.lilac];
    const pts = roundedRectSamples(30, 30, W - 60, H - 60, 30, 26);
    const scallops = pts.map(([x, y], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="15" fill="${colors[i % colors.length]}"/>`).join('');
    const sparkle = (x, y, s, c) => `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="${c}"/>`;
    const star = (x, y, s, c, o = 1) => `<path d="${starPolygon(x, y, s, s * 0.45, 5)}" fill="${c}" opacity="${o}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <radialGradient id="bgP" cx=".5" cy=".5" r=".8"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#fff3e2"/></radialGradient>
        <radialGradient id="blobA" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd6cc" stop-opacity=".9"/><stop offset="1" stop-color="#ffd6cc" stop-opacity="0"/></radialGradient>
        <radialGradient id="blobB" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff0d6" stop-opacity=".9"/><stop offset="1" stop-color="#fff0d6" stop-opacity="0"/></radialGradient>
        <radialGradient id="blobC" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffeccc" stop-opacity=".9"/><stop offset="1" stop-color="#ffeccc" stop-opacity="0"/></radialGradient>
        <radialGradient id="blobD" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe3d6" stop-opacity=".9"/><stop offset="1" stop-color="#ffe3d6" stop-opacity="0"/></radialGradient>
        <radialGradient id="sunG" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#fff2b3"/><stop offset="1" stop-color="#ffb938"/></radialGradient>
        <linearGradient id="balA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb3a8"/><stop offset="1" stop-color="#f2685a"/></linearGradient>
        <linearGradient id="balB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe3b0"/><stop offset="1" stop-color="#f0a73a"/></linearGradient>
        <linearGradient id="balC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset="1" stop-color="#f2b01e"/></linearGradient>
        <linearGradient id="balD" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd0bf"/><stop offset="1" stop-color="#e0674a"/></linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#fffaf2"/>
      ${scallops}
      <rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="30" fill="url(#bgP)"/>
      <ellipse cx="160" cy="650" rx="260" ry="200" fill="url(#blobC)"/>
      <ellipse cx="980" cy="160" rx="260" ry="190" fill="url(#blobB)"/>
      <ellipse cx="1000" cy="660" rx="240" ry="180" fill="url(#blobA)"/>
      <ellipse cx="170" cy="150" rx="230" ry="170" fill="url(#blobD)"/>
      <rect x="44" y="44" width="${W - 88}" height="${H - 88}" rx="22" fill="none" stroke="${PASTEL.teal}" stroke-width="1.6" stroke-dasharray="2 7" stroke-linecap="round" opacity=".55"/>
      <rect x="52" y="52" width="${W - 104}" height="${H - 104}" rx="18" fill="none" stroke="#f7c9b8" stroke-width="1.2"/>

      <!-- sun -->
      <g transform="translate(118 118)">
        ${Array.from({ length: 12 }, (_, i) => `<path d="M0 -58 L7 -40 L-7 -40 Z" fill="#ffcf57" transform="rotate(${i * 30})"/>`).join('')}
        <circle r="36" fill="url(#sunG)"/>
        <circle cx="-12" cy="-4" r="3" fill="#7a4b12"/><circle cx="12" cy="-4" r="3" fill="#7a4b12"/>
        <path d="M-12 10 Q0 20 12 10" stroke="#7a4b12" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <circle cx="-20" cy="7" r="5" fill="#ff9d7a" opacity=".55"/><circle cx="20" cy="7" r="5" fill="#ff9d7a" opacity=".55"/>
      </g>

      <!-- clouds top right -->
      <g fill="#ffffff" opacity=".95">
        <ellipse cx="930" cy="104" rx="40" ry="18"/><ellipse cx="960" cy="92" rx="30" ry="22"/><ellipse cx="992" cy="106" rx="30" ry="16"/>
      </g>

      <!-- balloons right side -->
      <g>
        <path d="M948 352 C 940 420, 968 470, 952 540" stroke="#c9a27a" stroke-width="1.3" fill="none"/>
        <path d="M1002 330 C 1010 410, 980 460, 958 540" stroke="#c9a27a" stroke-width="1.3" fill="none"/>
        <path d="M1046 372 C 1030 440, 990 480, 962 540" stroke="#c9a27a" stroke-width="1.3" fill="none"/>
        <path d="M912 398 C 930 460, 950 500, 956 540" stroke="#c9a27a" stroke-width="1.3" fill="none"/>
        <ellipse cx="948" cy="306" rx="34" ry="42" fill="url(#balA)"/><path d="M943 347 l5 7 l5 -7z" fill="#f2685a"/>
        <ellipse cx="1002" cy="282" rx="31" ry="39" fill="url(#balB)"/><path d="M997 320 l5 7 l5 -7z" fill="#f0a73a"/>
        <ellipse cx="1044" cy="332" rx="27" ry="34" fill="url(#balC)"/><path d="M1039 365 l5 7 l5 -7z" fill="#f2b01e"/>
        <ellipse cx="910" cy="362" rx="25" ry="31" fill="url(#balD)"/><path d="M905 392 l5 7 l5 -7z" fill="#e0674a"/>
        <ellipse cx="936" cy="290" rx="8" ry="13" fill="#ffffff" opacity=".45" transform="rotate(-20 936 290)"/>
        <ellipse cx="991" cy="266" rx="7" ry="12" fill="#ffffff" opacity=".45" transform="rotate(-20 991 266)"/>
        <ellipse cx="1035" cy="320" rx="6" ry="10" fill="#ffffff" opacity=".45" transform="rotate(-20 1035 320)"/>
        <ellipse cx="902" cy="352" rx="5" ry="9" fill="#ffffff" opacity=".45" transform="rotate(-20 902 352)"/>
        <path d="M940 540 h34 l-4 10 h-26 z" fill="#ff8a7a" opacity=".0"/>
      </g>

      <!-- stars & sparkles -->
      ${star(250, 92, 9, PASTEL.sun)}${star(860, 70, 7, PASTEL.coral)}${star(1060, 220, 8, PASTEL.lilac)}
      ${star(84, 300, 7, PASTEL.sky)}${star(92, 520, 8, PASTEL.coral)}${star(1066, 470, 7, PASTEL.mint)}
      ${star(300, 718, 8, PASTEL.lilac)}${star(820, 722, 9, PASTEL.sun)}${star(560, 66, 6, PASTEL.mint, 0.9)}
      ${sparkle(206, 236, 8, '#ffcf57')}${sparkle(1080, 600, 9, '#f4a58a')}${sparkle(70, 410, 7, '#e9a23b')}${sparkle(880, 470, 7, '#ff8a7a')}

      <!-- confetti -->
      ${[[140, 690, PASTEL.coral], [200, 700, PASTEL.sky], [960, 690, PASTEL.mint], [1030, 700, PASTEL.lilac], [700, 70, PASTEL.sky], [420, 70, PASTEL.coral]].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="10" height="5" rx="2" fill="${c}" transform="rotate(${(i * 37) % 90 - 30} ${x} ${y})"/>`).join('')}
    </svg>`;
    ART.preFrame = svgUri(svg);
    return ART.preFrame;
  }

  function gradCapArt() {
    if (ART.cap) return ART.cap;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">
      <path d="M30 40 L30 62 Q60 78 90 62 L90 40 Z" fill="#22304f"/>
      <path d="M60 14 L116 36 L60 58 L4 36 Z" fill="#2c3d63" stroke="#18223a" stroke-width="1.5"/>
      <path d="M60 14 L116 36 L60 40 Z" fill="#3d5280" opacity=".6"/>
      <circle cx="60" cy="36" r="4" fill="#ffc94d"/>
      <path d="M60 36 Q92 40 98 62" stroke="#ffc94d" stroke-width="2.6" fill="none"/>
      <path d="M93 60 l5 22 l6 -22 z" fill="#ffc94d"/>
    </svg>`;
    ART.cap = svgUri(svg);
    return ART.cap;
  }

  function preunitBadgeArt() {
    if (ART.preBadge) return ART.preBadge;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="190" viewBox="0 0 170 190">
      <defs><radialGradient id="bdg" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff3b8"/><stop offset=".6" stop-color="#ffcf57"/><stop offset="1" stop-color="#f2a81e"/></radialGradient></defs>
      <path d="M58 118 L38 186 L56 174 L68 188 L80 126 Z" fill="#ff8a7a"/>
      <path d="M112 118 L132 186 L114 174 L102 188 L90 126 Z" fill="#f4a58a"/>
      <path d="${starPolygon(85, 80, 74, 62, 24)}" fill="url(#bdg)" stroke="#e59a12" stroke-width="1.2"/>
      <circle cx="85" cy="80" r="52" fill="#ffffff" opacity=".92"/>
      <circle cx="85" cy="80" r="52" fill="none" stroke="#ff8a7a" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
      <circle cx="85" cy="80" r="45" fill="none" stroke="#ffcf57" stroke-width="1.5"/>
    </svg>`;
    ART.preBadge = svgUri(svg);
    return ART.preBadge;
  }

  // ---------- builders ----------
  function schoolBlock(d) {
    return d.school || { name: 'Socrates School', tagline: '', contact: '' };
  }

  function signatureCell(label, name, color, font, lineStyle) {
    return `
      <div style="width:250px;text-align:center;">
        <div style="height:42px;"></div>
        <div style="height:2px;${lineStyle}"></div>
        <div style="margin-top:8px;font-family:${font};font-size:15px;letter-spacing:.14em;color:${color};font-weight:700;">${esc(label)}</div>
        ${name ? `<div style="font-family:${font};font-size:12px;color:${color};opacity:.75;margin-top:2px;">${esc(name)}</div>` : ''}
      </div>`;
  }

  function buildClass7(d) {
    const s = schoolBlock(d);
    const date = formalDate(d.issuedDate);
    const navy = '#0f1f45';
    const burgundy = '#7a1f2b';
    const goldText = '#9c7425';
    const pulled = d.pulledUp;
    const classLabel = d.className || 'Class 7';
    const body = pulled
      ? `having shown outstanding merit in <b>${esc(classLabel)}</b>, is hereby admitted to graduate with the Class of ${esc(d.year)}, and is awarded this certificate in recognition thereof.`
      : `has satisfactorily completed the full course of <b>Primary Education</b> (Standard Seven) and is awarded this certificate in recognition of diligence, character and achievement.`;
    const node = document.createElement('div');
    node.className = 'somap-cert somap-cert--class7';
    node.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#fffdf6;color:${navy};`;
    node.innerHTML = `
      <img src="${class7FrameArt()}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>
      ${d.crestUrl ? `<img src="${esc(d.crestUrl)}" alt="" style="position:absolute;left:${W / 2 - 150}px;top:${H / 2 - 128}px;width:300px;height:300px;object-fit:contain;opacity:.05;"/>` : ''}

      <div style="position:absolute;left:0;right:0;top:64px;text-align:center;">
        ${crestHtml(d.crestData, 70, 'linear-gradient(135deg,#8a6420,#f3d27a,#fff0b8,#c99a3a,#7d5a1a)')}
      </div>

      <div style="position:absolute;left:120px;right:120px;top:146px;text-align:center;">
        <div data-fit="school" style="font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:28px;letter-spacing:.2em;color:${navy};white-space:nowrap;">${esc(String(s.name).toUpperCase())}</div>
        ${s.tagline ? `<div style="margin-top:3px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:16px;color:${burgundy};letter-spacing:.06em;">${esc(s.tagline)}</div>` : ''}
        ${s.contact ? `<div style="margin-top:2px;font-family:'Cinzel',Georgia,serif;font-size:10.5px;letter-spacing:.2em;color:${goldText};">${esc(s.contact)}</div>` : ''}
      </div>

      <div style="position:absolute;left:0;right:0;top:234px;text-align:center;">
        <div style="font-family:'Cinzel Decorative','Cinzel',Georgia,serif;font-weight:700;font-size:52px;line-height:1;letter-spacing:.06em;color:#a87b22;text-shadow:0 1px 0 #fff3c4,0 2px 0 #7d5a1a,0 4px 7px rgba(70,45,5,.28);">Certificate</div>
        <div style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:16px;">
          <div style="width:110px;height:2px;background:linear-gradient(90deg,rgba(156,116,37,0),#c99a3a);"></div>
          <div style="font-family:'Cinzel',Georgia,serif;font-weight:700;font-size:15px;letter-spacing:.34em;color:${navy};">OF COMPLETION OF PRIMARY EDUCATION</div>
          <div style="width:110px;height:2px;background:linear-gradient(90deg,#c99a3a,rgba(156,116,37,0));"></div>
        </div>
      </div>

      <div style="position:absolute;left:88px;top:316px;width:168px;height:206px;">
        <img src="${portraitFrameArt(144, 182, 'class7')}" alt="" style="position:absolute;left:0;top:0;width:168px;height:206px;"/>
        ${d.photoData
          ? `<img src="${esc(d.photoData)}" alt="" style="position:absolute;left:12px;top:12px;width:144px;height:182px;"/>`
          : `<div style="position:absolute;left:12px;top:12px;width:144px;height:182px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#f7efd9,#e6d6ae);display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:44px;color:#9c7425;">${esc(initials(d.name))}</div>`}
      </div>

      <div style="position:absolute;right:86px;top:322px;width:172px;height:172px;">
        <img src="${laurelArt()}" alt="" style="position:absolute;left:0;top:0;width:172px;height:172px;"/>
        <div style="position:absolute;left:0;right:0;top:50px;text-align:center;font-family:'Cinzel',Georgia,serif;color:${navy};">
          <div style="font-size:11px;letter-spacing:.32em;font-weight:700;color:${burgundy};">CLASS OF</div>
          <div style="font-size:38px;font-weight:700;letter-spacing:.04em;line-height:1.1;color:${navy};">${esc(d.year)}</div>
          <div style="font-size:9.5px;letter-spacing:.28em;font-weight:700;color:${goldText};">GRADUATE</div>
        </div>
      </div>

      <div style="position:absolute;left:276px;right:276px;top:332px;text-align:center;">
        <div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:21px;color:#3b4766;">This is to certify that</div>
        <div data-fit="name" style="margin-top:4px;font-family:'Pinyon Script',cursive;font-size:62px;line-height:1.25;color:${navy};white-space:nowrap;">${esc(toTitleCase(d.name))}</div>
        <div style="margin:2px auto 0;width:470px;height:2px;background:linear-gradient(90deg,rgba(201,154,58,0),#c99a3a 20%,#f7e2a0 50%,#c99a3a 80%,rgba(201,154,58,0));"></div>
        <div style="margin-top:12px;font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:18.5px;line-height:1.5;color:#2a3553;">${body}</div>
        <div style="margin-top:8px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;color:${burgundy};">Given at ${esc(s.name)} this ${esc(date.day)} day of ${esc(date.month)}, ${esc(date.year)}</div>
      </div>

      <div style="position:absolute;left:120px;right:120px;top:584px;display:flex;justify-content:space-between;align-items:flex-end;">
        ${signatureCell('HEAD TEACHER', d.headTeacherName, navy, "'Cinzel',Georgia,serif", 'background:linear-gradient(90deg,rgba(15,31,69,0),#0f1f45 15%,#0f1f45 85%,rgba(15,31,69,0));')}
        <div style="width:150px;"></div>
        ${signatureCell('ACADEMIC TEACHER', d.academicTeacherName, navy, "'Cinzel',Georgia,serif", 'background:linear-gradient(90deg,rgba(15,31,69,0),#0f1f45 15%,#0f1f45 85%,rgba(15,31,69,0));')}
      </div>
      <img src="${class7SealArt()}" alt="" style="position:absolute;left:${W / 2 - 62}px;top:566px;width:124px;height:155px;"/>

      <div style="position:absolute;left:0;right:0;top:718px;display:flex;align-items:center;justify-content:center;gap:10px;font-family:'Cinzel',Georgia,serif;font-size:9.5px;letter-spacing:.18em;color:#6b5a35;">
        <img src="${esc(d.somapLogoUrl)}" alt="" style="width:16px;height:16px;object-fit:contain;"/>
        <span>ADM ${esc(d.admissionNo)} · CERT NO. ${esc(d.serial)} · ${esc(date.short)}</span>
      </div>`;
    return node;
  }

  function buildPreunit(d) {
    const s = schoolBlock(d);
    const date = formalDate(d.issuedDate);
    const pulled = d.pulledUp;
    const body = pulled
      ? `shone so brightly in <b>${esc(d.className || 'class')}</b> that we proudly graduate this little star with the Class of ${esc(d.year)}. Hello, Class One!`
      : `has joyfully completed <b>Pre-Primary Education</b> and is ready to fly high into Class One. We are so proud of you!`;
    const node = document.createElement('div');
    node.className = 'somap-cert somap-cert--preunit';
    node.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#fffaf2;color:${PASTEL.ink};`;
    node.innerHTML = `
      <img src="${preunitFrameArt()}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>

      <div style="position:absolute;left:0;right:0;top:62px;text-align:center;">
        ${crestHtml(d.crestData, 62, 'linear-gradient(135deg,#ff8a7a,#ffc94d,#f6c56b,#f4a58a,#e9a23b)')}
      </div>
      <div style="position:absolute;left:250px;right:250px;top:138px;text-align:center;">
        <div data-fit="school" style="font-family:'Fredoka','Nunito',sans-serif;font-weight:700;font-size:26px;letter-spacing:.06em;color:${PASTEL.teal};white-space:nowrap;">${esc(s.name)}</div>
        ${s.tagline ? `<div style="font-family:'Nunito',sans-serif;font-weight:700;font-size:12.5px;letter-spacing:.16em;color:#b07a52;text-transform:uppercase;">${esc(s.tagline)}</div>` : ''}
      </div>

      <div style="position:absolute;left:0;right:0;top:190px;text-align:center;">
        <div style="font-family:'Fredoka','Nunito',sans-serif;font-weight:700;font-size:54px;line-height:1.05;color:#f26b5b;letter-spacing:.01em;text-shadow:0 3px 0 #ffffff,0 5px 0 #ffe2cf,0 8px 14px rgba(242,107,91,.25);">Certificate of Graduation</div>
        <div style="margin-top:10px;display:inline-block;padding:6px 22px;border-radius:999px;background:#ffffff;border:2px solid #ffe1d6;font-family:'Nunito',sans-serif;font-weight:800;font-size:13.5px;letter-spacing:.3em;color:${PASTEL.teal};">PRE-PRIMARY · CLASS OF ${esc(d.year)}</div>
      </div>

      <div style="position:absolute;left:86px;top:300px;width:214px;height:214px;">
        <img src="${portraitFrameArt(190, 190, 'preunit')}" alt="" style="position:absolute;left:0;top:0;width:214px;height:214px;"/>
        ${d.photoData
          ? `<img src="${esc(d.photoData)}" alt="" style="position:absolute;left:12px;top:12px;width:190px;height:190px;"/>`
          : `<div style="position:absolute;left:12px;top:12px;width:190px;height:190px;border-radius:50%;background:radial-gradient(circle at 45% 35%,#fff6e6,#ffe0c9);display:flex;align-items:center;justify-content:center;font-family:'Fredoka',sans-serif;font-weight:700;font-size:62px;color:#f26b5b;">${esc(initials(d.name))}</div>`}
        <img src="${gradCapArt()}" alt="" style="position:absolute;left:-26px;top:-36px;width:118px;height:88px;transform:rotate(-16deg);"/>
      </div>

      <div style="position:absolute;left:320px;right:250px;top:312px;text-align:center;">
        <div style="font-family:'Nunito',sans-serif;font-weight:700;font-size:18px;color:#9a6b4f;letter-spacing:.04em;">This certificate is proudly presented to</div>
        <div data-fit="name" style="margin-top:2px;font-family:'Pacifico','Fredoka',cursive;font-size:50px;line-height:1.45;color:${PASTEL.plum};white-space:nowrap;">${esc(toTitleCase(d.name))}</div>
        <div style="margin:0 auto;width:420px;height:6px;border-radius:6px;background:linear-gradient(90deg,#ff8a7a,#ffc94d,#f6c56b,#f4a58a,#e9a23b);opacity:.85;"></div>
        <div style="margin-top:14px;font-family:'Nunito',sans-serif;font-weight:700;font-size:18.5px;line-height:1.5;color:#4a3b63;">${body}</div>
        <div style="margin-top:8px;font-family:'Fredoka',sans-serif;font-weight:600;font-size:15px;color:#f26b5b;letter-spacing:.04em;">Awarded on the ${esc(date.day)} of ${esc(date.month)} ${esc(date.year)}</div>
      </div>

      <div style="position:absolute;left:120px;right:120px;top:576px;display:flex;justify-content:space-between;align-items:flex-end;">
        ${signatureCell('HEAD TEACHER', d.headTeacherName, PASTEL.teal, "'Nunito',sans-serif", `height:3px;background:linear-gradient(90deg,${PASTEL.coral},${PASTEL.sun},${PASTEL.mint},${PASTEL.sky});border-radius:3px;`)}
        <div style="width:150px;"></div>
        ${signatureCell('ACADEMIC TEACHER', d.academicTeacherName, PASTEL.teal, "'Nunito',sans-serif", `height:3px;background:linear-gradient(90deg,${PASTEL.sky},${PASTEL.lilac},${PASTEL.coral},${PASTEL.sun});border-radius:3px;`)}
      </div>
      <div style="position:absolute;left:${W / 2 - 74}px;top:548px;width:148px;height:166px;">
        <img src="${preunitBadgeArt()}" alt="" style="position:absolute;left:0;top:0;width:148px;height:166px;"/>
        <div style="position:absolute;left:0;right:0;top:44px;text-align:center;font-family:'Fredoka',sans-serif;color:#f26b5b;">
          <div style="font-weight:700;font-size:20px;line-height:1;">WELL</div>
          <div style="font-weight:700;font-size:20px;line-height:1.05;color:${PASTEL.teal};">DONE!</div>
          <div style="font-weight:600;font-size:11px;letter-spacing:.14em;color:#b07a52;margin-top:3px;">${esc(d.year)}</div>
        </div>
      </div>

      <div style="position:absolute;left:0;right:0;top:722px;display:flex;align-items:center;justify-content:center;gap:9px;font-family:'Nunito',sans-serif;font-weight:700;font-size:10px;letter-spacing:.14em;color:#a88468;">
        <img src="${esc(d.somapLogoUrl)}" alt="" style="width:16px;height:16px;object-fit:contain;"/>
        <span>ADM ${esc(d.admissionNo)} · CERT NO. ${esc(d.serial)}${s.contact ? ` · ${esc(s.contact)}` : ''}</span>
      </div>`;
    return node;
  }

  function initials(name) {
    return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '★';
  }

  /** Shrink single-line text so it never overflows its column. Call after the node is in the DOM. */
  function fitText(node) {
    node.querySelectorAll('[data-fit]').forEach((el) => {
      const parent = el.parentElement;
      const max = parent ? parent.clientWidth : el.clientWidth;
      let size = parseFloat(el.style.fontSize) || 40;
      let guard = 40;
      while (el.scrollWidth > max && size > 14 && guard > 0) {
        size -= 1.5;
        el.style.fontSize = `${size}px`;
        guard -= 1;
      }
    });
  }

  /**
   * Resolve all async assets (fonts, photo, logos) and return a built, fitted
   * certificate node attached to `host` (an offscreen container).
   */
  async function render(host, data) {
    const kind = data.kind || kindFor(data.className);
    const fontsOk = await ensureFonts();
    const crestSize = kind === 'preunit' ? 62 : 70;
    const crestSrc = data.school?.logoUrl || SOMAP_LOGO;
    const crestKey = `crest-${crestSize}-${crestSrc}`;
    const [photoData, somapLogoUrl, crestData] = await Promise.all([
      data.photoUrl ? preparePortrait(data.photoUrl, kind === 'preunit' ? 190 : 144, kind === 'preunit' ? 190 : 182) : Promise.resolve(''),
      ART.somapLogo ? Promise.resolve(ART.somapLogo) : imageToDataUrl(SOMAP_LOGO).then((u) => u || imageToDataUrl(SOMAP_LOGO_FALLBACK)).then((u) => { ART.somapLogo = u || SOMAP_LOGO_FALLBACK; return ART.somapLogo; }),
      ART[crestKey] ? Promise.resolve(ART[crestKey]) : makeCrest(crestSrc, crestSize)
        .then((u) => u || makeCrest(SOMAP_LOGO_FALLBACK, crestSize))
        .then((u) => { if (u) ART[crestKey] = u; return u; }),
    ]);
    const full = { ...data, kind, photoData, somapLogoUrl, crestData, crestUrl: data.school?.logoUrl ? crestData : '' };
    const node = kind === 'preunit' ? buildPreunit(full) : buildClass7(full);
    host.innerHTML = '';
    host.appendChild(node);
    fitText(node);
    await Promise.all(Array.from(node.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    return { node, kind, fontsOk, missingFonts: fontsMissing(), hasPhoto: Boolean(photoData) };
  }

  function renderScale() {
    const mem = Number(navigator.deviceMemory || 8);
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    if (mobile || mem <= 3) return 2;
    return 3; // ~290 dpi on A4 — crisp print
  }

  /** Rasterise a rendered node (html2canvas). */
  async function toCanvas(node) {
    if (!window.html2canvas) throw new Error('html2canvas is not loaded');
    return window.html2canvas(node, {
      scale: renderScale(),
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: W,
      height: H,
      windowWidth: W,
      windowHeight: H,
    });
  }

  window.GradCertDesigns = {
    W, H, kindFor, render, toCanvas, ensureFonts, fontsMissing, formalDate, toTitleCase,
    // Drawing kit shared with js/award_cert_designs.js (Top Students awards).
    _kit: { esc, svgUri, f, GOLD_DEFS, guillocheBand, rosette, starPolygon, roundedRectSamples, laurelArt, preparePortrait, makeCrest, crestHtml, imageToDataUrl, fitText, initials, signatureCell, ART, SOMAP_LOGO, SOMAP_LOGO_FALLBACK },
  };
}(window));
