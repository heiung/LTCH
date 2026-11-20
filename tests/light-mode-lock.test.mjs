import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const HTML_PAGES = [
  'public/app.html',
  'public/index.html',
  'public/chinh-sach-bao-mat.html'
];

const CSS_FILES = [
  'public/app.css',
  'public/style.css',
  'public/scrollbars.css'
];

const EMAIL_FILES = [
  'server/domain/email-layout.cjs',
  'integrations/apps-script-otp/OtpTemplate.gs'
];

test('all public HTML pages enforce only-light color scheme, darkreader-lock, CSP hygiene, and synced brand icons', () => {
  for (const file of HTML_PAGES) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /<meta\s+name="color-scheme"\s+content="only light"\s*>/i, `${file} missing only light meta`);
    assert.match(html, /<meta\s+name="darkreader-lock"\s*>/i, `${file} missing darkreader-lock meta`);
    assert.doesNotMatch(html, /<style\b/i, `${file} must not contain inline <style> tags (CSP)`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${file} must not contain inline style attributes (CSP)`);
    assert.match(html, /favicon-32\.png\?v=20261119_brand_v2/, `${file} missing synced favicon-32`);
    assert.match(html, /logo\.png\?v=20261119_brand_v2/, `${file} missing synced logo`);
  }
});

test('all public stylesheets enforce color-scheme only light with explicit light canvas and native control rules', () => {
  for (const file of CSS_FILES) {
    const css = readFileSync(file, 'utf8');
    assert.match(css, /color-scheme:\s*only light\s*;/i, `${file} missing color-scheme: only light`);
    assert.doesNotMatch(css, /@media\s*\([^)]*prefers-color-scheme\s*:\s*dark/i, `${file} must not contain dark mode media queries`);
  }

  for (const file of ['public/app.css', 'public/style.css']) {
    const css = readFileSync(file, 'utf8');
    const htmlBlock = css.match(/\bhtml\s*\{[\s\S]*?\}/);
    assert.ok(htmlBlock, `${file} missing html rule`);
    assert.match(htmlBlock[0], /color-scheme:\s*only light\s*;/i, `${file} html rule missing color-scheme: only light`);
    assert.match(htmlBlock[0], /background-color:\s*/i, `${file} html rule missing explicit background-color`);
    assert.match(htmlBlock[0], /\bcolor:\s*/i, `${file} html rule missing explicit color`);
  }

  const appCss = readFileSync('public/app.css', 'utf8');
  assert.match(appCss, /:-webkit-autofill[\s\S]*?-webkit-text-fill-color:\s*var\(--ink\)/, 'public/app.css missing light autofill override');
  assert.match(appCss, /select option,\s*select optgroup\s*\{[\s\S]*?background-color:\s*#ffffff/, 'public/app.css missing light select option override');
});

test('transactional email templates enforce only-light color scheme and use synced logo', () => {
  for (const file of EMAIL_FILES) {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /<meta\s+(?:\\"|")?name=(?:\\"|")?color-scheme(?:\\"|")?\s+content=(?:\\"|")?only light(?:\\"|")?\s*>/i, `${file} missing email color-scheme meta`);
    assert.match(src, /<meta\s+(?:\\"|")?name=(?:\\"|")?supported-color-schemes(?:\\"|")?\s+content=(?:\\"|")?light(?:\\"|")?\s*>/i, `${file} missing supported-color-schemes meta`);
    assert.match(src, /logo\.png\?v=20261119_brand_v2/, `${file} missing synced brand logo URL`);
  }
});
