(function cosmeticFavoritesFeature() {
    'use strict';

    const STORAGE_KEY = 'flappyCosmeticFavorites:v1';
    const read = () => {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return new Set(Array.isArray(value) ? value.filter(entry => typeof entry === 'string' && entry.includes(':')) : []);
        } catch (_) { return new Set(); }
    };
    let favorites = read();

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites].sort()));
        window.dispatchEvent(new CustomEvent('flappy-favorites-changed', { detail:{ favorites:[...favorites] } }));
    }

    function decorate(root = document) {
        root.querySelectorAll?.('[data-favorite-key]').forEach(element => {
            const key = element.dataset.favoriteKey;
            const active = favorites.has(key);
            element.classList.toggle('favorite', active);
            if (element.matches('.cosmetic-favorite-button')) {
                element.textContent = active ? '♥' : '♡';
                element.setAttribute('aria-pressed', String(active));
                element.title = active ? 'Remove from favorites' : 'Add to favorites';
            }
        });
    }

    function toggle(key) {
        key = String(key || '');
        if (!key.includes(':')) return false;
        if (favorites.has(key)) favorites.delete(key); else favorites.add(key);
        save();
        decorate();
        return favorites.has(key);
    }

    function favoriteKeyForElement(element) {
        return element?.closest?.('[data-favorite-key]')?.dataset?.favoriteKey || '';
    }

    document.addEventListener('click', event => {
        const button = event.target.closest('.cosmetic-favorite-button[data-favorite-key]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(button.dataset.favoriteKey);
    }, true);

    document.addEventListener('dblclick', event => {
        if (event.target.closest('button,input,select,textarea,a')) return;
        const card = event.target.closest('.skin-option[data-favorite-key],.title-option[data-favorite-key],.inventory-card[data-favorite-key]');
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(card.dataset.favoriteKey);
    }, true);

    window.addEventListener('flappy-favorites-changed', () => {
        decorate();
        if (typeof applySkinFilter === 'function') applySkinFilter();
        if (typeof refreshTitlesMenu === 'function') refreshTitlesMenu();
        if (typeof refreshInventoryMenu === 'function' && document.getElementById('inventoryMenu')?.classList.contains('open')) refreshInventoryMenu();
    });

    window.FlappyFavorites = Object.freeze({
        all:() => new Set(favorites),
        has:key => favorites.has(String(key || '')),
        toggle,
        decorate,
        favoriteAtPoint:(x,y) => {
            const element = document.elementFromPoint(Number(x) || 0, Number(y) || 0);
            const key = favoriteKeyForElement(element);
            return key ? toggle(key) : false;
        }
    });

    const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) decorate(node);
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
    decorate();
})();
