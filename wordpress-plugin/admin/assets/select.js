/**
 * Progressive-enhancement dropdown for `select.aivastra-select`.
 *
 * CSS alone can only restyle a native <select>'s *closed* chrome — the open
 * option list is rendered by the browser/OS, not the page, in every
 * mainstream browser. This wraps each select with a styled trigger button
 * and a custom listbox that this file fully controls, while leaving the
 * original <select> in the DOM (visually hidden, not removed) as the value
 * that actually submits with the form. If this script fails to load, the
 * select stays visible and fully usable via settings-page.css's own
 * `.wp-core-ui select.aivastra-select` styling — this is enhancement, not
 * a replacement the page depends on.
 */
(function () {
  'use strict';

  function enhance(select) {
    if (select.dataset.aivastraEnhanced) return;
    select.dataset.aivastraEnhanced = 'true';

    var wrap = document.createElement('div');
    wrap.className = 'aivastra-select-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('aivastra-select-native');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'aivastra-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var label = document.createElement('span');
    label.className = 'aivastra-select-trigger-label';
    trigger.appendChild(label);

    var chevron = document.createElement('span');
    chevron.className = 'aivastra-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.appendChild(chevron);

    var popup = document.createElement('ul');
    popup.className = 'aivastra-select-popup';
    popup.setAttribute('role', 'listbox');
    popup.hidden = true;

    var options = Array.prototype.slice.call(select.options);
    var items = options.map(function (opt, i) {
      var li = document.createElement('li');
      li.className = 'aivastra-select-option';
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      li.textContent = opt.textContent;
      popup.appendChild(li);
      return li;
    });

    wrap.appendChild(trigger);
    wrap.appendChild(popup);

    var highlighted = 0;
    var isOpen = false;

    function syncFromSelect() {
      var idx = select.selectedIndex;
      label.textContent = options[idx] ? options[idx].textContent : '';
      items.forEach(function (li, i) {
        var selected = i === idx;
        li.classList.toggle('is-selected', selected);
        li.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }

    function setHighlight(index) {
      if (index < 0) index = 0;
      if (index > items.length - 1) index = items.length - 1;
      highlighted = index;
      items.forEach(function (li, i) {
        li.classList.toggle('is-highlighted', i === index);
      });
      var el = items[index];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    function onDocClick(e) {
      if (!wrap.contains(e.target)) close();
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      popup.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      setHighlight(select.selectedIndex >= 0 ? select.selectedIndex : 0);
      document.addEventListener('click', onDocClick, true);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      popup.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
      document.removeEventListener('click', onDocClick, true);
    }

    function commit(index) {
      var opt = options[index];
      if (!opt) return;
      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncFromSelect();
    }

    trigger.addEventListener('click', function () {
      if (isOpen) close();
      else open();
    });

    trigger.addEventListener('keydown', function (e) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) open();
          else setHighlight(highlighted + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) open();
          else setHighlight(highlighted - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!isOpen) open();
          else {
            commit(highlighted);
            close();
          }
          break;
        case 'Escape':
          if (isOpen) {
            e.preventDefault();
            close();
          }
          break;
        case 'Home':
          if (isOpen) {
            e.preventDefault();
            setHighlight(0);
          }
          break;
        case 'End':
          if (isOpen) {
            e.preventDefault();
            setHighlight(items.length - 1);
          }
          break;
        default:
          break;
      }
    });

    items.forEach(function (li, i) {
      li.addEventListener('mouseenter', function () {
        setHighlight(i);
      });
      li.addEventListener('click', function () {
        commit(i);
        close();
        trigger.focus();
      });
    });

    syncFromSelect();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var selects = document.querySelectorAll('select.aivastra-select');
    Array.prototype.forEach.call(selects, enhance);
  });
})();
