import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeOtpDigits } from '../client/otp-code-input.mjs';

test('sanitizeOtpDigits extracts only numeric digits up to maxLen', () => {
  assert.equal(sanitizeOtpDigits('012345'), '012345');
  assert.equal(sanitizeOtpDigits(' 09-87 65 43 '), '098765');
  assert.equal(sanitizeOtpDigits('abc0def', 1), '0');
  assert.equal(sanitizeOtpDigits('no-digits'), '');
});
