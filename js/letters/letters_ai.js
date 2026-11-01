// SoMAp Letters — writing assistant client.
// The AI itself runs in the Cloud Functions (cloud-functions/letters); the browser never holds the API key.
// When the service is not deployed or unreachable, `tidy` gives an offline clean-up:
// capitals, spacing, punctuation, money format and paragraphing — never new facts.
(function (global) {
  'use strict';
  const T = global.SomapLettersT;

  // ---------- offline tidy ----------
  const PROPER = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tanzania', 'arusha', 'dodoma', 'dar es salaam', 'mwanza', 'moshi',
    'januari', 'februari', 'machi', 'aprili', 'mei', 'juni', 'julai', 'agosti', 'septemba', 'oktoba', 'novemba', 'desemba',
    'jumatatu', 'jumanne', 'jumatano', 'alhamisi', 'ijumaa', 'jumamosi', 'jumapili', 'english', 'kiswahili', 'swahili',
    'tra', 'brela', 'nssf', 'nhif', 'nmb', 'crdb', 'nbc'];
  const ACRONYMS = ['tra', 'brela', 'nssf', 'nhif', 'nmb', 'crdb', 'nbc', 'tin', 'vrn', 'p.o.', 'ltd', 'tzs'];

  function fmtMoney(n) { return Number(n).toLocaleString('en-US'); }
  function money(text) {
    // "25000000 tsh", "tsh 25000000", "tzs 25,000,000", "shs. 2500000/="  ->  "TShs 25,000,000/="
    const unit = '(?:tshs?\\.?|tzs|shs?\\.?|shilingi|sh\\.)';
    return text
      .replace(new RegExp(`\\b${unit}\\s*([0-9][0-9,]*)(?:\\s*\\/=)?`, 'gi'), (m, num) => `TShs ${fmtMoney(num.replace(/,/g, ''))}/=`)
      .replace(new RegExp(`\\b([0-9][0-9,]{3,})(?:\\s*\\/=)?\\s*${unit}(?![a-z])`, 'gi'), (m, num) => `TShs ${fmtMoney(num.replace(/,/g, ''))}/=`);
  }
  function capitalizeSentences(text, lang) {
    let out = text.replace(/(^|[.!?]\s+|\n\s*)([a-zà-ÿ])/g, (m, pre, ch) => pre + ch.toUpperCase());
    if (lang !== 'sw') out = out.replace(/\bi\b(?!\.)/g, 'I').replace(/\bi'(m|ve|ll|d)\b/g, "I'$1");
    return out;
  }
  function properNouns(text, extra) {
    let out = text;
    const words = PROPER.concat((extra || []).map((s) => String(s).toLowerCase()).filter((s) => s.length > 2));
    words.sort((a, b) => b.length - a.length).forEach((w) => {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      out = out.replace(re, (m) => (m === m.toLowerCase() ? (ACRONYMS.includes(w) ? m.toUpperCase() : m.replace(/\b[a-z]/g, (c) => c.toUpperCase())) : m));
    });
    return out;
  }
  function spacing(text) {
    return text
      .replace(/[ \t]+/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .replace(/([,;:!?])(?=[A-Za-z])/g, '$1 ')
      .replace(/([a-z])\.(?=[A-Z][a-z])/g, '$1. ')
      // "renovation.tunaomba" -> "renovation. tunaomba", but leave web addresses like somapv2i.com alone
      .replace(/([a-z]{3,})\.(?!(?:com|org|net|co|tz|go|ac|ke|ug|info|edu)\b)([a-z]{3,})/g, '$1. $2')
      .replace(/\.{2,}(?!\.)/g, '.')
      .replace(/ *\n */g, '\n')
      .trim();
  }
  function splitSentences(p) { return p.match(/[^.!?]+(?:[.!?]+(?:["')\]]+)?|$)/g)?.map((s) => s.trim()).filter(Boolean) || [p]; }
  // One long run-on block becomes paragraphs of about three sentences.
  function paragraphs(text) {
    const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const out = [];
    blocks.forEach((b) => {
      if (/^\s*([-•*]|\d+[.)])\s/m.test(b)) { out.push(b); return; }
      const flat = b.replace(/\n+/g, ' ');
      const words = flat.split(/\s+/).length;
      if (words < 90) { out.push(flat); return; }
      const sents = splitSentences(flat);
      for (let i = 0; i < sents.length; i += 3) out.push(sents.slice(i, i + 3).join(' '));
    });
    return out.map((p) => (/[.!?:;"')]$/.test(p) || /^\s*([-•*]|\d+[.)])\s/.test(p) ? p : `${p}.`));
  }
  function tidyText(text, lang, names) {
    if (!String(text || '').trim()) return '';
    let t = spacing(money(String(text)));
    t = properNouns(t, names);
    t = capitalizeSentences(t, lang);
    return paragraphs(t).join('\n\n');
  }
  function tidy(doc, names) {
    const lang = doc.lang || 'en';
    const out = {
      subject: String(doc.subject || '').replace(/^\s*(re|yah)\s*[:.-]\s*/i, '').toUpperCase().trim(),
      salutation: capitalizeSentences(spacing(doc.salutation || ''), lang).replace(/\b(sir|madam|mr|mrs|ms|dr|ndugu|mheshimiwa)\b/g, (w) => w[0].toUpperCase() + w.slice(1)),
      body: tidyText(doc.body, lang, names),
      closing: doc.closing || T.closingFor(doc.salutation, lang),
      missingDetails: [], notes: 'Quick tidy (offline): capitals, spacing, punctuation, money and paragraphs. Deploy the AI service for full rewriting and translation.',
      offline: true,
    };
    if (out.salutation && !/[,:]$/.test(out.salutation)) out.salutation += ',';
    return out;
  }

  // ---------- remote service ----------
  async function idToken() {
    const u = global.firebase.auth().currentUser;
    return u ? u.getIdToken() : '';
  }
  async function call(baseUrl, path, body, timeoutMs) {
    if (!baseUrl) throw Object.assign(new Error('AI service URL not set'), { code: 'NO_SERVICE' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 90000);
    let res;
    try {
      res = await fetch(`${baseUrl.replace(/\/+$/, '')}/${path}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw Object.assign(new Error(err.name === 'AbortError' ? 'The service took too long' : 'The service could not be reached'), { code: 'UNREACHABLE' });
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch (_) { /* not json */ }
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `Service error (${res.status})`), { code: (data && data.code) || `HTTP_${res.status}`, status: res.status });
    return data;
  }

  function letterPayload(doc, type, settings) {
    return {
      typeName: type ? type.en : doc.typeName, tone: type ? type.tone : '', scope: doc.scope, lang: doc.lang || 'en',
      sender: doc.scope === 'company' ? settings.companyName : (settings.letterheads.school?.name || ''),
      recipient: doc.recipient || '', subject: doc.subject || '', salutation: doc.salutation || '', body: doc.body || '', closing: doc.closing || '',
    };
  }
  // action: polish | translate | subject | minutes
  async function run(settings, action, doc, type, extra) {
    const payload = Object.assign({ action, letter: letterPayload(doc, type, settings) }, extra || {});
    if (action === 'minutes') payload.minutes = doc.minutes;
    return call(settings.serviceUrl, 'lettersAi', payload);
  }
  async function requestOtp(settings, schoolId) { return call(settings.serviceUrl, 'lettersOtpRequest', { schoolId }, 30000); }
  async function verifyOtp(settings, schoolId, code) { return call(settings.serviceUrl, 'lettersOtpVerify', { schoolId, code: String(code || '').trim() }, 30000); }
  async function ping(settings) { return call(settings.serviceUrl, 'lettersAi', { action: 'ping' }, 20000); }

  global.SomapLettersAI = { tidy, tidyText, money, run, requestOtp, verifyOtp, ping };
})(window);
