(() => {
    'use strict';
    if (!/^https?:$/.test(location.protocol)) return;

    let installPrompt = null;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const mobileDevice = ios || /Android|Mobile|Silk|Kindle/i.test(navigator.userAgent);
    const button = document.createElement('button');
    button.id = 'installAppBtn';
    button.type = 'button';
    button.textContent = '📲 Install Mobile App';
    button.hidden = standalone || !mobileDevice;
    document.querySelector('.button-row')?.appendChild(button);

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        installPrompt = event;
        if (!standalone && mobileDevice) button.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        button.hidden = true;
        void window.gameAlert?.('Flappy Monkey is installed! Open it from your home screen.', { title:'App Installed' });
    });

    button.addEventListener('click', async () => {
        if (installPrompt) {
            installPrompt.prompt();
            await installPrompt.userChoice;
            installPrompt = null;
            return;
        }
        const message = ios
            ? 'In Safari, tap the Share button, then choose “Add to Home Screen.” Flappy Monkey will open full-screen like an app.'
            : 'Open your browser menu and choose “Install app” or “Add to Home screen.”';
        void window.gameAlert?.(message, { title:'Install Flappy Monkey' });
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch((error) => {
            console.warn('Mobile app offline support could not start:', error);
        }));
    }
})();
