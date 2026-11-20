'use strict';

const {chromium} = require(process.env.LTCH_PLAYWRIGHT_MODULE || 'playwright');

module.exports = () => chromium.launch({
  headless: true,
  executablePath: process.env.LTCH_QA_CHROMIUM_EXECUTABLE || undefined
});
