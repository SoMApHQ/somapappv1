/*
 * SoMAp Graduation Galleries (2026+).
 * Data stays at schools/{schoolId}/graduation/{year}/galleries/{id} with the same fields as
 * before (caption, url, uploadedBy, uploadedAt, storagePath) so parent.html keeps working;
 * new photos add storageProvider:'google_drive', driveFileId, thumbUrl, album, width, height.
 * Google Drive upload mirrors Bookshtml/upload.html (GIS token, drive.file scope, resumable
 * upload, "anyone with the link" reader). Cloudinary is only a fallback if Drive fails.
 */
(function () {
  'use strict';
  const db = firebase.database();
  const auth = firebase.auth();
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const GOOGLE_CLIENT_ID = '105526245138-6om2vv54l5adt0a79afmpbjb26rofjqc.apps.googleusercontent.com';
  const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_ROOT = 'SoMAp Graduation Gallery';
  const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
  const CLD_CLOUD_NAME = localStorage.getItem('cloud_name') || 'dg7vnrkgd';
  const CLD_UPLOAD_PRESET = localStorage.getItem('upload_preset') || 'books_unsigned';
  const CLD_GALLERY_FOLDER = 'somapappv1/graduation/gallery';
  const UPLOADER_EMAILS = new Set(['ssclass42023@gmail.com', 'socratesschool2020@gmail.com']);
  // These publish straight to the gallery. Other staff upload into galleryPending and wait for the
  // Head Teacher (workershtml/headteacherapprovals.html, Graduation uploads card).
  const UPLOADER_ROLES = new Set(['admin', 'head', 'headteacher', 'head teacher', 'director', 'owner', 'principal']);
  const NON_STAFF_ROLES = new Set(['parent', 'guardian', 'student', '']);
  const DEFAULT_ALBUM = 'Graduation Day';
  const MAX_EDGE = 2048;
  const CONCURRENCY = 3;
  const YEAR_START = 2024;

  const state = {
    user: null, canUpload: false, isApprover: false, role: '', year: new Date().getFullYear(), photos: [], album: 'all',
    ref: null, token: null, tokenAt: 0, queue: [], running: 0, lbIndex: -1, lbList: [], school: null,
  };

  function toast(msg, tone = 'ok', ms = 4200) {
    const n = $('#toast');
    n.textContent = msg;
    n.style.background = tone === 'error' ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : tone === 'warn' ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#10b981,#047857)';
    n.classList.add('show');
    clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), ms);
  }

  // ---------- school / paths (same as js/graduation.js gradPath) ----------
  function schoolId() {
    const raw = window.SOMAP?.getSchool?.()?.id || window.currentSchoolId || localStorage.getItem('schoolId') || 'socrates-school';
    return !raw || raw === 'socrates' ? 'socrates-school' : String(raw).trim();
  }
  const gradPath = (year, sub) => `schools/${schoolId()}/graduation/${year}${sub ? `/${sub}` : ''}`;
  async function read(path) { try { const s = await db.ref(path).once('value'); return s.val(); } catch (_) { return null; } }

  // ---------- image URLs: fast thumbnails for both storage kinds ----------
  function cldTransform(url, t) { return /res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace('/upload/', `/upload/${t}/`) : url; }
  function thumbOf(p, w = 600) {
    if (p.driveFileId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(p.driveFileId)}&sz=w${w}`;
    return cldTransform(p.url || '', `c_limit,w_${w},q_auto,f_auto`);
  }
  function largeOf(p) {
    if (p.driveFileId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(p.driveFileId)}&sz=w1920`;
    return cldTransform(p.url || '', 'c_limit,w_1920,q_auto,f_auto');
  }
  function downloadOf(p) {
    if (p.driveFileId) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(p.driveFileId)}`;
    return cldTransform(p.url || '', 'fl_attachment');
  }
  const albumOf = (p) => String(p.album || '').trim() || DEFAULT_ALBUM;

  // ---------- rendering ----------
  function renderYears() {
    const now = new Date().getFullYear();
    const years = [];
    for (let y = now + 1; y >= YEAR_START; y -= 1) years.push(y);
    $('#yearChips').innerHTML = years.map((y) => `<button class="chip ${y === state.year ? 'active' : ''}" data-year="${y}">${y}</button>`).join('');
  }
  function albums() {
    const map = new Map();
    state.photos.forEach((p) => map.set(albumOf(p), (map.get(albumOf(p)) || 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  function renderAlbumControls() {
    const list = albums();
    if (state.album !== 'all' && !list.some(([a]) => a === state.album)) state.album = 'all';
    $('#albumBar').innerHTML = [`<button class="chip ${state.album === 'all' ? 'active' : ''}" data-album="all">All <small>${state.photos.length}</small></button>`]
      .concat(list.map(([a, n]) => `<button class="chip ${state.album === a ? 'active' : ''}" data-album="${esc(a)}">${esc(a)} <small>${n}</small></button>`)).join('');
    const sel = $('#albumSelect');
    const prev = sel.value;
    const names = Array.from(new Set([DEFAULT_ALBUM, ...list.map(([a]) => a)]));
    sel.innerHTML = names.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('') + '<option value="__new__">+ New album…</option>';
    sel.value = names.includes(prev) || prev === '__new__' ? prev : DEFAULT_ALBUM;
    $('#newAlbumWrap').classList.toggle('hidden', sel.value !== '__new__');
  }
  function visiblePhotos() {
    return state.photos.filter((p) => state.album === 'all' || albumOf(p) === state.album);
  }
  function renderGallery() {
    renderAlbumControls();
    const list = visiblePhotos();
    state.lbList = list;
    $('#galleryTitle').textContent = state.album === 'all' ? `Gallery ${state.year}` : state.album;
    $('#galleryCount').textContent = list.length ? `${list.length} photo${list.length > 1 ? 's' : ''}` : '';
    const grid = $('#galleryGrid');
    if (!list.length) {
      grid.innerHTML = `<div class="empty"><i class="fa-regular fa-images" style="font-size:2rem;display:block;margin-bottom:8px"></i>No photos ${state.album === 'all' ? `for ${state.year}` : 'in this album'} yet.${state.canUpload ? ' Add the first ones above.' : ''}</div>`;
      return;
    }
    grid.innerHTML = list.map((p, i) => {
      const ratio = p.width && p.height ? `aspect-ratio:${p.width}/${p.height};` : '';
      return `<figure class="tile" style="${ratio}" data-i="${i}" tabindex="0">
        <img data-src="${esc(thumbOf(p))}" data-fallback="${esc(p.url || '')}" alt="${esc(p.caption || 'Graduation photo')}" decoding="async">
        <figcaption>${esc(p.caption || albumOf(p))}</figcaption></figure>`;
    }).join('');
    lazyLoad(grid);
  }
  let observer = null;
  function lazyLoad(root) {
    if (observer) observer.disconnect();
    const load = (img) => {
      img.onload = () => img.classList.add('in');
      img.onerror = () => { if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback; else img.classList.add('in'); };
      img.src = img.dataset.src;
    };
    const imgs = root.querySelectorAll('img[data-src]');
    if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
    observer = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); load(e.target); } }), { rootMargin: '400px 0px' });
    imgs.forEach((img) => observer.observe(img));
  }

  function attachYear(year) {
    state.year = year;
    renderYears();
    if (state.ref) state.ref.off();
    $('#galleryGrid').innerHTML = '<div class="empty">Loading photos…</div>';
    state.ref = db.ref(gradPath(year, 'galleries'));
    state.ref.on('value', (snap) => {
      state.photos = Object.entries(snap.val() || {}).map(([key, v]) => ({ key, ...(v || {}) })).filter((p) => p.url || p.driveFileId)
        .sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0));
      renderGallery();
    }, (err) => { $('#galleryGrid').innerHTML = `<div class="empty">Unable to load photos: ${esc(err?.message || err)}</div>`; });
  }

  // ---------- lightbox ----------
  function openLightbox(i) {
    state.lbIndex = i;
    $('#lightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
    showLightbox();
  }
  function showLightbox() {
    const list = state.lbList;
    const p = list[state.lbIndex];
    if (!p) return;
    const img = $('#lbImg');
    img.classList.add('loading');
    img.src = thumbOf(p, 600); // instant from cache, then sharpen
    const big = new Image();
    big.onload = () => { if (list[state.lbIndex] === p) { img.src = big.src; img.classList.remove('loading'); } };
    big.onerror = () => { if (list[state.lbIndex] === p) { img.src = p.url || img.src; img.classList.remove('loading'); } };
    big.src = largeOf(p);
    img.alt = p.caption || 'Graduation photo';
    $('#lbCaption').textContent = p.caption || albumOf(p);
    $('#lbMeta').textContent = [albumOf(p), p.uploadedAt ? new Date(Number(p.uploadedAt)).toLocaleDateString('en-GB') : '', String(p.uploadedBy || '').split('@')[0]].filter(Boolean).join(' · ');
    $('#lbDownload').href = downloadOf(p);
    $('#lbCount').textContent = `${state.lbIndex + 1} / ${list.length}`;
    [state.lbIndex - 1, state.lbIndex + 1].forEach((j) => { if (list[j]) { const pre = new Image(); pre.src = largeOf(list[j]); } });
  }
  function step(d) {
    if (!state.lbList.length) return;
    state.lbIndex = (state.lbIndex + d + state.lbList.length) % state.lbList.length;
    showLightbox();
  }
  function closeLightbox() { $('#lightbox').classList.remove('show'); document.body.style.overflow = ''; state.lbIndex = -1; }

  // ---------- compression ----------
  function loadBitmap(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a readable image')); };
      img.src = url;
    });
  }
  async function prepareImage(file) {
    const { img, url } = await loadBitmap(file);
    try {
      let { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      const tw = Math.round(w * scale); const th = Math.round(h * scale);
      const thumbCanvas = document.createElement('canvas');
      const ts = Math.min(1, 120 / Math.max(w, h));
      thumbCanvas.width = Math.max(1, Math.round(w * ts)); thumbCanvas.height = Math.max(1, Math.round(h * ts));
      thumbCanvas.getContext('2d').drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const preview = thumbCanvas.toDataURL('image/jpeg', 0.7);
      if (scale === 1 && file.size <= 1.2 * 1024 * 1024 && /jpe?g/i.test(file.type)) return { blob: file, width: w, height: h, preview };
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) throw new Error('Could not compress image');
      return { blob, width: tw, height: th, preview };
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- Google Drive (same pattern as Bookshtml/upload.html) ----------
  let gisPromise = null;
  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load Google sign-in.'));
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }
  let tokenPromise = null;
  function driveToken() {
    if (state.token && Date.now() - state.tokenAt < 50 * 60 * 1000) return Promise.resolve(state.token);
    if (!tokenPromise) tokenPromise = requestToken().finally(() => { tokenPromise = null; });
    return tokenPromise; // parallel uploads share one Google sign-in
  }
  async function requestToken() {
    await loadGis();
    const token = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_SCOPE,
        prompt: '',
        hint: state.user?.email || undefined,
        callback: (res) => (res?.access_token ? resolve(res.access_token) : reject(new Error(res?.error_description || res?.error || 'Google Drive permission was not granted.'))),
        error_callback: (err) => reject(new Error(err?.message || 'Google Drive sign-in was closed.')),
      });
      client.requestAccessToken();
    });
    state.token = token; state.tokenAt = Date.now();
    return token;
  }
  async function driveJson(token, url, options = {}) {
    const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Google Drive request failed (HTTP ${res.status})`);
    return data;
  }
  const qText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const folderCache = new Map();
  async function ensureFolder(token, name, parentId) {
    const key = `somap_gallery_folder_${parentId || 'root'}_${name}`;
    if (folderCache.has(key)) return folderCache.get(key);
    const p = (async () => {
      const saved = localStorage.getItem(key);
      if (saved) return saved;
      const clauses = [`name = '${qText(name)}'`, `mimeType = '${DRIVE_FOLDER_MIME}'`, 'trashed = false'];
      if (parentId) clauses.push(`'${qText(parentId)}' in parents`);
      const found = await driveJson(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(clauses.join(' and '))}&fields=files(id)&pageSize=1`);
      let id = found.files?.[0]?.id;
      if (!id) {
        const created = await driveJson(token, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }) });
        id = created.id;
      }
      localStorage.setItem(key, id);
      return id;
    })();
    folderCache.set(key, p);
    try { return await p; } catch (err) { folderCache.delete(key); throw err; }
  }
  const safeName = (v) => String(v || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'SoMAp';
  async function albumFolder(token, album) {
    const root = await ensureFolder(token, DRIVE_ROOT, '');
    const school = await ensureFolder(token, safeName(state.school || schoolId()), root);
    const year = await ensureFolder(token, String(state.year), school);
    return ensureFolder(token, safeName(album), year);
  }
  async function uploadToDrive(blob, name, album, onProgress) {
    const token = await driveToken();
    const folderId = await albumFolder(token, album);
    const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'image/jpeg', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify({ name, parents: [folderId], description: `SoMAp graduation gallery ${state.year} · ${album}` }),
    });
    if (!init.ok) throw new Error(`Google Drive upload setup failed (${init.status})`);
    const session = init.headers.get('Location');
    if (!session) throw new Error('Google Drive did not return an upload session.');
    const uploaded = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', session, true);
      xhr.setRequestHeader('Content-Type', blob.type || 'image/jpeg');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 95)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new Error(`Google Drive upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error('Network error during Google Drive upload.'));
      xhr.send(blob);
    });
    await driveJson(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions?fields=id`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
    return { driveFileId: uploaded.id, driveFolderId: folderId, bytes: Number(uploaded.size || blob.size) };
  }
  function uploadToCloudinary(blob, name, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', blob, name);
      form.append('upload_preset', CLD_UPLOAD_PRESET);
      form.append('folder', CLD_GALLERY_FOLDER);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLD_CLOUD_NAME}/image/upload`, true);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 95)); };
      xhr.onload = () => { try { const d = JSON.parse(xhr.responseText || '{}'); if (xhr.status < 300 && d.secure_url) resolve(d); else reject(new Error(d.error?.message || `Cloud upload failed (${xhr.status})`)); } catch (e) { reject(e); } };
      xhr.onerror = () => reject(new Error('Network error during cloud upload.'));
      xhr.send(form);
    });
  }

  // ---------- upload queue ----------
  function currentAlbum() {
    const sel = $('#albumSelect').value;
    return sel === '__new__' ? (safeName($('#newAlbum').value) || DEFAULT_ALBUM) : sel;
  }
  function captionFor(file) {
    const typed = $('#captionInput').value.trim();
    if (typed) return typed;
    return file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Graduation moment';
  }
  function enqueue(files) {
    if (!state.canUpload) { toast('Only authorised staff can upload photos.', 'warn'); return; }
    const images = Array.from(files || []).filter((f) => f && (!f.type || f.type.startsWith('image/')));
    if (!images.length) { toast('Choose image files only.', 'warn'); return; }
    if ($('#albumSelect').value === '__new__' && !$('#newAlbum').value.trim()) { toast('Type a name for the new album first.', 'warn'); return; }
    const album = currentAlbum();
    images.forEach((file) => {
      const item = { id: Math.random().toString(36).slice(2), file, album, caption: captionFor(file), status: 'waiting', pct: 0 };
      state.queue.push(item);
      const el = document.createElement('div');
      el.className = 'q-item';
      el.id = `q-${item.id}`;
      el.innerHTML = `<img alt=""><div><div class="q-name">${esc(file.name)}</div><div class="q-state">Waiting…</div><div class="q-bar"><i></i></div></div>`;
      $('#queue').prepend(el);
    });
    pump();
  }
  function paint(item, text) {
    const el = document.getElementById(`q-${item.id}`);
    if (!el) return;
    el.querySelector('.q-state').textContent = text;
    el.querySelector('.q-bar i').style.width = `${item.pct}%`;
    el.classList.toggle('done', item.status === 'done');
    el.classList.toggle('fail', item.status === 'fail');
    if (item.preview) el.querySelector('img').src = item.preview;
  }
  function summary() {
    const done = state.queue.filter((q) => q.status === 'done').length;
    const failed = state.queue.filter((q) => q.status === 'fail').length;
    const left = state.queue.filter((q) => q.status === 'waiting' || q.status === 'busy').length;
    $('#uploadSummary').textContent = state.queue.length ? `${done} saved${failed ? ` · ${failed} failed` : ''}${left ? ` · ${left} in progress` : ''}` : '';
  }
  function pump() {
    summary();
    while (state.running < CONCURRENCY) {
      const next = state.queue.find((q) => q.status === 'waiting');
      if (!next) return;
      next.status = 'busy';
      state.running += 1;
      uploadOne(next).finally(() => { state.running -= 1; pump(); });
    }
  }
  async function uploadOne(item) {
    try {
      paint(item, 'Resizing…');
      const prepared = await prepareImage(item.file);
      item.preview = prepared.preview;
      // Staff uploads wait for Head Teacher approval; parents never see them until approved.
      const entryRef = db.ref(gradPath(state.year, state.isApprover ? 'galleries' : 'galleryPending')).push();
      const name = `${state.year}-${entryRef.key}-${safeName(item.file.name.replace(/\.[^.]+$/, ''))}.jpg`;
      const progress = (p) => { item.pct = p; paint(item, `Uploading ${p}%`); };
      let record;
      try {
        const d = await uploadToDrive(prepared.blob, name, item.album, progress);
        record = {
          storageProvider: 'google_drive', driveFileId: d.driveFileId, driveFolderId: d.driveFolderId,
          url: `https://drive.google.com/thumbnail?id=${encodeURIComponent(d.driveFileId)}&sz=w1600`,
          thumbUrl: `https://drive.google.com/thumbnail?id=${encodeURIComponent(d.driveFileId)}&sz=w600`,
          viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(d.driveFileId)}/view`,
          downloadUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(d.driveFileId)}`,
          storagePath: `drive:${DRIVE_ROOT}/${state.school || schoolId()}/${state.year}/${item.album}/${name}`, bytes: d.bytes,
        };
      } catch (driveErr) {
        console.warn('Drive upload failed, using cloud fallback', driveErr);
        paint(item, 'Drive unavailable, using backup storage…');
        const c = await uploadToCloudinary(prepared.blob, name, progress);
        record = { storageProvider: 'cloudinary', url: c.secure_url, storagePath: `${CLD_GALLERY_FOLDER}/${c.public_id}`, bytes: c.bytes, driveError: String(driveErr?.message || driveErr).slice(0, 200) };
        toast(`Saved to backup storage: ${driveErr?.message || 'Google Drive unavailable'}`, 'warn', 6000);
      }
      const entry = {
        caption: item.caption, album: item.album, width: prepared.width, height: prepared.height,
        uploadedBy: state.user?.email || 'unknown', uploadedAt: firebase.database.ServerValue.TIMESTAMP, ...record,
        ...(state.isApprover ? {} : { approval: 'pending', uploaderRole: state.role || 'staff' }),
      };
      await entryRef.set(entry);
      await db.ref(gradPath(state.year, 'audits')).push({
        actor: state.user?.email || 'unknown', action: state.isApprover ? 'gallery:add' : 'gallery:submit-for-approval', refType: 'gallery', refId: entryRef.key,
        after: { caption: entry.caption, url: entry.url, album: entry.album, storageProvider: entry.storageProvider }, at: firebase.database.ServerValue.TIMESTAMP,
      });
      item.status = 'done'; item.pct = 100;
      paint(item, !state.isApprover ? 'Sent to Head Teacher for approval ✓' : record.storageProvider === 'google_drive' ? 'Saved to Google Drive ✓' : 'Saved (backup storage) ✓');
    } catch (err) {
      console.error(err);
      item.status = 'fail';
      paint(item, err?.message || 'Upload failed');
    }
    summary();
  }

  // ---------- wiring ----------
  function bind() {
    const drop = $('#dropZone');
    const input = $('#fileInput');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => enqueue(e.dataTransfer?.files));
    input.addEventListener('change', () => { enqueue(input.files); input.value = ''; });
    $('#albumSelect').addEventListener('change', (e) => $('#newAlbumWrap').classList.toggle('hidden', e.target.value !== '__new__'));

    document.addEventListener('click', (e) => {
      const y = e.target.closest('[data-year]');
      if (y) { attachYear(Number(y.dataset.year)); return; }
      const a = e.target.closest('[data-album]');
      if (a) { state.album = a.dataset.album; renderGallery(); return; }
      const tile = e.target.closest('.tile');
      if (tile) { openLightbox(Number(tile.dataset.i)); return; }
      if (e.target.closest('[data-lb-close]')) { closeLightbox(); return; }
      if (e.target.closest('[data-lb-prev]')) { step(-1); return; }
      if (e.target.closest('[data-lb-next]')) { step(1); return; }
      if (e.target.id === 'lbStage') closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (!$('#lightbox').classList.contains('show')) {
        if (e.key === 'Enter' && e.target.classList?.contains('tile')) openLightbox(Number(e.target.dataset.i));
        return;
      }
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
    let x0 = null;
    const stage = $('#lbStage');
    stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
      x0 = null;
    });
    window.addEventListener('beforeunload', (e) => { if (state.queue.some((q) => q.status === 'busy' || q.status === 'waiting')) { e.preventDefault(); e.returnValue = ''; } });
  }

  // 'approver' publishes directly; 'staff' uploads for Head Teacher approval; null = view only (parents).
  async function resolveUploader(user) {
    if (!user) return null;
    if (UPLOADER_EMAILS.has(String(user.email || '').toLowerCase())) return 'approver';
    const key = String(user.email || '').trim().toLowerCase().replace(/\./g, '_');
    const role = String((await read(`users/${user.uid}/role`)) || (await read(`users/${key}/role`)) || '').trim().toLowerCase();
    state.role = role;
    if (UPLOADER_ROLES.has(role)) return 'approver';
    return NON_STAFF_ROLES.has(role) ? null : 'staff';
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    renderYears();
    const y = Number(window.somapYearContext?.getSelectedYear?.() || sessionStorage.getItem('somap_selected_year') || new Date().getFullYear());
    let started = false;
    auth.onAuthStateChanged(async (user) => {
      state.user = user;
      if (!started) { started = true; attachYear(Number.isFinite(y) ? y : new Date().getFullYear()); }
      const access = await resolveUploader(user);
      state.canUpload = Boolean(access);
      state.isApprover = access === 'approver';
      $('#uploadPanel').classList.toggle('hidden', !state.canUpload);
      const note = document.getElementById('approvalNote');
      if (note) note.classList.toggle('hidden', !(state.canUpload && !state.isApprover));
      const profile = (await read(`schools/${schoolId()}/profile`)) || {};
      state.school = String(profile.name || profile.schoolName || window.SOMAP?.getSchool?.()?.name || (schoolId() === 'socrates-school' ? 'Socrates School' : schoolId())).trim();
      $('#schoolName').textContent = state.school;
      renderGallery();
    });
  });
}());
