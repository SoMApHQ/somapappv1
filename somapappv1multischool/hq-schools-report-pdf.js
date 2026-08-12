(function (global) {
  'use strict';

  async function dataUrl(url) {
    if (!url) return null;
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (_err) {
      return null;
    }
  }

  function clean(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function formatDate(ts) {
    if (!ts) return 'Unknown';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return 'Unknown';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_err) {
      return 'Unknown';
    }
  }

  function statusLabel(status) {
    const s = (status || 'pending').toLowerCase();
    if (s === 'approved' || s === 'active') return 'Approved / Active';
    if (s === 'rejected') return 'Rejected';
    return 'Pending';
  }

  function statusColor(status) {
    const s = (status || 'pending').toLowerCase();
    if (s === 'approved' || s === 'active') return [16, 129, 87];
    if (s === 'rejected') return [190, 50, 50];
    return [180, 130, 20];
  }

  async function build(entries) {
    if (!global.jspdf?.jsPDF) throw new Error('PDF generator unavailable.');
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 16;
    const width = 178;
    let page = 0;
    let y = 0;

    const sorted = (entries || []).slice().sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    const logos = await Promise.all(sorted.map(r => dataUrl(r.logoUrl)));

    function coverPage() {
      page++;
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 297, 'F');
      doc.setTextColor(255);
      doc.setFont('times', 'bold');
      doc.setFontSize(28);
      doc.text('SoMAp HQ', 105, 110, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(14);
      doc.text('Registered Schools — Full Report', 105, 122, { align: 'center' });
      doc.setFontSize(10);
      doc.setTextColor(180, 195, 210);
      doc.text(`${sorted.length} school registration${sorted.length === 1 ? '' : 's'} on record`, 105, 132, { align: 'center' });
      doc.text(`Generated ${new Date().toLocaleString()}`, 105, 140, { align: 'center' });
    }

    function header() {
      if (page) doc.addPage();
      page++;
      doc.setFillColor(13, 63, 48);
      doc.rect(0, 0, 210, 24, 'F');
      doc.setTextColor(255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('SoMAp HQ — School Registrations', margin, 15);
      y = 34;
    }

    function ensure(h) {
      if (y + h > 280) header();
    }

    function field(label, value, xOffset, yPos, colWidth) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(90, 100, 95);
      doc.text(label.toUpperCase(), margin + xOffset, yPos);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(25, 35, 30);
      const lines = doc.splitTextToSize(clean(value) || '—', colWidth);
      doc.text(lines, margin + xOffset, yPos + 5);
      return lines.length * 5 + 5;
    }

    coverPage();
    header();

    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const logo = logos[i];
      const s = r.school || {};
      const c = r.contact || {};

      ensure(95);
      doc.setDrawColor(200, 210, 205);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + width, y);
      y += 8;

      if (logo) {
        try {
          doc.addImage(logo, logo.includes('png') ? 'PNG' : 'JPEG', margin, y, 22, 22, undefined, 'FAST');
        } catch (_err) { /* skip broken image */ }
      } else {
        doc.setDrawColor(200, 210, 205);
        doc.rect(margin, y, 22, 22);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text('No logo', margin + 11, y + 12, { align: 'center' });
      }

      const textX = margin + 28;
      doc.setFont('times', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(20, 30, 25);
      doc.text(clean(s.name) || 'Unnamed School', textX, y + 7, { maxWidth: width - 28 });

      const color = statusColor(r.status);
      doc.setFillColor(color[0], color[1], color[2]);
      doc.roundedRect(textX, y + 11, 38, 6, 1.5, 1.5, 'F');
      doc.setTextColor(255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(statusLabel(r.status), textX + 19, y + 15.2, { align: 'center' });

      doc.setTextColor(90, 100, 95);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Submitted ${formatDate(r.submittedAt)}`, textX + 44, y + 15.2);

      y += 28;

      const col2X = 90;

      // Two-column detail grid, rendered sequentially to keep alignment simple.
      const rows = [
        ['Owner / Director', c.ownerName],
        ['Registration No.', s.registrationNumber],
        ['Ownership Type', s.type],
        ['Levels', s.level],
        ['Country / Region', s.country],
        ['Location Details', s.location],
        ['Average Students', s.avgStudents],
        ['School Email', s.email],
        ['School Phone', s.phone],
        ['P.O. Box', s.poBox],
        ['Banks / Mobile Money', Array.isArray(s.banks) ? s.banks.join(', ') : s.banks],
        ['Day / Boarding', s.dayBoardingType],
        ['Languages / Streams', Array.isArray(s.languages) ? s.languages.join(', ') : s.languages],
        ['Plan / Modules', s.plan]
      ];

      const colWidth = 84;
      for (let ri = 0; ri < rows.length; ri += 2) {
        ensure(16);
        const [leftLabel, leftValue] = rows[ri];
        const leftH = field(leftLabel, leftValue, 0, y, colWidth);
        let rowH = leftH;
        if (rows[ri + 1]) {
          const [rightLabel, rightValue] = rows[ri + 1];
          const rightH = field(rightLabel, rightValue, col2X, y, colWidth);
          rowH = Math.max(leftH, rightH);
        }
        y += rowH + 2;
      }

      if (s.reason) {
        ensure(20);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(90, 100, 95);
        doc.text('REASON FOR JOINING', margin, y);
        y += 5;
        doc.setFont('times', 'italic');
        doc.setFontSize(9.5);
        doc.setTextColor(40, 50, 45);
        const lines = doc.splitTextToSize(clean(s.reason), width);
        doc.text(lines, margin, y);
        y += lines.length * 5 + 4;
      }

      y += 6;
    }

    const pages = doc.getNumberOfPages();
    for (let n = 2; n <= pages; n++) {
      doc.setPage(n);
      doc.setDrawColor(220, 229, 222);
      doc.line(margin, 290, 210 - margin, 290);
      doc.setTextColor(110);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text('SoMAp HQ · School Registrations Report', margin, 294);
      doc.text(`Page ${n - 1} of ${pages - 1}`, 210 - margin, 294, { align: 'right' });
    }

    return doc;
  }

  async function downloadReport(entries) {
    const doc = await build(entries);
    doc.save(`somap-school-registrations-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  global.SomapSchoolsReportPdf = { build, downloadReport };
})(window);
