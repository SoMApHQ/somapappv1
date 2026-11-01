// SoMAp Letters & Minutes Studio — letter types, labels (English / Kiswahili), dates, fonts.
// Pure data + formatting helpers; no Firebase here. Exposed as window.SomapLettersT.
(function (global) {
  'use strict';

  // scope: 'school' letters are readable by the Head Teacher; 'company' letters are
  // encrypted and open only in the director's unlocked session.
  // confidential: encrypted even when the scope is 'school'.
  const GROUPS = [
    { id: 'staff', en: 'Staff', sw: 'Watumishi', icon: '👥' },
    { id: 'parents', en: 'Parents & Pupils', sw: 'Wazazi & Wanafunzi', icon: '👪' },
    { id: 'company', en: 'Company', sw: 'Kampuni', icon: '🏢' },
    { id: 'governance', en: 'Governance', sw: 'Uongozi', icon: '⚖️' },
    { id: 'custom', en: 'My types', sw: 'Aina zangu', icon: '✳️' },
  ];

  const TYPES = [
    { id: 'warning', group: 'staff', scope: 'school', code: 'STF', icon: '⚠️', en: 'Warning Letter', sw: 'Barua ya Onyo', subject: 'WARNING LETTER', subjectSw: 'BARUA YA ONYO', tone: 'Firm, fair and factual. State the misconduct, the date, the rule breached, the expected correction and the consequence of repetition.' },
    { id: 'summons', group: 'staff', scope: 'school', code: 'STF', icon: '📣', en: 'Summons / Disciplinary Meeting', sw: 'Wito / Kikao cha Nidhamu', subject: 'INVITATION TO A DISCIPLINARY MEETING', subjectSw: 'WITO WA KIKAO CHA NIDHAMU', tone: 'Formal and neutral. Give the date, time, venue, the matter to be discussed and the right to be accompanied or to respond.' },
    { id: 'show_cause', group: 'staff', scope: 'school', code: 'STF', icon: '❓', en: 'Show-Cause Letter', sw: 'Barua ya Kujieleza', subject: 'SHOW CAUSE LETTER', subjectSw: 'BARUA YA KUJIELEZA', tone: 'Formal. Describe the issue and ask the employee to explain in writing by a stated deadline why action should not be taken.' },
    { id: 'course', group: 'staff', scope: 'school', code: 'STF', icon: '🎓', en: 'Course / Training Nomination', sw: 'Uteuzi wa Mafunzo', subject: 'NOMINATION FOR TRAINING', subjectSw: 'UTEUZI WA KUHUDHURIA MAFUNZO', tone: 'Encouraging and clear. Course name, dates, venue, costs covered and what is expected afterwards.' },
    { id: 'appointment', group: 'staff', scope: 'school', code: 'STF', icon: '🤝', en: 'Appointment Letter', sw: 'Barua ya Ajira', subject: 'LETTER OF APPOINTMENT', subjectSw: 'BARUA YA AJIRA', tone: 'Warm and precise. Position, start date, salary, probation and reporting line.' },
    { id: 'confirmation', group: 'staff', scope: 'school', code: 'STF', icon: '✅', en: 'Confirmation of Employment', sw: 'Uthibitisho wa Ajira', subject: 'CONFIRMATION OF EMPLOYMENT', subjectSw: 'UTHIBITISHO WA AJIRA', tone: 'Positive and formal.' },
    { id: 'commendation', group: 'staff', scope: 'school', code: 'STF', icon: '🌟', en: 'Commendation / Appreciation', sw: 'Pongezi / Shukrani', subject: 'LETTER OF APPRECIATION', subjectSw: 'BARUA YA PONGEZI', tone: 'Sincere and specific about what was done well.' },
    { id: 'termination', group: 'staff', scope: 'school', code: 'STF', icon: '🛑', en: 'Termination', sw: 'Kusitishwa Ajira', subject: 'TERMINATION OF EMPLOYMENT', subjectSw: 'KUSITISHWA KWA AJIRA', tone: 'Formal, respectful and legally careful. Reason, effective date, final dues and handover.' },
    { id: 'leave', group: 'staff', scope: 'school', code: 'STF', icon: '🏖️', en: 'Leave Approval', sw: 'Idhini ya Likizo', subject: 'APPROVAL OF LEAVE', subjectSw: 'IDHINI YA LIKIZO', tone: 'Brief and clear: type of leave, dates and resumption date.' },
    { id: 'salary_notice', group: 'staff', scope: 'school', code: 'STF', icon: '💵', en: 'Salary / Allowance Notice', sw: 'Taarifa ya Mshahara / Posho', subject: 'SALARY ADJUSTMENT NOTICE', subjectSw: 'TAARIFA YA MABADILIKO YA MSHAHARA', tone: 'Precise with figures and effective dates.' },

    { id: 'parent_notice', group: 'parents', scope: 'school', code: 'PAR', icon: '📌', en: 'Parent Notice', sw: 'Tangazo kwa Wazazi', subject: 'NOTICE TO PARENTS', subjectSw: 'TANGAZO KWA WAZAZI', tone: 'Friendly, clear and short. Dates and actions parents must take.' },
    { id: 'fee_reminder', group: 'parents', scope: 'school', code: 'PAR', icon: '🧾', en: 'Fee Reminder', sw: 'Ukumbusho wa Ada', subject: 'REMINDER ON SCHOOL FEES', subjectSw: 'UKUMBUSHO WA ADA YA SHULE', tone: 'Polite but firm, with amount, deadline and payment channels.' },
    { id: 'parent_invite', group: 'parents', scope: 'school', code: 'PAR', icon: '📅', en: 'Invitation to Meeting', sw: 'Mwaliko wa Kikao', subject: 'INVITATION TO PARENTS MEETING', subjectSw: 'MWALIKO WA KIKAO CHA WAZAZI', tone: 'Warm and inviting with date, time, venue and agenda.' },
    { id: 'circular', group: 'parents', scope: 'school', code: 'PAR', icon: '🔁', en: 'Circular', sw: 'Waraka', subject: 'CIRCULAR', subjectSw: 'WARAKA', tone: 'Neutral and informative.' },
    { id: 'recommendation', group: 'parents', scope: 'school', code: 'PAR', icon: '📝', en: 'Recommendation / Transfer', sw: 'Utambulisho / Uhamisho', subject: 'LETTER OF RECOMMENDATION', subjectSw: 'BARUA YA UTAMBULISHO', tone: 'Honest and supportive.' },

    { id: 'loan_request', group: 'company', scope: 'company', confidential: true, code: 'LTR', icon: '🏦', en: 'Loan Request', sw: 'Ombi la Mkopo', subject: 'APPLICATION FOR A LOAN', subjectSw: 'OMBI LA MKOPO', tone: 'Formal, precise and confident. Amount, purpose, repayment source and capacity, security offered and enclosed documents. Never invent figures.' },
    { id: 'bank_letter', group: 'company', scope: 'company', code: 'LTR', icon: '🏛️', en: 'Letter to Bank', sw: 'Barua kwa Benki', subject: 'REQUEST', subjectSw: 'OMBI', tone: 'Formal and precise, with account details where given.' },
    { id: 'explanation', group: 'company', scope: 'company', code: 'LTR', icon: '💬', en: 'Explanation / Clarification', sw: 'Maelezo / Ufafanuzi', subject: 'CLARIFICATION', subjectSw: 'UFAFANUZI', tone: 'Clear, calm and factual. Explain the background, the facts and the way forward.' },
    { id: 'director_apology', group: 'company', scope: 'company', confidential: true, code: 'LTR', icon: '🕊️', en: 'Director Apology', sw: 'Barua ya Kuomba Radhi (Mkurugenzi)', subject: 'APOLOGY', subjectSw: 'KUOMBA RADHI', tone: 'Respectful, sincere and humble without grovelling. Acknowledge the issue, take responsibility, state the corrective steps and close warmly.' },
    { id: 'investor_letter', group: 'company', scope: 'company', confidential: true, code: 'LTR', icon: '📈', en: 'Letter to Investor', sw: 'Barua kwa Mwekezaji', subject: 'UPDATE TO INVESTOR', subjectSw: 'TAARIFA KWA MWEKEZAJI', tone: 'Professional, transparent and confident.' },
    { id: 'gov_letter', group: 'company', scope: 'company', code: 'LTR', icon: '🇹🇿', en: 'Letter to Government / Authority', sw: 'Barua kwa Serikali / Mamlaka', subject: 'REQUEST', subjectSw: 'OMBI', tone: 'Very formal and respectful. Cite registration numbers and references given.' },
    { id: 'request', group: 'company', scope: 'company', code: 'LTR', icon: '🙏', en: 'Request', sw: 'Ombi', subject: 'REQUEST', subjectSw: 'OMBI', tone: 'Polite and clear about what is requested and by when.' },
    { id: 'complaint', group: 'company', scope: 'company', code: 'LTR', icon: '📢', en: 'Complaint', sw: 'Malalamiko', subject: 'COMPLAINT', subjectSw: 'MALALAMIKO', tone: 'Firm, factual and solution-focused.' },

    { id: 'minutes_directors', group: 'governance', scope: 'company', confidential: true, mode: 'minutes', code: 'MIN', icon: '🗂️', en: "Minutes of Directors' Meeting", sw: 'Kumbukumbu za Kikao cha Wakurugenzi', subject: "MINUTES OF THE DIRECTORS' MEETING", subjectSw: 'KUMBUKUMBU ZA KIKAO CHA WAKURUGENZI', tone: 'Formal minutes in the past tense; record decisions and who will act.' },
    { id: 'board_resolution', group: 'governance', scope: 'company', confidential: true, code: 'RES', icon: '🖋️', en: 'Board Resolution', sw: 'Azimio la Bodi', subject: 'BOARD RESOLUTION', subjectSw: 'AZIMIO LA BODI', tone: 'Formal resolution language: "IT IS HEREBY RESOLVED THAT…".' },
    { id: 'minutes_committee', group: 'governance', scope: 'school', mode: 'minutes', code: 'MIN', icon: '📋', en: 'Minutes of School Committee', sw: 'Kumbukumbu za Kamati ya Shule', subject: 'MINUTES OF THE SCHOOL COMMITTEE MEETING', subjectSw: 'KUMBUKUMBU ZA KIKAO CHA KAMATI YA SHULE', tone: 'Formal minutes in the past tense.' },
    { id: 'meeting_notice', group: 'governance', scope: 'school', code: 'MTG', icon: '🗓️', en: 'Agenda / Notice of Meeting', sw: 'Ajenda / Taarifa ya Kikao', subject: 'NOTICE OF MEETING', subjectSw: 'TAARIFA YA KIKAO', tone: 'Clear date, time, venue and numbered agenda.' },
  ];

  const L = {
    en: {
      ref: 'Ref', date: 'Date', re: 'RE', dearSir: 'Dear Sir/Madam,', faithfully: 'Yours faithfully,', sincerely: 'Yours sincerely,',
      onBehalf: 'For and on behalf of', enclosures: 'Encl.', cc: 'C.C.', page: 'Page', of: 'of', signedEl: 'Signed electronically',
      minutes: { date: 'Date', time: 'Time', venue: 'Venue', chair: 'Chairperson', secretary: 'Secretary', present: 'Members Present', absent: 'Absent with apology', inAttendance: 'In attendance', agenda: 'Agenda', resolutions: 'Resolutions', closing: 'Closing', closedAt: 'There being no other business, the meeting was closed at', no: 'No.', name: 'Name', designation: 'Designation', signature: 'Signature', heldOn: 'held on', confirmed: 'Confirmed as a true record' },
    },
    sw: {
      ref: 'Kumb. Na.', date: 'Tarehe', re: 'YAH', dearSir: 'Ndugu,', faithfully: 'Wako mwaminifu,', sincerely: 'Wako katika ujenzi wa taifa,',
      onBehalf: 'Kwa niaba ya', enclosures: 'Viambatisho', cc: 'Nakala', page: 'Ukurasa', of: 'kati ya', signedEl: 'Imesainiwa kielektroniki',
      minutes: { date: 'Tarehe', time: 'Muda', venue: 'Mahali', chair: 'Mwenyekiti', secretary: 'Katibu', present: 'Wajumbe Waliohudhuria', absent: 'Hawakuhudhuria kwa taarifa', inAttendance: 'Walioalikwa', agenda: 'Ajenda', resolutions: 'Maazimio', closing: 'Kufunga Kikao', closedAt: 'Hakukuwa na jambo jingine, kikao kilifungwa saa', no: 'Na.', name: 'Jina', designation: 'Cheo', signature: 'Sahihi', heldOn: 'kilichofanyika tarehe', confirmed: 'Imethibitishwa kuwa kumbukumbu sahihi' },
    },
  };

  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  // '2026-06-16' -> '16th June 2026' / '16 Juni 2026'
  function formatDate(ymd, lang) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return String(ymd || '');
    const d = Number(m[3]); const mo = Number(m[2]) - 1;
    return lang === 'sw' ? `${d} ${MONTHS_SW[mo]} ${m[1]}` : `${ordinal(d)} ${MONTHS_EN[mo]} ${m[1]}`;
  }

  // "Dear Sir/Madam" -> faithfully; a named salutation -> sincerely.
  function closingFor(salutation, lang) {
    const lab = L[lang === 'sw' ? 'sw' : 'en'];
    const s = String(salutation || '').toLowerCase();
    if (lang === 'sw') return lab.faithfully;
    return /sir|madam|whom/.test(s) || !s.trim() ? lab.faithfully : lab.sincerely;
  }

  // jsPDF core fonts need no download; the others are embedded from Google Fonts TTFs
  // (metric-compatible stand-ins) so the PDF matches the on-screen preview.
  const FONT_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/';
  const FONTS = [
    { id: 'times', label: 'Times New Roman', css: "'Times New Roman', Tinos, Times, serif", pdf: 'times' },
    { id: 'helvetica', label: 'Arial', css: 'Arial, Helvetica, sans-serif', pdf: 'helvetica' },
    { id: 'cambria', label: 'Cambria', css: "Caladea, Cambria, Georgia, serif", pdf: 'Caladea',
      ttf: { normal: `${FONT_BASE}caladea/Caladea-Regular.ttf`, bold: `${FONT_BASE}caladea/Caladea-Bold.ttf`, italic: `${FONT_BASE}caladea/Caladea-Italic.ttf` } },
    { id: 'garamond', label: 'Garamond', css: "'Crimson Text', Garamond, Georgia, serif", pdf: 'CrimsonText',
      ttf: { normal: `${FONT_BASE}crimsontext/CrimsonText-Regular.ttf`, bold: `${FONT_BASE}crimsontext/CrimsonText-Bold.ttf`, italic: `${FONT_BASE}crimsontext/CrimsonText-Italic.ttf` } },
  ];
  const SPACINGS = [1, 1.15, 1.5, 2];
  const SIZES = [11, 12, 13];
  const DEFAULT_FORMAT = { font: 'times', size: 12, spacing: 1.15, paraGap: 6, align: 'justify', margins: 'normal', centerSubject: false, footerMark: false, pageNumbers: true, letterheadId: '' };

  const STATUSES = {
    draft: { en: 'Draft', sw: 'Rasimu', tone: 'muted' },
    final: { en: 'Awaiting signature', sw: 'Inasubiri sahihi', tone: 'warn' },
    signed: { en: 'Signed', sw: 'Imesainiwa', tone: 'good' },
    filed: { en: 'Sent / Filed', sw: 'Imetumwa', tone: 'info' },
  };

  function blankMinutes(lang) {
    return { title: '', date: '', timeStart: '', timeEnd: '', venue: '', chair: '', secretary: '', present: [{ name: '', designation: '' }], absent: '', inAttendance: '', agenda: [''], sections: [{ title: '', body: '' }], resolutions: [''], notes: '', lang: lang || 'en' };
  }

  function label(t, lang) { return t ? (lang === 'sw' ? (t.sw || t.en) : (t.en || t.name)) : ''; }

  // Sentences the studio can offer to add when a letter is thin (used when the Claude service is
  // not available; Claude writes letter-specific suggestions instead). `at`: start | end.
  const S_ = (at, en, sw, why) => ({ at, en, sw, why });
  const SUGGEST = {
    _generic: [
      S_('start', 'I hope this letter finds you well.', 'Natumaini barua hii inakukuta ukiwa mzima wa afya.', 'A courteous opening'),
      S_('end', 'Thank you for your time and consideration.', 'Asante kwa muda wako na kwa kulizingatia jambo hili.', 'A polite close'),
      S_('end', 'Please do not hesitate to contact us should you need any further information.', 'Tafadhali usisite kuwasiliana nasi iwapo utahitaji maelezo zaidi.', 'Invites a reply'),
    ],
    director_apology: [
      S_('start', 'I hope this letter finds you well.', 'Natumaini barua hii inakukuta ukiwa mzima wa afya.', 'A warm opening'),
      S_('end', 'I take full responsibility for this, and I truly value your work and the patience you have shown during this period.', 'Ninabeba jukumu kamili kwa hili, na ninathamini sana kazi yako pamoja na uvumilivu uliouonyesha katika kipindi hiki.', 'Takes responsibility and shows appreciation'),
      S_('end', 'I am committed to making sure that this does not happen again.', 'Ninaahidi kuhakikisha kwamba hali hii haijirudii tena.', 'A commitment for the future'),
      S_('end', 'Should you wish to discuss this further, please feel free to contact me at any time.', 'Iwapo ungependa kulijadili jambo hili zaidi, tafadhali usisite kuwasiliana nami wakati wowote.', 'Keeps the door open'),
      S_('end', 'Thank you for your understanding and continued support.', 'Asante kwa uelewa wako na ushirikiano wako endelevu.', 'A gracious close'),
    ],
    loan_request: [
      S_('start', 'We are writing to formally apply for a loan facility from your esteemed institution.', 'Tunaandika kuomba rasmi mkopo kutoka katika taasisi yenu tukufu.', 'States the purpose up front'),
      S_('end', 'The loan will be repaid from the school\'s fee collections, which have been stable and growing.', 'Mkopo huu utarejeshwa kupitia makusanyo ya ada za shule, ambayo yamekuwa imara na yanaongezeka.', 'Shows repayment capacity — keep only if true'),
      S_('end', 'We have attached the supporting documents for your review and are ready to provide any further information you may require.', 'Tumeambatisha nyaraka za kuunga mkono ombi hili, na tuko tayari kutoa taarifa nyingine yoyote mtakayohitaji.', 'Points to the enclosures'),
      S_('end', 'We look forward to your favourable consideration.', 'Tunatarajia kupata majibu mazuri kutoka kwenu.', 'A confident close'),
    ],
    warning: [
      S_('end', 'You are hereby warned that any repetition of this conduct will lead to further disciplinary action in accordance with the school\'s regulations.', 'Unaonywa kwamba kurudia kosa hili kutasababisha hatua zaidi za kinidhamu kwa mujibu wa kanuni za shule.', 'States the consequence'),
      S_('end', 'Please sign the copy of this letter to acknowledge receipt.', 'Tafadhali saini nakala ya barua hii kuthibitisha kuipokea.', 'Records receipt'),
    ],
    summons: [
      S_('end', 'You are welcome to be accompanied by a colleague of your choice.', 'Unaruhusiwa kuambatana na mfanyakazi mwenzako utakayemchagua.', 'Fair process'),
      S_('end', 'Failure to attend without a reasonable explanation may lead to the matter being decided in your absence.', 'Kutohudhuria bila sababu ya msingi kunaweza kusababisha suala hili kuamuliwa bila uwepo wako.', 'States the consequence'),
    ],
    show_cause: [
      S_('end', 'Your written explanation should reach the Head Teacher\'s office within three (3) working days from the date of this letter.', 'Maelezo yako ya maandishi yafike ofisi ya Mwalimu Mkuu ndani ya siku tatu (3) za kazi tangu tarehe ya barua hii.', 'Sets a deadline — adjust the days'),
    ],
    course: [
      S_('end', 'Upon your return, you will be expected to share what you have learnt with your colleagues.', 'Utakaporudi, unatarajiwa kuwashirikisha wenzako yale uliyojifunza.', 'Sets an expectation'),
      S_('end', 'We wish you a fruitful training.', 'Tunakutakia mafunzo mema yenye mafanikio.', 'An encouraging close'),
    ],
    commendation: [
      S_('end', 'Your dedication sets a good example for your colleagues and for our pupils.', 'Kujituma kwako ni mfano mzuri kwa wenzako na kwa wanafunzi wetu.', 'Adds warmth'),
      S_('end', 'Keep up the good work.', 'Endelea na kazi nzuri.', 'An encouraging close'),
    ],
    parent_notice: [
      S_('end', 'We appreciate your continued cooperation and support.', 'Tunashukuru kwa ushirikiano na msaada wenu endelevu.', 'Thanks parents'),
      S_('end', 'For any enquiries, please contact the school office.', 'Kwa maswali yoyote, tafadhali wasiliana na ofisi ya shule.', 'Where to ask'),
    ],
    fee_reminder: [
      S_('end', 'If you have already made the payment, kindly ignore this reminder and accept our thanks.', 'Kama tayari umeshalipa, tafadhali puuza ukumbusho huu na upokee shukrani zetu.', 'Polite for those who have paid'),
      S_('end', 'For any enquiries, please contact the school office.', 'Kwa maswali yoyote, tafadhali wasiliana na ofisi ya shule.', 'Where to ask'),
    ],
  };
  SUGGEST.parent_invite = SUGGEST.parent_notice;
  SUGGEST.circular = SUGGEST.parent_notice;
  SUGGEST.bank_letter = SUGGEST._generic;

  global.SomapLettersT = { GROUPS, TYPES, L, MONTHS_EN, MONTHS_SW, FONTS, SPACINGS, SIZES, DEFAULT_FORMAT, STATUSES, SUGGEST, formatDate, closingFor, blankMinutes, label };
})(window);
