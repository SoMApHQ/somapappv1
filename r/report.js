/*
 * SoMAp public report page (somapv2i.com/r/?k=KEY).
 * Sends ONLY the key to the SoMAp SMS Worker and receives that ONE report card:
 * the exact PDF generatereportform.html drew (its own drawReportCard) — report card,
 * Taarifa ya Maandishi kwa Mzazi, Uchambuzi wa Maendeleo, every page.
 * All pages are SHOWN on screen first (scroll + zoom); nothing downloads unless the
 * parent taps "Pakua PDF", which saves the very same file.
 * Never reads Firebase (the page's Content-Security-Policy blocks any other site).
 */
(function () {
  'use strict';
  const WORKER = 'https://somap-sms.somap.workers.dev';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
  const MAX_PIXELS_WIDE = 1700; // sharp enough to zoom, light enough for modest phones
  const $ = (id) => document.getElementById(id);
  const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  const dateSw = (ms) => { const d = new Date(Number(ms)); return `${d.getDate()} ${MONTHS_SW[d.getMonth()]} ${d.getFullYear()}`; };
  let file = null; // { bytes, filename }
  let zoomIndex = 0;

  function showError(title, text) {
    $('loading').hidden = true;
    $('errTitle').textContent = title;
    $('errText').textContent = text;
    $('error').hidden = false;
  }

  // ------------------------------------------------------------------ zoom
  function applyZoom() {
    const z = ZOOMS[zoomIndex];
    const pages = $('pages');
    const viewer = $('viewer');
    const centre = viewer.scrollLeft + viewer.clientWidth / 2;
    const before = pages.offsetWidth || 1;
    pages.style.maxWidth = z === 1 ? '900px' : 'none';
    pages.style.width = z === 1 ? '100%' : `${Math.round(Math.min(viewer.clientWidth, 900) * z)}px`;
    viewer.scrollLeft = Math.max(0, (centre / before) * pages.offsetWidth - viewer.clientWidth / 2);
    $('zoomText').textContent = `${Math.round(z * 100)}%`;
    $('zoomOut').disabled = zoomIndex === 0;
    $('zoomIn').disabled = zoomIndex === ZOOMS.length - 1;
  }
  $('zoomIn').addEventListener('click', () => { zoomIndex = Math.min(ZOOMS.length - 1, zoomIndex + 1); applyZoom(); });
  $('zoomOut').addEventListener('click', () => { zoomIndex = Math.max(0, zoomIndex - 1); applyZoom(); });

  // ------------------------------------------------------------------ download / share (only when tapped)
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Ripoti ya matokeo', url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href); $('shareBtn').textContent = 'Imenakiliwa'; }
    } catch (_) { /* cancelled */ }
  }

  // ------------------------------------------------------------------ show every page
  async function renderPages(bytes) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('viewer');
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: bytes.slice(), standardFontDataUrl: PDFJS + 'standard_fonts/', isEvalSupported: false }).promise;
    const box = $('pages');
    const slots = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const slot = document.createElement('div');
      slot.className = 'page pending';
      slot.textContent = `Ukurasa ${i}…`;
      box.appendChild(slot);
      slots.push(slot);
    }
    $('sub').textContent = `Kurasa ${pdf.numPages} • sogeza chini kuona zote`;
    $('loading').hidden = true;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = MAX_PIXELS_WIDE / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      canvas.width = 0; canvas.height = 0; // free memory
      const img = new Image();
      img.alt = `Ukurasa ${i} wa ripoti`;
      img.src = URL.createObjectURL(blob);
      const slot = slots[i - 1];
      slot.className = 'page';
      slot.textContent = '';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = `Ukurasa ${i} / ${pdf.numPages}`;
      slot.append(img, label);
      page.cleanup();
    }
  }

  async function start() {
    applyZoom();
    const key = new URLSearchParams(window.location.search).get('k') || '';
    if (!/^[A-Za-z0-9]{14}$/.test(key)) { showError('Kiungo si sahihi', 'Hakikisha umefungua kiungo kamili kutoka kwenye SMS.'); return; }
    let res;
    try {
      res = await fetch(`${WORKER}/r?k=${encodeURIComponent(key)}`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    } catch (_) { showError('Hakuna mtandao', 'Tafadhali angalia intaneti kisha jaribu tena.'); return; }
    if (!res.ok || !/application\/pdf/.test(res.headers.get('content-type') || '')) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) showError('Subiri kidogo', data.message || 'Majaribio mengi mno. Jaribu tena baada ya dakika 10.');
      else showError('Ripoti haipatikani', data.message || 'Kiungo si sahihi au muda wake umekwisha.');
      return;
    }
    file = { bytes: new Uint8Array(await res.arrayBuffer()), filename: res.headers.get('x-report-filename') || 'report.pdf' };
    $('pdfBtn').disabled = false;
    $('shareBtn').disabled = false;
    const expires = res.headers.get('x-report-expires');
    if (expires) { $('note').textContent = `Kiungo hiki kitafanya kazi hadi ${dateSw(expires)}.`; $('note').hidden = false; }
    try {
      await renderPages(file.bytes);
    } catch (_) {
      // Viewer could not start on this phone: the report is still here, unchanged — offer the file (no forced download).
      showError('Ripoti iko tayari', 'Simu hii haikuweza kuonyesha kurasa hapa. Bonyeza "Pakua PDF" kuifungua.');
    }
  }

  $('pdfBtn').addEventListener('click', download);
  $('shareBtn').addEventListener('click', share);
  start();
})();
