(function () {
  'use strict';

  const NAME_SOURCE_IDS = [
    'usernameDisplayHeader',
    'usernameDisplay',
    'nameAppearancePreview',
    'nameAppearancePopupPreview'
  ];

  const NAME_TARGET_SELECTOR = [
    '.username', '.user-name', '.player-name', '.profile-name', '.friend-name',
    '.member-name', '.world-player-name', '.leaderboard-name', '.chat-author',
    '.message-author', '.online-name', '.duel-player-name', '.account-name',
    '[data-username]', '[data-user-name]', '[data-player-name]'
  ].join(',');

  let scheduled = false;

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findNameSource() {
    for (const id of NAME_SOURCE_IDS) {
      const element = document.getElementById(id);
      if (element) return element;
    }
    return null;
  }

  function copyNameAppearance() {
    scheduled = false;
    const source = findNameSource();
    if (!source) return;

    const computed = getComputedStyle(source);
    const animatedClasses = Array.from(source.classList).filter((name) =>
      /(?:rgb|rainbow|glow|name-appearance|animated-name)/i.test(name)
    );

    document.querySelectorAll(NAME_TARGET_SELECTOR).forEach((target) => {
      if (target === source || target.closest('#nameAppearancePopup')) return;
      target.style.setProperty('color', computed.color, 'important');
      target.style.setProperty('text-shadow', computed.textShadow, 'important');
      target.style.setProperty('filter', computed.filter, 'important');
      target.style.setProperty('animation-name', computed.animationName, 'important');
      target.style.setProperty('animation-duration', computed.animationDuration, 'important');
      target.style.setProperty('animation-timing-function', computed.animationTimingFunction, 'important');
      target.style.setProperty('animation-iteration-count', computed.animationIterationCount, 'important');
      animatedClasses.forEach((className) => target.classList.add(className));
    });
  }

  function scheduleNameAppearance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(copyNameAppearance);
  }

  function closeNameAppearanceOnly(event) {
    if (event.key !== 'Escape') return;
    const popup = document.getElementById('nameAppearancePopup');
    if (!popup || !visible(popup) || (!popup.classList.contains('open') && popup.getAttribute('aria-hidden') === 'true')) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const closeButton = popup.querySelector('[data-close], .close, .close-button, .modal-close, button[aria-label*="close" i]');
    if (closeButton) {
      closeButton.click();
    } else {
      popup.classList.remove('open');
      popup.setAttribute('aria-hidden', 'true');
      popup.style.display = 'none';
    }

    const settings = document.getElementById('settingsModal') || document.getElementById('settingsMenu') || document.querySelector('.settings-modal');
    if (settings) {
      settings.classList.add('open');
      settings.setAttribute('aria-hidden', 'false');
      if (settings.style.display === 'none') settings.style.display = '';
    }
  }

  window.addEventListener('keydown', closeNameAppearanceOnly, true);

  const observer = new MutationObserver(scheduleNameAppearance);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-username', 'data-user-name', 'data-player-name']
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleNameAppearance, { once: true });
  } else {
    scheduleNameAppearance();
  }

  window.addEventListener('storage', scheduleNameAppearance);
  window.addEventListener('nameappearancechange', scheduleNameAppearance);
})();
