// Menu thao tác dropdown dùng chung (Progressive Disclosure, hỗ trợ bàn phím & CSP-safe)
import { closeActiveCustomSelect } from './custom-select.mjs';

const MENU_ICONS = {
  more: '<circle cx="5" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.75" fill="currentColor" stroke="none"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkAll: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  drive: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  play: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.4 1.1H21a2 2 0 0 1 0 4h-.09c-.63.08-1.14.5-1.51 1.1Z"/>'
};

let activeMenuController = null;
let menuIdSeq = 0;
let globalListenersAttached = false;

function renderMenuSvg(name, size = 16, extraClass = '') {
  const path = MENU_ICONS[name];
  if (!path) return null;
  const span = document.createElement('span');
  span.className = extraClass ? `ltch-action-menu-icon ${extraClass}` : 'ltch-action-menu-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return span;
}

export function closeActiveActionMenu({ restoreFocus = false } = {}) {
  if (!activeMenuController) return;
  const ctrl = activeMenuController;
  activeMenuController = null;
  ctrl.close({ restoreFocus });
}

function ensureGlobalListeners() {
  if (globalListenersAttached || typeof document === 'undefined') return;
  globalListenersAttached = true;
  document.addEventListener('ltch:close-action-menus', () => {
    closeActiveActionMenu({ restoreFocus: false });
  });
  document.addEventListener(
    'close',
    () => {
      closeActiveActionMenu({ restoreFocus: false });
    },
    true
  );
}

export function createActionMenu({
  label = 'Thao tác',
  ariaLabel = '',
  iconName = '',
  iconOnly = false,
  triggerClass = '',
  variant = 'secondary',
  items = [],
  getItems = null,
  align = 'end',
  minMenuWidth = 210
} = {}) {
  ensureGlobalListeners();
  const instanceId = ++menuIdSeq;
  const menuId = `ltch-action-menu-${instanceId}`;

  const wrap = document.createElement('div');
  wrap.className = 'ltch-action-menu-wrap';

  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';

  const variantClass = triggerClass
    ? triggerClass
    : variant === 'primary'
      ? 'primary'
      : variant === 'outline'
        ? ''
        : 'secondary';

  triggerBtn.className = [
    'ltch-action-menu-trigger',
    iconOnly ? 'is-icon-only' : '',
    iconName === 'settings' ? 'is-gear-trigger' : '',
    variantClass
  ]
    .filter(Boolean)
    .join(' ');
  triggerBtn.setAttribute('aria-haspopup', 'menu');
  triggerBtn.setAttribute('aria-expanded', 'false');
  triggerBtn.setAttribute('aria-controls', menuId);

  const accessibleLabel = ariaLabel || label || 'Thêm thao tác';
  if (iconOnly) {
    triggerBtn.setAttribute('aria-label', accessibleLabel);
    triggerBtn.title = accessibleLabel;
    triggerBtn.append(renderMenuSvg(iconName || 'more', 18));
  } else {
    if (ariaLabel) triggerBtn.setAttribute('aria-label', ariaLabel);
    if (iconName) {
      const leadIcon = renderMenuSvg(iconName, 16);
      if (leadIcon) triggerBtn.append(leadIcon);
    }
    const labelSpan = document.createElement('span');
    labelSpan.className = 'ltch-action-menu-label';
    labelSpan.textContent = label;
    triggerBtn.append(labelSpan, renderMenuSvg('chevronDown', 14, 'is-chevron'));
  }

  wrap.append(triggerBtn);

  let isOpen = false;
  let popoverEl = null;
  let itemButtons = [];
  let cleanupListeners = null;

  function resolveItems() {
    const raw = typeof getItems === 'function' ? getItems() : items;
    return (Array.isArray(raw) ? raw : []).filter(Boolean);
  }

  function focusItemAt(index) {
    const enabled = itemButtons.filter(btn => !btn.disabled);
    if (!enabled.length) return;
    const target = enabled[((index % enabled.length) + enabled.length) % enabled.length];
    target?.focus();
  }

  function positionPopover() {
    if (!popoverEl || !isOpen) return;
    if (!triggerBtn.isConnected) {
      closeMenu({ restoreFocus: false });
      return;
    }

    const rect = triggerBtn.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
    const vh = window.innerHeight || document.documentElement.clientHeight || 768;

    const popMin = Math.min(vw - 16, Math.max(rect.width, minMenuWidth));
    const popMax = Math.min(340, vw - 16);
    popoverEl.style.minWidth = `${Math.round(popMin)}px`;
    popoverEl.style.maxWidth = `${Math.round(popMax)}px`;

    const measuredWidth = Math.min(popMax, Math.max(popMin, popoverEl.offsetWidth || popMin));
    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const popHeight = popoverEl.offsetHeight || 180;
    const dropUp = spaceBelow < Math.min(popHeight + 12, 220) && spaceAbove > spaceBelow;

    popoverEl.classList.toggle('is-drop-up', dropUp);
    const availableHeight = Math.max(120, (dropUp ? spaceAbove : spaceBelow) - 8);
    popoverEl.style.maxHeight = `${Math.round(Math.min(360, availableHeight))}px`;

    let left = align === 'start' ? rect.left : rect.right - measuredWidth;
    if (left + measuredWidth > vw - 8) left = vw - measuredWidth - 8;
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

  function closeMenu({ restoreFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    if (activeMenuController === controller) activeMenuController = null;
    wrap.classList.remove('is-open');
    triggerBtn.classList.remove('is-open');
    triggerBtn.setAttribute('aria-expanded', 'false');

    if (cleanupListeners) {
      cleanupListeners();
      cleanupListeners = null;
    }
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
    itemButtons = [];

    if (restoreFocus && triggerBtn.isConnected) {
      triggerBtn.focus();
    }
  }

  function openMenu({ focusDirection = 0 } = {}) {
    if (isOpen || triggerBtn.disabled) return;
    const resolved = resolveItems().filter(item => !item.hidden);
    if (!resolved.length) return;

    closeActiveCustomSelect({ restoreFocus: false });
    if (activeMenuController && activeMenuController !== controller) {
      activeMenuController.close({ restoreFocus: false });
    }

    isOpen = true;
    activeMenuController = controller;
    wrap.classList.add('is-open');
    triggerBtn.classList.add('is-open');
    triggerBtn.setAttribute('aria-expanded', 'true');

    popoverEl = document.createElement('div');
    popoverEl.id = menuId;
    popoverEl.className = 'ltch-action-menu-popover';
    popoverEl.setAttribute('role', 'menu');
    popoverEl.setAttribute('aria-label', accessibleLabel);

    itemButtons = [];
    for (const item of resolved) {
      if (item.dividerBefore && itemButtons.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'ltch-action-menu-sep';
        sep.setAttribute('role', 'separator');
        popoverEl.append(sep);
      }

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = `ltch-action-menu-item${item.danger ? ' is-danger' : ''}`;
      menuBtn.setAttribute('role', 'menuitem');
      if (item.disabled) {
        menuBtn.disabled = true;
        menuBtn.setAttribute('aria-disabled', 'true');
      }

      if (item.icon) {
        const itemIcon = renderMenuSvg(item.icon, 16, 'is-item-icon');
        if (itemIcon) menuBtn.append(itemIcon);
      }

      const textCol = document.createElement('span');
      textCol.className = 'ltch-action-menu-item-text';
      textCol.textContent = item.label || '';
      menuBtn.append(textCol);

      if (item.hint) {
        const hintEl = document.createElement('span');
        hintEl.className = 'ltch-action-menu-item-hint';
        hintEl.textContent = item.hint;
        menuBtn.append(hintEl);
      }

      menuBtn.addEventListener('click', event => {
        event.stopPropagation();
        if (item.disabled) return;
        closeMenu({ restoreFocus: false });
        if (typeof item.onSelect === 'function') {
          item.onSelect();
        }
      });

      popoverEl.append(menuBtn);
      itemButtons.push(menuBtn);
    }

    const mountTarget =
      triggerBtn.closest('dialog[open]') ||
      triggerBtn.closest('.ltch-exam-fullscreen-overlay') ||
      document.body;
    mountTarget.append(popoverEl);

    positionPopover();

    if (focusDirection !== 0) {
      const enabled = itemButtons.filter(b => !b.disabled);
      const target = focusDirection < 0 ? enabled[enabled.length - 1] : enabled[0];
      target?.focus();
    }

    const onPointerDownOutside = event => {
      const target = event.target;
      if (!target) return;
      if (popoverEl?.contains(target) || wrap.contains(target)) return;
      closeMenu({ restoreFocus: false });
    };

    const onScrollOrResize = event => {
      if (event.type === 'scroll' && popoverEl && popoverEl.contains(event.target)) {
        return;
      }
      positionPopover();
    };

    const onMenuKeydown = event => {
      if (!isOpen) return;
      const enabled = itemButtons.filter(b => !b.disabled);
      const currentIdx = enabled.indexOf(document.activeElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ restoreFocus: true });
      } else if (event.key === 'Tab') {
        closeMenu({ restoreFocus: false });
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusItemAt(currentIdx < 0 ? 0 : currentIdx + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusItemAt(currentIdx < 0 ? enabled.length - 1 : currentIdx - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusItemAt(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusItemAt(enabled.length - 1);
      }
    };

    document.addEventListener('pointerdown', onPointerDownOutside, true);
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    window.addEventListener('scroll', onScrollOrResize, true);
    document.addEventListener('keydown', onMenuKeydown, true);

    cleanupListeners = () => {
      document.removeEventListener('pointerdown', onPointerDownOutside, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      document.removeEventListener('keydown', onMenuKeydown, true);
    };
  }

  triggerBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (isOpen) closeMenu({ restoreFocus: false });
    else openMenu({ focusDirection: 0 });
  });

  triggerBtn.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) openMenu({ focusDirection: 1 });
      else focusItemAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openMenu({ focusDirection: -1 });
      else focusItemAt(-1);
    }
  });

  const controller = {
    wrap,
    trigger: triggerBtn,
    open: openMenu,
    close: closeMenu
  };

  wrap._ltchActionMenu = controller;
  return wrap;
}
