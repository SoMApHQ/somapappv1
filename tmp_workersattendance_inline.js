
    // Required by finance_math.js for anchor enrollment year
    var SOMAP_DEFAULT_YEAR = new Date().getFullYear();
    var SOMAP_ALLOWED_YEARS = Array.from({length: 10}, (_, i) => SOMAP_DEFAULT_YEAR - 2 + i);
  
