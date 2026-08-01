(() => {
    'use strict';

    // Mobile browsers may keep JavaScript timers alive briefly after the app is
    // backgrounded. Expose one lifecycle flag that every game mode can honor so
    // locking the phone or switching apps never leaves a local match running.
    let suspended = document.hidden;
    const setSuspended = (nextState, reason) => {
        const next = Boolean(nextState);
        if (suspended === next && window.flappyAppSuspended === next) return;
        suspended = next;
        window.flappyAppSuspended = next;
        document.documentElement.classList.toggle('flappy-app-suspended', next);
        if (next) {
            document.querySelectorAll('audio, video').forEach((media) => {
                try { media.pause(); } catch (_) {}
            });
        }
        window.dispatchEvent(new CustomEvent('flappy:lifecycle', {
            detail:{ suspended:next, reason:String(reason || '') }
        }));
    };
    window.flappyAppSuspended = suspended;
    document.documentElement.classList.toggle('flappy-app-suspended', suspended);
    document.addEventListener('visibilitychange', () => setSuspended(document.hidden, 'visibility'));
    window.addEventListener('pagehide', () => setSuspended(true, 'pagehide'));
    window.addEventListener('pageshow', () => setSuspended(document.hidden, 'pageshow'));
    document.addEventListener('freeze', () => setSuspended(true, 'freeze'));
    document.addEventListener('resume', () => setSuspended(document.hidden, 'resume'));

    const mobileQuery = matchMedia('(max-width: 760px), (max-height: 520px) and (orientation: landscape)');
    const moreButton = document.getElementById('mobileMoreBtn');
    const sheet = document.getElementById('mobileMoreSheet');
    const closeButton = document.getElementById('mobileMoreClose');
    const scrim = sheet?.querySelector('.mobile-more-scrim');
    if (!moreButton || !sheet || !closeButton || !scrim) return;

    const setSheetOpen = (open) => {
        const shouldOpen = Boolean(open && mobileQuery.matches);
        sheet.classList.toggle('open', shouldOpen);
        sheet.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
        moreButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        if (shouldOpen) closeButton.focus({ preventScroll:true });
        else if (document.activeElement && sheet.contains(document.activeElement)) moreButton.focus({ preventScroll:true });
    };

    const syncInstallAction = () => {
        const installProxy = sheet.querySelector('[data-mobile-install]');
        const installButton = document.getElementById('installAppBtn');
        if (!installProxy) return;
        installProxy.hidden = !installButton || installButton.hidden;
    };

    moreButton.setAttribute('aria-expanded', 'false');
    moreButton.addEventListener('click', () => setSheetOpen(true));
    closeButton.addEventListener('click', () => setSheetOpen(false));
    scrim.addEventListener('click', () => setSheetOpen(false));
    sheet.addEventListener('click', (event) => {
        const proxy = event.target.closest('[data-mobile-proxy]');
        if (!proxy) return;
        const target = document.getElementById(proxy.dataset.mobileProxy);
        if (!target || target.hidden) return;
        setSheetOpen(false);
        target.click();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sheet.classList.contains('open')) {
            event.preventDefault();
            setSheetOpen(false);
        }
    });
    mobileQuery.addEventListener?.('change', () => {
        if (!mobileQuery.matches) setSheetOpen(false);
        syncInstallAction();
    });

    const navigationObserver = new MutationObserver(syncInstallAction);
    navigationObserver.observe(document.querySelector('.button-row') || document.body, {
        childList:true,
        subtree:false,
        attributes:true,
        attributeFilter:['hidden']
    });
    syncInstallAction();
})();
