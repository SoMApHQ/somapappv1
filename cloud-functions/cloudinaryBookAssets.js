/**
 * Firebase HTTPS function for signed Cloudinary book deletion.
 *
 * Deploy this from a Firebase Functions project after installing:
 *   npm install firebase-admin firebase-functions busboy
 *
 * PDF compression requires Ghostscript on the function host. Configure either:
 *   PDF_COMPRESSOR_BIN=/path/to/gs
 *   or functions config pdf.compressor_bin
 *
 * Required environment, either as process env vars or functions config:
 *   CLOUDINARY_CLOUD_NAME / cloudinary.cloud_name
 *   CLOUDINARY_API_KEY    / cloudinary.api_key
 *   CLOUDINARY_API_SECRET / cloudinary.api_secret
 *
 * Frontend endpoint:
 *   https://REGION-PROJECT.cloudfunctions.net/deleteCloudinaryBookAsset
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Busboy = require('busboy');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

if (!admin.apps.length) admin.initializeApp();

function envValue(name, configPath) {
  const env = process.env[name];
  if (env) return env;
  return configPath.split('.').reduce((obj, key) => (obj && obj[key]) || null, functions.config()) || '';
}

function emailKey(email) {
  return String(email || '').replace(/\./g, '_');
}

function cors(res) {
  res.set('Access-Control-Allow-Origin', 'https://somapv2i.com');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Expose-Headers', 'X-Original-Size, X-Compressed-Size, X-Reduction-Percent, Content-Disposition');
}

async function requireAdmin(req) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) throw Object.assign(new Error('Missing auth token'), { status: 401 });

  const decoded = await admin.auth().verifyIdToken(token);
  const userSnap = await admin.database().ref(`users/${emailKey(decoded.email)}`).once('value');
  const user = userSnap.val() || {};
  if (user.role !== 'admin') throw Object.assign(new Error('Admin role required'), { status: 403 });
  return { uid: decoded.uid, email: decoded.email, key: emailKey(decoded.email) };
}

function cleanAsset(asset) {
  return {
    asset_id: String(asset && asset.asset_id || ''),
    public_id: String(asset && asset.public_id || asset && asset.cloudinary_public_id || ''),
    resource_type: String(asset && asset.resource_type || 'raw'),
    type: String(asset && asset.type || 'upload')
  };
}

function sanitizeKey(value) {
  return String(value || '').replace(/[.#$\[\]]/g, '_');
}

async function deleteCloudinaryAsset(asset) {
  const cloudName = envValue('CLOUDINARY_CLOUD_NAME', 'cloudinary.cloud_name');
  const apiKey = envValue('CLOUDINARY_API_KEY', 'cloudinary.api_key');
  const apiSecret = envValue('CLOUDINARY_API_SECRET', 'cloudinary.api_secret');
  if (!cloudName || !apiKey || !apiSecret) {
    throw Object.assign(new Error('Cloudinary credentials are not configured on the server'), { status: 500 });
  }

  const resourceType = encodeURIComponent(asset.resource_type || 'raw');
  const type = encodeURIComponent(asset.type || 'upload');
  const idPart = asset.asset_id
    ? `by_asset_id/${encodeURIComponent(asset.asset_id)}`
    : encodeURIComponent(asset.public_id || '');
  if (!idPart) throw Object.assign(new Error('Missing Cloudinary asset_id/public_id'), { status: 400 });

  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/${resourceType}/${type}/${idPart}?invalidate=true`;
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const result = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${auth}` }
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw Object.assign(new Error(body.error && body.error.message || `Cloudinary delete failed with HTTP ${result.status}`), { status: 502, body });
  }
  return body;
}

function parseMultipartPdf(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 70 * 1024 * 1024 } });
    const fields = {};
    let upload = null;
    let pendingWrite = null;

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, file, info) => {
      const filename = String(info.filename || 'book.pdf');
      const mimeType = String(info.mimeType || '');
      if (name !== 'file' || (!filename.toLowerCase().endsWith('.pdf') && mimeType !== 'application/pdf')) {
        file.resume();
        reject(Object.assign(new Error('Only PDF files are supported'), { status: 400 }));
        return;
      }
      const tmpPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-${filename.replace(/[^\w.-]/g, '_')}`);
      const out = fs.createWriteStream(tmpPath);
      upload = { path: tmpPath, filename, mimeType };
      pendingWrite = new Promise((res, rej) => {
        out.on('finish', res);
        out.on('error', rej);
      });
      file.pipe(out);
    });

    busboy.on('error', reject);
    busboy.on('finish', async () => {
      try {
        if (pendingWrite) await pendingWrite;
        if (!upload) throw Object.assign(new Error('Missing PDF file'), { status: 400 });
        resolve({ file: upload, fields });
      } catch (error) {
        reject(error);
      }
    });

    if (req.rawBody) busboy.end(req.rawBody);
    else req.pipe(busboy);
  });
}

function runGhostscriptCompression(inputPath, outputPath) {
  const bin = envValue('PDF_COMPRESSOR_BIN', 'pdf.compressor_bin') || 'gs';
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-dPDFSETTINGS=/ebook',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    `-sOutputFile=${outputPath}`,
    inputPath
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      reject(Object.assign(new Error(`PDF compressor failed to start: ${error.message}`), { status: 500 }));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(Object.assign(new Error(`PDF compressor failed: ${stderr || `exit code ${code}`}`), { status: 500 }));
        return;
      }
      resolve();
    });
  });
}

exports.compressPdfForUpload = functions
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    let inputPath = '';
    let outputPath = '';
    try {
      await requireAdmin(req);
      const parsed = await parseMultipartPdf(req);
      inputPath = parsed.file.path;
      outputPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-compressed.pdf`);

      const originalSize = fs.statSync(inputPath).size;
      await runGhostscriptCompression(inputPath, outputPath);

      if (!fs.existsSync(outputPath)) {
        throw Object.assign(new Error('Compression did not create an output PDF'), { status: 500 });
      }

      let compressedSize = fs.statSync(outputPath).size;
      let responsePath = outputPath;
      if (!compressedSize || compressedSize >= originalSize) {
        responsePath = inputPath;
        compressedSize = originalSize;
      }

      const reduction = originalSize > 0
        ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
        : 0;
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${path.basename(parsed.file.filename, '.pdf')}.compressed.pdf"`);
      res.set('X-Original-Size', String(originalSize));
      res.set('X-Compressed-Size', String(compressedSize));
      res.set('X-Reduction-Percent', String(reduction));
      return fs.createReadStream(responsePath).pipe(res);
    } catch (error) {
      console.error(error);
      return res.status(error.status || 500).send(error.message || String(error));
    } finally {
      [inputPath, outputPath].forEach((filePath) => {
        if (filePath) fs.promises.unlink(filePath).catch(() => {});
      });
    }
  });

exports.deleteCloudinaryBookAsset = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const adminUser = await requireAdmin(req);
    const { action, bookId, previousAssetKey, reason } = req.body || {};
    if (!bookId) return res.status(400).json({ ok: false, error: 'bookId is required' });

    const bookRef = admin.database().ref(`books/${bookId}`);
    const bookSnap = await bookRef.once('value');
    const book = bookSnap.val();
    if (!book) return res.status(404).json({ ok: false, error: 'Book not found' });

    if (action === 'deleteBook') {
      const status = String(book.status || 'active').toLowerCase();
      if (status !== 'archived') {
        return res.status(409).json({ ok: false, error: 'Archive the book before permanent deletion' });
      }
      const asset = cleanAsset(req.body.asset || book);
      const cloudinaryResult = await deleteCloudinaryAsset(asset);
      const year = String(book.year || book.academicYear || new Date().getFullYear());
      const cls = encodeURIComponent(book.class || '');
      const updates = {};
      updates[`books/${bookId}`] = null;
      if (cls) {
        updates[`class_books/${year}/${cls}/${bookId}`] = null;
        updates[`class_books/${cls}/${bookId}`] = null;
      }
      const classIndexKey = sanitizeKey(book.class || '').toLowerCase();
      const subjectIndexKey = sanitizeKey(book.subject || '').toLowerCase();
      if (classIndexKey && subjectIndexKey) {
        updates[`classbooksIndex/${year}/${classIndexKey}/${subjectIndexKey}`] = null;
      }
      updates[`book_deletion_logs/${bookId}`] = {
        action,
        title: book.title || '',
        class: book.class || '',
        subject: book.subject || '',
        year,
        asset,
        deletedAt: Date.now(),
        deletedBy: adminUser.key,
        deletedByEmail: adminUser.email,
        deletedReason: reason || ''
      };
      await admin.database().ref().update(updates);
      return res.json({ ok: true, action, cloudinaryResult });
    }

    if (action === 'deletePreviousAsset') {
      if (!previousAssetKey) return res.status(400).json({ ok: false, error: 'previousAssetKey is required' });
      const assetSnap = await bookRef.child(`previousAssets/${previousAssetKey}`).once('value');
      const previousAsset = assetSnap.val();
      if (!previousAsset) return res.status(404).json({ ok: false, error: 'Previous asset not found' });
      const asset = cleanAsset(req.body.asset || previousAsset);
      const cloudinaryResult = await deleteCloudinaryAsset(asset);
      await bookRef.child(`previousAssets/${previousAssetKey}`).remove();
      await admin.database().ref(`book_deletion_logs/${bookId}/previousAssets/${previousAssetKey}`).set({
        action,
        title: book.title || '',
        asset,
        deletedAt: Date.now(),
        deletedBy: adminUser.key,
        deletedByEmail: adminUser.email,
        deletedReason: reason || ''
      });
      return res.json({ ok: true, action, cloudinaryResult });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({ ok: false, error: error.message || String(error) });
  }
});
