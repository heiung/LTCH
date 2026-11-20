// Hệ thống Dropdown (Custom Select) thửa riêng cho toàn bộ cổng học tập LTCH
// Tự động nâng cấp mọi thẻ <select> (tĩnh & động) sang giao diện Popover hiện đại,
// giữ nguyên 100% tương thích với FormData, .value, .disabled, .replaceChildren(),
// sự kiện change/input/invalid và hỗ trợ phím mũi tên / tìm kiếm nhanh.

const nativeValueDescriptor = typeof HTMLSelectElement !== 'undefined'
  ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  : null;
const nativeSelectedIndexDescriptor = typeof HTMLSelectElement !== 'undefined'
  ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex')
  : null;
const nativeDisabledDescriptor = typeof HTMLSelectElement !== 'undefined'
  ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled')
  : null;

let activeDropdown = null;
let dropdownIdSeq = 0;

function stripVi(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function createChevronSvg() {
  const span = document.createElement('span');
  span.className = 'ltch-select-chevron';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 7.5 5 5 5-5"/></svg>';
  return span;
}

function createCheckSvg() {
  const span = document.createElement('span');
  span.className = 'ltch-select-option-check';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 10.5 3.5 3.5 7.5-7.5"/></svg>';
  return span;
}

export function closeActiveCustomSelect({ restoreFocus = false } = {}) {
  if (!activeDropdown) return;
  const current = activeDropdown;
  activeDropdown = null;
  current.close({ restoreFocus });
}

export function upgradeSelect(selectEl) {
  if (!selectEl || selectEl.tagName !== 'SELECT') return null;
  if (selectEl._ltchSelectController) {
    selectEl._ltchSelectController.sync();
    return selectEl._ltchSelectController;
  }
  if (selectEl.dataset.ltchUpgraded === '1' || !selectEl.isConnected || !selectEl.parentNode) return null;
  selectEl.dataset.ltchUpgraded = '1';

  const instanceId = ++dropdownIdSeq;
  const listboxId = `ltch-select-listbox-${instanceId}`;

  const isSortInline =
    selectEl.classList.contains('session-catalog-sort-select') ||
    selectEl.classList.contains('ltch-9study-sort-select') ||
    Boolean(selectEl.closest('.session-catalog-sort-box, .ltch-9study-sort-box'));
  const isBreadcrumbInline = selectEl.classList.contains('ltch-breadcrumb-select');
  const isPdfZoom = selectEl.classList.contains('pdf-zoom-select');
  const isCompactCell = Boolean(selectEl.closest('td'));

  const wrap = document.createElement('div');
  wrap.className = 'ltch-select-wrap';
  if (isSortInline) wrap.classList.add('is-sort-inline');
  if (isBreadcrumbInline) wrap.classList.add('is-breadcrumb-inline');
  if (isPdfZoom) wrap.classList.add('is-pdf-zoom');
  if (isCompactCell) wrap.classList.add('is-compact-cell');

  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'ltch-select-trigger';
  triggerBtn.setAttribute('aria-haspopup', 'listbox');
  triggerBtn.setAttribute('aria-expanded', 'false');
  triggerBtn.setAttribute('aria-controls', listboxId);

  const valueTextSpan = document.createElement('span');
  valueTextSpan.className = 'ltch-select-value-text';

  const chevronSpan = createChevronSvg();
  triggerBtn.append(valueTextSpan, chevronSpan);

  // Đặt triggerBtn TRƯỚC selectEl để nếu nằm trong <label>, thao tác bấm vào nhãn
  // sẽ kích hoạt triggerBtn (phần tử labelable đầu tiên) thay vì thẻ select ẩn.
  const parent = selectEl.parentNode;
  parent.insertBefore(wrap, selectEl);
  wrap.append(triggerBtn, selectEl);

  selectEl.classList.add('ltch-native-select-hidden');
  selectEl.tabIndex = -1;
  selectEl.setAttribute('aria-hidden', 'true');

  let isOpen = false;
  let popoverEl = null;
  let listEl = null;
  let searchInputEl = null;
  let focusedIndex = -1;
  let optionButtons = [];
  let cleanupListeners = null;

  function getSelectedLabelText() {
    const selectedOpt = selectEl.selectedOptions?.[0] || selectEl.options?.[selectEl.selectedIndex] || null;
    if (selectedOpt) {
      return {
        text: selectedOpt.textContent || '',
        isPlaceholder: Boolean(selectEl.required && selectedOpt.value === '')
      };
    }
    if (isPdfZoom && selectEl.dataset.customZoomLabel) {
      return { text: selectEl.dataset.customZoomLabel, isPlaceholder: false };
    }
    const firstOpt = selectEl.options?.[0] || null;
    return {
      text: firstOpt ? firstOpt.textContent || '' : 'Chọn mục...',
      isPlaceholder: Boolean(selectEl.required && (!firstOpt || firstOpt.value === ''))
    };
  }

  function syncTrigger() {
    const { text, isPlaceholder } = getSelectedLabelText();
    valueTextSpan.textContent = text;
    triggerBtn.classList.toggle('is-placeholder', isPlaceholder);

    const isDisabled = Boolean(nativeDisabledDescriptor ? nativeDisabledDescriptor.get.call(selectEl) : selectEl.disabled);
    triggerBtn.disabled = isDisabled;
    wrap.classList.toggle('is-disabled', isDisabled);

    const isInvalid = selectEl.getAttribute('aria-invalid') === 'true';
    triggerBtn.setAttribute('aria-invalid', String(isInvalid));
    wrap.classList.toggle('is-invalid', isInvalid);

    const ariaLabel = selectEl.getAttribute('aria-label');
    if (ariaLabel) triggerBtn.setAttribute('aria-label', ariaLabel);
    const ariaDescribedBy = selectEl.getAttribute('aria-describedby');
    if (ariaDescribedBy) triggerBtn.setAttribute('aria-describedby', ariaDescribedBy);
    else triggerBtn.removeAttribute('aria-describedby');

    if (selectEl.hidden) {
      wrap.hidden = true;
    } else {
      wrap.hidden = false;
    }

    const parentSortPill = selectEl.closest('.session-catalog-sort-box, .ltch-9study-sort-box');
    if (parentSortPill) {
      parentSortPill.classList.toggle('is-open', isOpen);
    }

    if (isOpen) {
      renderPopoverOptions(searchInputEl ? searchInputEl.value : '');
      positionPopover();
    }
  }

  function selectOptionValue(newVal) {
    const prevVal = nativeValueDescriptor ? nativeValueDescriptor.get.call(selectEl) : selectEl.value;
    if (nativeValueDescriptor) {
      nativeValueDescriptor.set.call(selectEl, newVal);
    } else {
      selectEl.value = newVal;
    }
    syncTrigger();
    closePopover({ restoreFocus: true });
    if (prevVal !== newVal) {
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function setFocusedOptionIndex(nextIdx, { scroll = true } = {}) {
    if (!optionButtons.length) {
      focusedIndex = -1;
      return;
    }
    const clamped = Math.max(0, Math.min(optionButtons.length - 1, nextIdx));
    focusedIndex = clamped;
    optionButtons.forEach((entry, idx) => {
      const active = idx === focusedIndex;
      entry.btn.classList.toggle('is-focused', active);
      if (active && scroll) {
        entry.btn.scrollIntoView?.({ block: 'nearest' });
      }
    });
  }

  function renderPopoverOptions(filterQuery = '') {
    if (!listEl) return;
    listEl.replaceChildren();
    optionButtons = [];

    const normQuery = stripVi(filterQuery);
    const currentVal = nativeValueDescriptor ? nativeValueDescriptor.get.call(selectEl) : selectEl.value;
    let initialFocusIdx = 0;

    const appendOptionNode = (optNode, inGroup = false) => {
      if (optNode.hidden) return;
      const optText = optNode.textContent || '';
      if (normQuery && !stripVi(optText).includes(normQuery)) return;

      const optVal = optNode.value;
      const isSelected = optVal === currentVal && (selectEl.selectedIndex >= 0 || optVal !== '');
      const isOptDisabled = Boolean(optNode.disabled);

      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.role = 'option';
      optBtn.className = `ltch-select-option${inGroup ? ' is-grouped' : ''}${isSelected ? ' is-selected' : ''}`;
      optBtn.setAttribute('aria-selected', String(isSelected));
      optBtn.disabled = isOptDisabled;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'ltch-select-option-text';
      labelSpan.textContent = optText;

      const checkIcon = createCheckSvg();
      optBtn.append(labelSpan, checkIcon);

      const btnIndex = optionButtons.length;
      if (isSelected) initialFocusIdx = btnIndex;

      optBtn.addEventListener('mouseenter', () => {
        if (!isOptDisabled) setFocusedOptionIndex(btnIndex, { scroll: false });
      });
      optBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (isOptDisabled) return;
        selectOptionValue(optVal);
      });

      optionButtons.push({ btn: optBtn, value: optVal, disabled: isOptDisabled });
      listEl.append(optBtn);
    };

    for (const child of selectEl.children) {
      if (child.tagName === 'OPTGROUP') {
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'ltch-select-group';
        const groupHeader = document.createElement('div');
        groupHeader.className = 'ltch-select-group-label';
        groupHeader.textContent = child.label || '';
        const beforeCount = optionButtons.length;
        listEl.append(groupHeader);
        for (const subOpt of child.children) {
          if (subOpt.tagName === 'OPTION') appendOptionNode(subOpt, true);
        }
        if (optionButtons.length === beforeCount) {
          groupHeader.remove();
        }
      } else if (child.tagName === 'OPTION') {
        appendOptionNode(child, false);
      }
    }

    if (!optionButtons.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'ltch-select-empty';
      emptyEl.textContent = 'Không tìm thấy lựa chọn phù hợp';
      listEl.append(emptyEl);
      focusedIndex = -1;
    } else {
      setFocusedOptionIndex(initialFocusIdx, { scroll: true });
    }
  }

  function getAnchorElement() {
    return selectEl.closest('.session-catalog-sort-box, .ltch-9study-sort-box') || triggerBtn;
  }

  function positionPopover() {
    if (!popoverEl || !isOpen) return;
    if (!triggerBtn.isConnected) {
      closePopover({ restoreFocus: false });
      return;
    }

    const anchorEl = getAnchorElement();
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
    const vh = window.innerHeight || document.documentElement.clientHeight || 768;

    const minWidth = isPdfZoom
      ? Math.max(rect.width, 164)
      : isBreadcrumbInline
        ? Math.max(rect.width, 280)
        : Math.max(rect.width, 220);
    const maxWidth = Math.min(440, vw - 16);
    const popWidth = Math.min(maxWidth, Math.max(rect.width, minWidth));
    popoverEl.style.width = `${Math.round(popWidth)}px`;

    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const dropUp = spaceBelow < 230 && spaceAbove > spaceBelow;

    popoverEl.classList.toggle('is-drop-up', dropUp);
    const availableHeight = Math.max(130, (dropUp ? spaceAbove : spaceBelow) - 8);
    const searchHeight = searchInputEl ? 50 : 0;
    if (listEl) {
      listEl.style.maxHeight = `${Math.min(310, Math.max(110, availableHeight - searchHeight - 12))}px`;
    }

    let left = rect.left;
    if (isSortInline || left + popWidth > vw - 8) {
      left = Math.min(rect.right - popWidth, vw - popWidth - 8);
    }
    left = Math.max(8, left);
    popoverEl.style.left = `${Math.round(left)}px`;

    if (dropUp) {
      popoverEl.style.top = 'auto';
      popoverEl.style.bottom = `${Math.round(vh - rect.top + 6)}px`;
    } else {
      popoverEl.style.bottom = 'auto';
      popoverEl.style.top = `${Math.round(rect.bottom + 6)}px`;
    }
  }

  function openPopover() {
    if (isOpen || triggerBtn.disabled) return;
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('ltch:close-action-menus'));
    }
    if (activeDropdown && activeDropdown !== controller) {
      activeDropdown.close({ restoreFocus: false });
    }

    isOpen = true;
    activeDropdown = controller;
    wrap.classList.add('is-open');
    triggerBtn.setAttribute('aria-expanded', 'true');
    const parentSortPill = selectEl.closest('.session-catalog-sort-box, .ltch-9study-sort-box');
    if (parentSortPill) parentSortPill.classList.add('is-open');

    popoverEl = document.createElement('div');
    popoverEl.className = 'ltch-select-popover';
    if (isPdfZoom) popoverEl.classList.add('is-dark-popover');
    if (isSortInline) popoverEl.classList.add('is-sort-popover');

    const totalOptions = selectEl.options ? selectEl.options.length : 0;
    if (totalOptions >= 10 && !isPdfZoom) {
      const searchBox = document.createElement('div');
      searchBox.className = 'ltch-select-search-wrap';
      searchInputEl = document.createElement('input');
      searchInputEl.type = 'search';
      searchInputEl.className = 'ltch-select-search-input';
      searchInputEl.placeholder = 'Tìm nhanh...';
      searchInputEl.setAttribute('aria-label', 'Tìm nhanh trong danh sách');
      searchInputEl.addEventListener('input', () => {
        renderPopoverOptions(searchInputEl.value);
      });
      searchInputEl.addEventListener('keydown', handleKeydown);
      searchBox.append(searchInputEl);
      popoverEl.append(searchBox);
    } else {
      searchInputEl = null;
    }

    listEl = document.createElement('div');
    listEl.id = listboxId;
    listEl.role = 'listbox';
    listEl.className = 'ltch-select-list';
    listEl.tabIndex = -1;
    popoverEl.append(listEl);

    const mountTarget = selectEl.closest('dialog[open]') || document.body;
    mountTarget.append(popoverEl);

    renderPopoverOptions('');
    positionPopover();

    if (searchInputEl) {
      requestAnimationFrame(() => searchInputEl?.focus({ preventScroll: true }));
    }

    const onPointerDownOutside = event => {
      const target = event.target;
      if (!target) return;
      if (popoverEl?.contains(target) || wrap.contains(target)) return;
      const enclosingLabel = selectEl.closest('label');
      if (enclosingLabel && enclosingLabel.contains(target)) {
        // Bấm vào phần chữ của label khi đang mở -> đóng lại và chặn click tổng hợp mở lại
        event.preventDefault();
      }
      closePopover({ restoreFocus: false });
    };

    const onScrollOrResize = event => {
      if (event.type === 'scroll' && popoverEl && popoverEl.contains(event.target)) {
        return;
      }
      positionPopover();
    };

    const onWindowKeydown = event => {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePopover({ restoreFocus: true });
      }
    };

    document.addEventListener('pointerdown', onPointerDownOutside, true);
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('keydown', onWindowKeydown, true);

    cleanupListeners = () => {
      document.removeEventListener('pointerdown', onPointerDownOutside, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('keydown', onWindowKeydown, true);
    };
  }

  function closePopover({ restoreFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    if (activeDropdown === controller) activeDropdown = null;
    wrap.classList.remove('is-open');
    triggerBtn.setAttribute('aria-expanded', 'false');
    const parentSortPill = selectEl.closest('.session-catalog-sort-box, .ltch-9study-sort-box');
    if (parentSortPill) parentSortPill.classList.remove('is-open');

    if (cleanupListeners) {
      cleanupListeners();
      cleanupListeners = null;
    }
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
      listEl = null;
      searchInputEl = null;
    }
    optionButtons = [];
    focusedIndex = -1;

    if (restoreFocus && triggerBtn.isConnected && !triggerBtn.disabled) {
      triggerBtn.focus({ preventScroll: true });
    }
  }

  function moveFocusStep(delta) {
    if (!optionButtons.length) return;
    let idx = focusedIndex < 0 ? 0 : focusedIndex;
    for (let step = 0; step < optionButtons.length; step++) {
      idx = (idx + delta + optionButtons.length) % optionButtons.length;
      if (!optionButtons[idx].disabled) {
        setFocusedOptionIndex(idx, { scroll: true });
        return;
      }
    }
  }

  function handleKeydown(event) {
    if (triggerBtn.disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) openPopover();
      else moveFocusStep(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openPopover();
      else moveFocusStep(-1);
    } else if (event.key === 'Home' && isOpen) {
      event.preventDefault();
      setFocusedOptionIndex(0, { scroll: true });
    } else if (event.key === 'End' && isOpen) {
      event.preventDefault();
      setFocusedOptionIndex(optionButtons.length - 1, { scroll: true });
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target !== searchInputEl)) {
      event.preventDefault();
      if (!isOpen) {
        openPopover();
      } else if (focusedIndex >= 0 && optionButtons[focusedIndex] && !optionButtons[focusedIndex].disabled) {
        selectOptionValue(optionButtons[focusedIndex].value);
      }
    } else if (event.key === 'Tab' && isOpen) {
      closePopover({ restoreFocus: false });
    }
  }

  triggerBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (isOpen) closePopover({ restoreFocus: true });
    else openPopover();
  });

  triggerBtn.addEventListener('keydown', handleKeydown);

  // Đồng bộ tự động khi code JS gán select.value, select.selectedIndex, select.disabled, select.replaceChildren()
  if (nativeValueDescriptor) {
    Object.defineProperty(selectEl, 'value', {
      configurable: true,
      enumerable: true,
      get() {
        return nativeValueDescriptor.get.call(this);
      },
      set(val) {
        const strVal = String(val ?? '');
        nativeValueDescriptor.set.call(this, strVal);
        if (isPdfZoom && this.value !== strVal && /^\d+$/.test(strVal)) {
          this.dataset.customZoomLabel = `${strVal}%`;
        } else {
          delete this.dataset.customZoomLabel;
        }
        syncTrigger();
      }
    });
  }

  if (nativeSelectedIndexDescriptor) {
    Object.defineProperty(selectEl, 'selectedIndex', {
      configurable: true,
      enumerable: true,
      get() {
        return nativeSelectedIndexDescriptor.get.call(this);
      },
      set(idx) {
        nativeSelectedIndexDescriptor.set.call(this, idx);
        syncTrigger();
      }
    });
  }

  if (nativeDisabledDescriptor) {
    Object.defineProperty(selectEl, 'disabled', {
      configurable: true,
      enumerable: true,
      get() {
        return nativeDisabledDescriptor.get.call(this);
      },
      set(flag) {
        nativeDisabledDescriptor.set.call(this, Boolean(flag));
        syncTrigger();
      }
    });
  }

  const origReplaceChildren = selectEl.replaceChildren.bind(selectEl);
  selectEl.replaceChildren = (...nodes) => {
    origReplaceChildren(...nodes);
    syncTrigger();
  };

  selectEl.focus = options => {
    triggerBtn.focus(options);
  };

  const observer = new MutationObserver(() => {
    syncTrigger();
  });
  observer.observe(selectEl, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-invalid', 'aria-label', 'aria-describedby', 'hidden']
  });

  const controller = {
    selectEl,
    wrap,
    triggerBtn,
    sync: syncTrigger,
    open: openPopover,
    close: closePopover
  };

  selectEl._ltchSelectController = controller;
  syncTrigger();
  return controller;
}

export function upgradeAllSelectsIn(root = document) {
  if (!root) return;
  if (root.tagName === 'SELECT') {
    upgradeSelect(root);
    return;
  }
  if (typeof root.querySelectorAll === 'function') {
    root.querySelectorAll('select').forEach(sel => upgradeSelect(sel));
  }
}

let observerStarted = false;
export function initCustomSelectObserver() {
  if (observerStarted || typeof document === 'undefined') return;
  observerStarted = true;

  upgradeAllSelectsIn(document);

  const bodyObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (added.nodeType === 1) {
          upgradeAllSelectsIn(added);
        }
      }
    }
  });

  if (document.body) {
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Đóng popover khi dialog đóng
  document.addEventListener(
    'close',
    () => {
      closeActiveCustomSelect({ restoreFocus: false });
    },
    true
  );
}
