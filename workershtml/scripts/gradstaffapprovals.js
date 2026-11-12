/*
 * Graduation uploads awaiting Head Teacher approval (shown on headteacherapprovals.html).
 *
 * Staff can use every graduation page except Expenses; what they ADD waits here:
 *   - gallery photos:  schools/{id}/graduation/{year}/galleryPending/{photoId}
 *                      → approve moves it to .../galleries/{photoId} (parents then see it)
 *   - teacher awards:  P(studentAwards/{year}/{awardId}) with approvalStatus 'pending'
 *                      → approve sets approvalStatus 'approved' (certificate unlocks)
 * Head Teacher check mirrors headteacherapprovals.js: worker role / teacherType contains "head".
 */
(function () {
  'use strict';
  const ID = 'grad-staff-approvals';
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const css = `
    #${ID} { margin-top:24px; background:linear-gradient(135deg,#0f172a,#1e1b4b); border:1px solid rgba(255,255,255,0.15); border-radius:18px; padding:18px; box-shadow:0 18px 48px rgba(0,0,0,0.35); color:#e2e8f0; font-family:'Inter',system-ui,sans-serif; }
    #${ID} h2 { margin:0 0 4px; font-size:1.3rem; color:#fff; }
    #${ID} .eyebrow { text-transform:uppercase; letter-spacing:.08em; font-size:.78rem; color:#fcd34d; margin:0 0 4px; }
    #${ID} .sub { color:#94a3b8; margin:0 0 12px; font-size:.92rem; }
    #${ID} .pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
    #${ID} .pill { padding:7px 12px; border-radius:999px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.16); font-size:.85rem; }
    #${ID} .pill b { color:#fcd34d; }
    #${ID} h3 { margin:16px 0 8px; font-size:1rem; color:#fff; }
    #${ID} .photos { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); }
    #${ID} .photo { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; }
    #${ID} .photo img { width:100%; height:150px; object-fit:cover; background:#1e293b; display:block; cursor:zoom-in; }
    #${ID} .meta { padding:8px 10px; font-size:.82rem; flex:1; }
    #${ID} .meta b { color:#fff; display:block; } #${ID} .meta small { color:#94a3b8; }
    #${ID} .acts { display:flex; gap:6px; padding:0 10px 10px; }
    #${ID} .btn { flex:1; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.15); cursor:pointer; font-weight:700; font-size:.82rem; }
    #${ID} .btn.ok { background:#ecfdf3; border-color:#bbf7d0; color:#166534; }
    #${ID} .btn.no { background:#fef2f2; border-color:#fecdd3; color:#9f1239; }
    #${ID} .btn[disabled] { opacity:.5; cursor:progress; }
    #${ID} .award { display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); margin-bottom:8px; }
    #${ID} .award .acts { padding:0; }
    #${ID} .empty { color:#94a3b8; font-size:.9rem; padding:6px 0; }
    #${ID} .bulk { display:flex; gap:8px; justify-content:flex-end; margin:-4px 0 8px; }
    #${ID}-zoom { position:fixed; inset:0; background:rgba(2,6,23,.92); display:none; align-items:center; justify-content:center; z-index:10001; cursor:zoom-out; }
    #${ID}-zoom img { max-width:94vw; max-height:90vh; border-radius:8px; }`;

  const db = () => firebase.database();
  const P = (p) => (window.SOMAP?.P ? window.SOMAP.P(p) : p);
  async function val(path) { try { const s = await db().ref(path).once('value'); return s.val(); } catch (_) { return null; } }
  function toast(msg) {
    let t = document.getElementById(`${ID}-toast`);
    if (!t) { t = document.createElement('div'); t.id = `${ID}-toast`; t.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10002;padding:12px 16px;border-radius:12px;background:#065f46;color:#fff;font-weight:600;font-family:Inter,sans-serif;transition:opacity .3s'; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1'; clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = '0'; }, 4000);
  }
  const thumb = (p) => (p.driveFileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(p.driveFileId)}&sz=w480` : String(p.url || '').replace('/upload/', '/upload/c_limit,w_480,q_auto,f_auto/'));
  const large = (p) => (p.driveFileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(p.driveFileId)}&sz=w1600` : p.url);

  async function whoIsHead(year) {
    const workerId = localStorage.getItem('workerId');
    if (!workerId) return null;
    const legacy = window.SOMAP?.getSchool?.()?.id === 'socrates-school';
    const profile = (await val(P(`years/${year}/workers/${workerId}/profile`))) || (legacy ? await val(`workers/${workerId}/profile`) : null) || {};
    const cfg = (await val(P(`years/${year}/teachers_config/${workerId}`))) || (legacy ? await val(`teachers_config/${workerId}`) : null) || {};
    const role = String(profile.role || '').toLowerCase();
    const type = String(cfg.teacherType || '').toLowerCase();
    const cached = String(localStorage.getItem('somap_role') || '').toLowerCase();
    if (!(role.includes('head') || type.includes('head') || cached.includes('head'))) return null;
    const name = String(profile.fullNameUpper || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || workerId).trim();
    return { workerId, name };
  }

  function ensureHost() {
    let host = document.getElementById(ID);
    if (host) return host;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    host = document.createElement('section'); host.id = ID;
    const anchor = document.getElementById('headteacher-approvals-card');
    (anchor?.parentNode || document.body).insertBefore(host, anchor || null);
    const zoom = document.createElement('div'); zoom.id = `${ID}-zoom`; zoom.innerHTML = '<img alt="">';
    zoom.addEventListener('click', () => { zoom.style.display = 'none'; });
    document.body.appendChild(zoom);
    return host;
  }

  async function load() {
    const school = window.SOMAP?.getSchool?.();
    if (!school?.id || !window.firebase?.database) return;
    const year = String(window.somapYearContext?.getSelectedYear?.() || new Date().getFullYear());
    const head = await whoIsHead(year);
    if (!head) return;
    const gradBase = `schools/${school.id}/graduation/${year}`;
    const [pendingPhotos, awards] = await Promise.all([val(`${gradBase}/galleryPending`), val(P(`studentAwards/${year}`))]);
    const photos = Object.entries(pendingPhotos || {}).filter(([, p]) => p && p.approval !== 'rejected').map(([id, p]) => ({ id, ...p })).sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0));
    const pendingAwards = Object.entries(awards || {}).filter(([, a]) => a && a.approvalStatus === 'pending').map(([id, a]) => ({ id, ...a }));
    const host = ensureHost();
    host.innerHTML = `
      <p class="eyebrow">Graduation · staff uploads</p>
      <h2>Waiting for your approval</h2>
      <p class="sub">Staff can use every graduation page except Expenses. Anything they add appears here first. Parents and certificates only see it after you approve.</p>
      <div class="pills"><span class="pill">Gallery photos <b>${photos.length}</b></span><span class="pill">Teacher awards <b>${pendingAwards.length}</b></span><span class="pill">Year <b>${esc(year)}</b></span></div>
      <h3>Gallery photos</h3>
      ${photos.length > 1 ? '<div class="bulk"><button class="btn ok" data-all-photos style="flex:0 0 auto">Approve all photos</button></div>' : ''}
      ${photos.length ? `<div class="photos">${photos.map((p) => `
        <div class="photo"><img src="${esc(thumb(p))}" data-zoom="${esc(large(p))}" alt="" loading="lazy" onerror="this.src='${esc(p.url || '')}'">
          <div class="meta"><b>${esc(p.caption || 'Graduation photo')}</b><small>${esc(p.album || 'Graduation Day')} · ${esc(String(p.uploadedBy || '').split('@')[0])} · ${p.uploadedAt ? new Date(Number(p.uploadedAt)).toLocaleDateString('en-GB') : ''}</small></div>
          <div class="acts"><button class="btn ok" data-photo-ok="${esc(p.id)}">Approve</button><button class="btn no" data-photo-no="${esc(p.id)}">Reject</button></div></div>`).join('')}</div>` : '<div class="empty">No photos waiting.</div>'}
      <h3>Teacher awards</h3>
      ${pendingAwards.length ? pendingAwards.map((a) => `
        <div class="award"><div><b style="color:#fff">${esc(a.studentName || '—')}</b> · ${esc(a.categoryName || 'Award')} · Position ${esc(a.rank || '—')}<br><small style="color:#94a3b8">${a.scope === 'school' ? 'Whole school' : esc(a.className || 'Class')} · by ${esc(String(a.createdByEmail || '').split('@')[0])}</small></div>
          <div class="acts"><button class="btn ok" data-award-ok="${esc(a.id)}">Approve</button><button class="btn no" data-award-no="${esc(a.id)}">Reject</button></div></div>`).join('') : '<div class="empty">No awards waiting.</div>'}`;

    if (location.hash === '#graduation' && !load.scrolled) { load.scrolled = true; host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    const stamp = () => ({ by: head.name, byWorkerId: head.workerId, at: firebase.database.ServerValue.TIMESTAMP });
    async function approvePhoto(id) {
      const p = photos.find((x) => x.id === id);
      if (!p) return;
      const { id: _id, approval, ...entry } = p;
      await db().ref(`${gradBase}/galleries/${id}`).set({ ...entry, approvedBy: head.name, approvedAt: firebase.database.ServerValue.TIMESTAMP });
      await db().ref(`${gradBase}/galleryPending/${id}`).remove();
      await db().ref(`${gradBase}/audits`).push({ actor: head.name, action: 'gallery:approve', refType: 'gallery', refId: id, after: { caption: p.caption, url: p.url }, at: firebase.database.ServerValue.TIMESTAMP });
    }
    host.onclick = async (e) => {
      const z = e.target.closest('[data-zoom]');
      if (z) { const box = document.getElementById(`${ID}-zoom`); box.querySelector('img').src = z.dataset.zoom; box.style.display = 'flex'; return; }
      const btn = e.target.closest('button');
      if (!btn) return;
      btn.disabled = true;
      try {
        if (btn.dataset.photoOk) { await approvePhoto(btn.dataset.photoOk); toast('Photo approved and published to the gallery.'); }
        else if (btn.dataset.photoNo) {
          const reason = window.prompt('Reason for rejecting this photo (optional):');
          if (reason === null) { btn.disabled = false; return; }
          await db().ref(`${gradBase}/galleryPending/${btn.dataset.photoNo}`).update({ approval: 'rejected', rejectReason: reason, rejectedBy: head.name, rejectedAt: firebase.database.ServerValue.TIMESTAMP });
          toast('Photo rejected. It will not be shown.');
        } else if (btn.dataset.allPhotos !== undefined) {
          if (!window.confirm(`Approve all ${photos.length} photos?`)) { btn.disabled = false; return; }
          for (const p of photos) await approvePhoto(p.id);
          toast(`${photos.length} photos approved.`);
        } else if (btn.dataset.awardOk) {
          await db().ref(P(`studentAwards/${year}/${btn.dataset.awardOk}`)).update({ approvalStatus: 'approved', approvedBy: head.name, approvedAt: stamp().at });
          toast('Award approved. Its certificate can now be downloaded.');
        } else if (btn.dataset.awardNo) {
          const reason = window.prompt('Reason for rejecting this award (optional):');
          if (reason === null) { btn.disabled = false; return; }
          await db().ref(P(`studentAwards/${year}/${btn.dataset.awardNo}`)).update({ approvalStatus: 'rejected', rejectReason: reason, rejectedBy: head.name, rejectedAt: stamp().at });
          toast('Award rejected.');
        }
        await load();
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        toast(`Could not save: ${err?.message || err}`);
      }
    };
  }

  document.addEventListener('DOMContentLoaded', () => { load(); });
  window.addEventListener('headteacher-approvals-open', () => { load(); });
}());
