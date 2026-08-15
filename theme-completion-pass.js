(function () {
  'use strict';
  if (window.__fmThemeCompletionPass) return;
  window.__fmThemeCompletionPass = true;

  const frame = (fn) => {
    let pending = false;
    return () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; fn(); });
    };
  };

  function visibleSource() {
    const ids = ['nameAppearancePopupPreview', 'nameAppearancePreview', 'usernameDisplayHeader', 'usernameDisplay'];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node && node.textContent.trim()) return node;
    }
    return null;
  }

  function syncNameAppearance() {
    const source = visibleSource();
    if (!source) return;
    const style = getComputedStyle(source);
    const selector = [
      '[data-username]', '.username', '.player-name', '.profile-name',
      '.chat-username', '.world-player-name', '.leaderboard-name',
      '.friend-name', '.clan-member-name', '.online-player-name',
      '[class*="username"]', '[class*="player-name"]'
    ].join(',');
    document.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement) || node.matches('input, textarea, select, option')) return;
      if (node === source || node.closest('#nameAppearancePopup')) return;
      node.style.color = style.color;
      node.style.textShadow = style.textShadow;
      node.style.backgroundImage = style.backgroundImage;
      node.style.backgroundClip = style.backgroundClip;
      node.style.webkitBackgroundClip = style.webkitBackgroundClip;
      node.style.webkitTextFillColor = style.webkitTextFillColor;
      node.style.animation = style.animation;
    });
  }

  const scheduleNameSync = frame(syncNameAppearance);
  const observer = new MutationObserver(scheduleNameSync);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-username']
  });
  window.addEventListener('load', scheduleNameSync);
  document.addEventListener('change', scheduleNameSync, true);

  /* A nested appearance editor is the top modal. Escape must close it first
     and must never leak to the global screen/router Escape handler. */
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const popup = document.getElementById('nameAppearancePopup');
    if (!popup || !popup.classList.contains('open')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (typeof window.closeNameAppearance === 'function') {
      window.closeNameAppearance();
    } else {
      popup.classList.remove('open');
      popup.setAttribute('aria-hidden', 'true');
    }
  }, true);

  /* Monkey Duel now owns its Friends & Messages action. Remove compatibility
     copies left by older builds instead of injecting another header button. */
  function ensureDuelFriendsButton() {
    const duel = document.querySelector('#monkeyDuelScreen, .monkey-duel-page, .monkey-duel');
    if (!duel) return;
    const bar = duel.querySelector('.md-topbar,header,.header,.topbar,.mode-header');
    if (!bar) return;
    const native = bar.querySelector('#mdSocial');
    bar.querySelectorAll('[data-fm-duel-friends],.fm-duel-friends-button').forEach((button) => {
      if (button !== native) button.remove();
    });
  }
  const scheduleDuelButton = frame(ensureDuelFriendsButton);
  new MutationObserver(scheduleDuelButton).observe(document.body, { subtree: true, childList: true });
  window.addEventListener('load', scheduleDuelButton);
})();
