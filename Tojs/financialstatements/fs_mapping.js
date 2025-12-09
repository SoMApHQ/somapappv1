(function (global) {
  'use strict';

  const CATEGORY_NOTE_MAP = {
    income: 1,
    directExpenses: 2,
    adminExpenses: 3,
    personnelExpenses: 4,
    professionalExpenses: 5,
    financialExpenses: 6,
    receivables: 7,
    cash: 8,
    equity: 9,
    retainedEarnings: 10,
    payables: 11,
    tax: 12,
  };

  global.FsMapping = {
    CATEGORY_NOTE_MAP,
  };
})(window);
