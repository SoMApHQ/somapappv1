(function (global) {
  'use strict';

  async function downloadFsPdf(elementOrSelector, schoolName = 'School', year = new Date().getFullYear()) {
    const target = typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector;
    if (!target) {
      alert('Nothing to print.');
      return;
    }
    const filename = `Socrates_FS_${schoolName || 'School'}_${year}.pdf`.replace(/\s+/g, '_');
    const canvas = await html2canvas(target, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jspdf.jsPDF('p', 'pt', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(filename);
  }

  global.FsPdf = { downloadFsPdf };
})(window);
