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
  // Names with their own spelling; once written this way the spell check leaves them alone.
  const BRANDS = [[/\bsomap\b/gi, 'SoMAp'], [/\bwhats ?app\b/gi, 'WhatsApp'], [/\bm-?pesa\b/gi, 'M-Pesa'], [/\btigo ?pesa\b/gi, 'Tigo Pesa'], [/\bairtel money\b/gi, 'Airtel Money'],
    [/\bhalo ?pesa\b/gi, 'HaloPesa'], [/\bgmail\b/gi, 'Gmail'], [/\bpdf\b/gi, 'PDF'], [/\bsms\b/gi, 'SMS'], [/\bp\.? ?o\.? box\b/gi, 'P.O. Box']];
  function properNouns(text, extra) {
    let out = text;
    BRANDS.forEach(([re, v]) => { out = out.replace(re, v); });
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
      salutation: capitalizeSentences(spacing(doc.salutation || ''), lang).replace(/\b([a-z])([a-z']*)/g, (m, a, b) => (['and', 'na', 'of', 'wa'].includes(a + b) ? m : a.toUpperCase() + b)), // names and titles: "ndugu juma" -> "Ndugu Juma"
      body: tidyText(doc.body, lang, names),
      closing: doc.closing || T.closingFor(doc.salutation, lang),
      missingDetails: [], notes: 'Quick tidy (offline): capitals, spacing, punctuation, money and paragraphs. Deploy the AI service for full rewriting and translation.',
      offline: true,
    };
    if (out.salutation && !/[,:]$/.test(out.salutation)) out.salutation += ',';
    return out;
  }

  // ---------- free public services (used when the Claude service is not deployed) ----------
  // LanguageTool: English spelling + grammar. Google Translate (gtx) with MyMemory as backup:
  // English <-> Kiswahili. Both allow browser calls without a key. Text leaves SoMAp, so the UI
  // asks before sending protected letters.
  // Frequent Kiswahili words (and verb shapes) to recognise Kiswahili sentences inside English text.
  const SW_COMMON = new Set(('na kwa ya wa za la cha vya ni si sana huu hii hizi hili hawa yule wote yote kila kwamba lakini pia tena bado sasa leo kesho jana '
    + 'asante shukrani tafadhali samahani radhi pole habari ndugu bwana bibi mwalimu mkuu shule wazazi wanafunzi mtoto watoto kazi mshahara mkopo pesa fedha ada '
    + 'naomba tunaomba nakuomba tunakuomba naomba nimeshindwa tumeshindwa nitalipa tutalipa usumbufu msaada mwezi wiki siku mwaka muda kwanza mimi sisi wewe ninyi '
    + 'yeye wao kuhusu kutoka hadi mpaka baada kabla kama ili sababu hivyo hapa pale huko jambo mambo suala tatizo matatizo nitafanya tutafanya utusaidie unisaidie').split(/\s+/));
  const SW_VERB = /^(ni|tu|u|m|wa|a|ku|ki|vi|li|ya|i|zi)(na|li|ta|me|ki|nge|ngali|ka)[a-z]{2,}$/;
  function isSwahili(sentence) {
    const w = sentence.toLowerCase().match(/[a-z']+/g) || [];
    if (!w.length) return false;
    const sw = w.filter((x) => SW_COMMON.has(x) || SW_VERB.test(x)).length;
    const en = w.filter((x) => EN_STOP.has(x)).length;
    return sw >= 2 && sw > en && sw / w.length >= 0.3;
  }
  // Typos LanguageTool skips (it reads "Pease" as a surname, for instance).
  const COMMON_TYPOS = { teh: 'the', pease: 'please', plese: 'please', recieve: 'receive', recieved: 'received', untill: 'until', occured: 'occurred', seperate: 'separate',
    definately: 'definitely', wich: 'which', adress: 'address', thier: 'their', beleive: 'believe', accomodate: 'accommodate', comming: 'coming', sucess: 'success',
    alot: 'a lot', dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", im: "I'm", ive: "I've", hte: 'the', adn: 'and', taht: 'that', becuase: 'because', becasue: 'because' };
  function fixCommonTypos(text, fixed) {
    return text.replace(/\b[A-Za-z]+\b/g, (w) => {
      const r = COMMON_TYPOS[w.toLowerCase()];
      if (!r) return w;
      const out = w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
      fixed.push(`${w} → ${out}`);
      return out;
    });
  }
  const EN_STOP = new Set(['the', 'and', 'we', 'is', 'are', 'to', 'of', 'for', 'that', 'this', 'will', 'have', 'you', 'our', 'with', 'from', 'be', 'it', 'on', 'in', 'as', 'by', 'please', 'your', 'i', 'am', 'was', 'were', 'not', 'at', 'an', 'a', 'my', 'can', 'would', 'should', 'has', 'had', 'they', 'their', 'there']);
  function damerau(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
    for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  async function fetchJson(url, opts, ms) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms || 20000);
    try { const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts)); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(t); }
  }
  async function languageTool(text) {
    if (!text.trim()) return [];
    const body = new URLSearchParams({ text, language: 'en-GB', enabledOnly: 'false' });
    const j = await fetchJson('https://api.languagetool.org/v2/check', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 25000);
    return j.matches || [];
  }
  const AUTO_CATS = new Set(['TYPOS', 'GRAMMAR', 'CASING', 'PUNCTUATION', 'CONFUSED_WORDS', 'COLLOCATIONS', 'TYPOGRAPHY', 'MISC', 'COMPOUNDING']);
  // Applies safe corrections. A "misspelling" far from its suggestion is usually a Kiswahili
  // word inside English text, so it is left alone and reported as `foreign`.
  function applyLT(text, matches, keep) {
    const fixed = []; const advice = []; const foreign = [];
    const edits = [];
    const kept = new Set((keep || []).flatMap((n) => String(n).toLowerCase().split(/\s+/)));
    matches.forEach((m) => {
      const word = text.substr(m.offset, m.length);
      const reps = (m.replacements || []).map((r) => r.value);
      const cat = m.rule?.category?.id || '';
      if (!reps.length) { if (m.rule?.issueType !== 'misspelling') advice.push(m.message); return; }
      let rep = reps[0];
      if (m.rule?.issueType === 'misspelling') {
        // Acronyms (NMB, CRDB, TRA) and known names are never "corrected".
        // Mixed-case words (TShs, SoMAp, WhatsApp) are deliberate spellings too.
        if ((word.length > 1 && word === word.toUpperCase()) || /[a-z][A-Z]|^[A-Z]{2,}[a-z]/.test(word) || kept.has(word.toLowerCase())
          || BRANDS.some(([, v]) => v.split(' ').includes(word))) return;
        // "ihave" -> "I have", but "I ihave" -> "I have" (the I is already there)
        const iBefore = /\bI\s*$/.test(text.slice(0, m.offset));
        const glued = /^i[a-z]{2,}$/i.test(word) && !iBefore && reps.find((r) => r.toLowerCase() === `i ${word.slice(1).toLowerCase()}`);
        if (glued) rep = glued;
        else if (/^i[a-z]{2,}$/i.test(word) && !iBefore && reps[0].toLowerCase() === word.slice(1).toLowerCase()) rep = `I ${reps[0]}`;
        const dist = damerau(word, rep);
        if (dist > 2 || (word.length < 4 && dist > 1)) { foreign.push({ word, offset: m.offset }); return; }
      } else if (!AUTO_CATS.has(cat)) { advice.push(`${m.message}${reps[0] ? ` (“${word}” → “${reps[0]}”)` : ''}`); return; }
      edits.push({ offset: m.offset, length: m.length, rep, word });
    });
    let out = text;
    edits.sort((a, b) => b.offset - a.offset).forEach((e) => {
      out = out.slice(0, e.offset) + e.rep + out.slice(e.offset + e.length);
      if (e.word.trim() !== e.rep.trim()) fixed.unshift(`${e.word} → ${e.rep}`);
    });
    return { text: out, fixed, advice, foreign };
  }

  async function gtx(text, sl, tl) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const j = await fetchJson(url, {}, 20000);
    return { text: (j[0] || []).map((s) => s[0]).join(''), detected: j[2] || sl };
  }
  async function myMemory(text, sl, tl) {
    const j = await fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl === 'auto' ? (tl === 'sw' ? 'en' : 'sw') : sl}|${tl}`, {}, 20000);
    if (j.responseStatus !== 200) throw new Error(j.responseDetails || 'MyMemory failed');
    return { text: j.responseData.translatedText, detected: sl };
  }
  function chunks(text, max) {
    if (text.length <= max) return [text];
    const out = []; let cur = '';
    (text.match(/[^.!?]+[.!?]*\s*/g) || [text]).forEach((s) => { if ((cur + s).length > max && cur) { out.push(cur); cur = ''; } cur += s; });
    if (cur) out.push(cur);
    return out;
  }
  let engineUsed = '';
  async function translate(text, sl, tl) {
    if (!String(text || '').trim()) return '';
    try {
      const parts = await Promise.all(chunks(text, 4000).map((c) => gtx(c, sl, tl)));
      engineUsed = 'Google Translate';
      return parts.map((p) => p.text).join(' ').trim();
    } catch (_) {
      const parts = [];
      for (const c of chunks(text, 450)) parts.push((await myMemory(c, sl, tl)).text);
      engineUsed = 'MyMemory';
      return parts.join(' ').trim();
    }
  }
  // ---- names and times survive translation ----
  // Names are swapped for tokens Google leaves alone (otherwise "Juma" becomes "Friday").
  // Times are converted between western and Kiswahili (East African) time: 7 am = saa moja asubuhi.
  const SW_HOURS = ['', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa', 'kumi', 'kumi na moja', 'kumi na mbili'];
  const NOT_NAMES = new Set(['the', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sir', 'madam', 'manager', 'director', 'officer', 'head', 'teacher', 'principal', 'secretary', 'chairman', 'chairperson',
    'bank', 'branch', 'ministry', 'office', 'school', 'limited', 'ltd', 'company', 'district', 'regional', 'council', 'dear', 'ndugu', 'bw', 'bi', 'mheshimiwa', 'mpendwa', 'box', 'p.o', 'po']);
  function namesOf(doc, extra) {
    const out = new Set((extra || []).filter((n) => n && n.length > 2));
    const words = (line) => String(line || '').replace(/[,.:]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && /^[A-Za-z'-]+$/.test(w) && !NOT_NAMES.has(w.toLowerCase()));
    const first = String(doc.recipient || '').split('\n')[0] || '';
    if (first.split(/\s+/).length <= 4 && !first.toLowerCase().split(/[\s,.]+/).some((w) => NOT_NAMES.has(w) && !['mr', 'mrs', 'ms', 'dr', 'bw', 'bi'].includes(w))) words(first).forEach((w) => out.add(w));
    (doc.signers || []).forEach((s) => words(s.name).forEach((w) => out.add(w)));
    words(String(doc.salutation || '').replace(/^\s*(dear|ndugu|mpendwa|mheshimiwa)\b/i, '')).forEach((w) => out.add(w));
    return [...out].sort((a, b) => b.length - a.length);
  }
  function swTime(h24, min) {
    const n = ((h24 + 6) % 12) || 12;
    const part = h24 >= 6 && h24 < 12 ? 'asubuhi' : h24 >= 12 && h24 < 16 ? 'mchana' : h24 >= 16 && h24 < 19 ? 'jioni' : 'usiku';
    const m = min === 30 ? ' na nusu' : min === 15 ? ' na robo' : min ? ` na dakika ${min}` : '';
    return `saa ${SW_HOURS[n]}${m} ${part}`;
  }
  function enTime(nSw, min, part) {
    let h = (nSw + 6) % 12; // 1 -> 7, 6 -> 12 (0), 7 -> 1
    let pm;
    if (part === 'asubuhi') pm = h === 0; else if (part === 'mchana' || part === 'jioni') pm = true;
    else if (part === 'usiku') pm = nSw >= 1 && nSw <= 5; else pm = !(h >= 7 && h <= 11);
    if (h === 0) h = 12;
    const mm = min ? `:${String(min).padStart(2, '0')}` : '';
    return h === 12 && !min ? (pm ? '12 noon' : '12 midnight') : `${h}${mm} ${pm ? 'p.m.' : 'a.m.'}`;
  }
  const SW_NUM = { moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10, 'kumi na moja': 11, 'kumi na mbili': 12 };
  function protect(text, sl, tl, names) {
    const map = [];
    let out = String(text || '');
    const add = (value) => { map.push(value); return `ZQX${map.length}Z`; };
    if (sl !== 'sw' && tl === 'sw') {
      out = out.replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi, (m, h, mi, ap) => {
        let h24 = Number(h) % 12; if (/p/i.test(ap)) h24 += 12;
        return add(swTime(h24, Number(mi || 0)));
      });
    } else if (tl === 'en') {
      const num = '(\\d{1,2}|kumi na moja|kumi na mbili|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi)';
      out = out.replace(new RegExp(`\\bsaa\\s+${num}(?:[:.](\\d{2})|\\s+na\\s+(nusu|robo))?(?:\\s+(asubuhi|mchana|jioni|usiku))?`, 'gi'), (m, n, mi, frac, part) => {
        const nSw = /^\d+$/.test(n) ? Number(n) : SW_NUM[n.toLowerCase()];
        const min = mi ? Number(mi) : frac ? (frac.toLowerCase() === 'nusu' ? 30 : 15) : 0;
        return add(enTime(nSw, min, (part || '').toLowerCase()));
      });
    }
    (names || []).forEach((n) => {
      const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      out = out.replace(re, (m) => add(m));
    });
    // English times come back with "at" ("arrive at 8 a.m."); clean the doubled words this can cause.
    const restore = (t) => String(t || '')
      .replace(/ZQ\s*X\s*(\d+)\s*Z/gi, (m, i) => { const v = map[Number(i) - 1]; if (v == null) return m; return tl === 'en' && /\d\s*(a|p)\.m\.|noon|midnight/.test(v) ? `at ${v}` : v; })
      .replace(/\b(at|to|by|from|until|on|kwa|kwenye|katika)\s+at\s+/gi, (m, w) => (/^(by|from|until)$/i.test(w) ? `${w} ` : 'at '))
      .replace(/\bsaa\s+saa\b/gi, 'saa')
      .replace(/(\b[ap]\.m)\.\./gi, '$1.');
    return { text: out, restore, count: map.length };
  }
  // Salutations translate by their title word; the name after it is never translated.
  const SALUTE_EN_SW = [[/^dear\s+sir\s*\/\s*madam,?$/i, 'Ndugu,'], [/^dear\s+(mr\.?)\s+/i, 'Ndugu Bw. '], [/^dear\s+(mrs\.?|ms\.?|miss)\s+/i, 'Ndugu Bi. '], [/^dear\s+(dr\.?)\s+/i, 'Ndugu Dkt. '], [/^dear\s+/i, 'Ndugu '], [/^(hon\.?|honourable)\s+/i, 'Mheshimiwa ']];
  const SALUTE_SW_EN = [[/^ndugu,?$/i, 'Dear Sir/Madam,'], [/^(ndugu|mpendwa)\s+bw\.?\s+/i, 'Dear Mr '], [/^(ndugu|mpendwa)\s+bi\.?\s+/i, 'Dear Ms '], [/^(ndugu|mpendwa)\s+dkt\.?\s+/i, 'Dear Dr '], [/^(ndugu|mpendwa)\s+/i, 'Dear '], [/^mheshimiwa\s+/i, 'Honourable ']];
  function translateSalutation(s, target) {
    const v = String(s || '').trim();
    for (const [re, rep] of target === 'sw' ? SALUTE_EN_SW : SALUTE_SW_EN) if (re.test(v)) { const out = v.replace(re, rep); return /[,:]$/.test(out) ? out : `${out},`; }
    return '';
  }
  async function translateSafe(text, sl, tl, names) {
    const p = protect(text, sl, tl, names);
    return p.restore(await translate(p.text, sl, tl));
  }
  function sentences(p) { return p.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [p]; }

  // Additions offered for the user to keep or untick; skipped when the letter already says it.
  function suggestAdditions(doc, typeId, paragraphs) {
    const lang = doc.lang === 'sw' ? 'sw' : 'en';
    const bank = T.SUGGEST[typeId] || T.SUGGEST._generic;
    const have = paragraphs.join(' ').toLowerCase();
    const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
    return bank.filter((s) => {
      const key = s[lang].toLowerCase().replace(/[^a-zÀ-ɏ\s]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
      return !key.every((k) => have.includes(k));
    }).filter((s, i) => words < 160 || i < 2).map((s) => ({ text: s[lang], at: s.at, reason: s.why }));
  }

  async function freePolish(doc, names, typeId) {
    const nm = namesOf(doc, names);
    const lang = doc.lang === 'sw' ? 'sw' : 'en';
    const fixed = []; const advice = []; const notes = [];
    let body = String(doc.body || ''); let subject = String(doc.subject || ''); let salutation = String(doc.salutation || '');
    if (lang === 'en') {
      try {
        body = fixCommonTypos(body, fixed);
        // Kiswahili sentences are written in English first, so the English spell check never
        // "corrects" Kiswahili words (kwa -> CWA).
        const paras = body.split(/\n\s*\n/);
        for (let i = 0; i < paras.length; i += 1) {
          const ss = sentences(paras[i]);
          for (let k = 0; k < ss.length; k += 1) {
            if (!isSwahili(ss[k])) continue;
            const tr = await translateSafe(ss[k].trim(), 'sw', 'en', nm);
            if (tr) { fixed.push(`Kiswahili → English: “${ss[k].trim()}” → “${tr}”`); ss[k] = `${tr} `; }
          }
          paras[i] = ss.join('').trim();
        }
        // Money, bank acronyms and known names are settled before the spell check sees them.
        body = properNouns(money(paras.join('\n\n')), (names || []).concat(nm));
        const keep = (names || []).concat(nm);
        const r = applyLT(body, await languageTool(body), keep);
        body = r.text; fixed.push(...r.fixed); advice.push(...r.advice);
        const head = applyLT(`${subject.toLowerCase()}\n${salutation}`, await languageTool(`${subject.toLowerCase()}\n${salutation}`), keep);
        const [s2, ...rest] = head.text.split('\n');
        subject = s2.toUpperCase(); salutation = rest.join('\n');
        notes.push('Spelling and grammar checked with LanguageTool.');
      } catch (err) {
        notes.push('The spelling service could not be reached; only the basic tidy ran.');
      }
    } else {
      // Kiswahili letter: English sentences inside it are written in Kiswahili.
      const paras = body.split(/\n\s*\n/);
      try {
        for (let i = 0; i < paras.length; i += 1) {
          const ss = sentences(paras[i]);
          for (let k = 0; k < ss.length; k += 1) {
            const w = ss[k].toLowerCase().match(/[a-z']+/g) || [];
            const en = w.filter((x) => EN_STOP.has(x)).length;
            if (en >= 2 && en / w.length >= 0.25) {
              const tr = await translateSafe(ss[k].trim(), 'en', 'sw', nm);
              if (tr) { fixed.push(`English → Kiswahili: “${ss[k].trim()}” → “${tr}”`); ss[k] = `${tr} `; }
            }
          }
          paras[i] = ss.join('').trim();
        }
        body = paras.join('\n\n');
      } catch (_) { notes.push('The translator could not be reached for the English sentences.'); }
      notes.push('Kiswahili spelling and grammar need the Claude AI service; capitals, spacing and money were tidied.');
    }
    const t = tidy(Object.assign({}, doc, { body, subject, salutation }), names);
    const paragraphs = t.body.split(/\n\s*\n/).filter(Boolean);
    return {
      subject: t.subject, salutation: t.salutation, paragraphs, closing: t.closing,
      missingDetails: [], fixes: fixed, advice: advice.slice(0, 8), additions: suggestAdditions(doc, typeId, paragraphs),
      notes: notes.join(' '), engine: 'free',
    };
  }

  async function freeTranslate(doc, target, names) {
    const nm = namesOf(doc, names);
    const from = target === 'sw' ? 'en' : 'sw';
    const L = T.L;
    const paras = String(doc.body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    engineUsed = '';
    const out = [];
    for (const p of paras) out.push(await translateSafe(p, from, target, nm));
    const isDefault = (v, list) => list.includes(String(v || '').trim());
    const salutation = isDefault(doc.salutation, [L.en.dearSir, L.sw.dearSir]) ? L[target].dearSir : translateSalutation(doc.salutation, target) || await translateSafe(doc.salutation, from, target, nm);
    const closing = isDefault(doc.closing, [L.en.faithfully, L.en.sincerely, L.sw.faithfully, L.sw.sincerely]) ? T.closingFor(salutation, target) : await translateSafe(doc.closing, from, target, nm);
    const subject = (await translateSafe(String(doc.subject || '').toLowerCase(), from, target, nm)).toUpperCase();
    return {
      subject, salutation, paragraphs: out, closing, missingDetails: [], fixes: [],
      notes: `Translated with ${engineUsed || 'the free translator'}. Read it once before sending — machine translation can miss tone; Claude gives the most natural formal ${target === 'sw' ? 'Kiswahili' : 'English'}.`,
      engine: 'free',
    };
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

  // Errors meaning "the Claude service is not there", so the free services should take over.
  const isServiceDown = (err) => ['NO_SERVICE', 'UNREACHABLE', 'HTTP_404', 'HTTP_403', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'AI_KEY', 'AI_DOWN'].includes(err && err.code);

  global.SomapLettersAI = { tidy, tidyText, money, run, requestOtp, verifyOtp, ping, freePolish, freeTranslate, suggestAdditions, translate, isServiceDown };
})(window);
