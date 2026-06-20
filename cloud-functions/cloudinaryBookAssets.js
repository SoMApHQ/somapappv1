/**
 * Firebase HTTPS function for signed Cloudinary book deletion.
 *
 * Deploy this from a Firebase Functions project after installing:
 *   npm install firebase-admin firebase-functions
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
