(() => {
    'use strict';

    const queue = [];
    let active = null;
    let previousFocus = null;

    function ensureUi() {
        let layer = document.getElementById('flappyGameDialogLayer');
        if (layer) return layer;
        layer = document.createElement('div');
        layer.id = 'flappyGameDialogLayer';
        layer.className = 'fm-dialog-layer';
        layer.setAttribute('aria-hidden', 'true');
        layer.innerHTML = `
            <section class="fm-dialog-card" role="dialog" aria-modal="true" aria-labelledby="flappyGameDialogTitle" aria-describedby="flappyGameDialogMessage">
                <div class="fm-dialog-accent"></div>
                <div class="fm-dialog-body">
                    <div class="fm-dialog-heading">
                        <span class="fm-dialog-icon" aria-hidden="true">🍌</span>
                        <h2 id="flappyGameDialogTitle" class="fm-dialog-title">Flappy Monkey</h2>
                    </div>
                    <p id="flappyGameDialogMessage" class="fm-dialog-message"></p>
                    <div class="fm-dialog-warning" role="note"></div>
                    <div class="fm-dialog-input-wrap">
                        <label class="fm-dialog-input-label" for="flappyGameDialogInput">Type your answer</label>
                        <input id="flappyGameDialogInput" class="fm-dialog-input" type="text" autocomplete="off" spellcheck="false">
                        <div class="fm-dialog-requirement"></div>
                    </div>
                    <div class="fm-dialog-actions">
                        <button class="fm-dialog-button fm-dialog-cancel" type="button">Cancel</button>
                        <button class="fm-dialog-button fm-dialog-confirm primary" type="button">OK</button>
                    </div>
                </div>
            </section>`;
        (document.body || document.documentElement).appendChild(layer);
        layer.querySelector('.fm-dialog-confirm').addEventListener('click', () => finish(true));
        layer.querySelector('.fm-dialog-cancel').addEventListener('click', () => finish(false));
        layer.querySelector('.fm-dialog-input').addEventListener('input', () => updatePromptState(layer));
        layer.addEventListener('pointerdown', (event) => {
            if (event.target === layer && active?.options?.backdropCancel !== false) finish(false);
        });
        return layer;
    }

    function updatePromptState(layer) {
        const input = layer.querySelector('.fm-dialog-input');
        const confirm = layer.querySelector('.fm-dialog-confirm');
        const requirement = layer.querySelector('.fm-dialog-requirement');
        const requiredText = String(active?.options?.requiredText || '').trim();
        if (!requiredText || active?.type !== 'prompt') {
            confirm.disabled = false;
            requirement.hidden = true;
            return;
        }
        const matches = input.value.trim().toUpperCase() === requiredText.toUpperCase();
        confirm.disabled = !matches;
        requirement.hidden = false;
        requirement.classList.toggle('matched', matches);
        requirement.textContent = matches ? '✓ Confirmation matched' : `Type ${requiredText} exactly to unlock the button`;
    }

    function present() {
        if (active || !queue.length) return;
        active = queue.shift();
        const layer = ensureUi();
        const { type, message, defaultValue, options } = active;
        previousFocus = document.activeElement;
        layer.className = `fm-dialog-layer ${type}${options.danger ? ' danger' : ''}`;
        layer.querySelector('.fm-dialog-icon').textContent = options.icon || (options.danger ? '⚠' : type === 'prompt' ? '✎' : type === 'confirm' ? '?' : '🍌');
        layer.querySelector('.fm-dialog-title').textContent = options.title || (options.danger ? 'Please Confirm' : type === 'prompt' ? 'Enter Details' : type === 'confirm' ? 'Are You Sure?' : 'Flappy Monkey');
        layer.querySelector('.fm-dialog-message').textContent = String(message ?? '');
        const warning = layer.querySelector('.fm-dialog-warning');
        warning.textContent = options.warning || '';
        warning.hidden = !options.warning;
        const input = layer.querySelector('.fm-dialog-input');
        input.value = defaultValue == null ? '' : String(defaultValue);
        input.placeholder = options.placeholder || '';
        input.maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 500;
        layer.querySelector('.fm-dialog-input-label').textContent = options.inputLabel || 'Type your answer';
        layer.querySelector('.fm-dialog-confirm').textContent = options.confirmLabel || (type === 'alert' ? 'Got It' : 'Confirm');
        layer.querySelector('.fm-dialog-cancel').textContent = options.cancelLabel || 'Cancel';
        updatePromptState(layer);
        layer.setAttribute('aria-hidden', 'false');
        document.body?.classList.add('fm-dialog-open');
        requestAnimationFrame(() => {
            layer.classList.add('open');
            (type === 'prompt' ? input : layer.querySelector('.fm-dialog-confirm')).focus({ preventScroll: true });
            if (type === 'prompt') input.select();
        });
    }

    function finish(accepted) {
        if (!active) return;
        const layer = ensureUi();
        if (accepted && layer.querySelector('.fm-dialog-confirm').disabled) return;
        const current = active;
        const inputValue = layer.querySelector('.fm-dialog-input').value;
        active = null;
        layer.classList.remove('open');
        layer.setAttribute('aria-hidden', 'true');
        document.body?.classList.remove('fm-dialog-open');
        if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        current.resolve(current.type === 'prompt' ? (accepted ? inputValue : null) : current.type === 'confirm' ? accepted : undefined);
        window.setTimeout(present, 170);
    }

    function request(type, message, defaultValue, options = {}) {
        return new Promise((resolve) => {
            queue.push({ type, message, defaultValue, options, resolve });
            present();
        });
    }

    document.addEventListener('keydown', (event) => {
        if (!active) return;
        if (window.flappyBackBindingMatches?.(event) ?? event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            finish(false);
        } else if (event.key === 'Enter' && (!event.shiftKey || active.type !== 'prompt')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!ensureUi().querySelector('.fm-dialog-confirm').disabled) finish(true);
        } else if (event.key === 'Tab') {
            const layer = ensureUi();
            const focusable = [...layer.querySelectorAll('button:not([disabled]),input:not([disabled])')]
                .filter((element) => getComputedStyle(element).display !== 'none');
            if (!focusable.length) return;
            const index = focusable.indexOf(document.activeElement);
            const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
            event.preventDefault();
            focusable[next].focus();
        }
    }, true);

    const api = {
        alert(message, options) {
            return request('alert', message, '', options);
        },
        confirm(message, options) {
            return request('confirm', message, '', options);
        },
        prompt(message, defaultValue = '', options) {
            return request('prompt', message, defaultValue, options);
        },
        isOpen() {
            return Boolean(active);
        },
        close() {
            if (active) finish(false);
        }
    };

    window.FlappyDialog = api;
    window.gameAlert = api.alert;
    window.gameConfirm = api.confirm;
    window.gamePrompt = api.prompt;
    document.documentElement.dataset.flappyDialog = 'ready';

    // Existing informational alerts automatically inherit the game UI. Calls
    // that need a return value use gameConfirm/gamePrompt and await the result.
    window.alert = (message) => {
        void api.alert(message);
    };
})();
