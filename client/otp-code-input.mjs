// Bộ điều khiển 6 ô nhập mã xác minh OTP (0-9)
// Hỗ trợ tự động chuyển ô, xóa lùi (Backspace), phím mũi tên, dán nhanh 6 số và đồng bộ với input[name="code"].

export function sanitizeOtpDigits(raw = '', maxLen = 6) {
  return String(raw || '').replace(/\D+/g, '').slice(0, maxLen);
}

export function setupOtpSixBoxInput(form) {
  if (!form) return null;
  const codeInput = form.querySelector('input[name="code"]');
  const boxes = [...form.querySelectorAll('.otp-digit-box')];
  if (!codeInput || boxes.length !== 6) return null;

  const wrapperLabel = codeInput.closest('label');
  if (wrapperLabel) {
    wrapperLabel.classList.add('otp-field-group');
    wrapperLabel.addEventListener('click', event => {
      const clickedBox = event.target.closest?.('.otp-digit-box');
      if (clickedBox) {
        event.preventDefault();
        clickedBox.focus();
        clickedBox.select?.();
      } else if (event.target === wrapperLabel || event.target.id === 'otp-code-label') {
        event.preventDefault();
        focusFirstEmptyOrIndex(0);
      }
    });
  }

  function syncCodeValue() {
    const combined = boxes.map(box => sanitizeOtpDigits(box.value, 1)).join('');
    codeInput.value = combined;
    boxes.forEach(box => {
      const hasVal = Boolean(box.value);
      box.classList.toggle('is-filled', hasVal);
    });
    if (codeInput.getAttribute('aria-invalid') === 'true' && combined.length === 6) {
      codeInput.setAttribute('aria-invalid', 'false');
      boxes.forEach(b => b.setAttribute('aria-invalid', 'false'));
      const err = form.querySelector('.field-error');
      if (err) {
        err.textContent = '';
        err.hidden = true;
      }
    }
    return combined;
  }

  function focusFirstEmptyOrIndex(fallbackIndex = 0) {
    const emptyIdx = boxes.findIndex(b => !b.value);
    const target = boxes[emptyIdx >= 0 ? emptyIdx : fallbackIndex] || boxes[0];
    target?.focus();
    target?.select?.();
  }

  // Redirect programmatic focus on elements.code to the 6-box inputs
  codeInput.focus = (options) => {
    const emptyIdx = boxes.findIndex(b => !b.value);
    const target = boxes[emptyIdx >= 0 ? emptyIdx : 0];
    if (target) HTMLElement.prototype.focus.call(target, options);
  };

  function fillDigitsFrom(startIndex, digitsStr) {
    const digits = sanitizeOtpDigits(digitsStr, 6);
    if (!digits) return;
    // If user pasted a full 6-digit code into any box, fill from box 0
    const start = digits.length === 6 ? 0 : startIndex;
    let lastFilled = start;
    for (let i = 0; i < digits.length && start + i < 6; i++) {
      boxes[start + i].value = digits[i];
      lastFilled = start + i;
    }
    syncCodeValue();
    const nextFocusIndex = Math.min(5, lastFilled + (lastFilled < 5 && boxes[lastFilled].value ? 1 : 0));
    // If all 6 filled, keep focus on the 6th box
    const targetIndex = boxes.every(b => b.value) ? 5 : nextFocusIndex;
    boxes[targetIndex]?.focus();
    boxes[targetIndex]?.select?.();
  }

  boxes.forEach((box, idx) => {
    box.addEventListener('focus', () => {
      box.select?.();
    });

    box.addEventListener('keydown', event => {
      if (event.key === 'Backspace') {
        event.preventDefault();
        if (box.value) {
          box.value = '';
          syncCodeValue();
        } else if (idx > 0) {
          boxes[idx - 1].value = '';
          syncCodeValue();
          boxes[idx - 1].focus();
        }
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        box.value = '';
        syncCodeValue();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (idx > 0) boxes[idx - 1].focus();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (idx < 5) boxes[idx + 1].focus();
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        boxes[0].focus();
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        boxes[5].focus();
        return;
      }

      // Single digit key press (0-9) without Ctrl/Meta/Alt
      if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        box.value = event.key;
        syncCodeValue();
        if (idx < 5) {
          boxes[idx + 1].focus();
        }
        return;
      }

      // Block non-digit printable characters
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
      }
    });

    box.addEventListener('input', () => {
      const digits = sanitizeOtpDigits(box.value, 6);
      if (!digits) {
        box.value = '';
        syncCodeValue();
        return;
      }
      if (digits.length > 1) {
        fillDigitsFrom(idx, digits);
        return;
      }
      box.value = digits[0];
      syncCodeValue();
      if (idx < 5) {
        boxes[idx + 1].focus();
      }
    });

    box.addEventListener('paste', event => {
      event.preventDefault();
      const pasted = event.clipboardData?.getData('text') || '';
      fillDigitsFrom(idx, pasted);
    });
  });

  codeInput.addEventListener('invalid', event => {
    event.preventDefault();
    const isInvalid = codeInput.value.length !== 6;
    boxes.forEach(b => b.setAttribute('aria-invalid', String(isInvalid && !b.value)));
    focusFirstEmptyOrIndex(0);
  });

  form.addEventListener('reset', () => {
    const clearAll = () => {
      boxes.forEach(box => {
        box.value = '';
        box.classList.remove('is-filled');
        box.setAttribute('aria-invalid', 'false');
      });
      codeInput.value = '';
      codeInput.setAttribute('aria-invalid', 'false');
    };
    clearAll();
    queueMicrotask(clearAll);
  });

  return {
    syncCodeValue,
    focusFirstEmptyOrIndex,
    boxes,
    codeInput
  };
}
