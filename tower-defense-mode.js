/*
 * Flappy Monkey - Tower Defense mode
 * Loaded by install-tower-defense-mode.js. This stays separate from index.html
 * so future updates are easy to install without hand-merging the main game.
 */
(() => {
    'use strict';

    if (window.__flappyMonkeyTowerDefenseLoaded) return;
    window.__flappyMonkeyTowerDefenseLoaded = true;

    const STATS_KEY = 'monkeyTowerDefenseStats';
    const MUSIC_KEY = 'monkeyTowerDefenseMusic';
    const WIDTH = 960;
    const HEIGHT = 560;
    const TRACK_WIDTH = 82;
    const TRACK = [
        { x: -35, y: 290 }, { x: 158, y: 290 }, { x: 158, y: 132 },
        { x: 522, y: 132 }, { x: 522, y: 446 }, { x: 800, y: 446 },
        { x: 800, y: 250 }, { x: 995, y: 250 }
    ];

    const DEFENDERS = [
        { id: 'honey', name: 'Honey Monkey', file: 'Honey Monkey.png', icon: '🍯', cost: 85, range: 138, rate: 1.55, effect: 'honey', color: '#f5b72f', detail: 'Slows a pest for 3 seconds. No damage.' },
        { id: 'ice', name: 'Ice Crystal Monkey', file: 'Ice Crystal Monkey.png', icon: '❄️', cost: 105, range: 150, rate: 0.78, damage: 9, projectile: 'ice', color: '#7ee9ff', detail: 'Shoots ice crystals for 9 damage.' },
        { id: 'shark', name: 'Shark Monkey', file: 'Shark Monkey.png', icon: '🦈', cost: 155, range: 92, rate: 0.94, damage: 25, effect: 'shark', color: '#6bbcff', detail: 'Bites the closest pest for 25 damage.' },
        { id: 'toxic', name: 'Toxic Monkey', file: 'Toxic Monkey.png', icon: '☣️', cost: 130, range: 145, rate: 1.12, damage: 2, projectile: 'toxic', color: '#88e861', detail: 'Poisons a hit pest for 4.5 seconds.' },
        { id: 'cone', name: 'Traffic Cone Monkey', file: 'Traffic Cone Monkey.png', icon: '🚧', cost: 125, range: 126, rate: 1.72, effect: 'cone', color: '#ff9a42', detail: 'Stops a pest in a traffic jam for 1.5 seconds.' },
        { id: 'water', name: 'Water Gun Monkey', file: 'Water Gun Monkey.png', icon: '💦', cost: 100, range: 154, rate: 0.54, damage: 11, projectile: 'water', color: '#46c9ff', detail: 'Sprays pests for 11 damage.' },
        { id: 'firework', name: 'Firework Monkey', file: 'Firework Monkey.png', icon: '🎆', cost: 180, range: 166, rate: 1.28, damage: 16, splash: 70, projectile: 'firework', color: '#ff65aa', detail: 'Fires an explosive firework that damages nearby pests.' },
        { id: 'astronaut', name: 'Astronaut Monkey', file: 'Astronaut Monkey.png', icon: '🪨', cost: 165, range: 172, rate: 1.38, damage: 20, splash: 46, projectile: 'rock', color: '#d1c4ff', detail: 'Throws space rocks for heavy splash damage.' }
    ];

    const MUSIC = [
        ['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night'], ['snow', 'Snow'],
        ['candy', 'Candy'], ['forest', 'Forest'], ['jungle', 'Jungle'], ['enchanted', 'Enchanted'],
        ['aurora', 'Aurora'], ['volcano', 'Volcano'], ['space', 'Space'], ['underwater', 'Underwater'],
        ['hell', 'Hell'], ['hell2', 'Hell 2']
    ];

    const imageCache = new Map();
    const getImage = (file) => {
        if (!imageCache.has(file)) {
            const image = new Image();
            image.src = file;
            imageCache.set(file, image);
        }
        return imageCache.get(file);
    };
    DEFENDERS.forEach((defender) => getImage(defender.file));

    function readStats() {
        const empty = { games: 0, wavesCleared: 0, highestWave: 0, pestsKilled: 0, pestsLeaked: 0, defendersPlaced: 0, damageDone: 0, bestKillStreak: 0 };
        try {
            const saved = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
            return Object.assign(empty, saved && typeof saved === 'object' ? saved : {});
        } catch (_) {
            return empty;
        }
    }

    const stats = readStats();
    function saveStats() {
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
        renderProfileStats();
    }

    let root;
    let stage;
    let canvas;
    let ctx;
    let deck;
    let statusEl;
    let waveEl;
    let waveProgressEl;
    let moneyEl;
    let livesEl;
    let pestsEl;
    let fastEl;
    let startButton;
    let themeLabel;
    let musicSelect;
    let selectedCard;
    let animationFrame;

    const state = {
        open: false,
        wave: 0,
        startedWave: false,
        gameOver: false,
        money: 350,
        lives: 25,
        defenders: [],
        pests: [],
        projectiles: [],
        effects: [],
        selected: null,
        spawned: 0,
        totalToSpawn: 0,
        nextSpawnAt: 0,
        elapsed: 0,
        lastFrame: 0,
        speed: 1,
        sessionKills: 0,
        streak: 0,
        lastStatus: 'Choose a defender, then click any grass area. The gray track is blocked.'
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function buildUi() {
        if (root) return;
        const style = document.createElement('style');
        style.id = 'tower-defense-mode-style';
        style.textContent = [
            '#towerDefenseOverlay{--td-accent:#ffe66d;position:fixed;inset:0;z-index:100000;display:none;overflow:auto;color:#fff;background:radial-gradient(circle at 25% 5%,#344b7a 0,transparent 30rem),linear-gradient(145deg,#06172d,#152b54);font-family:Arial,Helvetica,sans-serif}',
            '#towerDefenseOverlay *{box-sizing:border-box}',
            '.td-shell{min-height:100%;padding:18px;display:flex;flex-direction:column;align-items:center;gap:12px}',
            '.td-top{width:min(1120px,100%);display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;background:rgba(6,15,34,.84);border:2px solid var(--td-accent);border-radius:16px;padding:11px 15px;box-shadow:0 10px 32px rgba(0,0,0,.35)}',
            '.td-title{font-size:clamp(20px,3vw,30px);font-weight:900;letter-spacing:.8px;color:var(--td-accent);text-shadow:0 3px 10px #000}.td-sub{font-size:12px;opacity:.88;margin-top:3px}',
            '.td-actions,.td-stats{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}',
            '.td-btn,.td-music{border:1px solid var(--td-accent);border-radius:10px;background:rgba(10,24,53,.92);color:#fff;padding:8px 10px;font-weight:700;cursor:pointer}.td-btn:hover,.td-card:hover{filter:brightness(1.14)}.td-btn.active{background:var(--td-accent);color:#152447}',
            '.td-stat{min-width:62px;text-align:center;border-left:1px solid rgba(255,255,255,.18);padding:1px 7px}.td-stat b{display:block;color:var(--td-accent);font-size:18px}.td-stat span{font-size:10px;text-transform:uppercase;opacity:.8}',
            '.td-stage-wrap{width:min(1120px,100%);padding:12px;background:rgba(7,22,41,.86);border:2px solid color-mix(in srgb,var(--td-accent) 72%,#fff);border-radius:18px;box-shadow:0 20px 46px rgba(0,0,0,.36)}',
            '#towerDefenseCanvas{display:block;width:100%;height:auto;max-height:62vh;border-radius:10px;cursor:crosshair;touch-action:manipulation;background:#2c7445}',
            '.td-bottom{width:min(1120px,100%);display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px}.td-deck,.td-guide{background:rgba(7,18,40,.91);border:1px solid rgba(255,255,255,.25);border-radius:15px;padding:10px}',
            '.td-deck{display:grid;grid-template-columns:repeat(4,minmax(145px,1fr));gap:8px}.td-card{min-height:62px;border:2px solid transparent;border-radius:11px;background:rgba(255,255,255,.08);padding:7px;display:grid;grid-template-columns:43px 1fr;gap:8px;align-items:center;cursor:pointer;text-align:left;color:#fff}.td-card.selected{border-color:var(--td-accent);background:rgba(255,230,109,.2);box-shadow:0 0 15px rgba(255,230,109,.3)}.td-card img{width:42px;height:42px;object-fit:cover;border-radius:9px;background:#25324c}.td-card strong{font-size:13px;line-height:1.1}.td-card small{display:block;margin-top:4px;color:var(--td-accent);font-size:11px}.td-guide h3{margin:0 0 7px;color:var(--td-accent);font-size:15px}.td-guide p{margin:5px 0;font-size:12px;line-height:1.35}.td-status{color:#d9ecff}.td-track-note{color:#ffcf77}',
            '.td-progress{height:10px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.16);margin-top:5px}.td-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--td-accent),#78f0ae);transition:width .15s}',
            '.td-profile-panel{margin-top:22px;padding:17px;border-radius:13px;border:2px solid var(--td-profile-accent,#ffcc00);background:rgba(0,0,0,.18)}.td-profile-panel h3{margin:0 0 12px;color:var(--td-profile-accent,#ffdf6c)}.td-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.td-profile-stat{background:rgba(255,255,255,.09);border-radius:9px;padding:9px;text-align:center;font-size:12px}.td-profile-stat b{display:block;margin-top:3px;color:var(--td-profile-accent,#ffdf6c);font-size:20px}',
            '@media(max-width:760px){.td-shell{padding:8px}.td-top{grid-template-columns:1fr;padding:10px}.td-actions,.td-stats{justify-content:flex-start}.td-bottom{grid-template-columns:1fr}.td-deck{grid-template-columns:repeat(2,minmax(0,1fr))}.td-stage-wrap{padding:7px}.td-card{min-height:56px}.td-guide{order:-1}}'
        ].join('');
        document.head.appendChild(style);

        root = el('section');
        root.id = 'towerDefenseOverlay';
        const shell = el('div', 'td-shell');
        const top = el('div', 'td-top');
        const heading = el('div');
        heading.appendChild(el('div', 'td-title', '🐒 MONKEY TOWER DEFENSE'));
        themeLabel = el('div', 'td-sub');
        heading.appendChild(themeLabel);
        top.appendChild(heading);

        const actions = el('div', 'td-actions');
        musicSelect = el('select', 'td-music');
        MUSIC.forEach(([id, label]) => {
            const option = el('option', '', '♫ ' + label);
            option.value = id;
            musicSelect.appendChild(option);
        });
        musicSelect.value = localStorage.getItem(MUSIC_KEY) || 'jungle';
        musicSelect.title = 'Tower Defense music';
        musicSelect.addEventListener('change', () => {
            localStorage.setItem(MUSIC_KEY, musicSelect.value);
            if (state.open) playTowerMusic();
        });
        const refreshTheme = el('button', 'td-btn', '🎨 Refresh Theme');
        refreshTheme.addEventListener('click', applyTheme);
        const leave = el('button', 'td-btn', '← Back to Lobby');
        leave.addEventListener('click', closeTowerDefense);
        actions.append(musicSelect, refreshTheme, leave);
        top.appendChild(actions);

        const hudStats = el('div', 'td-stats');
        waveEl = createHudStat('WAVE');
        moneyEl = createHudStat('BANANAS');
        livesEl = createHudStat('HQ');
        pestsEl = createHudStat('PESTS');
        hudStats.append(waveEl.node, moneyEl.node, livesEl.node, pestsEl.node);
        top.appendChild(hudStats);
        shell.appendChild(top);

        const stageWrap = el('div', 'td-stage-wrap');
        stage = el('div');
        canvas = document.createElement('canvas');
        canvas.id = 'towerDefenseCanvas';
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        canvas.addEventListener('click', handleStageClick);
        stage.appendChild(canvas);
        ctx = canvas.getContext('2d');
        waveProgressEl = el('div', 'td-progress');
        waveProgressEl.appendChild(el('i'));
        stage.appendChild(waveProgressEl);
        stageWrap.appendChild(stage);
        shell.appendChild(stageWrap);

        const bottom = el('div', 'td-bottom');
        deck = el('div', 'td-deck');
        bottom.appendChild(deck);
        const guide = el('aside', 'td-guide');
        guide.appendChild(el('h3', '', 'Wave Control'));
        statusEl = el('p', 'td-status');
        guide.appendChild(statusEl);
        startButton = el('button', 'td-btn', 'Start Wave 1');
        startButton.style.width = '100%';
        startButton.style.marginTop = '6px';
        startButton.addEventListener('click', startOrResetWave);
        guide.appendChild(startButton);
        fastEl = el('button', 'td-btn', '⏩ Fast Forward: 1×');
        fastEl.style.width = '100%';
        fastEl.style.marginTop = '8px';
        fastEl.addEventListener('click', toggleFastForward);
        guide.appendChild(fastEl);
        const note = el('p', 'td-track-note', 'Build anywhere on grass — the gray pest track is the only no-build area.');
        guide.appendChild(note);
        bottom.appendChild(guide);
        shell.appendChild(bottom);
        root.appendChild(shell);
        document.body.appendChild(root);

        renderDeck();
        applyTheme();
        updateUi();
    }

    function createHudStat(label) {
        const node = el('div', 'td-stat');
        const value = el('b', '', '0');
        node.append(value, el('span', '', label));
        return { node, value };
    }

    function renderDeck() {
        deck.innerHTML = '';
        DEFENDERS.forEach((defender) => {
            const card = el('button', 'td-card');
            card.type = 'button';
            card.dataset.defender = defender.id;
            const image = document.createElement('img');
            image.src = defender.file;
            image.alt = defender.name;
            const copy = el('span');
            copy.appendChild(el('strong', '', defender.icon + ' ' + defender.name));
            copy.appendChild(el('small', '', defender.cost + ' 🍌 • ' + defender.detail));
            card.append(image, copy);
            card.title = defender.detail;
            card.addEventListener('click', () => selectDefender(defender.id));
            deck.appendChild(card);
        });
    }

    function selectDefender(id) {
        state.selected = state.selected === id ? null : id;
        selectedCard = deck.querySelector('[data-defender="' + state.selected + '"]');
        deck.querySelectorAll('.td-card').forEach((card) => card.classList.toggle('selected', card === selectedCard));
        const defender = DEFENDERS.find((entry) => entry.id === state.selected);
        state.lastStatus = defender ? 'Placing ' + defender.name + ': ' + defender.detail : 'Placement cancelled.';
        updateUi();
    }

    function currentTheme() {
        const fallback = { id: 'none', name: 'Classic', css: '#1a1a2e', lobbyCss: 'linear-gradient(145deg,#06172d,#152b54)', panelCss: 'linear-gradient(145deg,#182646,#0d1830)', accent: '#ffe66d' };
        try {
            if (typeof window.getEquippedProfileTheme === 'function') return Object.assign(fallback, window.getEquippedProfileTheme() || {});
        } catch (_) { /* The classic theme remains a safe fallback. */ }
        return fallback;
    }

    function applyTheme() {
        if (!root) return;
        const theme = currentTheme();
        const accent = theme.accent || '#ffe66d';
        root.style.background = theme.lobbyCss || theme.css || '#1a1a2e';
        root.style.setProperty('--td-accent', accent);
        const wrap = root.querySelector('.td-stage-wrap');
        if (wrap) wrap.style.background = theme.panelCss || 'rgba(7,22,41,.86)';
        themeLabel.textContent = 'Profile theme: ' + (theme.name || 'Classic') + ' • Your Banana Market background carries into this mode.';
        renderProfileStats();
    }

    function resetRun() {
        state.wave = 0;
        state.startedWave = false;
        state.gameOver = false;
        state.money = 350;
        state.lives = 25;
        state.defenders = [];
        state.pests = [];
        state.projectiles = [];
        state.effects = [];
        state.selected = null;
        state.spawned = 0;
        state.totalToSpawn = 0;
        state.elapsed = 0;
        state.speed = 1;
        state.sessionKills = 0;
        state.streak = 0;
        state.lastStatus = 'New defense ready. You have 350 🍌 to place defenders before wave 1.';
        stats.games += 1;
        saveStats();
        renderDeck();
        updateUi();
    }

    function openTowerDefense() {
        buildUi();
        if (state.open) return;
        state.open = true;
        root.style.display = 'block';
        document.body.style.overflow = 'hidden';
        resetRun();
        applyTheme();
        playTowerMusic();
        state.lastFrame = performance.now();
        animationFrame = requestAnimationFrame(loop);
    }

    function closeTowerDefense() {
        if (!state.open) return;
        state.open = false;
        cancelAnimationFrame(animationFrame);
        stopTowerMusic();
        root.style.display = 'none';
        document.body.style.overflow = '';
    }

    function playTowerMusic() {
        const trackId = musicSelect ? musicSelect.value : (localStorage.getItem(MUSIC_KEY) || 'jungle');
        document.querySelectorAll('audio[id^="bgm-"]').forEach((audio) => {
            audio.pause();
            if (audio.id === 'bgm-' + trackId) {
                audio.currentTime = 0;
                audio.play().catch(() => {});
            }
        });
    }

    function stopTowerMusic() {
        const trackId = musicSelect ? musicSelect.value : (localStorage.getItem(MUSIC_KEY) || 'jungle');
        const track = document.getElementById('bgm-' + trackId);
        if (track) track.pause();
    }

    function startOrResetWave() {
        if (state.gameOver) {
            resetRun();
            return;
        }
        if (state.startedWave) return;
        state.wave += 1;
        state.startedWave = true;
        state.spawned = 0;
        state.totalToSpawn = 6 + state.wave * 3 + Math.floor(state.wave / 3);
        state.nextSpawnAt = 0.45;
        state.elapsed = 0;
        state.lastStatus = 'Wave ' + state.wave + ' incoming — pests are tougher and quicker every wave.';
        updateUi();
    }

    function toggleFastForward() {
        state.speed = state.speed === 1 ? 2.5 : 1;
        fastEl.textContent = '⏩ Fast Forward: ' + state.speed + '×';
        fastEl.classList.toggle('active', state.speed > 1);
    }

    function wavePest(index) {
        const baseHealth = Math.round(20 * Math.pow(1.22, state.wave - 1) + state.wave * 4);
        const elite = state.wave >= 4 && (index + 1) % 7 === 0;
        const armored = state.wave >= 9 && (index + 1) % 11 === 0;
        const healthMultiplier = armored ? 2.15 : elite ? 1.55 : 1;
        return {
            id: 'pest-' + state.wave + '-' + index + '-' + Math.random().toString(36).slice(2),
            distance: 0,
            hp: Math.round(baseHealth * healthMultiplier),
            maxHp: Math.round(baseHealth * healthMultiplier),
            speed: (57 + state.wave * 2.2) * (elite ? 1.12 : armored ? 0.82 : 1),
            radius: armored ? 17 : elite ? 15 : 13,
            poisonUntil: 0,
            poisonRate: 0,
            slowUntil: 0,
            pauseUntil: 0,
            elite,
            armored,
            dead: false,
            escaped: false
        };
    }

    function loop(time) {
        if (!state.open) return;
        const realDt = Math.min(0.05, Math.max(0, (time - state.lastFrame) / 1000));
        state.lastFrame = time;
        update(realDt * state.speed, time);
        draw(time);
        updateUi();
        animationFrame = requestAnimationFrame(loop);
    }

    function update(dt, now) {
        if (!state.startedWave || state.gameOver) return;
        state.elapsed += dt;
        const spawnInterval = Math.max(0.26, 1.03 - state.wave * 0.035);
        while (state.spawned < state.totalToSpawn && state.elapsed >= state.nextSpawnAt) {
            state.pests.push(wavePest(state.spawned));
            state.spawned += 1;
            state.nextSpawnAt += spawnInterval;
        }

        state.pests.forEach((pest) => {
            if (pest.dead || pest.escaped) return;
            if (now < pest.poisonUntil) dealDamage(pest, pest.poisonRate * dt, true);
            if (pest.dead) return;
            if (now < pest.pauseUntil) return;
            const slow = now < pest.slowUntil ? 0.34 : 1;
            pest.distance += pest.speed * slow * dt;
            if (pest.distance >= trackLength()) {
                pest.escaped = true;
                state.lives -= 1;
                stats.pestsLeaked += 1;
                state.streak = 0;
                if (state.lives <= 0) endRun();
            }
        });
        state.pests = state.pests.filter((pest) => !pest.dead && !pest.escaped);

        state.defenders.forEach((defender) => actDefender(defender, now));
        updateProjectiles(dt, now);
        state.effects = state.effects.filter((effect) => now < effect.until);

        if (state.startedWave && state.spawned >= state.totalToSpawn && state.pests.length === 0 && !state.gameOver) finishWave();
    }

    function actDefender(defender, now) {
        if (now < defender.nextAttack) return;
        const target = nearestPest(defender);
        if (!target) return;
        defender.nextAttack = now + defender.rate * 1000;
        const spec = defender.spec;
        if (spec.effect === 'honey') {
            target.slowUntil = Math.max(target.slowUntil, now + 3000);
            state.effects.push({ type: 'honey', x: target.x, y: target.y, until: now + 230, color: spec.color });
        } else if (spec.effect === 'cone') {
            target.pauseUntil = Math.max(target.pauseUntil, now + 1500);
            state.effects.push({ type: 'cone', x: target.x, y: target.y, until: now + 300, color: spec.color });
        } else if (spec.effect === 'shark') {
            dealDamage(target, spec.damage, false);
            state.effects.push({ type: 'bite', x: target.x, y: target.y, until: now + 260, color: spec.color });
        } else {
            state.projectiles.push({ x: defender.x, y: defender.y, target, speed: spec.projectile === 'rock' ? 390 : 510, damage: spec.damage, type: spec.projectile, splash: spec.splash || 0, color: spec.color });
        }
    }

    function updateProjectiles(dt, now) {
        state.projectiles.forEach((projectile) => {
            const target = projectile.target;
            if (!target || target.dead || target.escaped) { projectile.done = true; return; }
            const targetPos = positionOnTrack(target.distance);
            target.x = targetPos.x;
            target.y = targetPos.y;
            const dx = target.x - projectile.x;
            const dy = target.y - projectile.y;
            const distance = Math.hypot(dx, dy) || 1;
            const step = projectile.speed * dt;
            if (distance <= step + target.radius) {
                hitProjectile(projectile, target, now);
                projectile.done = true;
                return;
            }
            projectile.x += dx / distance * step;
            projectile.y += dy / distance * step;
        });
        state.projectiles = state.projectiles.filter((projectile) => !projectile.done);
    }

    function hitProjectile(projectile, target, now) {
        if (projectile.type === 'toxic') {
            dealDamage(target, projectile.damage, false);
            target.poisonUntil = Math.max(target.poisonUntil, now + 4500);
            target.poisonRate = 1.65;
            state.effects.push({ type: 'poison', x: target.x, y: target.y, until: now + 650, color: projectile.color });
            return;
        }
        if (projectile.splash) {
            state.pests.forEach((pest) => {
                const pos = positionOnTrack(pest.distance);
                pest.x = pos.x;
                pest.y = pos.y;
                const d = Math.hypot(pest.x - target.x, pest.y - target.y);
                if (d <= projectile.splash) dealDamage(pest, projectile.damage * (pest === target ? 1 : 0.68), false);
            });
            state.effects.push({ type: 'blast', x: target.x, y: target.y, radius: projectile.splash, until: now + 360, color: projectile.color });
        } else {
            dealDamage(target, projectile.damage, false);
            state.effects.push({ type: projectile.type, x: target.x, y: target.y, until: now + 190, color: projectile.color });
        }
    }

    function dealDamage(pest, amount, isPoison) {
        if (pest.dead || pest.escaped) return;
        const damage = Math.max(0, amount);
        pest.hp -= damage;
        stats.damageDone += damage;
        if (pest.hp <= 0) {
            pest.dead = true;
            state.sessionKills += 1;
            state.streak += 1;
            stats.pestsKilled += 1;
            stats.bestKillStreak = Math.max(stats.bestKillStreak, state.streak);
            state.money += pest.elite ? 18 : pest.armored ? 25 : 9;
            state.effects.push({ type: isPoison ? 'poison' : 'pop', x: pest.x || positionOnTrack(pest.distance).x, y: pest.y || positionOnTrack(pest.distance).y, until: performance.now() + 300, color: isPoison ? '#79ea6c' : '#fff6a4' });
            saveStats();
        }
    }

    function finishWave() {
        const reward = 70 + state.wave * 17;
        state.money += reward;
        state.startedWave = false;
        stats.wavesCleared += 1;
        stats.highestWave = Math.max(stats.highestWave, state.wave);
        state.lastStatus = 'Wave ' + state.wave + ' cleared! +' + reward + ' 🍌. Build more defenders, then start the next wave.';
        saveStats();
    }

    function endRun() {
        state.gameOver = true;
        state.startedWave = false;
        state.lastStatus = 'HQ overrun on wave ' + state.wave + '. You defeated ' + state.sessionKills + ' pests this run.';
        saveStats();
    }

    function nearestPest(defender) {
        let chosen = null;
        let highestProgress = -Infinity;
        state.pests.forEach((pest) => {
            const pos = positionOnTrack(pest.distance);
            pest.x = pos.x;
            pest.y = pos.y;
            const distance = Math.hypot(pest.x - defender.x, pest.y - defender.y);
            if (distance <= defender.range && pest.distance > highestProgress) {
                chosen = pest;
                highestProgress = pest.distance;
            }
        });
        return chosen;
    }

    function handleStageClick(event) {
        if (!state.selected || state.gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * WIDTH;
        const y = (event.clientY - rect.top) / rect.height * HEIGHT;
        const spec = DEFENDERS.find((defender) => defender.id === state.selected);
        if (!spec) return;
        if (isOnTrack(x, y)) {
            state.lastStatus = 'No build: that spot is on the pest track. Choose grass beside the path.';
            updateUi();
            return;
        }
        if (state.defenders.some((defender) => Math.hypot(defender.x - x, defender.y - y) < 43)) {
            state.lastStatus = 'That spot is too close to another defender.';
            updateUi();
            return;
        }
        if (state.money < spec.cost) {
            state.lastStatus = 'You need ' + spec.cost + ' 🍌 for ' + spec.name + '.';
            updateUi();
            return;
        }
        state.money -= spec.cost;
        state.defenders.push({ x, y, spec, range: spec.range, rate: spec.rate, nextAttack: 0, facing: 0 });
        stats.defendersPlaced += 1;
        saveStats();
        state.lastStatus = spec.name + ' placed! Select the same card again to place another.';
        updateUi();
    }

    function trackLength() {
        let total = 0;
        for (let index = 1; index < TRACK.length; index += 1) total += Math.hypot(TRACK[index].x - TRACK[index - 1].x, TRACK[index].y - TRACK[index - 1].y);
        return total;
    }

    function positionOnTrack(distance) {
        let remaining = Math.max(0, distance);
        for (let index = 1; index < TRACK.length; index += 1) {
            const a = TRACK[index - 1];
            const b = TRACK[index];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (remaining <= length) {
                const t = remaining / length;
                return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            }
            remaining -= length;
        }
        return TRACK[TRACK.length - 1];
    }

    function pointSegmentDistance(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    }

    function isOnTrack(x, y) {
        for (let index = 1; index < TRACK.length; index += 1) {
            const a = TRACK[index - 1];
            const b = TRACK[index];
            if (pointSegmentDistance(x, y, a.x, a.y, b.x, b.y) < TRACK_WIDTH / 2 + 10) return true;
        }
        return false;
    }

    function draw(now) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        drawGrass();
        drawTrack();
        drawHeadquarters();
        state.effects.forEach((effect) => drawEffect(effect, now));
        state.defenders.forEach(drawDefender);
        state.projectiles.forEach(drawProjectile);
        state.pests.forEach((pest) => drawPest(pest, now));
        if (state.selected) drawPlacementHint();
    }

    function drawGrass() {
        const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        gradient.addColorStop(0, '#449c61');
        gradient.addColorStop(1, '#1f5f45');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#b5e877';
        for (let x = 20; x < WIDTH; x += 56) {
            for (let y = 25; y < HEIGHT; y += 47) {
                const offset = ((x * 13 + y * 7) % 15);
                ctx.beginPath();
                ctx.arc(x + offset, y + (offset % 9), 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawTrack() {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(55,45,40,.34)';
        ctx.lineWidth = TRACK_WIDTH + 16;
        ctx.beginPath();
        ctx.moveTo(TRACK[0].x, TRACK[0].y);
        TRACK.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.stroke();
        ctx.strokeStyle = '#c2b39c';
        ctx.lineWidth = TRACK_WIDTH;
        ctx.stroke();
        ctx.strokeStyle = '#e8dcc7';
        ctx.lineWidth = TRACK_WIDTH - 14;
        ctx.setLineDash([4, 10]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#c76940';
        ctx.beginPath();
        ctx.arc(18, 290, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff4de';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('PESTS', 23, 294);
    }

    function drawHeadquarters() {
        ctx.save();
        ctx.translate(918, 250);
        ctx.fillStyle = '#6d493a';
        ctx.fillRect(-35, -33, 70, 70);
        ctx.fillStyle = '#eacb80';
        ctx.fillRect(-24, -23, 48, 54);
        ctx.fillStyle = '#ca6246';
        ctx.beginPath();
        ctx.moveTo(-38, -24); ctx.lineTo(0, -57); ctx.lineTo(38, -24); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff2b0';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('HQ', 0, 5);
        ctx.restore();
    }

    function drawDefender(defender) {
        const target = nearestPest(defender);
        if (target) defender.facing = Math.atan2(target.y - defender.y, target.x - defender.x);
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = defender.spec.color;
        ctx.beginPath();
        ctx.arc(defender.x, defender.y, defender.range, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.translate(defender.x, defender.y);
        ctx.rotate(defender.facing || 0);
        ctx.fillStyle = defender.spec.color;
        ctx.fillRect(2, -4, 25, 8);
        ctx.rotate(-(defender.facing || 0));
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, Math.PI * 2);
        ctx.fillStyle = '#17233a';
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, 23, 0, Math.PI * 2);
        ctx.clip();
        const image = getImage(defender.spec.file);
        if (image.complete && image.naturalWidth) ctx.drawImage(image, -25, -25, 50, 50);
        else { ctx.fillStyle = defender.spec.color; ctx.fillRect(-23, -23, 46, 46); }
        ctx.restore();
        ctx.strokeStyle = defender.spec.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    function drawPest(pest, now) {
        const pos = positionOnTrack(pest.distance);
        pest.x = pos.x;
        pest.y = pos.y;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        if (pest.armored) ctx.fillStyle = '#48516b';
        else if (pest.elite) ctx.fillStyle = '#c44ecf';
        else ctx.fillStyle = '#83bb4f';
        ctx.beginPath();
        ctx.ellipse(0, 0, pest.radius + 3, pest.radius, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#21332b';
        ctx.beginPath(); ctx.arc(-5, -3, 2.4, 0, Math.PI * 2); ctx.arc(5, -3, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#21332b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 3, 5, 0, Math.PI); ctx.stroke();
        if (now < pest.pauseUntil) { ctx.strokeStyle = '#ff9a42'; ctx.lineWidth = 3; ctx.strokeRect(-pest.radius - 4, -pest.radius - 4, (pest.radius + 4) * 2, (pest.radius + 4) * 2); }
        if (now < pest.slowUntil) { ctx.strokeStyle = '#a7efff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, pest.radius + 6, 0, Math.PI * 2); ctx.stroke(); }
        if (now < pest.poisonUntil) { ctx.fillStyle = '#8af26d'; ctx.globalAlpha = .45; ctx.beginPath(); ctx.arc(0, -pest.radius - 7, 4, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(pos.x - 18, pos.y - pest.radius - 13, 36, 5);
        ctx.fillStyle = pest.armored ? '#b5b8ca' : '#f65d6a'; ctx.fillRect(pos.x - 18, pos.y - pest.radius - 13, 36 * Math.max(0, pest.hp / pest.maxHp), 5);
    }

    function drawProjectile(projectile) {
        const style = projectile.type === 'ice' ? '#c2f6ff' : projectile.type === 'water' ? '#58d7ff' : projectile.type === 'toxic' ? '#8cf06d' : projectile.type === 'firework' ? '#ff86c7' : '#e1d6ff';
        ctx.save();
        ctx.fillStyle = style;
        ctx.shadowColor = style;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(projectile.x, projectile.y, projectile.type === 'rock' ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawEffect(effect, now) {
        const life = Math.max(0, Math.min(1, (effect.until - now) / 450));
        ctx.save();
        ctx.globalAlpha = life;
        ctx.strokeStyle = effect.color;
        ctx.fillStyle = effect.color;
        ctx.lineWidth = 4;
        if (effect.type === 'blast') {
            ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.radius * (1 - life * .35), 0, Math.PI * 2); ctx.stroke();
        } else if (effect.type === 'bite') {
            ctx.beginPath(); ctx.arc(effect.x, effect.y, 18, -.75, .75); ctx.stroke();
            ctx.beginPath(); ctx.arc(effect.x, effect.y, 12, 2.4, 3.9); ctx.stroke();
        } else {
            ctx.beginPath(); ctx.arc(effect.x, effect.y, 9 + (1 - life) * 18, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
    }

    function drawPlacementHint() {
        ctx.save();
        ctx.globalAlpha = .5;
        ctx.fillStyle = '#fff5a8';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Click any grass area to place your selected defender', WIDTH / 2, 34);
        ctx.restore();
    }

    function updateUi() {
        if (!root) return;
        waveEl.value.textContent = state.wave || 1;
        moneyEl.value.textContent = Math.floor(state.money);
        livesEl.value.textContent = Math.max(0, state.lives);
        pestsEl.value.textContent = state.pests.length;
        statusEl.textContent = state.lastStatus;
        // The tracker represents how much of the current wave has been sent
        // down the path. Unlike a kill-only meter, it stays useful while the
        // final pests are still being cleaned up.
        const progress = state.totalToSpawn ? Math.round((state.spawned / state.totalToSpawn) * 100) : 0;
        const fill = waveProgressEl.querySelector('i');
        fill.style.width = Math.max(0, Math.min(100, progress)) + '%';
        if (state.gameOver) startButton.textContent = 'Start a New Defense';
        else if (state.startedWave) startButton.textContent = 'Wave ' + state.wave + ' in progress…';
        else startButton.textContent = 'Start Wave ' + (state.wave + 1);
        startButton.disabled = state.startedWave;
        startButton.style.opacity = state.startedWave ? '.62' : '1';
    }

    function renderProfileStats() {
        const profileBox = document.querySelector('#profileMenu .profile-box');
        if (!profileBox) return;
        let panel = document.getElementById('towerDefenseProfileStats');
        if (!panel) {
            panel = el('section', 'td-profile-panel');
            panel.id = 'towerDefenseProfileStats';
            const close = document.getElementById('closeProfileMenu');
            profileBox.insertBefore(panel, close || null);
        }
        const theme = currentTheme();
        panel.style.setProperty('--td-profile-accent', theme.accent || '#ffcc00');
        const values = [
            ['🏁 Highest wave', stats.highestWave], ['🌊 Waves cleared', stats.wavesCleared],
            ['🐛 Pests defeated', stats.pestsKilled], ['🏃 Pests leaked', stats.pestsLeaked],
            ['🐒 Defenders placed', stats.defendersPlaced], ['💥 Total damage', Math.floor(stats.damageDone)],
            ['🔥 Best kill streak', stats.bestKillStreak], ['🎮 Defenses played', stats.games]
        ];
        panel.innerHTML = '';
        panel.appendChild(el('h3', '', '🏰 TOWER DEFENSE PROGRESS'));
        const grid = el('div', 'td-profile-grid');
        values.forEach(([label, value]) => {
            const card = el('div', 'td-profile-stat');
            card.append(el('span', '', label), el('b', '', Number(value).toLocaleString()));
            grid.appendChild(card);
        });
        panel.appendChild(grid);
    }

    function addModeTile() {
        const grid = document.getElementById('modeGrid');
        const start = document.getElementById('startGameBtn');
        if (!grid || !start || document.getElementById('towerDefenseModeOption')) return;
        const tile = el('div', 'mode-option');
        tile.id = 'towerDefenseModeOption';
        tile.innerHTML = '<h3>🏰 Tower Defense</h3><p>Place monkey defenders anywhere off the pest track and survive endless waves.</p>';
        let chosen = false;
        tile.addEventListener('click', () => {
            chosen = true;
            grid.querySelectorAll('.mode-option').forEach((entry) => entry.classList.remove('selected'));
            tile.classList.add('selected');
        });
        Array.from(grid.querySelectorAll('.mode-option')).forEach((entry) => entry.addEventListener('click', () => {
            if (entry !== tile) {
                chosen = false;
                tile.classList.remove('selected');
            }
        }));
        grid.appendChild(tile);
        start.addEventListener('click', (event) => {
            if (!chosen) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const modeMenu = document.getElementById('modeMenu');
            if (modeMenu) modeMenu.style.display = 'none';
            openTowerDefense();
        }, true);
    }

    document.addEventListener('keydown', (event) => {
        if (!state.open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeTowerDefense();
        }
    }, true);

    function init() {
        buildUi();
        addModeTile();
        const profileButton = document.getElementById('profileBtn');
        if (profileButton) profileButton.addEventListener('click', () => window.setTimeout(renderProfileStats, 0));
        renderProfileStats();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
