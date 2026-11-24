import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../../shared/sms_core.js';

test('phone: missing words', () => {
  for (const v of ['', '--', 'N/A', 'n/a', null, undefined, '  ', 'NA', '-']) {
    assert.equal(core.normalizeTzPhone(v).status, 'MISSING', String(v));
  }
});

test('phone: valid local and international shapes', () => {
  const cases = {
    '0712345678': '255712345678',
    '0612 345 678': '255612345678',
    '712345678': '255712345678',
    '255712345678': '255712345678',
    '+255 712 345 678': '255712345678',
    '+255-686-000-111': '255686000111',
    '00255712345678': '255712345678',
  };
  for (const [input, msisdn] of Object.entries(cases)) {
    const r = core.normalizeTzPhone(input);
    assert.equal(r.status, 'VALID', input);
    assert.equal(r.msisdn, msisdn, input);
    assert.equal(r.e164, '+' + msisdn);
    assert.equal(r.local, '0' + msisdn.slice(3));
  }
});

test('phone: real SoMAp shapes — 2550 fixed, two numbers take the first, others invalid', () => {
  const fixed = core.normalizeTzPhone('2550712345678');
  assert.equal(fixed.status, 'VALID');
  assert.equal(fixed.msisdn, '255712345678');
  assert.deepEqual(fixed.flags, ['FIXED_2550']);
  assert.equal(core.normalizeTzPhone('+255 0712 345 678').msisdn, '255712345678');

  const two = core.normalizeTzPhone('0677123456/0712345678');
  assert.equal(two.status, 'VALID');
  assert.equal(two.msisdn, '255677123456');
  assert.ok(two.flags.includes('MULTIPLE_NUMBERS'));
  const firstBad = core.normalizeTzPhone('071234/0712345678');
  assert.equal(firstBad.msisdn, '255712345678', 'falls through to the first VALID one');

  for (const bad of ['07671234567', '71234567', '254712345678', '25571234567', '0512345678', 'abc']) {
    assert.equal(core.normalizeTzPhone(bad).status, bad === 'abc' ? 'MISSING' : 'INVALID', bad);
  }
});

test('parts: GSM-7 160 / 153', () => {
  assert.equal(core.countSmsParts('').parts, 0);
  assert.equal(core.countSmsParts('a'.repeat(160)).parts, 1);
  assert.equal(core.countSmsParts('a'.repeat(161)).parts, 2);
  assert.equal(core.countSmsParts('a'.repeat(306)).parts, 2);
  assert.equal(core.countSmsParts('a'.repeat(307)).parts, 3);
  const ext = core.countSmsParts('€'.repeat(80));
  assert.equal(ext.units, 160);
  assert.equal(ext.parts, 1);
  assert.equal(core.countSmsParts('€'.repeat(81)).parts, 2);
  // an escape pair must not be split across parts
  assert.equal(core.countSmsParts('a'.repeat(152) + '€' + 'a'.repeat(152)).parts, 3);
});

test('parts: Unicode 70 / 67', () => {
  const r = core.countSmsParts('ש'.repeat(70));
  assert.equal(r.encoding, 'UCS-2');
  assert.equal(r.parts, 1);
  assert.equal(core.countSmsParts('ש'.repeat(71)).parts, 2);
  assert.equal(core.countSmsParts('ש'.repeat(134)).parts, 2);
  assert.equal(core.countSmsParts('ש'.repeat(135)).parts, 3);
});

test('cleanText: quotes, dashes, emoji, accents, spaces -> GSM-7', () => {
  const dirty = '“Habari” mzazi – ada ya mtoto… 😊 Asante sana. Četi';
  const clean = core.cleanText(dirty);
  assert.equal(clean, '"Habari" mzazi - ada ya mtoto... Asante sana. Ceti');
  assert.equal(core.countSmsParts(clean).encoding, 'GSM-7');
  assert.deepEqual(core.nonGsmChars(dirty).includes('“'), true);
  assert.equal(core.cleanText('é and ü stay'), 'é and ü stay');
});

test('fillTemplate reports every missing value and strips braces from values', () => {
  const ok = core.fillTemplate('Habari {parentName}, deni la {studentName} ni TSh {debt}.', { parentName: 'Mama Amina', studentName: 'Amina', debt: '120,000' });
  assert.equal(ok.text, 'Habari Mama Amina, deni la Amina ni TSh 120,000.');
  assert.equal(ok.ok, true);
  const miss = core.fillTemplate('Habari {ParentName}, {venue} {time}', { parentName: '', venue: 'Ukumbini' });
  assert.deepEqual(miss.missing, ['ParentName', 'time']);
  assert.equal(miss.ok, false);
  assert.ok(core.hasUnfilledPlaceholder(miss.text));
  const inj = core.fillTemplate('Hi {parentName}', { parentName: 'Juma {debt}' });
  assert.equal(inj.text, 'Hi Juma debt');
  assert.equal(core.fillTemplate('Siku {date}', { date: 0 }).text, 'Siku 0');
});

test('money formatting', () => {
  assert.equal(core.formatNumber(1234567), '1,234,567');
  assert.equal(core.formatNumber(999), '999');
  assert.equal(core.formatTsh(120000), 'TSh 120,000');
});

test('fee reminders: one message per parent, children combined with each debt and total', () => {
  const rows = [
    { phone: '0712345678', parentName: 'Mama Amina', studentName: 'Amina Juma', className: 'Class 3', debt: 120000 },
    { phone: '+255712345678', parentName: '', studentName: 'Juma Juma', className: 'Class 1', debt: 80000 },
    { phone: '0755000111', parentName: 'Baba Neema', studentName: 'Neema Ali', className: 'Baby Class', debt: 50000 },
    { phone: '--', parentName: 'X', studentName: 'Hana Simu', className: 'Class 2', debt: 10000 },
    { phone: '25571234567', parentName: 'Y', studentName: 'Namba Mbaya', className: 'Class 2', debt: 10000 },
  ];
  const { groups, unreachable } = core.buildFeeReminderGroups(rows, { shortNames: true });
  assert.equal(groups.length, 2);
  assert.equal(unreachable.length, 2);
  assert.deepEqual(unreachable.map((u) => u.reason), ['MISSING', 'INVALID']);
  const fam = groups[0];
  assert.equal(fam.msisdn, '255712345678');
  assert.equal(fam.totalDebt, 200000);
  assert.equal(fam.values.parentName, 'Mama Amina');
  assert.equal(fam.values.studentName, 'Amina na Juma');
  assert.equal(fam.values.children, 'Amina (Class 3) 120,000, Juma (Class 1) 80,000');
  assert.equal(fam.values.total, '200,000');
  const msg = core.fillTemplate('{school}: Mzazi {parentName}, ada inayodaiwa: {children}. Jumla TSh {total}. Asante.', { ...fam.values, school: 'SOCRATES' });
  assert.equal(msg.ok, true);
  assert.equal(core.countSmsParts(msg.text).parts, 1, msg.text);
  assert.equal(groups[1].values.children, 'Neema');
});

test('groupByPhone keeps first-seen order and merges duplicate phones', () => {
  const { groups } = core.groupByPhone([{ phone: '0755000111', n: 1 }, { phone: '0712345678', n: 2 }, { phone: '755000111', n: 3 }]);
  assert.deepEqual(groups.map((g) => g.rows.map((r) => r.n)), [[1, 3], [2]]);
});
