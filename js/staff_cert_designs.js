/*
 * SoMAp Staff certificates (2026+): three designs that never resemble each other.
 *   teacher      — Best Teacher of the Year: emerald & gold, Greek-key border, arch portrait,
 *                  laurel position crest, subject results table.
 *   worker       — Best Worker of the Year: charcoal & copper Art Deco, sunburst, hexagon
 *                  portrait, deco shield, service evidence strip.
 *   appreciation — Certificate of Appreciation: ivory, sage & terracotta botanical vines,
 *                  leaf-wreath round portrait, script "Thank You", wax seal. No ranking.
 * Requires js/grad_cert_designs.js (kit: fonts, crest, fitText, html2canvas helpers).
 * html2canvas-safe: no CSS filters/masks/object-fit; photos are shaped on a canvas.
 */
(function (window) {
  'use strict';
  const G = window.GradCertDesigns;
  if (!G || !G._kit) { console.error('staff_cert_designs: load grad_cert_designs.js first'); return; }
  const K = G._kit;
  const { esc, svgUri, f, starPolygon } = K;
  const W = G.W; const H = G.H;
  const ART = K.ART;
  const EXTRA_FONTS = ['700 40px "Playfair Display"', 'italic 600 40px "Playfair Display"', '400 40px "Great Vibes"', '600 20px "Marcellus"'];

  // ---------- shaped, brightened portraits ----------
  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      if (!/^data:|^blob:/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  function shapePath(ctx, shape, w, h) {
    ctx.beginPath();
    if (shape === 'arch') {
      const r = w / 2;
      ctx.moveTo(0, h); ctx.lineTo(0, r); ctx.arc(r, r, r, Math.PI, 0); ctx.lineTo(w, h); ctx.closePath();
    } else if (shape === 'hex') {
      const pts = [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]];
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      ctx.closePath();
    } else {
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    }
  }
  async function shapedPortrait(src, w, h, shape) {
    const img = await loadImage(src);
    if (!img) return '';
    const s = 3; const cw = Math.round(w * s); const ch = Math.round(h * s);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    const iw = img.naturalWidth; const ih = img.naturalHeight;
    const ratio = Math.max(cw / iw, ch / ih);
    const sw = cw / ratio; const sh = ch / ratio;
    const sx = (iw - sw) / 2; const sy = Math.max(0, Math.min(ih - sh, (ih - sh) * 0.3));
    ctx.save(); ctx.scale(s, s); shapePath(ctx, shape, w, h); ctx.restore();
    ctx.save(); ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    ctx.restore();
    try {
      const data = ctx.getImageData(0, 0, cw, ch); const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        for (let k = 0; k < 3; k += 1) { let v = px[i + k] / 255; v = ((v - 0.5) * 1.05 + 0.5) * 1.08; px[i + k] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255; }
      }
      ctx.putImageData(data, 0, 0);
      return c.toDataURL('image/png');
    } catch (_) { return ''; }
  }

  // ---------- TEACHER: emerald & gold, Greek key ----------
  const T = { em: '#0b4d3b', emDeep: '#073528', gold: '#b8892f', goldLight: '#e6c065', paper: '#fbf8ef' };
  function greekKeyStrip(x, y, len, size, color, vertical) {
    // one meander unit is size*4 long
    let d = '';
    const unit = size * 4;
    for (let p = 0; p + unit <= len; p += unit) {
      const seg = [[0, size * 2], [0, 0], [size * 3, 0], [size * 3, size * 2], [size, size * 2], [size, size], [size * 2, size], [size * 2, size * 3], [size * 4, size * 3]];
      seg.forEach(([a, b], i) => {
        const px = vertical ? x + b : x + p + a;
        const py = vertical ? y + p + a : y + b;
        d += `${i ? 'L' : 'M'}${f(px)} ${f(py)}`;
      });
    }
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(size * 0.42)}" stroke-linecap="square"/>`;
  }
  function teacherFrame() {
    if (ART.staffTeacherFrame) return ART.staffTeacherFrame;
    const s = 6;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>${K.GOLD_DEFS}<radialGradient id="tp" cx=".5" cy=".42" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".65" stop-color="${T.paper}"/><stop offset="1" stop-color="#f1ead6"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="${T.em}"/>
      <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="${T.emDeep}"/>
      ${greekKeyStrip(30, 22, W - 60, s, T.goldLight)}${greekKeyStrip(30, H - 22 - s * 3, W - 60, s, T.goldLight)}
      ${greekKeyStrip(22, 48, H - 96, s, T.goldLight, true)}${greekKeyStrip(W - 22 - s * 3, 48, H - 96, s, T.goldLight, true)}
      <rect x="52" y="52" width="${W - 104}" height="${H - 104}" fill="url(#tp)"/>
      <rect x="52" y="52" width="${W - 104}" height="${H - 104}" fill="none" stroke="url(#gold)" stroke-width="3"/>
      <rect x="61" y="61" width="${W - 122}" height="${H - 122}" fill="none" stroke="${T.em}" stroke-width="1"/>
      ${K.rosette({ cx: W / 2, cy: H / 2 + 30, R: 200, amp: 24, petals: 20, strands: 6, stroke: T.em, width: 0.45, opacity: 0.06 })}

    </svg>`;
    ART.staffTeacherFrame = svgUri(svg);
    return ART.staffTeacherFrame;
  }
  function archFrame(w, h) {
    const key = `arch-${w}-${h}`;
    if (ART[key]) return ART[key];
    const p = 10; const r = w / 2 + 6;
    const d = (o) => `M${p - o} ${h + p + o} L${p - o} ${r + p - 6} A${r + o} ${r + o} 0 0 1 ${w + p + o} ${r + p - 6} L${w + p + o} ${h + p + o} Z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + p * 2}" height="${h + p * 2}" viewBox="0 0 ${w + p * 2} ${h + p * 2}"><defs>${K.GOLD_DEFS}</defs>
      <path d="${d(4)}" fill="none" stroke="url(#gold)" stroke-width="4.5"/><path d="${d(-1)}" fill="none" stroke="${T.em}" stroke-width="1.6"/></svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }
  const ordinal = (p) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[p] || `${p}th`);

  function buildTeacher(d) {
    const s = d.school || {};
    const date = G.formalDate(d.issuedDate);
    const subjects = (d.subjects || []).slice(0, 8);
    const node = document.createElement('div');
    node.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${T.paper};color:${T.emDeep};`;
    node.innerHTML = `
      <img src="${teacherFrame()}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>
      <div style="position:absolute;left:0;right:0;top:70px;text-align:center;">${K.crestHtml(d.crestData, 58, `linear-gradient(135deg,${T.em},${T.goldLight})`)}</div>
      <div style="position:absolute;left:160px;right:160px;top:142px;text-align:center;">
        <div data-fit="school" style="font-family:'Cinzel',serif;font-weight:700;font-size:21px;letter-spacing:.2em;color:${T.em};white-space:nowrap;">${esc(String(s.name || '').toUpperCase())}</div>
      </div>
      <div style="position:absolute;left:0;right:0;top:176px;text-align:center;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:44px;line-height:1.05;color:${T.emDeep};">Best Teacher of the Year</div>
        <div style="margin-top:8px;font-family:'Cinzel',serif;font-weight:700;font-size:13px;letter-spacing:.32em;color:${T.gold};">EXCELLENCE IN TEACHING · ${esc(String(d.groupShort || '').toUpperCase())} · ${esc(d.year)}</div>
      </div>
      <div style="position:absolute;left:92px;top:262px;width:160px;height:212px;">
        <img src="${archFrame(140, 192)}" alt="" style="position:absolute;left:0;top:0;width:160px;height:212px;"/>
        ${d.photoData ? `<img src="${esc(d.photoData)}" alt="" style="position:absolute;left:10px;top:10px;width:140px;height:192px;"/>`
          : `<div style="position:absolute;left:10px;top:10px;width:140px;height:192px;border-radius:70px 70px 0 0;background:#eef4ef;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:40px;color:${T.em};">${esc(K.initials(d.name))}</div>`}
      </div>
      <div style="position:absolute;right:88px;top:258px;width:176px;height:176px;">
        <img src="${K.laurelArt(T.em, T.gold)}" alt="" style="position:absolute;left:0;top:0;width:176px;height:176px;"/>
        <div style="position:absolute;left:0;right:0;top:52px;text-align:center;font-family:'Playfair Display',Georgia,serif;color:${T.emDeep};">
          <div style="font-size:46px;font-weight:700;line-height:1;">${esc(ordinal(d.position))}</div>
          <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.3em;font-weight:700;color:${T.gold};margin-top:4px;">POSITION</div>
        </div>
      </div>
      <div style="position:absolute;left:282px;right:282px;top:270px;text-align:center;">
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:19px;color:${T.em};">This certificate is proudly awarded to</div>
        <div data-fit="name" style="font-family:'Pinyon Script',cursive;font-size:54px;line-height:1.3;color:${T.emDeep};white-space:nowrap;">${esc(G.toTitleCase(d.name))}</div>
        <div style="margin:0 auto;width:380px;height:2px;background:linear-gradient(90deg,rgba(0,0,0,0),${T.gold},rgba(0,0,0,0));"></div>
        <div style="margin-top:10px;font-family:'Cormorant Garamond',serif;font-weight:500;font-size:17.5px;line-height:1.45;color:#23362f;">for the highest learner results in the ${esc(d.year)} annual examinations — <b>Position ${esc(d.position)}</b> among ${esc(d.groupLabel || 'teachers')}, with an annual teaching average of <b>${esc(Number(d.score).toFixed(2))}%</b>.</div>
      </div>
      <div style="position:absolute;left:150px;right:150px;top:490px;">
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px 8px;">
          ${subjects.map((x) => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid ${T.goldLight};background:#ffffff;font-family:'Cormorant Garamond',serif;font-weight:600;font-size:13px;color:${T.emDeep};">${esc(x.label)} <b style="color:${T.gold};">${esc(Number(x.average).toFixed(1))}%</b></span>`).join('')}
        </div>
      </div>
      <div style="position:absolute;left:130px;right:130px;top:586px;display:flex;justify-content:space-between;align-items:flex-end;">
        ${K.signatureCell('HEAD TEACHER', '', T.emDeep, "'Cinzel',serif", `background:${T.em};`)}
        <div style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:15px;color:${T.em};padding-bottom:6px;">${esc(date.day)} ${esc(date.month)} ${esc(date.year)}</div>
        ${K.signatureCell('ACADEMIC TEACHER', '', T.emDeep, "'Cinzel',serif", `background:${T.em};`)}
      </div>
      <div style="position:absolute;left:0;right:0;top:${H - 82}px;display:flex;align-items:center;justify-content:center;gap:8px;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.16em;color:${T.em};">
        <img src="${esc(d.somapLogoUrl)}" alt="" style="width:15px;height:15px;"/><span>${esc(d.footer || '')}</span></div>`;
    return node;
  }

  // ---------- WORKER: charcoal & copper Art Deco ----------
  const D = { ink: '#1c2530', ink2: '#2a3644', copper: '#b8733a', copperLight: '#e7b07a', paper: '#f7f3ec' };
  function workerFrame() {
    if (ART.staffWorkerFrame) return ART.staffWorkerFrame;
    const rays = Array.from({ length: 19 }, (_, i) => {
      const a = Math.PI + (i * Math.PI) / 18;
      return `<path d="M${W / 2} 250 L${f(W / 2 + 520 * Math.cos(a - 0.03))} ${f(250 + 520 * Math.sin(a - 0.03))} L${f(W / 2 + 520 * Math.cos(a + 0.03))} ${f(250 + 520 * Math.sin(a + 0.03))} Z" fill="${D.copper}" opacity="${i % 2 ? 0.05 : 0.09}"/>`;
    }).join('');
    const stepCorner = (x, y, sx, sy) => `<path d="M${x} ${y + sy * 90} V${y} H${x + sx * 90} M${x + sx * 12} ${y + sy * 70} V${y + sy * 12} H${x + sx * 70} M${x + sx * 24} ${y + sy * 50} V${y + sy * 24} H${x + sx * 50}" fill="none" stroke="${D.copper}" stroke-width="2.4"/><rect x="${x + sx * 30 - 5}" y="${y + sy * 30 - 5}" width="10" height="10" transform="rotate(45 ${x + sx * 30} ${y + sy * 30})" fill="${D.copperLight}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><clipPath id="paperClip"><rect x="27" y="27" width="${W - 54}" height="${H - 54}"/></clipPath><linearGradient id="cp" x1="0" x2="1"><stop offset="0" stop-color="#8a4f22"/><stop offset=".5" stop-color="${D.copperLight}"/><stop offset="1" stop-color="#8a4f22"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="${D.ink}"/>
      <rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="${D.paper}"/>
      <rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="url(#cp)" stroke-width="4"/>
      <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${D.ink}" stroke-width="1.2"/>
      <rect x="46" y="46" width="${W - 92}" height="${H - 92}" fill="none" stroke="${D.copper}" stroke-width=".8"/>
      <g clip-path="url(#paperClip)">${rays}</g>
      ${stepCorner(46, 46, 1, 1)}${stepCorner(W - 46, 46, -1, 1)}${stepCorner(46, H - 46, 1, -1)}${stepCorner(W - 46, H - 46, -1, -1)}
      <path d="M${W / 2 - 230} ${H - 112} H${W / 2 + 230}" stroke="${D.copper}" stroke-width="1" opacity=".5"/>
    </svg>`;
    ART.staffWorkerFrame = svgUri(svg);
    return ART.staffWorkerFrame;
  }
  function hexFrame(w, h) {
    const key = `hex-${w}-${h}`;
    if (ART[key]) return ART[key];
    const p = 10;
    const pts = (o) => [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]].map(([x, y]) => `${f(p + x * w + (x - 0.5) * o * 2)},${f(p + y * h + (y - 0.5) * o * 2)}`).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + p * 2}" height="${h + p * 2}" viewBox="0 0 ${w + p * 2} ${h + p * 2}">
      <polygon points="${pts(6)}" fill="none" stroke="${D.copper}" stroke-width="4"/><polygon points="${pts(1)}" fill="none" stroke="${D.ink}" stroke-width="1.6"/></svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }
  function decoShield(position) {
    const key = `shield-${position}`;
    if (ART[key]) return ART[key];
    const tone = { 1: ['#7d5a1a', '#e6c065', '#fff4c7'], 2: ['#5b6470', '#c7ced8', '#ffffff'], 3: ['#6e3412', '#cf8a55', '#ffe0c4'] }[position] || ['#555', '#aaa', '#eee'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="180" viewBox="0 0 150 180">
      <defs><linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tone[2]}"/><stop offset=".45" stop-color="${tone[1]}"/><stop offset="1" stop-color="${tone[0]}"/></linearGradient></defs>
      <path d="M75 6 L140 26 V86 C140 130 110 158 75 174 C40 158 10 130 10 86 V26 Z" fill="${D.ink}"/>
      <path d="M75 16 L130 33 V86 C130 124 104 148 75 162 C46 148 20 124 20 86 V33 Z" fill="url(#sh)"/>
      <path d="M75 16 V162 M20 60 H130" stroke="${D.ink}" stroke-width="1" opacity=".25"/>
      <path d="${starPolygon(75, 52, 12, 5, 5)}" fill="${D.ink}" opacity=".75"/>
    </svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }
  function buildWorker(d) {
    const s = d.school || {};
    const date = G.formalDate(d.issuedDate);
    const stat = (label, value) => `<div style="flex:1;min-width:0;text-align:center;padding:8px 4px;border-left:1px solid rgba(184,115,58,.35);">
      <div style="font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:21px;color:${D.ink};">${esc(value)}</div>
      <div style="font-family:'Cinzel',serif;font-size:8.5px;letter-spacing:.16em;color:${D.copper};font-weight:700;margin-top:2px;">${esc(label)}</div></div>`;
    const node = document.createElement('div');
    node.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${D.paper};color:${D.ink};`;
    node.innerHTML = `
      <img src="${workerFrame()}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>
      <div style="position:absolute;left:0;right:0;top:64px;text-align:center;">${K.crestHtml(d.crestData, 56, `linear-gradient(135deg,#8a4f22,${D.copperLight})`)}</div>
      <div style="position:absolute;left:160px;right:160px;top:132px;text-align:center;">
        <div data-fit="school" style="font-family:'Cinzel',serif;font-weight:700;font-size:20px;letter-spacing:.24em;color:${D.ink};white-space:nowrap;">${esc(String(s.name || '').toUpperCase())}</div>
      </div>
      <div style="position:absolute;left:0;right:0;top:164px;text-align:center;">
        <div style="font-family:'Cinzel',serif;font-weight:700;font-size:15px;letter-spacing:.5em;color:${D.copper};">DISTINGUISHED SERVICE AWARD</div>
        <div style="margin-top:6px;font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:46px;line-height:1.05;letter-spacing:.01em;color:${D.ink};">Best Worker of the Year</div>
      </div>
      <div style="position:absolute;left:92px;top:262px;width:168px;height:196px;">
        <img src="${hexFrame(148, 176)}" alt="" style="position:absolute;left:0;top:0;width:168px;height:196px;"/>
        ${d.photoData ? `<img src="${esc(d.photoData)}" alt="" style="position:absolute;left:10px;top:10px;width:148px;height:176px;"/>`
          : `<div style="position:absolute;left:24px;top:40px;width:120px;height:116px;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:40px;color:${D.copper};">${esc(K.initials(d.name))}</div>`}
      </div>
      <div style="position:absolute;right:98px;top:262px;width:150px;height:180px;">
        <img src="${decoShield(d.position)}" alt="" style="position:absolute;left:0;top:0;width:150px;height:180px;"/>
        <div style="position:absolute;left:0;right:0;top:74px;text-align:center;font-family:'Playfair Display',Georgia,serif;color:${D.ink};">
          <div style="font-size:50px;font-weight:700;line-height:1;">${esc(d.position)}</div>
          <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.3em;font-weight:700;margin-top:2px;">POSITION</div>
        </div>
      </div>
      <div style="position:absolute;left:290px;right:290px;top:270px;text-align:center;">
        <div style="font-family:'Cinzel',serif;font-size:12px;letter-spacing:.3em;color:${D.copper};font-weight:700;">PRESENTED TO</div>
        <div data-fit="name" style="margin-top:4px;font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:600;font-size:50px;line-height:1.2;color:${D.ink};white-space:nowrap;">${esc(G.toTitleCase(d.name))}</div>
        ${d.role ? `<div style="font-family:'Cinzel',serif;font-size:12px;letter-spacing:.2em;color:${D.ink2};margin-top:2px;">${esc(String(d.role).toUpperCase())}</div>` : ''}
        <div style="margin-top:12px;font-family:'Cormorant Garamond',serif;font-weight:500;font-size:17.5px;line-height:1.45;color:#2d3743;">for exemplary presence, punctuality and faithful following of school protocol from 1 January to ${esc(d.untilLabel || date.short)} — <b>Position ${esc(d.position)}</b> among all workers in ${esc(d.year)}.</div>
      </div>
      <div style="position:absolute;left:170px;right:170px;top:484px;display:flex;border:1px solid rgba(184,115,58,.45);border-left:0;background:rgba(255,255,255,.7);">
        ${stat('DAYS PRESENT', `${d.signIns}/${d.workDays}`)}${stat('ON TIME', `${Math.round((d.punctuality || 0) * 100)}%`)}${stat('SIGNED OUT', d.signOuts)}${stat('LETTERS', d.letters)}${stat('AVG ARRIVAL', d.avgArrivalLabel || '—')}
      </div>
      <div style="position:absolute;left:130px;right:130px;top:588px;display:flex;justify-content:space-between;align-items:flex-end;">
        ${K.signatureCell('HEAD TEACHER', '', D.ink, "'Cinzel',serif", `background:${D.copper};`)}
        <div style="font-family:'Cinzel',serif;font-size:11px;letter-spacing:.2em;color:${D.copper};padding-bottom:6px;">${esc(date.day)} ${esc(date.month).toUpperCase()} ${esc(date.year)}</div>
        ${K.signatureCell('DIRECTOR', '', D.ink, "'Cinzel',serif", `background:${D.copper};`)}
      </div>
      <div style="position:absolute;left:0;right:0;top:${H - 70}px;display:flex;align-items:center;justify-content:center;gap:8px;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.16em;color:${D.copper};">
        <img src="${esc(d.somapLogoUrl)}" alt="" style="width:15px;height:15px;"/><span>${esc(d.footer || '')}</span></div>`;
    return node;
  }

  // ---------- APPRECIATION: ivory botanical ----------
  const A = { sage: '#5f8a68', sageLight: '#a9c3a6', terra: '#c0714f', ink: '#3a3226', paper: '#fdfaf2' };
  function vine(x, y, len, angle, flip) {
    // a curved stem with alternating leaves
    let out = '';
    const pts = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const px = t * len; const py = Math.sin(t * Math.PI) * 26 * (flip ? -1 : 1);
      pts.push([px, py]);
    }
    const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)} ${f(py)}`).join('');
    out += `<path d="${d}" fill="none" stroke="${A.sage}" stroke-width="2"/>`;
    for (let i = 2; i < 24; i += 3) {
      const [px, py] = pts[i];
      const side = (i % 2 ? 1 : -1) * (flip ? -1 : 1);
      const rot = side * 50 + (flip ? -10 : 10);
      out += `<ellipse cx="${f(px)}" cy="${f(py + side * 9)}" rx="11" ry="4.6" transform="rotate(${rot} ${f(px)} ${f(py + side * 9)})" fill="${i % 6 === 2 ? A.sageLight : A.sage}" opacity=".9"/>`;
      if (i % 9 === 5) out += `<circle cx="${f(px + 4)}" cy="${f(py - side * 6)}" r="3.4" fill="${A.terra}" opacity=".85"/>`;
    }
    return `<g transform="translate(${x} ${y}) rotate(${angle})">${out}</g>`;
  }
  function appreciationFrame() {
    if (ART.staffApprFrame) return ART.staffApprFrame;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><radialGradient id="ap" cx=".5" cy=".45" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="${A.paper}"/><stop offset="1" stop-color="#f3ebd9"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#ap)"/>
      <rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="18" fill="none" stroke="${A.sage}" stroke-width="1.4"/>
      <rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="14" fill="none" stroke="${A.terra}" stroke-width=".8" stroke-dasharray="2 6" stroke-linecap="round"/>
      ${vine(40, 120, 260, -20, false)}${vine(40, 150, 200, 62, true)}
      ${vine(W - 40, 120, 260, 200, true)}${vine(W - 40, 150, 200, 118, false)}
      ${vine(40, H - 120, 260, 20, true)}${vine(40, H - 150, 200, -62, false)}
      ${vine(W - 40, H - 120, 260, 160, false)}${vine(W - 40, H - 150, 200, 242, true)}
    </svg>`;
    ART.staffApprFrame = svgUri(svg);
    return ART.staffApprFrame;
  }
  function wreath(size) {
    const key = `wreath-${size}`;
    if (ART[key]) return ART[key];
    const c = size / 2; const R = size / 2 - 14;
    let leaves = '';
    for (let i = 0; i < 34; i += 1) {
      if (i > 14 && i < 19) continue; // open at the bottom
      const a = Math.PI / 2 + (i / 34) * Math.PI * 2;
      const x = c + R * Math.cos(a); const y = c + R * Math.sin(a);
      const deg = (a * 180) / Math.PI + (i % 2 ? 30 : -30);
      leaves += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="10" ry="4.2" transform="rotate(${f(deg)} ${f(x)} ${f(y)})" fill="${i % 3 ? A.sage : A.sageLight}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${leaves}
      <circle cx="${c - 10}" cy="${size - 12}" r="5" fill="${A.terra}"/><circle cx="${c + 10}" cy="${size - 12}" r="5" fill="${A.terra}"/></svg>`;
    ART[key] = svgUri(svg);
    return ART[key];
  }
  function waxSeal() {
    if (ART.waxSeal) return ART.waxSeal;
    let blob = '';
    for (let i = 0; i < 18; i += 1) { const a = (i / 18) * Math.PI * 2; const r = 52 + (i % 2 ? 4 : -2); blob += `${i ? 'L' : 'M'}${f(60 + r * Math.cos(a))} ${f(60 + r * Math.sin(a))}`; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs><radialGradient id="wx" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#e3a07f"/><stop offset=".55" stop-color="${A.terra}"/><stop offset="1" stop-color="#8f4a2f"/></radialGradient></defs>
      <path d="${blob}Z" fill="url(#wx)"/><circle cx="60" cy="60" r="38" fill="none" stroke="#f5d2bf" stroke-width="1.4" opacity=".8"/>
      <path d="M60 82 C 36 66, 34 48, 44 41 C 52 36, 58 42, 60 47 C 62 42, 68 36, 76 41 C 86 48, 84 66, 60 82 Z" fill="#f8e3d6" opacity=".9"/></svg>`;
    ART.waxSeal = svgUri(svg);
    return ART.waxSeal;
  }
  function buildAppreciation(d) {
    const s = d.school || {};
    const date = G.formalDate(d.issuedDate);
    const node = document.createElement('div');
    node.style.cssText = `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${A.paper};color:${A.ink};`;
    node.innerHTML = `
      <img src="${appreciationFrame()}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;"/>
      <div style="position:absolute;left:0;right:0;top:56px;text-align:center;">${K.crestHtml(d.crestData, 54, `linear-gradient(135deg,${A.sage},${A.terra})`)}</div>
      <div style="position:absolute;left:200px;right:200px;top:122px;text-align:center;">
        <div data-fit="school" style="font-family:'Marcellus','Cinzel',serif;font-size:19px;letter-spacing:.22em;color:${A.sage};white-space:nowrap;">${esc(String(s.name || '').toUpperCase())}</div>
        <div style="margin-top:14px;font-family:'Marcellus','Cinzel',serif;font-size:15px;letter-spacing:.42em;color:${A.terra};">CERTIFICATE OF APPRECIATION</div>
      </div>
      <div style="position:absolute;left:0;right:0;top:190px;text-align:center;font-family:'Great Vibes','Pinyon Script',cursive;font-size:82px;line-height:1.1;color:${A.sage};">Thank You</div>
      <div style="position:absolute;left:0;right:0;top:300px;text-align:center;">
        <div style="position:relative;display:inline-block;width:168px;height:168px;">
          <img src="${wreath(168)}" alt="" style="position:absolute;left:0;top:0;width:168px;height:168px;"/>
          ${d.photoData ? `<img src="${esc(d.photoData)}" alt="" style="position:absolute;left:30px;top:30px;width:108px;height:108px;"/>`
            : `<div style="position:absolute;left:30px;top:30px;width:108px;height:108px;border-radius:50%;background:#eef3ec;display:flex;align-items:center;justify-content:center;font-family:'Marcellus',serif;font-size:34px;color:${A.sage};">${esc(K.initials(d.name))}</div>`}
        </div>
      </div>
      <div style="position:absolute;left:180px;right:180px;top:474px;text-align:center;">
        <div data-fit="name" style="font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:34px;letter-spacing:.02em;color:${A.ink};white-space:nowrap;">${esc(G.toTitleCase(d.name))}</div>
        ${d.role ? `<div style="font-family:'Marcellus',serif;font-size:12px;letter-spacing:.26em;color:${A.terra};margin-top:2px;">${esc(String(d.role).toUpperCase())}</div>` : ''}
        <div style="margin-top:10px;font-family:'Cormorant Garamond',serif;font-style:italic;font-size:18px;line-height:1.45;color:#4a4236;">With heartfelt gratitude for your dedication, care and service to the learners, families and community of ${esc(s.name || 'our school')} throughout ${esc(d.year)}. Your work makes our school shine.</div>
      </div>
      <div style="position:absolute;left:140px;right:140px;top:624px;display:flex;justify-content:space-between;align-items:flex-end;">
        ${K.signatureCell('HEAD TEACHER', '', A.ink, "'Marcellus',serif", `background:${A.sage};`)}
        <div style="width:150px;"></div>
        ${K.signatureCell('DIRECTOR', '', A.ink, "'Marcellus',serif", `background:${A.sage};`)}
      </div>
      <img src="${waxSeal()}" alt="" style="position:absolute;left:${W / 2 - 50}px;top:600px;width:100px;height:100px;"/>
      <div style="position:absolute;left:0;right:0;top:${H - 58}px;display:flex;align-items:center;justify-content:center;gap:8px;font-family:'Marcellus',serif;font-size:9.5px;letter-spacing:.14em;color:${A.sage};">
        <img src="${esc(d.somapLogoUrl)}" alt="" style="width:15px;height:15px;"/><span>${esc(date.day)} ${esc(date.month)} ${esc(date.year)}${d.footer ? ` · ${esc(d.footer)}` : ''}</span></div>`;
    return node;
  }

  async function render(host, data) {
    await G.ensureFonts();
    await Promise.all(EXTRA_FONTS.map((face) => (document.fonts?.load ? document.fonts.load(face).catch(() => null) : null)));
    const kind = data.kind;
    const shape = kind === 'teacher' ? ['arch', 140, 192] : kind === 'worker' ? ['hex', 148, 176] : ['circle', 108, 108];
    const crestSize = kind === 'teacher' ? 58 : kind === 'worker' ? 56 : 54;
    const crestSrc = data.school?.logoUrl || K.SOMAP_LOGO;
    const crestKey = `crest-${crestSize}-${crestSrc}`;
    const [photoData, crestData, somapLogoUrl] = await Promise.all([
      data.photoUrl ? shapedPortrait(data.photoUrl, shape[1], shape[2], shape[0]) : Promise.resolve(''),
      ART[crestKey] ? Promise.resolve(ART[crestKey]) : K.makeCrest(crestSrc, crestSize).then((u) => u || K.makeCrest(K.SOMAP_LOGO_FALLBACK, crestSize)).then((u) => { if (u) ART[crestKey] = u; return u; }),
      ART.somapLogo ? Promise.resolve(ART.somapLogo) : K.imageToDataUrl(K.SOMAP_LOGO).then((u) => { ART.somapLogo = u || K.SOMAP_LOGO_FALLBACK; return ART.somapLogo; }),
    ]);
    const full = { ...data, photoData, crestData, somapLogoUrl, issuedDate: data.issuedDate || new Date() };
    const node = kind === 'teacher' ? buildTeacher(full) : kind === 'worker' ? buildWorker(full) : buildAppreciation(full);
    host.innerHTML = '';
    host.appendChild(node);
    K.fitText(node);
    await Promise.all(Array.from(node.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    return { node };
  }

  window.StaffCertDesigns = { render, toCanvas: G.toCanvas };
}(window));
