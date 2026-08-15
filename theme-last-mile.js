(function () {
  'use strict';
  if (window.__fmThemeLastMile) return;
  window.__fmThemeLastMile = true;

  const SETTINGS = [
    '#settingsModal', '#settingsScreen', '.settings-modal', '.settings-screen'
  ];

  function visible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const matches = document.querySelectorAll(selector);
      for (const el of matches) if (visible(el)) return el;
    }
    return null;
  }

  function findHeading(text) {
    const wanted = text.toLowerCase();
    return Array.from(document.querySelectorAll('h2,h3,h4,.settings-title,.section-title'))
      .find(el => (el.textContent || '').trim().toLowerCase().includes(wanted));
  }

  function compactVisualsCard() {
    const heading = findHeading('visuals & performance');
    if (!heading) return;
    const card = heading.closest('.settings-section,.settings-card,.settings-group,section,article');
    if (card) card.classList.add('fm-compact-settings-card');
  }

  function labelAppearanceSections() {
    const nameHeading = findHeading('name appearance');
    if (nameHeading && !/level\s*5/i.test(nameHeading.textContent || '')) {
      nameHeading.textContent = 'Name Appearance - Level 5';
    }
    const titleHeading = findHeading('title appearance');
    if (titleHeading && !/level\s*5/i.test(titleHeading.textContent || '')) {
      titleHeading.textContent = 'Title Appearance - Level 5';
    }
  }

  function ensureDuelFriendsButton() {
    const duel = document.querySelector('#monkeyDuelScreen,.monkey-duel-screen,[data-screen="monkey-duel"]');
    if (!duel) return;
    const header = duel.querySelector('header,.duel-header,.mode-header,.top-bar') || duel;
    const native = header.querySelector('#mdSocial');
    header.querySelectorAll('[data-fm-duel-friends],.fm-duel-friends-button').forEach(button => {
      if (button !== native) button.remove();
    });
  }

  function topAppearancePopup() {
    return firstVisible([
      '#nameAppearancePopup.open', '[data-popup="name-appearance"].open', '.name-appearance-popup.open',
      '#titleAppearancePopup.open', '[data-popup="title-appearance"].open', '.title-appearance-popup.open'
    ]);
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const popup = topAppearancePopup();
    if (!popup) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    popup.classList.remove('open', 'visible', 'active');
    popup.hidden = true;
    popup.setAttribute('aria-hidden', 'true');
    const settings = firstVisible(SETTINGS);
    if (settings) {
      settings.hidden = false;
      settings.classList.add('open', 'visible', 'active');
      settings.setAttribute('aria-hidden', 'false');
    }
  }, true);

  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      compactVisualsCard();
      labelAppearanceSections();
      ensureDuelFriendsButton();
    });
  }

  /* Only rescan when new UI is rendered. Watching every class/style attribute
     across the document caused the older repair passes to notify themselves
     continuously while gameplay was running. Theme and appearance changes
     already expose explicit events, so they do not need an attribute observer. */
  const observer = new MutationObserver(refresh);
  observer.observe(document.body || document.documentElement, {
    subtree: true,
    childList: true
  });
  document.addEventListener('change', refresh, true);
  window.addEventListener('load', refresh);
  window.addEventListener('storage', refresh);
  window.addEventListener('flappy-profile-theme-changed', refresh);
  window.addEventListener('flappy-theme-applied', refresh);
  refresh();
})();
