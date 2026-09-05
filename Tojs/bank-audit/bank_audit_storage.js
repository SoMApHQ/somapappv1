(function (global) {
  "use strict";

  function db() {
    return global.firebase?.database?.();
  }

  function authUser() {
    return global.firebase?.auth?.().currentUser || null;
  }

  const GOOGLE_CLIENT_ID = "105526245138-6om2vv54l5adt0a79afmpbjb26rofjqc.apps.googleusercontent.com";
  const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const DRIVE_ROOT_FOLDER_NAME = "SoMAp Bank Audit Storage";
  const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

  function schoolId() {
    return global.SOMAP?.getSchoolId?.() || "";
  }

  function school() {
    return global.SOMAP?.getSchool?.() || { id: schoolId() };
  }

  function year() {
    return global.somapYearContext?.getSelectedYear?.() || String(new Date().getFullYear());
  }

  function path(subPath) {
    if (global.SOMAP?.P) return global.SOMAP.P(subPath);
    return subPath;
  }

  function auditPath(y) {
    return path(`years/${y || year()}/bankAudits`);
  }

  function safeName(value) {
    return String(value || "file").replace(/[^\w.-]+/g, "_").slice(0, 120);
  }

  function safeDriveName(value) {
    return String(value || "")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || "SoMAp Bank Audit";
  }

  function storageAuditBase(audit, y) {
    const sid = schoolId() || audit?.schoolId || "socrates-school";
    const yr = String(y || audit?.year || year());
    const id = audit?.id || audit?.auditId;
    if (!id) throw new Error("Audit ID is required before uploading files.");
    return `bankAudits/${safeName(sid)}/years/${safeName(yr)}/${safeName(id)}`;
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (global.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error("Google Drive sign-in library did not load. Refresh and try again."));
        }
      }, 100);
    });
  }

  async function requestDriveAccessToken() {
    await waitForGoogleIdentity();
    return new Promise((resolve, reject) => {
      const tokenClient = global.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_SCOPE,
        prompt: "",
        callback: (response) => {
          if (response?.access_token) resolve(response.access_token);
          else reject(new Error(response?.error_description || response?.error || "Google Drive permission was not granted."));
        }
      });
      tokenClient.requestAccessToken();
    });
  }

  function driveHeaders(accessToken, extra) {
    return { Authorization: `Bearer ${accessToken}`, ...(extra || {}) };
  }

  function escapeDriveQueryText(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function driveFolderStorageKey(name, parentId) {
    return `somap_bank_audit_drive_folder_${parentId || "root"}_${name}`;
  }

  async function driveApiJson(accessToken, url, options) {
    const res = await fetch(url, {
      ...(options || {}),
      headers: driveHeaders(accessToken, {
        "Content-Type": "application/json; charset=UTF-8",
        ...((options && options.headers) || {})
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Google Drive request failed with HTTP ${res.status}`);
    return data;
  }

  async function findDriveFolder(accessToken, name, parentId) {
    const key = driveFolderStorageKey(name, parentId);
    const savedId = localStorage.getItem(key);
    if (savedId) return savedId;
    const clauses = [
      `name = '${escapeDriveQueryText(name)}'`,
      `mimeType = '${DRIVE_FOLDER_MIME}'`,
      "trashed = false"
    ];
    if (parentId) clauses.push(`'${escapeDriveQueryText(parentId)}' in parents`);
    const q = encodeURIComponent(clauses.join(" and "));
    const data = await driveApiJson(accessToken, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`);
    const id = data.files && data.files[0] && data.files[0].id;
    if (id) localStorage.setItem(key, id);
    return id || "";
  }

  async function createDriveFolder(accessToken, name, parentId) {
    const metadata = { name, mimeType: DRIVE_FOLDER_MIME };
    if (parentId) metadata.parents = [parentId];
    const data = await driveApiJson(accessToken, "https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method: "POST",
      body: JSON.stringify(metadata)
    });
    localStorage.setItem(driveFolderStorageKey(name, parentId), data.id);
    return data.id;
  }

  async function ensureDriveFolder(accessToken, name, parentId) {
    return (await findDriveFolder(accessToken, name, parentId)) || createDriveFolder(accessToken, name, parentId);
  }

  async function ensureAuditDriveFolder(accessToken, audit) {
    const rootId = await ensureDriveFolder(accessToken, DRIVE_ROOT_FOLDER_NAME, "");
    const schoolFolder = await ensureDriveFolder(accessToken, safeDriveName(audit.schoolName || audit.schoolId || schoolId()), rootId);
    const yearFolder = await ensureDriveFolder(accessToken, String(audit.year || year()), schoolFolder);
    return ensureDriveFolder(accessToken, `${safeDriveName(audit.bankName || "Bank")} - ${safeDriveName(audit.id || audit.auditId)}`, yearFolder);
  }

  async function uploadFileToDrive(accessToken, file, metadata, onProgress) {
    const initRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,webContentLink", {
      method: "POST",
      headers: driveHeaders(accessToken, {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": file.type || "application/octet-stream",
        "X-Upload-Content-Length": String(file.size)
      }),
      body: JSON.stringify(metadata)
    });
    if (!initRes.ok) {
      const text = await initRes.text().catch(() => initRes.statusText);
      throw new Error(`Google Drive upload setup failed: ${text || initRes.status}`);
    }
    const sessionUrl = initRes.headers.get("Location");
    if (!sessionUrl) throw new Error("Google Drive did not return an upload session.");
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", sessionUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText || "{}")); } catch (error) { reject(error); }
        } else {
          reject(new Error(`Google Drive upload failed: ${xhr.status} ${xhr.responseText || xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during Google Drive upload."));
      xhr.send(file);
    });
  }

  function driveDownloadUrl(fileId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }

  async function shareDriveFileByLink(accessToken, fileId) {
    await driveApiJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=id`, {
      method: "POST",
      body: JSON.stringify({ role: "reader", type: "anyone" })
    });
  }

  async function readDriveFile(accessToken, fileId) {
    return driveApiJson(accessToken, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,webContentLink`);
  }

  async function uploadAuditFileToDrive(accessToken, audit, file, kind, onProgress) {
    if (!file) return null;
    const folderId = await ensureAuditDriveFolder(accessToken, audit);
    const prefix = kind === "reports" ? "SoMAp Audit Report" : "Bank Statement";
    const driveName = `${prefix} - ${safeDriveName(audit.bankName || "Bank")} - ${safeDriveName(audit.statementPeriodFrom || audit.year || "")} - ${safeDriveName(file.name)}`;
    const uploaded = await uploadFileToDrive(accessToken, file, {
      name: driveName,
      mimeType: file.type || "application/octet-stream",
      parents: [folderId],
      description: `SoMAp bank audit ${kind || "file"} for ${audit.schoolName || audit.schoolId || schoolId()}`
    }, onProgress);
    await shareDriveFileByLink(accessToken, uploaded.id);
    const meta = await readDriveFile(accessToken, uploaded.id);
    return {
      storageProvider: "google_drive",
      driveFileId: meta.id,
      driveFolderId: folderId,
      driveWebViewLink: meta.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(meta.id)}/view`,
      driveWebContentLink: meta.webContentLink || "",
      driveDownloadLink: driveDownloadUrl(meta.id),
      downloadUrl: meta.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(meta.id)}/view`,
      fileName: meta.name || driveName,
      contentType: meta.mimeType || file.type || "application/octet-stream",
      size: Number(meta.size || file.size || 0),
      uploadedAt: Date.now()
    };
  }

  async function getSettings(y) {
    const snap = await db().ref(path(`years/${y || year()}/bankAuditSettings`)).once("value");
    return snap.val() || {};
  }

  async function saveSettings(settings, y) {
    await db().ref(path(`years/${y || year()}/bankAuditSettings`)).update(settings || {});
  }

  async function listAudits(y) {
    const snap = await db().ref(auditPath(y)).once("value");
    const val = snap.val() || {};
    return Object.entries(val)
      .map(([id, audit]) => ({ id, ...(audit || {}) }))
      .sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0));
  }

  async function getAudit(id, y) {
    const snap = await db().ref(`${auditPath(y)}/${id}`).once("value");
    const val = snap.val();
    return val ? { id, ...val } : null;
  }

  async function saveAudit(audit, y) {
    const ref = audit.id ? db().ref(`${auditPath(y)}/${audit.id}`) : db().ref(auditPath(y)).push();
    const user = authUser();
    const now = Date.now();
    const payload = {
      ...audit,
      id: ref.key,
      auditId: ref.key,
      schoolId: schoolId(),
      schoolName: school()?.name || school()?.schoolName || schoolId(),
      year: String(y || year()),
      uploadedAt: audit.uploadedAt || now,
      updatedAt: now,
      uploadedBy: {
        uid: user?.uid || "",
        email: user?.email || ""
      }
    };
    await ref.set(payload);
    return payload;
  }

  function reserveAuditId(y) {
    return db().ref(auditPath(y)).push().key;
  }

  async function updateAudit(id, patch, y) {
    await db().ref(`${auditPath(y)}/${id}`).update({
      ...(patch || {}),
      updatedAt: Date.now()
    });
  }

  async function uploadAuditBlob(audit, blob, fileName, contentType, kind) {
    if (audit?._driveAccessToken) {
      const file = new File([blob], fileName || "audit.pdf", { type: contentType || blob?.type || "application/octet-stream" });
      return uploadAuditFileToDrive(audit._driveAccessToken, audit, file, kind || "reports");
    }
    throw new Error("Google Drive permission is required before saving audit files.");
  }

  async function uploadAuditFile(audit, file, kind) {
    if (!file) return null;
    if (audit?._driveAccessToken) return uploadAuditFileToDrive(audit._driveAccessToken, audit, file, kind || "statement");
    throw new Error("Google Drive permission is required before saving audit files.");
  }

  async function deleteAudit(id, y) {
    await db().ref(`${auditPath(y)}/${id}`).remove();
  }

  global.SomapBankAuditStorage = {
    year,
    school,
    schoolId,
    path,
    getSettings,
    saveSettings,
    listAudits,
    getAudit,
    saveAudit,
    reserveAuditId,
    updateAudit,
    uploadAuditBlob,
    uploadAuditFile,
    requestDriveAccessToken,
    uploadAuditFileToDrive,
    deleteAudit
  };
})(window);
