// SoMAp Letters — layout engine: one letter model rendered two ways.
//   buildPdf(doc, assets)    -> jsPDF document (real, selectable text; justified; paginated)
//   previewHtml(doc, assets) -> HTML for the on-screen A4 sheet, using the same rules
// assets = { head: letterhead, signatures: { key: dataUrl }, images: { url: {w,h} }, companyName }
(function (global) {
  'use strict';
  const T = global.SomapLettersT;
  const PT = 0.352778; // mm per point
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const lab = (doc) => T.L[doc.lang === 'sw' ? 'sw' : 'en'];
  const fontDef = (id) => T.FONTS.find((f) => f.id === id) || T.FONTS[0];
  const lines = (text) => String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  function paras(text) { return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean); }
  const LIST_RE = /^\s*(?:([-•*])|(\d+|[a-z])[.)])\s+/i;
  // Splits a paragraph into runs of plain text and list items ("- x", "1. x"), so an intro line can lead a list.
  function blocks(p) {
    const out = [];
    p.split('\n').forEach((r) => {
      const m = LIST_RE.exec(r);
      if (m) out.push({ item: true, bullet: !!m[1], marker: m[1] ? '•' : `${m[2]}.`, text: r.replace(LIST_RE, '').trim() });
      else if (out.length && !out[out.length - 1].item) out[out.length - 1].text += ` ${r.trim()}`;
      else out.push({ item: false, text: r.trim() });
    });
    return out.filter((b) => b.text);
  }

  // ---------- assets ----------
  function imageSize(src) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  async function toDataUrl(src) {
    if (!src || /^data:/.test(src)) return src;
    try {
      const blob = await (await fetch(src, { mode: 'cors' })).blob();
      return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(''); r.readAsDataURL(blob); });
    } catch (_) { return ''; }
  }
  async function prepareAssets(assets) {
    const out = Object.assign({ images: {} }, assets);
    const head = out.head ? Object.assign({}, out.head) : null;
    if (head) {
      if (head.logo) head.logo = await toDataUrl(head.logo);
      if (head.image) head.image = await toDataUrl(head.image);
      out.head = head;
    }
    const srcs = [head?.logo, head?.image].concat(Object.values(out.signatures || {})).filter(Boolean);
    await Promise.all(srcs.map(async (s) => { out.images[s] = await imageSize(s); }));
    return out;
  }
  const imgType = (src) => (/^data:image\/jpe?g/i.test(src) ? 'JPEG' : 'PNG');
  function fit(size, maxW, maxH) {
    if (!size) return { w: maxW, h: maxH };
    const r = Math.min(maxW / size.w, maxH / size.h);
    return { w: size.w * r, h: size.h * r };
  }
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0x0f3d6e;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---------- fonts ----------
  const fontCache = {};
  async function fetchBinary(url) {
    if (fontCache[url]) return fontCache[url];
    fontCache[url] = (async () => {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let s = ''; const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
      return s;
    })();
    return fontCache[url];
  }
  // Embeds a TTF family; falls back to Times when the font cannot be downloaded.
  async function useFont(pdf, id) {
    const f = fontDef(id);
    if (!f.ttf) return f.pdf;
    try {
      for (const [style, url] of Object.entries(f.ttf)) {
        const file = `${f.pdf}-${style}.ttf`;
        pdf.addFileToVFS(file, await fetchBinary(url));
        pdf.addFont(file, f.pdf, style);
      }
      if (!f.ttf.bolditalic) pdf.addFont(`${f.pdf}-bold.ttf`, f.pdf, 'bolditalic');
      return f.pdf;
    } catch (err) {
      console.warn('Font download failed, using Times', err);
      return 'times';
    }
  }

  // ---------- PDF writer ----------
  function makeWriter(pdf, doc, family) {
    const fmt = Object.assign({}, T.DEFAULT_FORMAT, doc.format || {});
    const narrow = fmt.margins === 'narrow';
    const pw = pdf.internal.pageSize.getWidth(); const ph = pdf.internal.pageSize.getHeight();
    const W = {
      pdf, fmt, family, pw, ph,
      ml: narrow ? 16 : 25, mr: narrow ? 16 : 22, top: narrow ? 14 : 18, bottom: ph - (narrow ? 18 : 22),
      size: Number(fmt.size) || 12, spacing: Number(fmt.spacing) || 1.15,
    };
    W.width = pw - W.ml - W.mr;
    W.y = W.top;
    W.lh = (size) => (size || W.size) * PT * 1.2 * W.spacing;
    W.font = (style, size) => { pdf.setFont(family, style || 'normal'); pdf.setFontSize(size || W.size); };
    W.newPage = () => { pdf.addPage(); W.y = W.top + 6; };
    W.ensure = (h) => { if (W.y + h > W.bottom) W.newPage(); };
    W.gap = (mm) => { W.y += mm; };
    return W;
  }

  // Draws one line; 'justify' stretches word gaps to the full width.
  function drawLine(W, text, x, width, align, last) {
    const { pdf } = W;
    if (align === 'center') { pdf.text(text, x + width / 2, W.y, { align: 'center' }); return; }
    if (align === 'right') { pdf.text(text, x + width, W.y, { align: 'right' }); return; }
    const words = text.split(/\s+/).filter(Boolean);
    if (align !== 'justify' || last || words.length < 2) { pdf.text(text, x, W.y); return; }
    const total = words.reduce((s, w) => s + pdf.getTextWidth(w), 0);
    const gap = (width - total) / (words.length - 1);
    if (gap > pdf.getTextWidth(' ') * 4) { pdf.text(text, x, W.y); return; } // don't over-stretch short lines
    let cx = x;
    words.forEach((w) => { pdf.text(w, cx, W.y); cx += pdf.getTextWidth(w) + gap; });
  }

  // A paragraph with orphan/widow control: never leave a single line alone at the foot or head of a page.
  function paragraph(W, text, o = {}) {
    const size = o.size || W.size;
    W.font(o.style, size);
    const indent = o.indent || 0;
    const width = (o.width || W.width) - indent;
    const x = (o.x || W.ml) + indent;
    const ls = W.pdf.splitTextToSize(String(text), width);
    const lh = o.lh || W.lh(size);
    const align = o.align || 'left';
    // W.y is the baseline of the next line. Keep the first two lines together (no orphan)…
    if (W.y > W.bottom || (ls.length > 1 && W.y + lh > W.bottom)) W.newPage();
    for (let i = 0; i < ls.length; i += 1) {
      if (W.y > W.bottom) W.newPage();
      // …and the last two lines together (no widow).
      if (i >= 2 && ls.length - i === 2 && W.y + lh > W.bottom) W.newPage();
      W.font(o.style, size);
      drawLine(W, ls[i], x, width, align, i === ls.length - 1);
      if (o.underline) {
        const tw = W.pdf.getTextWidth(ls[i]);
        const ux = align === 'center' ? x + (width - tw) / 2 : x;
        W.pdf.setLineWidth(0.3); W.pdf.line(ux, W.y + 0.9, ux + tw, W.y + 0.9);
      }
      W.y += lh;
    }
    return ls.length;
  }
  // Body text: blank lines separate paragraphs; "- " / "1." lines become hanging-indent lists.
  function body(W, text) {
    const gap = Number(W.fmt.paraGap) || 0;
    paras(text).forEach((p) => {
      blocks(p).forEach((b) => {
        if (!b.item) { paragraph(W, b.text, { align: W.fmt.align }); return; }
        W.font('normal');
        W.ensure(W.lh()); // same break rule as paragraph(), so the marker stays with its text
        W.pdf.text(b.marker, W.ml + 2, W.y);
        paragraph(W, b.text, { indent: 8, align: W.fmt.align });
      });
      W.y += gap * PT * 1.2;
    });
  }

  function letterhead(W, head, images, doc) {
    const { pdf } = W;
    if (!head) return;
    if (head.kind === 'image' && head.image) {
      const s = fit(images[head.image], W.pw - 20, 45);
      pdf.addImage(head.image, imgType(head.image), (W.pw - s.w) / 2, 8, s.w, s.h);
      W.y = 8 + s.h + 6;
      return;
    }
    const color = hexRgb(head.color);
    const top = W.top - 4;
    let logoW = 0;
    if (head.logo) {
      const s = fit(images[head.logo], 26, 26);
      pdf.addImage(head.logo, imgType(head.logo), W.ml, top, s.w, s.h);
      logoW = s.w;
    }
    const inset = logoW ? logoW + 4 : 0;
    const cx = W.ml + inset; const cw = W.width - inset * 2;
    W.y = top + 6;
    pdf.setTextColor(color[0], color[1], color[2]);
    paragraph(W, String(head.name || '').toUpperCase(), { style: 'bold', size: 16.5, align: 'center', x: cx, width: cw, lh: 7 });
    if (head.subtitle) paragraph(W, String(head.subtitle).toUpperCase(), { style: 'bold', size: 11, align: 'center', x: cx, width: cw, lh: 5 });
    pdf.setTextColor(55, 65, 81);
    const info = [head.regNo, head.address, [head.phones, head.email, head.website].filter(Boolean).join('  •  ')].filter(Boolean);
    info.forEach((t) => paragraph(W, t, { size: 9.5, align: 'center', x: cx, width: cw, lh: 4.3 }));
    if (head.motto) paragraph(W, `“${head.motto}”`, { style: 'italic', size: 9.5, align: 'center', x: cx, width: cw, lh: 4.3 });
    pdf.setTextColor(0, 0, 0);
    W.y = Math.max(W.y, top + 28) + 1;
    pdf.setDrawColor(color[0], color[1], color[2]); pdf.setLineWidth(0.9); pdf.line(W.ml, W.y, W.pw - W.mr, W.y);
    pdf.setLineWidth(0.25); pdf.line(W.ml, W.y + 1.3, W.pw - W.mr, W.y + 1.3);
    pdf.setDrawColor(0, 0, 0);
    W.y += 8;
  }

  function refDate(W, doc) {
    const L = lab(doc);
    W.font('normal');
    if (doc.refNo) W.pdf.text(`${L.ref}: ${doc.refNo}`, W.ml, W.y);
    W.pdf.text(T.formatDate(doc.date, doc.lang), W.pw - W.mr, W.y, { align: 'right' });
    W.y += W.lh() * 1.6;
  }

  function signatureBlock(W, doc, assets, opts = {}) {
    const { pdf } = W;
    const L = lab(doc);
    const signers = (doc.signers || []).filter((s) => s.name || s.position);
    const lh = W.lh();
    const cols = Math.min(Math.max(signers.length, 1), 2);
    const rows = Math.ceil(signers.length / cols);
    const blockH = rows * 30 + (opts.closing ? lh * 2 : 0) + (doc.onBehalf ? lh * 2 : 0);
    if (W.y + Math.min(blockH, 120) > W.bottom) W.newPage();
    if (opts.closing) { paragraph(W, opts.closing); }
    if (doc.onBehalf) {
      paragraph(W, `${L.onBehalf}`, { lh: lh * 0.9 });
      paragraph(W, String(doc.onBehalfName || assets.companyName || '').toUpperCase(), { style: 'bold', lh: lh * 0.9 });
    }
    const colW = W.width / cols;
    for (let r = 0; r < rows; r += 1) {
      if (W.y + 30 > W.bottom) W.newPage();
      const y0 = W.y;
      for (let c = 0; c < cols; c += 1) {
        const s = signers[r * cols + c];
        if (!s) continue;
        const x = W.ml + c * colW;
        const img = s.signed ? assets.signatures?.[s.key] : '';
        if (img) {
          const sz = fit(assets.images?.[img], 42, 15);
          pdf.addImage(img, imgType(img), x, y0 + 1, sz.w, sz.h);
        } else if (s.signed) {
          W.font('italic', 8.5); pdf.setTextColor(90, 90, 90);
          pdf.text(`${L.signedEl}${s.signedAt ? ` · ${T.formatDate(new Date(s.signedAt).toISOString().slice(0, 10), doc.lang)}` : ''}`, x, y0 + 12);
          pdf.setTextColor(0, 0, 0);
        }
        pdf.setLineWidth(0.25); pdf.setDrawColor(120, 120, 120); pdf.line(x, y0 + 17, x + Math.min(colW - 8, 62), y0 + 17); pdf.setDrawColor(0, 0, 0);
        W.font('bold'); pdf.text(String(s.name || '').toUpperCase(), x, y0 + 17 + lh * 0.95);
        W.font('normal', W.size - 1); pdf.text(String(s.position || ''), x, y0 + 17 + lh * 1.85);
      }
      W.y = y0 + 17 + lh * 1.85 + 8;
    }
  }

  function listBlock(W, title, text) {
    const items = lines(text);
    if (!items.length) return;
    W.ensure(W.lh() * 2);
    W.font('bold', W.size - 1); W.pdf.text(`${title}:`, W.ml, W.y);
    W.y += W.lh(W.size - 1);
    items.forEach((it, i) => paragraph(W, `${items.length > 1 ? `${i + 1}. ` : ''}${it}`, { size: W.size - 1, indent: 5 }));
    W.y += 2;
  }

  function footers(W, doc, head) {
    const { pdf } = W;
    const L = lab(doc);
    const n = pdf.internal.getNumberOfPages();
    for (let p = 1; p <= n; p += 1) {
      pdf.setPage(p);
      const y = W.ph - 11;
      if (head && head.footer) {
        pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.2); pdf.line(W.ml, y - 4, W.pw - W.mr, y - 4);
        W.font('normal', 8); pdf.setTextColor(100, 100, 100); pdf.text(String(head.footer), W.pw / 2, y, { align: 'center', maxWidth: W.width });
      }
      W.font('normal', 8); pdf.setTextColor(120, 120, 120);
      if (W.fmt.pageNumbers && n > 1) pdf.text(`${L.page} ${p} ${L.of} ${n}`, W.pw - W.mr, W.ph - 6, { align: 'right' });
      if (W.fmt.footerMark) pdf.text('Generated with SoMAp', W.ml, W.ph - 6);
      pdf.setTextColor(0, 0, 0);
    }
  }

  function minutesPdf(W, doc, assets) {
    const { pdf } = W;
    const m = doc.minutes || {};
    const L = lab(doc).minutes;
    const title = String(m.title || doc.subject || '').toUpperCase();
    paragraph(W, title, { style: 'bold', size: W.size + 2, align: 'center', underline: true });
    W.y += 2;
    const when = T.formatDate(m.date || doc.date, doc.lang);
    const time = [m.timeStart, m.timeEnd].filter(Boolean).join(' – ');
    [[L.date, when], [L.time, time], [L.venue, m.venue], [L.chair, m.chair], [L.secretary, m.secretary]].filter((r) => r[1]).forEach(([k, v]) => {
      W.ensure(W.lh());
      W.font('bold'); pdf.text(`${k}:`, W.ml, W.y);
      W.font('normal'); pdf.text(String(v), W.ml + 32, W.y);
      W.y += W.lh();
    });
    W.y += 3;
    const present = (m.present || []).filter((p) => p && p.name);
    if (present.length) {
      W.ensure(W.lh() * 3);
      W.font('bold'); pdf.text(L.present.toUpperCase(), W.ml, W.y); W.y += 2;
      pdf.autoTable({
        startY: W.y, margin: { left: W.ml, right: W.mr, bottom: W.ph - W.bottom }, theme: 'grid',
        head: [[L.no, L.name, L.designation, L.signature]],
        body: present.map((p, i) => [String(i + 1), p.name, p.designation || '', '']),
        styles: { font: W.family, fontSize: W.size - 1.5, cellPadding: 1.8, lineColor: [180, 180, 180], lineWidth: 0.2, textColor: [20, 20, 20] },
        headStyles: { fillColor: hexRgb(assets.head?.color), textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 12 }, 3: { cellWidth: 38 } },
      });
      W.y = pdf.lastAutoTable.finalY + W.lh();
    }
    if (m.absent) { W.font('bold'); W.ensure(W.lh() * 2); pdf.text(`${L.absent}:`, W.ml, W.y); W.y += W.lh(); paragraph(W, lines(m.absent).join(', ')); }
    if (m.inAttendance) { W.font('bold'); W.ensure(W.lh() * 2); pdf.text(`${L.inAttendance}:`, W.ml, W.y); W.y += W.lh(); paragraph(W, lines(m.inAttendance).join(', ')); }
    const agenda = (m.agenda || []).filter(Boolean);
    if (agenda.length) {
      W.y += 2; W.ensure(W.lh() * 3);
      W.font('bold'); pdf.text(L.agenda.toUpperCase(), W.ml, W.y); W.y += W.lh();
      agenda.forEach((a, i) => { W.font('normal'); W.ensure(W.lh()); pdf.text(`${i + 1}.`, W.ml + 2, W.y); paragraph(W, a, { indent: 9 }); });
    }
    (m.sections || []).filter((s) => s && (s.title || s.body)).forEach((s, i) => {
      W.y += 3; W.ensure(W.lh() * 3);
      paragraph(W, `${i + 1}.0  ${String(s.title || '').toUpperCase()}`, { style: 'bold' });
      body(W, s.body);
    });
    const res = (m.resolutions || []).filter(Boolean);
    if (res.length) {
      W.y += 3;
      W.font('normal');
      const inner = W.width - 10;
      const est = res.reduce((h, r) => h + pdf.splitTextToSize(r, inner - 8).length * W.lh() + 1.5, 0) + W.lh() * 1.3 + 4;
      if (est < W.bottom - W.top && W.y + est > W.bottom) W.newPage();
      const boxed = W.y + est <= W.bottom;
      const y0 = W.y - W.lh() * 0.8;
      const color = hexRgb(assets.head?.color);
      if (boxed) {
        pdf.setFillColor(Math.round(color[0] * 0.08 + 235), Math.round(color[1] * 0.08 + 235), Math.round(color[2] * 0.08 + 235));
        pdf.setDrawColor(color[0], color[1], color[2]); pdf.setLineWidth(0.4);
        pdf.roundedRect(W.ml, y0, W.width, est, 2, 2, 'FD'); pdf.setDrawColor(0, 0, 0);
      }
      W.y += 1.5;
      W.font('bold'); pdf.text(L.resolutions.toUpperCase(), W.ml + 5, W.y); W.y += W.lh();
      res.forEach((r, i) => { W.font('normal'); pdf.text(`${i + 1}.`, W.ml + 5, W.y); paragraph(W, r, { x: W.ml + 5, width: inner, indent: 8 }); W.y += 1.5; });
      W.y = Math.max(W.y, y0 + est) + W.lh();
    }
    if (m.timeEnd) { paragraph(W, `${L.closedAt} ${m.timeEnd}.`); }
    if (m.notes) body(W, m.notes);
    W.y += 4;
    signatureBlock(W, Object.assign({}, doc, { onBehalf: false }), assets);
  }

  async function buildPdf(doc, rawAssets) {
    const assets = await prepareAssets(rawAssets || {});
    const { jsPDF } = global.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const family = await useFont(pdf, (doc.format || {}).font);
    const W = makeWriter(pdf, doc, family);
    pdf.setProperties({ title: doc.subject || doc.minutes?.title || doc.typeName || 'Letter', subject: doc.typeName || '', creator: 'SoMAp Letters', author: doc.authorName || '' });
    letterhead(W, assets.head, assets.images, doc);
    if (doc.mode === 'minutes') {
      if (doc.refNo) { W.font('normal', W.size - 1); pdf.text(`${lab(doc).ref}: ${doc.refNo}`, W.ml, W.y); W.y += W.lh() * 1.4; }
      minutesPdf(W, doc, assets);
    } else {
      const L = lab(doc);
      refDate(W, doc);
      lines(doc.recipient).forEach((r, i) => paragraph(W, r, { style: i === 0 ? 'bold' : 'normal', lh: W.lh() * 0.92 }));
      W.y += W.lh() * 0.6;
      if (doc.salutation) { paragraph(W, doc.salutation); W.y += 1; }
      if (doc.subject) {
        paragraph(W, `${L.re}: ${String(doc.subject).replace(/^\s*(re|yah)\s*[:.-]\s*/i, '').toUpperCase()}`, { style: 'bold', underline: true, align: W.fmt.centerSubject ? 'center' : 'left' });
        W.y += 2;
      }
      body(W, doc.body);
      W.y += 2;
      signatureBlock(W, doc, assets, { closing: doc.closing || T.closingFor(doc.salutation, doc.lang) });
      W.y += 2;
      listBlock(W, L.enclosures, doc.enclosures);
      listBlock(W, L.cc, doc.cc);
    }
    footers(W, doc, assets.head);
    return pdf;
  }

  function fileName(doc) {
    const clean = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
    // The organisation is usually the second recipient line ("The Branch Manager," / "Fanikiwa Microfinance,").
    const to = String(doc.recipient || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const who = clean(to[1] || to[0] || '').split('-')[0];
    return [doc.date, clean(doc.typeName || 'Letter'), who, String(doc.refNo || '').replace(/\//g, '-')].filter(Boolean).join('_') + '.pdf';
  }

  // ---------- HTML preview (same structure as the PDF) ----------
  function bodyHtml(text) {
    return paras(text).map((p) => {
      let html = ''; let list = null;
      blocks(p).forEach((b) => {
        if (b.item) {
          if (!list) { list = b.bullet ? 'ul' : 'ol'; html += `<${list} class="lp-list">`; }
          html += `<li>${esc(b.text)}</li>`;
        } else {
          if (list) { html += `</${list}>`; list = null; }
          html += `<p>${esc(b.text)}</p>`;
        }
      });
      return list ? `${html}</${list}>` : html;
    }).join('');
  }
  function headHtml(head) {
    if (!head) return '';
    if (head.kind === 'image' && head.image) return `<div class="lp-head lp-head--image"><img src="${esc(head.image)}" alt=""></div>`;
    const info = [head.regNo, head.address, [head.phones, head.email, head.website].filter(Boolean).join('  •  ')].filter(Boolean);
    return `<div class="lp-head" style="--lp-accent:${esc(head.color || '#0f3d6e')}">
      ${head.logo ? `<img class="lp-logo" src="${esc(head.logo)}" alt="">` : ''}
      <div class="lp-head__text ${head.logo ? 'lp-head__text--logo' : ''}">
        <div class="lp-head__name">${esc(String(head.name || '').toUpperCase() || 'YOUR LETTERHEAD')}</div>
        ${head.subtitle ? `<div class="lp-head__sub">${esc(String(head.subtitle).toUpperCase())}</div>` : ''}
        ${info.map((t) => `<div class="lp-head__info">${esc(t)}</div>`).join('')}
        ${head.motto ? `<div class="lp-head__motto">“${esc(head.motto)}”</div>` : ''}
      </div></div><div class="lp-rule" style="--lp-accent:${esc(head.color || '#0f3d6e')}"></div>`;
  }
  function signHtml(doc, assets, closing) {
    const L = lab(doc);
    const signers = (doc.signers || []).filter((s) => s.name || s.position);
    return `<div class="lp-sign">
      ${closing ? `<p class="lp-closing">${esc(closing)}</p>` : ''}
      ${doc.onBehalf ? `<p class="lp-behalf">${esc(L.onBehalf)}<br><strong>${esc(String(doc.onBehalfName || assets.companyName || '').toUpperCase())}</strong></p>` : ''}
      <div class="lp-signers lp-signers--${Math.min(Math.max(signers.length, 1), 2)}">${signers.map((s) => {
        const img = s.signed ? assets.signatures?.[s.key] : '';
        return `<div class="lp-signer"><div class="lp-signer__img">${img ? `<img src="${esc(img)}" alt="signature">` : s.signed ? `<em>${esc(L.signedEl)}</em>` : ''}</div>
          <div class="lp-signer__line"></div><div class="lp-signer__name">${esc(String(s.name || '').toUpperCase())}</div><div class="lp-signer__pos">${esc(s.position || '')}</div></div>`;
      }).join('')}</div></div>`;
  }
  function listHtml(title, text) {
    const items = lines(text);
    if (!items.length) return '';
    return `<div class="lp-encl"><strong>${esc(title)}:</strong>${items.length > 1 ? `<ol>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>` : ` ${esc(items[0])}`}</div>`;
  }
  function minutesHtml(doc, assets) {
    const m = doc.minutes || {};
    const L = lab(doc).minutes;
    const time = [m.timeStart, m.timeEnd].filter(Boolean).join(' – ');
    const meta = [[L.date, T.formatDate(m.date || doc.date, doc.lang)], [L.time, time], [L.venue, m.venue], [L.chair, m.chair], [L.secretary, m.secretary]].filter((r) => r[1]);
    const present = (m.present || []).filter((p) => p && p.name);
    const agenda = (m.agenda || []).filter(Boolean);
    const res = (m.resolutions || []).filter(Boolean);
    return `<h2 class="lp-mtitle">${esc(String(m.title || doc.subject || '').toUpperCase())}</h2>
      <table class="lp-meta">${meta.map(([k, v]) => `<tr><th>${esc(k)}:</th><td>${esc(v)}</td></tr>`).join('')}</table>
      ${present.length ? `<h3 class="lp-h">${esc(L.present.toUpperCase())}</h3><table class="lp-table" style="--lp-accent:${esc(assets.head?.color || '#0f3d6e')}"><thead><tr><th>${esc(L.no)}</th><th>${esc(L.name)}</th><th>${esc(L.designation)}</th><th>${esc(L.signature)}</th></tr></thead>
        <tbody>${present.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.designation || '')}</td><td></td></tr>`).join('')}</tbody></table>` : ''}
      ${m.absent ? `<p><strong>${esc(L.absent)}:</strong> ${esc(lines(m.absent).join(', '))}</p>` : ''}
      ${m.inAttendance ? `<p><strong>${esc(L.inAttendance)}:</strong> ${esc(lines(m.inAttendance).join(', '))}</p>` : ''}
      ${agenda.length ? `<h3 class="lp-h">${esc(L.agenda.toUpperCase())}</h3><ol class="lp-list">${agenda.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
      ${(m.sections || []).filter((s) => s && (s.title || s.body)).map((s, i) => `<h3 class="lp-h">${i + 1}.0&nbsp;&nbsp;${esc(String(s.title || '').toUpperCase())}</h3>${bodyHtml(s.body)}`).join('')}
      ${res.length ? `<div class="lp-res" style="--lp-accent:${esc(assets.head?.color || '#0f3d6e')}"><h3 class="lp-h">${esc(L.resolutions.toUpperCase())}</h3><ol>${res.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div>` : ''}
      ${m.timeEnd ? `<p>${esc(L.closedAt)} ${esc(m.timeEnd)}.</p>` : ''}
      ${m.notes ? bodyHtml(m.notes) : ''}
      ${signHtml(Object.assign({}, doc, { onBehalf: false }), assets, '')}`;
  }
  function previewHtml(doc, assets) {
    assets = assets || {};
    const fmt = Object.assign({}, T.DEFAULT_FORMAT, doc.format || {});
    const L = lab(doc);
    const style = `font-family:${fontDef(fmt.font).css};font-size:${fmt.size}pt;line-height:${(1.2 * fmt.spacing).toFixed(3)};--lp-gap:${Number(fmt.paraGap) || 0}pt;text-align:${fmt.align === 'justify' ? 'justify' : 'left'}`;
    const inner = doc.mode === 'minutes'
      ? `${doc.refNo ? `<div class="lp-ref">${esc(L.ref)}: ${esc(doc.refNo)}</div>` : ''}${minutesHtml(doc, assets)}`
      : `<div class="lp-refdate"><span>${doc.refNo ? `${esc(L.ref)}: ${esc(doc.refNo)}` : ''}</span><span>${esc(T.formatDate(doc.date, doc.lang))}</span></div>
        <div class="lp-to">${lines(doc.recipient).map((r, i) => `<div${i === 0 ? ' class="lp-to__first"' : ''}>${esc(r)}</div>`).join('')}</div>
        ${doc.salutation ? `<p class="lp-salute">${esc(doc.salutation)}</p>` : ''}
        ${doc.subject ? `<p class="lp-subject ${fmt.centerSubject ? 'lp-subject--center' : ''}">${esc(L.re)}: ${esc(String(doc.subject).replace(/^\s*(re|yah)\s*[:.-]\s*/i, '').toUpperCase())}</p>` : ''}
        <div class="lp-body">${bodyHtml(doc.body) || '<p class="lp-placeholder">Start writing on the left — the letter takes shape here.</p>'}</div>
        ${signHtml(doc, assets, doc.closing || T.closingFor(doc.salutation, doc.lang))}
        ${listHtml(L.enclosures, doc.enclosures)}${listHtml(L.cc, doc.cc)}`;
    return `<div class="lp-page lp-page--${fmt.margins === 'narrow' ? 'narrow' : 'normal'}" style="${style}">
      ${headHtml(assets.head)}${inner}
      ${assets.head?.footer || fmt.footerMark ? `<div class="lp-foot">${assets.head?.footer ? `<div>${esc(assets.head.footer)}</div>` : ''}${fmt.footerMark ? '<div class="lp-mark">Generated with SoMAp</div>' : ''}</div>` : ''}
    </div>`;
  }

  global.SomapLettersPDF = { buildPdf, previewHtml, fileName, prepareAssets };
})(window);
