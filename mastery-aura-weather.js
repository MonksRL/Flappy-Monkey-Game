(function masteryAuraWeatherFeature() {
    'use strict';

    const MASTERY_STORAGE_KEY = 'flappySkinMastery:v1';
    const OWNED_AURAS_KEY = 'flappyOwnedAuras:v1';
    const SELECTED_AURA_KEY = 'selectedAura';
    const EVENT_COSMETICS_KEY = 'flappyEventCosmetics:v1';
    const XP_THRESHOLDS = Object.freeze([0, 250, 750, 1750, 3500]);
    const XP_PER_SCORE = 5;
    const MONKEY_XP_PACKS = Object.freeze([50,100,150,200,250,300,350,400,450,500].map((xp) => ({ xp, cost:Math.ceil(xp / 2) })));

    const AURAS = Object.freeze([
        { id:'golden-spark', name:'Golden Spark', icon:'assets/auras/aura-golden-spark-v2.png?v=20260808e', mastery:1, rarity:'rare', color:'#ffd257', description:'Warm banana sparks orbit your monkey in a soft golden halo.' },
        { id:'grove-orbit', name:'Grove Orbit', icon:'assets/auras/aura-grove-orbit.png?v=20260808c', mastery:3, rarity:'epic', color:'#70e66f', description:'Living jade leaves and grove lights circle your monkey.' },
        { id:'starbound-ring', name:'Starbound Ring', icon:'assets/auras/aura-starbound-ring.png?v=20260808c', mastery:6, rarity:'epic', color:'#58b8ff', description:'A crisp ring of blue stars leaves a sparkling wake.' },
        { id:'royal-ascendant', name:'Royal Ascendant', icon:'assets/auras/aura-royal-ascendant-v2.png?v=20260808e', mastery:9, rarity:'mythic', color:'#bf68ff', description:'Royal violet energy, crown sparks, and orbiting gems.' },
        { id:'prismatic-sovereign', name:'Prismatic Sovereign', icon:'assets/auras/aura-prismatic-sovereign.png?v=20260808c', mastery:25, rarity:'mythic', color:'#fff08b', description:'The ultimate mastery aura: celestial prisms, stars, and rainbow light.' },
        { id:'inferno-halo', name:'Inferno Halo', icon:'assets/auras/aura-inferno-halo.png?v=20260808c', cost:175, rarity:'rare', color:'#ff5a23', description:'A hot ring of animated fire and flying embers.' },
        { id:'frost-veil', name:'Frost Veil', icon:'assets/auras/aura-frost-veil.png?v=20260808c', cost:250, rarity:'rare', color:'#bceaff', description:'Snowflakes spiral through a cool crystalline mist.' },
        { id:'neon-voltage', name:'Neon Voltage', icon:'assets/auras/aura-neon-voltage.png?v=20260808c', cost:350, rarity:'epic', color:'#36f0ff', description:'Cyan and magenta electricity pulses around your skin.' },
        { id:'tropical-bloom', name:'Tropical Bloom', icon:'assets/auras/aura-tropical-bloom.png?v=20260808c', cost:450, rarity:'epic', color:'#ff7faf', description:'Tropical flowers and glossy leaves bloom as you fly.' },
        { id:'shadow-wisp', name:'Shadow Wisp', icon:'assets/auras/aura-shadow-wisp.png?v=20260808c', cost:600, rarity:'legendary', color:'#8744e8', description:'Dark violet wisps curl around your monkey without hiding it.' },
        { id:'bubble-prism', name:'Bubble Prism', icon:'assets/auras/aura-bubble-prism.png?v=20260808c', cost:750, rarity:'legendary', color:'#8ffaff', description:'Iridescent bubbles orbit and shimmer with rainbow highlights.' },
        { id:'meteor-crown', name:'Meteor Crown', icon:'assets/auras/aura-meteor-crown.png?v=20260808c', cost:900, rarity:'mythic', color:'#ffb12f', description:'Golden meteors blaze in a fast, prestigious orbit.' }
    ]);

    const EVENT_COSMETICS = Object.freeze([
        { id:'firework-festival', type:'profile_background', name:'Firework Festival Theme', icon:'assets/event-vault/firework-festival.png?v=20260808e', rarity:'mythic', source:'Rare golden FLAPPY MONKEY firework', description:'Animated midnight fireworks and golden festival light.' },
        { id:'boss-breaker', type:'profile_background', name:'Boss Breaker Theme', icon:'assets/event-vault/boss-breaker.png?v=20260808e', rarity:'mythic', source:'Very rare Boss Breaker reward', description:'A high-energy boss arena theme built from the Boss Breaker art.' },
        { id:'x-marks-the-spot', type:'profile_background', name:'X Marks The Spot Theme', icon:'assets/event-vault/x-marks-the-spot.png?v=20260808e', rarity:'mythic', source:'Very rare Pirate Invasion treasure', description:'Animated pirate treasure, map lines, ocean mist, and gold.' },
        { id:'pvp-champion', type:'explosion_vfx', name:'PvP Champion Explosion', icon:'assets/event-vault/pvp-champion.png?v=20260808e', rarity:'mythic', source:'Super rare Monkey PvP winner reward', description:'A cyan-magenta clash burst matching its charged icon.' },
        { id:'last-monkey-standing', type:'pipe_skin', name:'Last Monkey Standing Pipes', icon:'assets/event-vault/last-monkey-standing.png?v=20260808e', rarity:'mythic', source:'Very rare Last Monkey Standing winner reward', description:'Royal survivor crown pipes that match their victory icon.' }
    ]);

    function readJson(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            return value && typeof value === 'object' ? value : fallback;
        } catch (_) { return fallback; }
    }

    function writeJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function normalizeSkinKey(value) {
        return String(value || 'Default')
            .normalize('NFKD')
            .replace(/\.[^.]+$/, '')
            .toLocaleLowerCase('en-US')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'default';
    }

    let skinLookup = null;
    function rebuildSkinLookup() {
        skinLookup = new Map();
        if (typeof monkeySkins === 'undefined') return;
        monkeySkins.forEach(skin => {
            skinLookup.set(normalizeSkinKey(skin.name), skin);
            skinLookup.set(normalizeSkinKey(skin.file), skin);
            skin.editStyles?.forEach(style => skinLookup.set(normalizeSkinKey(style.file), skin));
        });
    }

    function skinFor(value) {
        if (typeof monkeySkins === 'undefined') return null;
        // Nearly every caller already passes the canonical skin object. Avoid
        // an O(n) identity scan for every mastery card in the 200+ skin grids.
        if (value && typeof value === 'object' && value.name && value.file) return value;
        const key = normalizeSkinKey(value?.name || value?.file || value);
        if (!skinLookup) rebuildSkinLookup();
        let skin = skinLookup.get(key) || null;
        // Edit styles can replace a skin file at runtime. A miss is uncommon,
        // so rebuild lazily only then rather than rescanning on every lookup.
        if (!skin) {
            rebuildSkinLookup();
            skin = skinLookup.get(key) || null;
        }
        return skin;
    }

    function masteryData() {
        const raw = readJson(MASTERY_STORAGE_KEY, {});
        const clean = {};
        for (const [key, entry] of Object.entries(raw).slice(0, 800)) {
            const xp = Math.max(0, Math.min(XP_THRESHOLDS[4], Math.floor(Number(entry?.xp ?? entry) || 0)));
            clean[normalizeSkinKey(key)] = { xp };
        }
        return clean;
    }

    let mastery = masteryData();

    function progressFor(value) {
        const skin = skinFor(value);
        const key = normalizeSkinKey(skin?.name || value);
        const xp = Math.max(0, Math.min(XP_THRESHOLDS[4], Number(mastery[key]?.xp) || 0));
        let level = 1;
        for (let index = 1; index < XP_THRESHOLDS.length; index += 1) {
            if (xp >= XP_THRESHOLDS[index]) level = index + 1;
        }
        const mastered = level >= 5;
        const currentFloor = XP_THRESHOLDS[level - 1];
        const nextTarget = mastered ? XP_THRESHOLDS[4] : XP_THRESHOLDS[level];
        const within = mastered ? 1 : (xp - currentFloor) / Math.max(1, nextTarget - currentFloor);
        return { skin, key, xp, level, mastered, currentFloor, nextTarget, percent:Math.max(0, Math.min(100, within * 100)) };
    }

    function masteredCount() {
        if (typeof monkeySkins === 'undefined') return 0;
        const unique = new Set();
        for (const skin of monkeySkins) {
            if (skin.unlocked && progressFor(skin).mastered) unique.add(normalizeSkinKey(skin.name));
        }
        return unique.size;
    }

    let masterySaveTimer = 0;
    function persistMasteryNow() {
        clearTimeout(masterySaveTimer);
        masterySaveTimer = 0;
        writeJson(MASTERY_STORAGE_KEY, mastery);
    }
    function persistMasterySoon() {
        clearTimeout(masterySaveTimer);
        masterySaveTimer = window.setTimeout(persistMasteryNow, 350);
    }

    let toastTimer = 0;
    function showMasteryToast(progress, previousLevel) {
        let toast = document.getElementById('masteryLevelToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'masteryLevelToast';
            toast.className = 'mastery-level-toast';
            document.body.appendChild(toast);
        }
        const name = progress.skin?.name || 'Monkey Skin';
        const playfield = document.getElementById('canvas');
        const bounds = playfield?.getBoundingClientRect?.();
        if (bounds?.width && bounds?.height) {
            toast.style.left = `${bounds.left + bounds.width / 2}px`;
            // Share the compact top-of-playfield position used by weather notices.
            toast.style.top = `${Math.max(14, bounds.top + 18)}px`;
            toast.style.width = `${Math.max(175, Math.min(235, bounds.width - 40))}px`;
        } else {
            toast.style.left = '50%';
            toast.style.top = '18px';
            toast.style.width = '';
        }
        toast.innerHTML = `<strong>${progress.mastered ? 'SKIN MASTERED!' : `${escapeHtml(name)} · LEVEL ${progress.level}`}</strong><span>${progress.mastered ? `${escapeHtml(name)} earned all five stars. A new mastery reward may be ready.` : `Star ${progress.level} earned · the next mastery level is harder.`}</span>`;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), progress.mastered ? 5200 : 3600);
        if (progress.mastered || progress.level > previousLevel) window.createConfetti?.();
    }

    function addSkinXp(value, amount, options = {}) {
        const skin = skinFor(value);
        if (!skin?.unlocked) return progressFor(value);
        const progress = progressFor(skin);
        if (progress.mastered) return progress;
        const gain = Math.max(0, Math.min(5000, Math.floor(Number(amount) || 0)));
        if (!gain) return progress;
        const previousLevel = progress.level;
        const nextXp = Math.min(XP_THRESHOLDS[4], progress.xp + gain);
        mastery[progress.key] = { xp:nextXp };
        persistMasterySoon();
        const updated = progressFor(skin);
        window.dispatchEvent(new CustomEvent('flappy-mastery-progress', { detail:{ skin:updated.key, xp:updated.xp, level:updated.level, mastered:updated.mastered } }));
        if (updated.level > previousLevel || updated.mastered !== progress.mastered) {
            window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'skin-mastery', mastered:masteredCount(), skin:updated.key, level:updated.level } }));
        }
        if (!options.silent && updated.level > previousLevel) showMasteryToast(updated, previousLevel);
        return updated;
    }

    function addScore(value, points, options = {}) {
        const safePoints = Math.max(0, Math.min(10000, Number(points) || 0));
        return addSkinXp(value, Math.max(1, Math.round(safePoints * XP_PER_SCORE)), options);
    }

    function ownedAuraSet() {
        const saved = readJson(OWNED_AURAS_KEY, []);
        return new Set(Array.isArray(saved) ? saved.filter((id) => AURAS.some((aura) => aura.id === id)) : []);
    }

    let ownedAuras = ownedAuraSet();

    function ownsAura(id) {
        if (id === 'none') return true;
        const aura = AURAS.find((entry) => entry.id === id);
        if (!aura) return false;
        return ownedAuras.has(aura.id) || (aura.mastery ? masteredCount() >= aura.mastery : false);
    }

    function selectedAuraId() {
        const id = String(localStorage.getItem(SELECTED_AURA_KEY) || 'none');
        if (!ownsAura(id)) {
            localStorage.setItem(SELECTED_AURA_KEY, 'none');
            return 'none';
        }
        return id;
    }

    function selectAura(id) {
        if (!ownsAura(id)) return false;
        localStorage.setItem(SELECTED_AURA_KEY, id);
        window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'auras', selected:id } }));
        renderAuraMarket();
        return true;
    }

    let auraOwnershipDirty = false;
    let eventCosmeticOwnershipDirty = false;
    function flushOwnership() {
        let changed = false;
        if (auraOwnershipDirty) {
            writeJson(OWNED_AURAS_KEY, [...ownedAuras]);
            auraOwnershipDirty = false;
            changed = true;
        }
        if (eventCosmeticOwnershipDirty) {
            writeJson(EVENT_COSMETICS_KEY, [...ownedEventCosmetics]);
            eventCosmeticOwnershipDirty = false;
            changed = true;
        }
        return changed;
    }

    function setAuraOwned(id, owned = true) {
        const aura = AURAS.find((entry) => entry.id === id);
        if (!aura) return false;
        if (owned) ownedAuras.add(id);
        else ownedAuras.delete(id);
        auraOwnershipDirty = true;
        if (window.__flappyBatchingCollectionUpdates !== true) flushOwnership();
        if (!owned && selectedAuraId() === id) {
            localStorage.setItem(SELECTED_AURA_KEY, 'none');
        }
        if (window.__flappyBatchingCollectionUpdates === true) {
            window.__flappyCollectionBatchDirty = true;
        } else {
            window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'auras', itemId:id, owned:Boolean(owned) } }));
            if (document.getElementById('aurasGrid')?.style.display !== 'none') renderAuraMarket();
            if (typeof refreshInventoryMenu === 'function' && document.getElementById('inventoryMenu')?.classList.contains('open')) refreshInventoryMenu();
        }
        return true;
    }

    function purchaseAura(id) {
        const aura = AURAS.find((entry) => entry.id === id && !entry.mastery);
        if (!aura || ownsAura(id)) return false;
        const balance = typeof monkeyCoins !== 'undefined'
            ? Math.max(0, Number(monkeyCoins) || 0)
            : Math.max(0, Number(localStorage.getItem('monkeyCoins')) || 0);
        if (balance < aura.cost) {
            window.gameAlert?.(`You need ${aura.cost - balance} more Banana Coins for ${aura.name}.`, { title:'Not Enough Bananas' })
                || window.alert(`You need ${aura.cost - balance} more Banana Coins.`);
            return false;
        }
        if (typeof spendBananaCoins === 'function') spendBananaCoins(aura.cost);
        else {
            const next = balance - aura.cost;
            localStorage.setItem('monkeyCoins', String(next));
            if (typeof monkeyCoins !== 'undefined') monkeyCoins = next;
        }
        ownedAuras.add(aura.id);
        writeJson(OWNED_AURAS_KEY, [...ownedAuras]);
        localStorage.setItem(SELECTED_AURA_KEY, aura.id);
        window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'auras', itemId:aura.id, owned:true } }));
        renderAuraMarket();
        if (typeof refreshShopGrid === 'function') refreshShopGrid();
        return true;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
    }

    function starsMarkup(level) {
        return Array.from({ length:5 }, (_, index) => `<span class="${index < level ? '' : 'empty'}">★</span>`).join('');
    }

    function masteryPanelMarkup(skin) {
        const progress = progressFor(skin);
        const remaining = Math.max(0, progress.nextTarget - progress.xp);
        return `<div class="skin-mastery-panel ${progress.mastered ? 'mastered' : ''}">
            <div class="skin-mastery-top"><div class="skin-mastery-level">${progress.mastered ? 'Mastered · Level 5' : `Skin Level ${progress.level}`}</div><div class="skin-mastery-stars" aria-label="${progress.level} of 5 mastery stars">${starsMarkup(progress.level)}</div></div>
            <div class="skin-mastery-progress-copy"><span>${progress.xp.toLocaleString()} Skin XP</span><span>${progress.mastered ? 'MAX' : `${remaining.toLocaleString()} XP to Level ${progress.level + 1}`}</span></div>
            <div class="skin-mastery-track"><div class="skin-mastery-fill" style="width:${progress.mastered ? 100 : progress.percent.toFixed(2)}%"></div></div>
        </div>`;
    }

    function decorateSkinMenu() {
        const grid = document.getElementById('skinGrid');
        if (!grid || typeof monkeySkins === 'undefined') return;
        let summary = grid.querySelector('.mastery-summary-card');
        if (!summary) {
            summary = document.createElement('div');
            summary.className = 'mastery-summary-card';
            grid.prepend(summary);
        }
        const count = masteredCount();
        summary.innerHTML = `<strong>Skin Mastery · ${count} Mastered</strong><br><span>Score points earned while a skin is equipped give ${XP_PER_SCORE} Skin XP each. Every skin has five increasingly difficult levels; Level 5 earns all five stars.</span>`;
        grid.querySelectorAll('.skin-option').forEach((card) => {
            const skin = skinFor(card.dataset.name);
            card.querySelector('.skin-mastery-panel')?.remove();
            if (!skin?.unlocked) return;
            const progress = progressFor(skin);
            card.dataset.masteryXp = String(progress.xp);
            card.dataset.masteryLevel = String(progress.level);
            card.insertAdjacentHTML('beforeend', masteryPanelMarkup(skin));
        });
    }

    function injectMarketTabs() {
        const tabs = document.getElementById('shopTabs');
        const shop = document.getElementById('shopMenu');
        const close = document.getElementById('closeShopMenu');
        if (!tabs || !shop || !close || document.querySelector('[data-tab="auras"]')) return;

        const auraTab = document.createElement('button');
        auraTab.className = 'shop-tab shop-tab-with-icon';
        auraTab.dataset.tab = 'auras';
        auraTab.innerHTML = '<img class="shop-tab-icon" src="assets/market-tabs/auras.png?v=20260808e" alt="" aria-hidden="true">Auras';
        const eventTab = document.createElement('button');
        eventTab.className = 'shop-tab shop-tab-with-icon';
        eventTab.dataset.tab = 'event-vault';
        eventTab.innerHTML = '<img class="shop-tab-icon" src="assets/market-tabs/event-vault.png?v=20260808e" alt="" aria-hidden="true">Event Vault';
        const xpTab = document.createElement('button');
        xpTab.className = 'shop-tab shop-tab-with-icon';
        xpTab.dataset.tab = 'monkey-xp';
        xpTab.innerHTML = '<img class="shop-tab-icon" src="powerup-xp-boost.png" alt="" aria-hidden="true">Monkey XP';
        const crateTab = tabs.querySelector('[data-tab="crates"]');
        tabs.insertBefore(xpTab, crateTab || null);
        tabs.insertBefore(auraTab, crateTab || null);
        tabs.insertBefore(eventTab, crateTab || null);

        const auraGrid = document.createElement('div');
        auraGrid.id = 'aurasGrid';
        auraGrid.className = 'banana-market-grid';
        auraGrid.style.display = 'none';
        const eventGrid = document.createElement('div');
        eventGrid.id = 'eventVaultGrid';
        eventGrid.className = 'banana-market-grid';
        eventGrid.style.display = 'none';
        const xpGrid = document.createElement('div');
        xpGrid.id = 'monkeyXpGrid';
        xpGrid.className = 'banana-market-grid';
        xpGrid.style.display = 'none';
        shop.insertBefore(xpGrid, close);
        shop.insertBefore(auraGrid, close);
        shop.insertBefore(eventGrid, close);

        const activate = (tab, grid, render) => {
            document.querySelectorAll('.shop-tab').forEach((entry) => entry.classList.toggle('active', entry === tab));
            document.querySelectorAll('#shopMenu .banana-market-grid').forEach((entry) => { entry.style.display = entry === grid ? 'grid' : 'none'; });
            render();
        };
        auraTab.addEventListener('click', (event) => { event.stopImmediatePropagation(); activate(auraTab, auraGrid, renderAuraMarket); });
        eventTab.addEventListener('click', (event) => { event.stopImmediatePropagation(); activate(eventTab, eventGrid, renderEventVault); });
        xpTab.addEventListener('click', (event) => { event.stopImmediatePropagation(); activate(xpTab, xpGrid, renderMonkeyXpMarket); });
        tabs.querySelectorAll('.shop-tab:not([data-tab="auras"]):not([data-tab="event-vault"]):not([data-tab="monkey-xp"])').forEach((tab) => tab.addEventListener('click', () => {
            xpGrid.style.display = 'none';
            auraGrid.style.display = 'none';
            eventGrid.style.display = 'none';
        }));
    }

    function purchaseMonkeyXp(pack) {
        const balance = Number.parseInt(localStorage.getItem('monkeyCoins') || '0', 10) || 0;
        if (!pack || balance < pack.cost) {
            const missing = Math.max(0, Number(pack?.cost || 0) - balance);
            window.gameAlert?.(`You need ${missing} more Banana Coins for this Monkey XP pack.`, { title:'Not Enough Bananas' })
                || window.alert(`You need ${missing} more Banana Coins.`);
            return;
        }
        const wasShowingUnlock = typeof isShowingUnlockPopup !== 'undefined' && isShowingUnlockPopup;
        if (typeof spendBananaCoins === 'function') spendBananaCoins(pack.cost);
        else localStorage.setItem('monkeyCoins', String(balance - pack.cost));
        if (typeof totalXP !== 'undefined') totalXP += pack.xp;
        else localStorage.setItem('monkeyXP', String((Number.parseInt(localStorage.getItem('monkeyXP') || '0', 10) || 0) + pack.xp));
        if (typeof updateXPBar === 'function') updateXPBar();
        if (typeof checkLevelUnlocks === 'function') checkLevelUnlocks();
        if (!wasShowingUnlock && typeof pendingUnlocks !== 'undefined' && pendingUnlocks.length && typeof showNextUnlockPopup === 'function') showNextUnlockPopup();
        if (typeof refreshShopGrid === 'function') refreshShopGrid();
        renderMonkeyXpMarket();
        window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'monkey-xp-purchase', xp:pack.xp, cost:pack.cost } }));
    }

    function renderMonkeyXpMarket() {
        const grid = document.getElementById('monkeyXpGrid');
        if (!grid) return;
        const info = typeof getLevelAndProgress === 'function' ? getLevelAndProgress() : { level:1, progress:0, required:100 };
        grid.innerHTML = `<h3 class="xp-market-heading">Monkey XP</h3><p class="xp-market-subtitle">Spend Banana Coins on permanent XP for your account level. Level rewards unlock immediately after purchase.</p><div class="xp-market-level"><img src="powerup-xp-boost.png" alt=""><div><strong>Level ${info.level}</strong><span>${info.progress.toLocaleString()} / ${info.required.toLocaleString()} XP to next level</span></div><i><b style="width:${Math.min(100, info.progress / info.required * 100).toFixed(2)}%"></b></i></div>`;
        for (const pack of MONKEY_XP_PACKS) {
            const card = document.createElement('article');
            card.className = 'shop-option xp-market-card';
            card.innerHTML = `<div class="xp-pack-icon"><img src="powerup-xp-boost.png" alt="Monkey XP"><strong>+${pack.xp}</strong></div><h3>+${pack.xp} Monkey XP</h3><div class="price">${pack.cost} 🍌</div><p>Added instantly to your account level.</p><button type="button">Buy XP · ${pack.cost} 🍌</button>`;
            card.querySelector('button').addEventListener('click', () => purchaseMonkeyXp(pack));
            grid.appendChild(card);
        }
    }

    function renderAuraMarket() {
        const grid = document.getElementById('aurasGrid');
        if (!grid) return;
        const selected = selectedAuraId();
        const count = masteredCount();
        grid.innerHTML = `<h3 class="aura-market-heading">Aura Cosmetics</h3><p class="aura-market-subtitle">Equip one glow or orbit effect around your monkey. The first five are mastery-exclusive and can never be purchased; the other seven are permanent Banana Market cosmetics. Use the No Aura card in Inventory to unequip an aura.</p>`;
        for (const aura of AURAS) {
            const owned = ownsAura(aura.id);
            const equipped = selected === aura.id;
            const card = document.createElement('article');
            card.className = `shop-option aura-card ${aura.mastery ? 'mastery-exclusive' : ''} ${owned ? '' : 'locked-exclusive'} ${equipped ? 'selected' : ''}`;
            const percent = aura.mastery ? Math.min(100, count / aura.mastery * 100) : 0;
            const source = aura.mastery
                ? `<div class="aura-rarity-pill">Mastery Exclusive · Cannot be bought</div><div class="aura-progress-copy"><span>Mastered skins</span><span>${Math.min(count, aura.mastery)} / ${aura.mastery}</span></div><div class="aura-progress-track"><div class="aura-progress-fill" style="width:${percent.toFixed(2)}%"></div></div>`
                : `<div class="aura-rarity-pill">Banana Market Aura</div><div class="price">${owned ? (equipped ? 'Equipped' : 'Owned') : `${aura.cost} 🍌`}</div>`;
            card.innerHTML = `<img class="aura-card-icon" src="${aura.icon}" alt="${escapeHtml(aura.name)} aura preview"><h3 style="color:${aura.color}">${escapeHtml(aura.name)}</h3>${source}<div class="desc">${escapeHtml(aura.description)}</div><button type="button" ${equipped ? 'disabled' : ''}>${equipped ? 'Equipped' : owned ? 'Equip Aura' : aura.mastery ? `Master ${aura.mastery} Skin${aura.mastery === 1 ? '' : 's'}` : `Buy · ${aura.cost} 🍌`}</button>`;
            const button = card.querySelector('button');
            button.addEventListener('click', () => {
                if (equipped) return;
                if (owned) selectAura(aura.id);
                else if (!aura.mastery) purchaseAura(aura.id);
                else window.gameAlert?.(`Master ${aura.mastery} skin${aura.mastery === 1 ? '' : 's'} to unlock ${aura.name}. Your progress is ${count}/${aura.mastery}.`, { title:'Mastery Aura Locked' })
                    || window.alert(`Master ${aura.mastery} skins to unlock this aura. Progress: ${count}/${aura.mastery}.`);
            });
            grid.appendChild(card);
        }
    }

    function eventCosmeticSet() {
        const saved = readJson(EVENT_COSMETICS_KEY, []);
        return new Set(Array.isArray(saved) ? saved.filter((id) => EVENT_COSMETICS.some((item) => item.id === id)) : []);
    }

    let ownedEventCosmetics = eventCosmeticSet();

    function renderEventVault() {
        const grid = document.getElementById('eventVaultGrid');
        if (!grid) return;
        grid.innerHTML = '<h3 class="event-vault-heading">Monkey World Event Vault</h3><p class="event-vault-subtitle">Every event-exclusive cosmetic is visible here before you own it. These previews cannot be bought or equipped; win the listed event reward to unlock the real item.</p>';
        for (const item of EVENT_COSMETICS) {
            const owned = ownedEventCosmetics.has(item.id);
            const card = document.createElement('article');
            card.className = `shop-option event-vault-card ${owned ? '' : 'locked-exclusive'}`;
            card.innerHTML = `<img class="event-vault-icon" src="${item.icon}" alt="${escapeHtml(item.name)} preview"><h3>${escapeHtml(item.name)}</h3><div class="event-source-pill">Event Exclusive · Cannot be bought</div><div class="desc">${escapeHtml(item.description)}</div><div class="aura-progress-copy"><span>Unlock source</span><span>${owned ? 'OWNED' : 'LOCKED'}</span></div><div class="event-unlock-source">${escapeHtml(item.source)}</div><button type="button" ${owned ? '' : 'disabled'}>${owned ? 'View Cosmetic' : 'Locked · Event Reward'}</button>`;
            if (owned) card.querySelector('button').addEventListener('click', () => openCosmeticTab(item.type));
            grid.appendChild(card);
        }
    }

    function openCosmeticTab(type) {
        const tabName = ({ profile_background:'background-themes', explosion_vfx:'explosions', pipe_skin:'pipes' })[type];
        document.querySelector(`.shop-tab[data-tab="${tabName}"]`)?.click();
    }

    function registerUnlockedEventCosmetics() {
        if (typeof profileBackgrounds !== 'undefined') {
            const backgrounds = [
                { id:'firework-festival', name:'Firework Festival', icon:'firework-bg.png', css:'url("firework-bg.png") center/cover,linear-gradient(145deg,#080426,#401454)', lobbyCss:'radial-gradient(circle at 20% 18%,rgba(255,210,79,.32),transparent 18rem),url("firework-bg.png") center/cover fixed,#08031f', panelCss:'linear-gradient(145deg,rgba(42,13,67,.96),rgba(8,6,38,.98))', buttonCss:'linear-gradient(145deg,#7a2fb2,#d6932e)', accent:'#ffd975' },
                { id:'boss-breaker', name:'Boss Breaker Arena', icon:'bossbreaker-bg.png', css:'url("bossbreaker-bg.png") center/cover,linear-gradient(145deg,#151012,#661c18)', lobbyCss:'radial-gradient(circle at 50% 0,rgba(255,89,48,.28),transparent 27rem),url("bossbreaker-bg.png") center/cover fixed,#170906', panelCss:'linear-gradient(145deg,rgba(92,25,15,.97),rgba(22,12,10,.98))', buttonCss:'linear-gradient(145deg,#bd3c1f,#5b1712)', accent:'#ffb15c' },
                { id:'x-marks-the-spot', name:'X Marks The Spot', icon:'pirate-bg.png', css:'url("pirate-bg.png") center/cover,linear-gradient(145deg,#0c4661,#8d5d18)', lobbyCss:'radial-gradient(circle at 65% 8%,rgba(255,224,123,.33),transparent 24rem),url("pirate-bg.png") center/cover fixed,#082e43', panelCss:'linear-gradient(145deg,rgba(23,82,92,.97),rgba(70,42,13,.98))', buttonCss:'linear-gradient(145deg,#bd7d27,#185f70)', accent:'#ffe38a' }
            ];
            for (const item of backgrounds) {
                if (!ownedEventCosmetics.has(item.id) || profileBackgrounds.some((entry) => entry.id === item.id)) continue;
                profileBackgrounds.push({ ...item, cost:0, unlocked:true, eventOnly:true });
            }
        }
        if (typeof explosionVfxOptions !== 'undefined' && ownedEventCosmetics.has('pvp-champion') && !explosionVfxOptions.some((entry) => entry.id === 'pvp-champion')) {
            explosionVfxOptions.push({ id:'pvp-champion', name:'PvP Champion Clash', cost:0, unlocked:true, eventOnly:true, description:'Exclusive electric clash burst from Monkey PvP.' });
        }
        if (typeof pipeThemes !== 'undefined' && ownedEventCosmetics.has('last-monkey-standing') && !pipeThemes.some((entry) => entry.id === 'last-monkey-standing')) {
            pipeThemes.push({ id:'last-monkey-standing', name:'Last Monkey Standing', cost:0, unlocked:true, eventOnly:true });
        }
    }

    function grantEventCosmetic(id) {
        const item = EVENT_COSMETICS.find((entry) => entry.id === id);
        if (!item) return false;
        ownedEventCosmetics.add(id);
        eventCosmeticOwnershipDirty = true;
        if (window.__flappyBatchingCollectionUpdates !== true) flushOwnership();
        registerUnlockedEventCosmetics();
        if (item.type === 'profile_background' && typeof saveUnlockedProfileBgs === 'function') saveUnlockedProfileBgs();
        if (item.type === 'explosion_vfx' && typeof saveUnlockedExplosionVfx === 'function') saveUnlockedExplosionVfx();
        if (item.type === 'pipe_skin' && typeof saveUnlockedPipeThemes === 'function') saveUnlockedPipeThemes();
        if (window.__flappyBatchingCollectionUpdates === true) {
            window.__flappyCollectionBatchDirty = true;
        } else {
            window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'event-cosmetic', itemId:id, owned:true } }));
            if (typeof refreshShopGrid === 'function' && document.getElementById('shopMenu')?.classList.contains('open')) refreshShopGrid();
            if (document.getElementById('eventVaultGrid')?.style.display !== 'none') renderEventVault();
        }
        return true;
    }

    function setEventCosmeticOwned(id, owned = true) {
        const item = EVENT_COSMETICS.find((entry) => entry.id === id);
        if (!item) return false;
        if (owned) return grantEventCosmetic(id);
        ownedEventCosmetics.delete(id);
        eventCosmeticOwnershipDirty = true;
        if (window.__flappyBatchingCollectionUpdates !== true) flushOwnership();
        const collection = item.type === 'profile_background' ? (typeof profileBackgrounds !== 'undefined' ? profileBackgrounds : null)
            : item.type === 'explosion_vfx' ? (typeof explosionVfxOptions !== 'undefined' ? explosionVfxOptions : null)
            : item.type === 'pipe_skin' ? (typeof pipeThemes !== 'undefined' ? pipeThemes : null)
            : null;
        const runtimeItem = collection?.find((entry) => entry.id === id);
        if (runtimeItem) runtimeItem.unlocked = false;
        if (item.type === 'profile_background' && typeof selectedProfileBg !== 'undefined' && selectedProfileBg === id) {
            selectedProfileBg = 'none';
            localStorage.setItem('selectedProfileBg', 'none');
            if (typeof applyProfileTheme === 'function') applyProfileTheme();
        }
        if (item.type === 'explosion_vfx' && typeof selectedExplosionVfx !== 'undefined' && selectedExplosionVfx === id) {
            selectedExplosionVfx = 'none';
            localStorage.setItem('selectedExplosionVfx', 'none');
        }
        if (item.type === 'pipe_skin' && typeof selectedPipeTheme !== 'undefined' && selectedPipeTheme === id) {
            selectedPipeTheme = 'classic';
            localStorage.setItem('selectedPipeTheme', 'classic');
        }
        if (item.type === 'profile_background' && typeof saveUnlockedProfileBgs === 'function') saveUnlockedProfileBgs();
        if (item.type === 'explosion_vfx' && typeof saveUnlockedExplosionVfx === 'function') saveUnlockedExplosionVfx();
        if (item.type === 'pipe_skin' && typeof saveUnlockedPipeThemes === 'function') saveUnlockedPipeThemes();
        if (window.__flappyBatchingCollectionUpdates === true) {
            window.__flappyCollectionBatchDirty = true;
        } else {
            window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'event-cosmetic', itemId:id, owned:false } }));
            if (typeof refreshShopGrid === 'function' && document.getElementById('shopMenu')?.classList.contains('open')) refreshShopGrid();
            if (typeof refreshInventoryMenu === 'function' && document.getElementById('inventoryMenu')?.classList.contains('open')) refreshInventoryMenu();
            if (document.getElementById('eventVaultGrid')?.style.display !== 'none') renderEventVault();
        }
        return true;
    }

    function drawSpark(context, x, y, radius, color, rotation = 0) {
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(0, -radius);
        context.lineTo(radius * .23, -radius * .23);
        context.lineTo(radius, 0);
        context.lineTo(radius * .23, radius * .23);
        context.lineTo(0, radius);
        context.lineTo(-radius * .23, radius * .23);
        context.lineTo(-radius, 0);
        context.lineTo(-radius * .23, -radius * .23);
        context.closePath();
        context.fill();
        context.restore();
    }

    function orbitPoint(cx, cy, rx, ry, angle) {
        return { x:cx + Math.cos(angle) * rx, y:cy + Math.sin(angle) * ry };
    }

    function drawOrbitTrail(context, cx, cy, rx, ry, rotation, color, width, opacity = 1, dash = []) {
        context.save();
        context.translate(cx, cy);
        context.rotate(rotation);
        context.globalAlpha *= opacity;
        context.strokeStyle = color;
        context.lineWidth = width;
        context.lineCap = 'round';
        context.setLineDash(dash);
        context.beginPath();
        context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        context.stroke();
        context.restore();
    }

    function drawFivePointStar(context, x, y, outerRadius, color, rotation = 0, innerRatio = .45) {
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.translate(x, y);
        context.rotate(rotation - Math.PI / 2);
        context.fillStyle = color;
        context.beginPath();
        for (let point = 0; point < 10; point += 1) {
            const radius = point % 2 ? outerRadius * innerRatio : outerRadius;
            const angle = point * Math.PI / 5;
            const px = Math.cos(angle) * radius;
            const py = Math.sin(angle) * radius;
            if (!point) context.moveTo(px, py); else context.lineTo(px, py);
        }
        context.closePath();
        context.fill();
        context.restore();
    }

    function drawLeaf(context, x, y, length, color, rotation = 0) {
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(-length * .55, 0);
        context.quadraticCurveTo(0, -length * .48, length * .55, 0);
        context.quadraticCurveTo(0, length * .48, -length * .55, 0);
        context.fill();
        context.strokeStyle = 'rgba(238,255,174,.62)';
        context.lineWidth = Math.max(.7, length * .055);
        context.beginPath(); context.moveTo(-length * .4, 0); context.lineTo(length * .4, 0); context.stroke();
        context.restore();
    }

    function drawCrescent(context, x, y, radius, color, rotation = 0) {
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(0, -radius);
        context.bezierCurveTo(radius * 1.04, -radius * .46, radius * 1.04, radius * .46, 0, radius);
        context.bezierCurveTo(radius * .43, radius * .35, radius * .43, -radius * .35, 0, -radius);
        context.closePath();
        context.fill();
        context.restore();
    }

    function drawSnowflake(context, x, y, radius, color, rotation = 0) {
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.translate(x, y);
        context.rotate(rotation);
        context.strokeStyle = color;
        context.lineWidth = Math.max(1, radius * .12);
        context.lineCap = 'round';
        for (let arm = 0; arm < 6; arm += 1) {
            context.rotate(Math.PI / 3);
            context.beginPath(); context.moveTo(0, 0); context.lineTo(radius, 0); context.stroke();
            context.beginPath(); context.moveTo(radius * .58, 0); context.lineTo(radius * .78, -radius * .2); context.moveTo(radius * .58, 0); context.lineTo(radius * .78, radius * .2); context.stroke();
        }
        context.restore();
    }

    function drawFlower(context, x, y, radius, petalColor, centerColor, rotation = 0) {
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.translate(x, y);
        context.rotate(rotation);
        context.fillStyle = petalColor;
        for (let petal = 0; petal < 5; petal += 1) {
            context.rotate(Math.PI * 2 / 5);
            context.beginPath(); context.ellipse(0, -radius * .62, radius * .42, radius * .68, 0, 0, Math.PI * 2); context.fill();
        }
        context.fillStyle = centerColor;
        context.beginPath(); context.arc(0, 0, radius * .38, 0, Math.PI * 2); context.fill();
        context.restore();
    }

    function drawCrown(context, x, y, width, color) {
        context.save();
        context.globalCompositeOperation = 'source-over';
        context.translate(x, y);
        context.fillStyle = color;
        context.strokeStyle = '#fff0a8';
        context.lineWidth = Math.max(1, width * .045);
        context.beginPath();
        context.moveTo(-width * .5, width * .22);
        context.lineTo(-width * .42, -width * .2);
        context.lineTo(-width * .16, width * .02);
        context.lineTo(0, -width * .38);
        context.lineTo(width * .16, width * .02);
        context.lineTo(width * .42, -width * .2);
        context.lineTo(width * .5, width * .22);
        context.closePath(); context.fill(); context.stroke();
        context.fillStyle = '#ff7be5';
        [-.25,0,.25].forEach((offset) => { context.beginPath(); context.arc(width * offset, width * .12, width * .055, 0, Math.PI * 2); context.fill(); });
        context.restore();
    }

    function drawDiamond(context, x, y, radius, color, rotation = 0) {
        context.save(); context.globalCompositeOperation = 'source-over'; context.translate(x, y); context.rotate(rotation); context.fillStyle = color;
        context.beginPath(); context.moveTo(0, -radius); context.lineTo(radius * .72, 0); context.lineTo(0, radius); context.lineTo(-radius * .72, 0); context.closePath(); context.fill(); context.restore();
    }

    const auraRenderCache = new Map();

    function drawAuraFrame(context, x, y, size, time, explicitId, alpha = 1) {
        if (window.flappyVisualEffectsEnabled?.('aura') === false) return;
        const id = explicitId || selectedAuraId();
        if (!ownsAura(id) && !explicitId) return;
        if (id === 'none' || !AURAS.some((entry) => entry.id === id)) return;
        const t = Number(time) || performance.now() / 16.67;
        const cx = x + size / 2;
        const cy = y + size / 2;
        const radius = size * .66;
        const reduced = Boolean(window.gameAccessibility?.reducedFlashing);
        const phase = t * .012;
        const particleScale = reduced ? .62 : 1;
        context.save();
        context.globalAlpha *= Math.max(.15, Math.min(1, Number(alpha) || 1));
        context.globalCompositeOperation = 'lighter';
        if (id === 'golden-spark') {
            context.shadowColor = '#ffbf32'; context.shadowBlur = size * .15;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,phase,'#ffb829',size*.045,.66,[size*.14,size*.07]);
            drawOrbitTrail(context,cx,cy,radius*.91,radius*.66,-phase*.7,'#ffe986',size*.022,.74,[size*.05,size*.06]);
            for (let index=0; index<(reduced?2:3); index+=1) { const angle=phase*.7+index*Math.PI*2/3; const p=orbitPoint(cx,cy,radius,radius*.72,angle); drawCrescent(context,p.x,p.y,size*.105,'#ffe06d',angle+.6); }
            for (let index=0; index<(reduced?4:8); index+=1) { const angle=-phase+index*Math.PI*2/8; const p=orbitPoint(cx,cy,radius*(.82+(index%2)*.2),radius*.72*(.82+(index%2)*.2),angle); drawSpark(context,p.x,p.y,size*(index%3? .035:.065),'#fff4a7',angle); }
        } else if (id === 'grove-orbit') {
            context.shadowColor='#47e46a'; context.shadowBlur=size*.13;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,phase*.52,'#36b84c',size*.055,.58,[size*.21,size*.045]);
            drawOrbitTrail(context,cx,cy,radius*.91,radius*.66,-phase*.34,'#a5f45a',size*.018,.72);
            for(let index=0;index<(reduced?4:7);index+=1){const angle=phase*.55+index*Math.PI*2/7;const p=orbitPoint(cx,cy,radius,radius*.72,angle);drawLeaf(context,p.x,p.y,size*(index%3===0?.18:.14),index%2?'#76e94e':'#b8f26b',angle+Math.PI/2);}
            for(let index=0;index<(reduced?1:3);index+=1){const angle=-phase*.8+index*Math.PI*2/3;const p=orbitPoint(cx,cy,radius*.88,radius*.64,angle);context.fillStyle='#8ffcff';context.beginPath();context.arc(p.x,p.y,size*.035,0,Math.PI*2);context.fill();}
        } else if (id === 'starbound-ring') {
            context.shadowColor='#42a5ff'; context.shadowBlur=size*.16;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,phase*.36,'#2086ff',size*.045,.65);
            drawOrbitTrail(context,cx,cy,radius*.9,radius*.64,-phase*.5,'#8ed9ff',size*.02,.72,[size*.08,size*.04]);
            const stars=reduced?4:6; for(let index=0;index<stars;index+=1){const angle=phase*.55+index*Math.PI*2/stars;const p=orbitPoint(cx,cy,radius,radius*.72,angle);drawFivePointStar(context,p.x,p.y,size*(index%3===0?.13:.09),index%2?'#e2f7ff':'#67bfff',-angle);}
        } else if (id === 'royal-ascendant') {
            context.shadowColor='#b346ff'; context.shadowBlur=size*.2;
            drawOrbitTrail(context,cx,cy,radius,radius*.73,0,'#751ed6',size*.07,.46,[size*.18,size*.045]);
            drawOrbitTrail(context,cx,cy,radius*.9,radius*.65,-phase*.28,'#ef72ff',size*.025,.72);
            for(let index=0;index<(reduced?4:7);index+=1){const angle=-phase*.55+index*Math.PI*2/7;const p=orbitPoint(cx,cy,radius,radius*.72,angle);context.strokeStyle=index%2?'#ff82ed':'#963cff';context.lineWidth=size*.038;context.beginPath();context.moveTo(p.x,p.y);context.quadraticCurveTo(p.x+Math.cos(angle+.8)*size*.22,p.y+Math.sin(angle+.8)*size*.22,p.x+Math.cos(angle)*size*.11,p.y+Math.sin(angle)*size*.11);context.stroke();}
            drawCrown(context,cx,cy-radius*.77,size*.52,'#ffb92f');
            drawDiamond(context,cx,cy+radius*.76,size*.15,'#d36cff',Math.sin(phase*.4)*.16);
        } else if (id === 'prismatic-sovereign') {
            const colors=['#5ff4ff','#8d91ff','#ff65de','#ffd86a','#72f5a2'];
            context.shadowBlur=size*.18;
            colors.forEach((color,index)=>{context.shadowColor=color;drawOrbitTrail(context,cx,cy,radius*(1-index*.027),radius*.72*(1-index*.027),phase*(.16+index*.025)+index*.18,color,size*(.026-index*.002),.58,[size*.22,size*.06]);});
            for(let index=0;index<(reduced?4:8);index+=1){const angle=-phase*.55+index*Math.PI/4;const p=orbitPoint(cx,cy,radius*(index%2?.84:1.02),radius*.72*(index%2?.84:1.02),angle); if(index%2) {context.fillStyle=colors[index%colors.length];context.beginPath();context.arc(p.x,p.y,size*.055,0,Math.PI*2);context.fill();} else drawSpark(context,p.x,p.y,size*.08,colors[index%colors.length],angle);}
            drawDiamond(context,cx,cy+radius*.77,size*.19,'#8beaff',phase*.18); drawDiamond(context,cx,cy+radius*.77,size*.105,'#ef65ff',-phase*.22);
            drawSpark(context,cx,cy-radius*.78,size*.12,'#fff0a0',phase*.12);
        } else if (id === 'inferno-halo') {
            context.shadowColor='#ff4a11'; context.shadowBlur=size*.18;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,0,'#ff5718',size*.075,.72);
            drawOrbitTrail(context,cx,cy,radius*.9,radius*.64,phase*.18,'#ffd15b',size*.023,.82);
            const flames=reduced?8:15; for(let index=0;index<flames;index+=1){const angle=phase*.38+index*Math.PI*2/flames;const p=orbitPoint(cx,cy,radius,radius*.72,angle);const length=size*(.15+(Math.sin(phase*2+index*2.3)+1)*.038);context.save();context.globalCompositeOperation='source-over';context.translate(p.x,p.y);context.rotate(angle+Math.PI/2);context.fillStyle=index%3?'#ff5b13':'#ff9a23';context.beginPath();context.moveTo(0,-length);context.quadraticCurveTo(length*.54,-length*.26,0,length*.22);context.quadraticCurveTo(-length*.44,-length*.15,0,-length);context.fill();context.fillStyle='#ffe05c';context.beginPath();context.moveTo(0,-length*.65);context.quadraticCurveTo(length*.24,-length*.18,0,length*.08);context.quadraticCurveTo(-length*.2,-length*.12,0,-length*.65);context.fill();context.restore();}
            context.fillStyle='#ffb12a';for(let index=0;index<(reduced?4:10);index+=1){const angle=-phase*.7+index*.91;const p=orbitPoint(cx,cy,radius*(.92+(index%3)*.1),radius*.72*(.92+(index%3)*.1),angle);context.globalAlpha*=.55;context.beginPath();context.arc(p.x,p.y,size*(.012+(index%3)*.006),0,Math.PI*2);context.fill();context.globalAlpha/=.55;}
        } else if (id === 'frost-veil') {
            context.shadowColor='#95d9ff';context.shadowBlur=size*.1;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,phase*.22,'#b8efff',size*.055,.5,[size*.16,size*.04]);
            drawOrbitTrail(context,cx,cy,radius*.9,radius*.64,-phase*.3,'#69aaff',size*.022,.76);
            const flakes=reduced?3:5;for(let index=0;index<flakes;index+=1){const angle=phase*.34+index*Math.PI*2/flakes;const p=orbitPoint(cx,cy,radius,radius*.72,angle);drawSnowflake(context,p.x,p.y,size*(index%2?.09:.112),'#effcff',-phase*.4+index);}
            context.fillStyle='#e8fbff';for(let index=0;index<(reduced?4:9);index+=1){const angle=-phase*.65+index*.73;const p=orbitPoint(cx,cy,radius*(.72+(index%4)*.1),radius*.72*(.72+(index%4)*.1),angle);context.beginPath();context.arc(p.x,p.y,size*.014,0,Math.PI*2);context.fill();}
        } else if (id === 'neon-voltage') {
            context.lineCap='round';context.lineJoin='round';context.shadowBlur=size*.18;
            ['#1be8ff','#ff45df'].forEach((color,layer)=>{context.shadowColor=color;context.strokeStyle=color;context.lineWidth=size*(layer?.028:.038);context.beginPath();const points=reduced?18:32;for(let index=0;index<=points;index+=1){const angle=phase*(layer?-1:.9)+index*Math.PI*2/points;const jag=(index%2?1.07:.91)+(Math.sin(index*5.3+phase*4)*.035);const p=orbitPoint(cx,cy,radius*jag,radius*.72*jag,angle);if(!index)context.moveTo(p.x,p.y);else context.lineTo(p.x,p.y);}context.closePath();context.stroke();});
            for(let index=0;index<(reduced?3:7);index+=1){const angle=phase*1.3+index*.91;const p=orbitPoint(cx,cy,radius*1.03,radius*.74,angle);drawSpark(context,p.x,p.y,size*.04,index%2?'#ff9ced':'#d7fbff',angle);}
        } else if (id === 'tropical-bloom') {
            context.shadowColor='#9ddd40';context.shadowBlur=size*.12;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,phase*.12,'#6cab2d',size*.07,.5,[size*.22,size*.025]);
            drawOrbitTrail(context,cx,cy,radius*.91,radius*.65,-phase*.16,'#ffd641',size*.022,.64);
            for(let index=0;index<(reduced?5:9);index+=1){const angle=phase*.22+index*Math.PI*2/9;const p=orbitPoint(cx,cy,radius,radius*.72,angle);drawLeaf(context,p.x,p.y,size*(index%2?.13:.17),index%3?'#72da3e':'#b6ef5e',angle+Math.PI/2);}
            const flowers=reduced?3:4;for(let index=0;index<flowers;index+=1){const angle=-phase*.12+index*Math.PI*2/flowers+.35;const p=orbitPoint(cx,cy,radius*.98,radius*.7,angle);drawFlower(context,p.x,p.y,size*(index===0?.13:.105),index%3===0?'#ff6eaa':index%3===1?'#ff93c0':'#ffd04b','#fff08a',phase*.15+index);}
        } else if (id === 'shadow-wisp') {
            context.lineCap='round';context.shadowColor='#a755ff';context.shadowBlur=size*.2;
            const wisps=reduced?3:4;for(let index=0;index<wisps;index+=1){const angle=-phase*.48+index*Math.PI*2/wisps;const head=orbitPoint(cx,cy,radius,radius*.72,angle);const tail=orbitPoint(cx,cy,radius*.66,radius*.47,angle+.82);const color=index%2?'#6f27cf':'#bb62ff';context.strokeStyle=color;context.lineWidth=size*.09;context.globalAlpha*=.62;context.beginPath();context.moveTo(tail.x,tail.y);context.quadraticCurveTo(cx+Math.cos(angle+.5)*radius*.96,cy+Math.sin(angle+.5)*radius*.67,head.x,head.y);context.stroke();context.globalAlpha/=.62;context.strokeStyle='#e199ff';context.lineWidth=size*.026;context.beginPath();context.moveTo(tail.x,tail.y);context.quadraticCurveTo(cx+Math.cos(angle+.55)*radius*.91,cy+Math.sin(angle+.55)*radius*.64,head.x,head.y);context.stroke();context.fillStyle='#c16cff';context.beginPath();context.arc(head.x,head.y,size*.075,0,Math.PI*2);context.fill();drawSpark(context,head.x,head.y,size*.035,'#fff0ff',angle);}
        } else if (id === 'bubble-prism') {
            const bubbleColors=['#69f7ff','#fff38c','#f66eff','#76a8ff'];
            const bubbles=reduced?6:10;for(let index=0;index<bubbles;index+=1){const angle=phase*(.24+(index%3)*.035)+index*Math.PI*2/bubbles;const orbit=radius*(.82+(index%3)*.095);const p=orbitPoint(cx,cy,orbit,orbit*.72,angle);const bubbleRadius=size*(.05+(index%4)*.018);context.strokeStyle=bubbleColors[index%bubbleColors.length];context.lineWidth=Math.max(1,size*.018);context.shadowColor=bubbleColors[(index+2)%bubbleColors.length];context.shadowBlur=size*.07;context.globalAlpha*=.78;context.beginPath();context.arc(p.x,p.y,bubbleRadius,0,Math.PI*2);context.stroke();context.globalAlpha/=.78;context.strokeStyle=bubbleColors[(index+1)%bubbleColors.length];context.lineWidth=Math.max(.7,size*.008);context.beginPath();context.arc(p.x,p.y,bubbleRadius*.76,.4,2.1);context.stroke();context.fillStyle='rgba(255,255,255,.72)';context.beginPath();context.arc(p.x-bubbleRadius*.32,p.y-bubbleRadius*.32,bubbleRadius*.18,0,Math.PI*2);context.fill();}
        } else if (id === 'meteor-crown') {
            context.shadowColor='#ff9d21';context.shadowBlur=size*.22;
            drawOrbitTrail(context,cx,cy,radius,radius*.72,phase*.2,'#ff8b16',size*.04,.48,[size*.2,size*.06]);
            for(let meteor=0;meteor<2;meteor+=1){const angle=phase*.65+meteor*Math.PI;const head=orbitPoint(cx,cy,radius,radius*.72,angle);context.strokeStyle=meteor?'#ffb62f':'#ff7d14';context.lineWidth=size*.085;context.lineCap='round';context.globalAlpha*=.7;context.beginPath();context.moveTo(head.x,head.y);for(let step=1;step<=4;step+=1){const tail=orbitPoint(cx,cy,radius*(1-step*.055),radius*.72*(1-step*.055),angle-step*.17);context.lineTo(tail.x,tail.y);}context.stroke();context.globalAlpha/=.7;context.globalCompositeOperation='source-over';context.fillStyle='#9b2f0c';context.beginPath();context.arc(head.x,head.y,size*.105,0,Math.PI*2);context.fill();context.fillStyle='#ffb52f';context.beginPath();context.arc(head.x-size*.016,head.y-size*.016,size*.073,0,Math.PI*2);context.fill();context.fillStyle='#fff7b0';context.beginPath();context.arc(head.x-size*.038,head.y-size*.038,size*.025,0,Math.PI*2);context.fill();context.globalCompositeOperation='lighter';}
            context.fillStyle='#d8791e';for(let index=0;index<(reduced?4:9);index+=1){const angle=-phase*.32+index*.7;const p=orbitPoint(cx,cy,radius*(.82+(index%3)*.12),radius*.72*(.82+(index%3)*.12),angle);drawDiamond(context,p.x,p.y,size*(.022+(index%3)*.009),'#e99a34',angle);}
        }
        context.shadowBlur = 0;
        context.globalAlpha = Math.max(.15, Math.min(1, Number(alpha) || 1));
        context.restore();
    }

    function drawAura(context, x, y, size, time, explicitId, alpha = 1) {
        if (window.flappyVisualEffectsEnabled?.('aura') === false) return;
        const id = explicitId || selectedAuraId();
        if ((!explicitId && !ownsAura(id)) || id === 'none' || !AURAS.some((entry) => entry.id === id)) return;
        const requestedSize = Math.max(12, Number(size) || 12);
        const cacheSize = Math.max(12, Math.round(requestedSize));
        const reduced = Boolean(window.gameAccessibility?.reducedFlashing);
        // Aura artwork is cached at roughly 12 FPS while the game keeps
        // rendering at its normal frame rate. The motion remains smooth at
        // cosmetic scale, while snowflakes, shadows, and multiplayer auras no
        // longer rebuild expensive paths every display frame.
        const frameStep = reduced ? 8 : 5;
        const rawTime = Number(time) || performance.now() / 16.67;
        const frameBucket = Math.floor(rawTime / frameStep);
        const margin = Math.ceil(cacheSize * .9);
        const dimension = cacheSize + margin * 2;
        const cacheKey = `${id}:${cacheSize}:${reduced ? 'reduced' : 'full'}`;
        let cached = auraRenderCache.get(cacheKey);
        if (!cached) {
            const canvas = document.createElement('canvas');
            canvas.width = dimension;
            canvas.height = dimension;
            cached = { canvas, context:canvas.getContext('2d'), frameBucket:-1 };
            auraRenderCache.set(cacheKey, cached);
            if (auraRenderCache.size > 24) auraRenderCache.delete(auraRenderCache.keys().next().value);
        }
        if (cached.frameBucket !== frameBucket) {
            cached.context.clearRect(0, 0, dimension, dimension);
            drawAuraFrame(cached.context, margin, margin, cacheSize, frameBucket * frameStep, id, 1);
            cached.frameBucket = frameBucket;
        }
        const scale = requestedSize / cacheSize;
        context.save();
        context.globalAlpha *= Math.max(.15, Math.min(1, Number(alpha) || 1));
        context.drawImage(cached.canvas, x - margin * scale, y - margin * scale, dimension * scale, dimension * scale);
        context.restore();
    }

    const WEATHER_TYPES = Object.freeze([
        { id:'sunny', name:'Sunny', icon:'☀️', weight:24 }, { id:'rain', name:'Rain', icon:'🌧️', weight:20 },
        { id:'snow', name:'Snow', icon:'❄️', weight:16 }, { id:'thunderstorm', name:'Thunderstorm', icon:'⛈️', weight:12 },
        { id:'fog', name:'Fog', icon:'🌫️', weight:12 }, { id:'night', name:'Night', icon:'🌙', weight:8 },
        { id:'blood-moon', name:'Blood Moon', icon:'🔴', weight:3 }, { id:'aurora', name:'Aurora', icon:'🌌', weight:3 },
        { id:'meteor-shower', name:'Meteor Shower', icon:'☄️', weight:2 }
    ]);
    let activeWeather = null;
    let weatherVisualSeed = hashSeed(Date.now());
    let weatherBadgeTimer = 0;

    function weatherPreferences() {
        let settings = window.flappyVisualSettings || window.gameAccessibility;
        if (!settings) {
            try { settings = JSON.parse(localStorage.getItem('gameAccessibilitySettings') || '{}'); } catch (_) { settings = {}; }
        }
        const validMode = settings?.weatherMode === 'random' || WEATHER_TYPES.some((entry) => entry.id === settings?.weatherMode);
        return { enabled:settings?.showWeatherOverlays !== false, mode:validMode ? settings.weatherMode : 'random' };
    }

    function hashSeed(seed) {
        let value = Number(seed) >>> 0;
        value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
        value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
        return (value ^ (value >>> 16)) >>> 0;
    }

    function selectWeather(seed, forceId) {
        if (forceId) return WEATHER_TYPES.find((entry) => entry.id === forceId) || null;
        const hash = hashSeed(seed);
        if (hash % 1000 >= 300) return null;
        let roll = hashSeed(hash ^ 0x9e3779b9) % WEATHER_TYPES.reduce((sum, entry) => sum + entry.weight, 0);
        for (const entry of WEATHER_TYPES) {
            roll -= entry.weight;
            if (roll < 0) return entry;
        }
        return WEATHER_TYPES[0];
    }

    function showWeatherBadge(weather) {
        let badge = document.getElementById('flappyWeatherBadge');
        if (!weather || !weatherPreferences().enabled) {
            badge?.classList.remove('show');
            return;
        }
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'flappyWeatherBadge';
            badge.className = 'flappy-weather-badge';
            document.body.appendChild(badge);
        }
        const playfield = document.getElementById('canvas');
        if (playfield) {
            const rect = playfield.getBoundingClientRect();
            badge.style.left = `${rect.left + rect.width / 2}px`;
            badge.style.top = `${Math.max(14, rect.top + 18)}px`;
        }
        badge.innerHTML = `<span>${weather.icon}</span><span>${escapeHtml(weather.name)} Weather <small>visual overlay</small></span>`;
        badge.classList.add('show');
        clearTimeout(weatherBadgeTimer);
        weatherBadgeTimer = setTimeout(() => badge.classList.remove('show'), 4200);
    }

    function menuIsCoveringPlayfield() {
        const ids=['skinMenu','titlesMenu','modeMenu','shopMenu','profileMenu','bananaPassMenu','inventoryMenu','settingsPopup','musicOptionsPopup','powerupsInfoPopup','collectionIndexPopup','onlineModesScreen','multiplayerScreen','monkeyWorldScreen','onlineDefenseScreen','towerDefenseScreen'];
        return ids.some(id=>{
            const element=document.getElementById(id);if(!element)return false;
            const style=getComputedStyle(element);
            return style.display!=='none'&&style.visibility!=='hidden'&&element.getAttribute('aria-hidden')!=='true';
        });
    }

    function dismissWeatherBadgeForMenu() {
        window.setTimeout(()=>{
            if (!menuIsCoveringPlayfield()) return;
            clearTimeout(weatherBadgeTimer);
            document.getElementById('flappyWeatherBadge')?.classList.remove('show');
        },0);
    }

    function startWeather(seed = Date.now(), forceId = '') {
        const preferences = weatherPreferences();
        if (!preferences.enabled) {
            endWeather();
            return null;
        }
        weatherVisualSeed = hashSeed(seed);
        const selectedId = forceId || (preferences.mode === 'random' ? '' : preferences.mode);
        activeWeather = selectWeather(seed, selectedId);
        showWeatherBadge(activeWeather);
        return activeWeather;
    }

    function endWeather() {
        activeWeather = null;
        clearTimeout(weatherBadgeTimer);
        document.getElementById('flappyWeatherBadge')?.classList.remove('show');
    }

    function drawWeather(context, width, height, time, stage = 'front', explicitWeather) {
        if (!weatherPreferences().enabled) return;
        const weather = typeof explicitWeather === 'string' ? WEATHER_TYPES.find((entry) => entry.id === explicitWeather) : explicitWeather || activeWeather;
        if (!weather) return;
        const t = Number(time) || performance.now() / 16.67;
        const reduced = Boolean(window.gameAccessibility?.reducedFlashing);
        const count = reduced ? 20 : 44;
        context.save();
        if (stage === 'back') {
            if (weather.id === 'sunny') {
                const sunX = width * .79, sunY = height * .14, sunRadius = Math.max(22, height * .075);
                const glow = context.createRadialGradient(sunX, sunY, 3, sunX, sunY, width * .56);
                glow.addColorStop(0, 'rgba(255,255,225,.72)'); glow.addColorStop(.12, 'rgba(255,238,138,.4)'); glow.addColorStop(.48, 'rgba(255,205,68,.13)'); glow.addColorStop(1, 'rgba(255,219,85,0)');
                context.fillStyle = glow; context.fillRect(0, 0, width, height);
                context.save(); context.translate(sunX, sunY); context.rotate(t * .0018);
                context.strokeStyle = 'rgba(255,241,149,.2)'; context.lineWidth = Math.max(7, sunRadius * .2);
                for (let ray = 0; ray < 12; ray += 1) { context.rotate(Math.PI / 6); context.beginPath(); context.moveTo(sunRadius * 1.45, 0); context.lineTo(sunRadius * (2.35 + (ray % 3) * .25), 0); context.stroke(); }
                context.restore();
                const disc = context.createRadialGradient(sunX - sunRadius * .25, sunY - sunRadius * .25, 2, sunX, sunY, sunRadius);
                disc.addColorStop(0, 'rgba(255,255,239,.95)'); disc.addColorStop(.55, 'rgba(255,232,112,.84)'); disc.addColorStop(1, 'rgba(255,184,45,.18)');
                context.fillStyle = disc; context.beginPath(); context.arc(sunX, sunY, sunRadius, 0, Math.PI * 2); context.fill();
            } else if (['night','meteor-shower','aurora'].includes(weather.id)) {
                context.fillStyle = 'rgba(2,4,35,.56)'; context.fillRect(0, 0, width, height);
                context.fillStyle = 'rgba(225,240,255,.86)';
                for (let index = 0; index < 52; index += 1) {
                    const x = hashSeed(index * 991 + 17) % width, y = hashSeed(index * 577 + 91) % Math.floor(height * .72);
                    context.globalAlpha = .28 + (Math.sin(t * .03 + index) + 1) * .28;
                    context.fillRect(x, y, index % 5 === 0 ? 2 : 1, index % 5 === 0 ? 2 : 1);
                }
                context.globalAlpha = 1;
            } else if (weather.id === 'blood-moon') {
                const moonX = width * .78, moonY = height * .17, moonRadius = height * .115;
                const sky = context.createLinearGradient(0, 0, 0, height);
                sky.addColorStop(0, 'rgba(39,0,18,.62)'); sky.addColorStop(.58, 'rgba(63,3,20,.42)'); sky.addColorStop(1, 'rgba(28,0,12,.5)');
                context.fillStyle = sky; context.fillRect(0, 0, width, height);
                const halo = context.createRadialGradient(moonX, moonY, moonRadius * .45, moonX, moonY, moonRadius * 2.8);
                halo.addColorStop(0, 'rgba(255,82,70,.38)'); halo.addColorStop(.42, 'rgba(210,30,48,.18)'); halo.addColorStop(1, 'rgba(120,0,20,0)');
                context.fillStyle = halo; context.beginPath(); context.arc(moonX, moonY, moonRadius * 2.8, 0, Math.PI * 2); context.fill();
                const moon = context.createRadialGradient(moonX - moonRadius * .28, moonY - moonRadius * .32, 2, moonX, moonY, moonRadius);
                moon.addColorStop(0, '#ffd1bb'); moon.addColorStop(.48, '#ed6959'); moon.addColorStop(.82, '#aa1d34'); moon.addColorStop(1, '#5b0b25');
                context.fillStyle = moon; context.beginPath(); context.arc(moonX, moonY, moonRadius, 0, Math.PI * 2); context.fill();
                context.fillStyle = 'rgba(82,7,28,.2)';
                for (let crater = 0; crater < 7; crater += 1) { const angle = (hashSeed(crater * 733 + weatherVisualSeed) % 628) / 100; const radius = moonRadius * (.12 + (crater % 3) * .035); context.beginPath(); context.arc(moonX + Math.cos(angle) * moonRadius * .55, moonY + Math.sin(angle) * moonRadius * .52, radius, 0, Math.PI * 2); context.fill(); }
            } else if (weather.id === 'rain' || weather.id === 'thunderstorm') {
                const rainTint = context.createLinearGradient(0, 0, 0, height);
                if (weather.id === 'thunderstorm') {
                    rainTint.addColorStop(0, 'rgba(12,14,48,.52)'); rainTint.addColorStop(1, 'rgba(28,38,67,.34)');
                } else {
                    rainTint.addColorStop(0, 'rgba(24,73,93,.28)'); rainTint.addColorStop(.55, 'rgba(31,82,98,.17)'); rainTint.addColorStop(1, 'rgba(18,61,76,.25)');
                }
                context.fillStyle = rainTint; context.fillRect(0, 0, width, height);
                context.fillStyle = weather.id === 'thunderstorm' ? 'rgba(112,124,165,.07)' : 'rgba(183,224,230,.065)';
                for (let band = 0; band < 3; band += 1) {
                    const cloudY = height * (.03 + band * .075) + Math.sin(t * .0028 + band * 2.1) * 8;
                    context.beginPath(); context.ellipse(width * (.18 + band * .34), cloudY, width * .34, height * .09, 0, 0, Math.PI * 2); context.fill();
                }
            } else if (weather.id === 'snow') {
                context.fillStyle = 'rgba(210,232,255,.17)'; context.fillRect(0, 0, width, height);
            } else if (weather.id === 'fog') {
                const fogWash = context.createLinearGradient(0, 0, 0, height);
                fogWash.addColorStop(0, 'rgba(197,218,223,.055)'); fogWash.addColorStop(.52, 'rgba(208,226,226,.12)'); fogWash.addColorStop(1, 'rgba(183,207,208,.18)');
                context.fillStyle = fogWash; context.fillRect(0, 0, width, height);
                for (let layer = 0; layer < 4; layer += 1) {
                    const fog = context.createRadialGradient(width * (.18 + layer * .23), height * (.3 + layer * .17), 0, width * (.18 + layer * .23), height * (.3 + layer * .17), width * .45);
                    fog.addColorStop(0, `rgba(226,239,237,${.065 + layer * .012})`); fog.addColorStop(1, 'rgba(226,239,237,0)'); context.fillStyle = fog; context.fillRect(0, 0, width, height);
                }
            }
            if (weather.id === 'aurora') {
                context.globalCompositeOperation = 'lighter';
                for (let band = 0; band < 5; band += 1) {
                    const gradient = context.createLinearGradient(0, 0, width, height * .5);
                    const colors=['rgba(50,255,183,.23)','rgba(103,135,255,.21)','rgba(247,82,255,.18)','rgba(58,255,215,.2)','rgba(255,222,116,.14)'];
                    gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(.28, colors[band]); gradient.addColorStop(.64, colors[(band + 2) % colors.length]);
                    gradient.addColorStop(1, 'rgba(0,0,0,0)');
                    context.strokeStyle = gradient; context.lineWidth = 12 + band * 5;
                    context.shadowColor = ['#4dffc2','#7699ff','#ee7dff','#64ffe0','#ffe391'][band]; context.shadowBlur = 9;
                    context.beginPath();
                    for (let x = -20; x <= width + 20; x += 12) {
                        const y = height * (.13 + band * .058) + Math.sin(x * (.014 + band * .0015) + t * (.008 + band * .001) + band) * (22 + band * 6) + Math.sin(x * .031 - t * .005) * 10;
                        if (x < 0) context.moveTo(x, y); else context.lineTo(x, y);
                    }
                    context.stroke();
                }
                context.shadowBlur = 0;
            }
        } else {
            if (weather.id === 'rain' || weather.id === 'thunderstorm') {
                const thunder = weather.id === 'thunderstorm';
                const rainCount = reduced ? (thunder ? 24 : 30) : (thunder ? 58 : 72);
                context.lineCap = 'round';
                for (let index = 0; index < rainCount; index += 1) {
                    const depth = .35 + (hashSeed(index * 131 + 29) % 66) / 100;
                    const speed = (thunder ? 15 : 10.5) * depth;
                    const drift = (thunder ? 8.5 : 5.5) * depth;
                    const x = ((hashSeed(index * 341 + 13) % (width + 180)) + t * drift) % (width + 180) - 90;
                    const y = ((hashSeed(index * 797 + 31) % (height + 110)) + t * speed) % (height + 110) - 55;
                    const length = (thunder ? 24 : 17) + depth * (thunder ? 23 : 19);
                    const slant = length * (thunder ? .34 : .27);
                    context.globalAlpha = .28 + depth * (thunder ? .6 : .48);
                    context.strokeStyle = thunder ? '#d6ddff' : (index % 5 === 0 ? '#d8f8ff' : '#9eddeb');
                    context.lineWidth = .45 + depth * (thunder ? 1.55 : 1.05);
                    context.beginPath(); context.moveTo(x, y); context.lineTo(x - slant, y + length); context.stroke();
                }
                context.globalAlpha = 1;
                if (!thunder) {
                    const splashCount = reduced ? 4 : 10;
                    context.strokeStyle = 'rgba(183,238,248,.48)'; context.lineWidth = 1;
                    for (let index = 0; index < splashCount; index += 1) {
                        const cycle = ((t * (.018 + (index % 3) * .002)) + (hashSeed(index * 499 + 73) % 100) / 100) % 1;
                        const x = hashSeed(index * 953 + weatherVisualSeed) % width;
                        const y = height * (.88 + (hashSeed(index * 281 + 9) % 9) / 100);
                        context.globalAlpha = (1 - cycle) * .52;
                        context.beginPath(); context.ellipse(x, y, 2 + cycle * 12, .8 + cycle * 3.2, 0, 0, Math.PI * 2); context.stroke();
                    }
                    context.globalAlpha = 1;
                }
                if (weather.id === 'thunderstorm' && !reduced && Math.floor(t) % 211 < 3) {
                    const strikeNumber = Math.floor(t / 211);
                    const strikeSeed = hashSeed(weatherVisualSeed ^ Math.imul(strikeNumber + 1, 0x9e3779b1));
                    const startX = width * (.16 + (strikeSeed % 690) / 1000);
                    const bendOne = startX + (((hashSeed(strikeSeed ^ 0x51f15e5d) % 201) - 100) / 1000) * width;
                    const bendTwo = bendOne + (((hashSeed(strikeSeed ^ 0x7f4a7c15) % 181) - 90) / 1000) * width;
                    const endX = bendTwo + (((hashSeed(strikeSeed ^ 0x27d4eb2f) % 241) - 120) / 1000) * width;
                    context.fillStyle = 'rgba(226,232,255,.28)'; context.fillRect(0, 0, width, height);
                    context.strokeStyle = '#edf2ff'; context.lineWidth = 3; context.shadowColor = '#9eaaff'; context.shadowBlur = 16;
                    context.beginPath(); context.moveTo(startX, -10); context.lineTo(bendOne, height * .16); context.lineTo(bendTwo, height * .25); context.lineTo(endX, height * (.39 + (strikeSeed % 9) * .012)); context.stroke();
                }
            } else if (weather.id === 'snow') {
                context.fillStyle = 'rgba(245,252,255,.9)'; context.shadowColor = '#b7ddff'; context.shadowBlur = 6;
                for (let index = 0; index < count; index += 1) {
                    const x = ((hashSeed(index * 613 + 5) % width) + Math.sin(t * .025 + index) * 22 + width) % width;
                    const y = ((hashSeed(index * 919 + 19) % (height + 30)) + t * (1.1 + index % 4 * .22)) % (height + 30) - 15;
                    const radius = 1.2 + index % 4 * .55; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
                }
            } else if (weather.id === 'fog') {
                for (let band = 0; band < 7; band += 1) {
                    const gradient = context.createLinearGradient(0, 0, width, 0);
                    gradient.addColorStop(0, 'rgba(220,235,233,0)'); gradient.addColorStop(.28, `rgba(220,235,233,${.045 + band * .009})`); gradient.addColorStop(.58, `rgba(236,244,241,${.085 + band * .01})`); gradient.addColorStop(1, 'rgba(220,235,233,0)');
                    context.fillStyle = gradient;
                    const x = Math.sin(t * (.0035 + band * .00035) + band * 1.7) * width * .22;
                    const y = height * (.08 + band * .135) + Math.sin(t * .004 + band) * 8;
                    context.beginPath(); context.ellipse(x + width * .5, y, width * .72, height * (.065 + band * .004), 0, 0, Math.PI * 2); context.fill();
                }
            } else if (weather.id === 'meteor-shower') {
                context.lineCap = 'round';
                for (let index = 0; index < (reduced ? 3 : 7); index += 1) {
                    const phase = (t * (.8 + index * .08) + index * 170) % (width + height);
                    const x = width + 100 - phase, y = -80 + phase * .55 + index * 28;
                    const gradient = context.createLinearGradient(x, y, x + 90, y - 50);
                    gradient.addColorStop(0, '#fff4b0'); gradient.addColorStop(.25, '#ff9a3e'); gradient.addColorStop(1, 'rgba(255,110,30,0)');
                    context.strokeStyle = gradient; context.lineWidth = 3 + index % 3; context.shadowColor = '#ff8d32'; context.shadowBlur = 14;
                    context.beginPath(); context.moveTo(x, y); context.lineTo(x + 90, y - 50); context.stroke();
                }
            } else if (weather.id === 'sunny') {
                context.fillStyle = 'rgba(255,244,161,.55)';
                for (let index = 0; index < 18; index += 1) {
                    const x = (hashSeed(index * 877 + 41) % width + Math.sin(t * .012 + index) * 15 + width) % width;
                    const y = (hashSeed(index * 389 + 7) % height + t * .18 * (1 + index % 3)) % height;
                    context.beginPath(); context.arc(x, y, 1 + index % 3, 0, Math.PI * 2); context.fill();
                }
                context.globalAlpha = .22; context.fillStyle = '#fffbd1';
                for (let flare = 0; flare < 4; flare += 1) { const x = width * (.72 - flare * .12), y = height * (.18 + flare * .09), radius = 3 + flare * 2.2; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); }
                context.globalAlpha = 1;
            } else if (weather.id === 'aurora') {
                context.globalCompositeOperation = 'lighter';
                for (let index = 0; index < (reduced ? 8 : 22); index += 1) {
                    const x = (hashSeed(index * 811 + weatherVisualSeed) % width + Math.sin(t * .009 + index) * 18 + width) % width;
                    const y = height * (.08 + (hashSeed(index * 367 + 21) % 58) / 100);
                    const pulse = .35 + (Math.sin(t * .028 + index * 1.8) + 1) * .3;
                    context.globalAlpha = pulse; context.fillStyle = index % 3 === 0 ? '#f3a4ff' : index % 3 === 1 ? '#7fffd2' : '#b9d7ff';
                    drawSpark(context, x, y, 2 + index % 4, context.fillStyle, t * .01 + index);
                }
                context.globalAlpha = 1;
            } else if (weather.id === 'blood-moon') {
                context.fillStyle = 'rgba(255,83,76,.48)';
                for (let index = 0; index < (reduced ? 8 : 20); index += 1) {
                    const x = (hashSeed(index * 887 + weatherVisualSeed) % width + Math.sin(t * .008 + index) * 12 + width) % width;
                    const y = ((hashSeed(index * 433 + 15) % height) - t * (.12 + index % 4 * .03) + height) % height;
                    context.globalAlpha = .22 + (index % 5) * .08; context.beginPath(); context.arc(x, y, .8 + index % 3 * .55, 0, Math.PI * 2); context.fill();
                }
                context.globalAlpha = 1;
            }
        }
        context.restore();
    }

    function hookExistingMenus() {
        if (typeof refreshSkinMenu === 'function' && !refreshSkinMenu.__masteryWrapped) {
            const original = refreshSkinMenu;
            const wrapped = function refreshSkinMenuWithMastery(...args) {
                const result = original.apply(this, args);
                decorateSkinMenu();
                return result;
            };
            wrapped.__masteryWrapped = true;
            refreshSkinMenu = wrapped;
        }
        if (typeof refreshShopGrid === 'function' && !refreshShopGrid.__auraWrapped) {
            const original = refreshShopGrid;
            const wrapped = function refreshShopGridWithAuras(...args) {
                registerUnlockedEventCosmetics();
                const result = original.apply(this, args);
                renderAuraMarket();
                renderEventVault();
                renderMonkeyXpMarket();
                return result;
            };
            wrapped.__auraWrapped = true;
            refreshShopGrid = wrapped;
        }
    }

    window.FlappyMastery = Object.freeze({
        thresholds:XP_THRESHOLDS,
        xpPerScore:XP_PER_SCORE,
        addXp:addSkinXp,
        addScore,
        progress:progressFor,
        masteredCount,
        decorateSkinMenu
    });
    window.FlappyAuras = Object.freeze({
        definitions:AURAS,
        xpPacks:MONKEY_XP_PACKS,
        eventCosmetics:EVENT_COSMETICS,
        owns:ownsAura,
        selectedId:selectedAuraId,
        select:selectAura,
        setOwned:setAuraOwned,
        draw:drawAura,
        renderMarket:renderAuraMarket,
        renderXpMarket:renderMonkeyXpMarket,
        renderEventVault,
        grantEventCosmetic,
        setEventCosmeticOwned,
        flushOwned:flushOwnership,
        ownsEventCosmetic:(id) => ownedEventCosmetics.has(id)
    });
    window.FlappyWeather = Object.freeze({
        definitions:WEATHER_TYPES,
        selectForSeed:selectWeather,
        startRun:startWeather,
        endRun:endWeather,
        current:() => activeWeather,
        draw:drawWeather
    });

    injectMarketTabs();
    registerUnlockedEventCosmetics();
    hookExistingMenus();
    window.addEventListener('flappy-skins-changed', () => { decorateSkinMenu(); renderAuraMarket(); });
    window.addEventListener('flappy-collection-changed', (event) => {
        const category = event.detail?.category;
        if (category !== 'skin-mastery') mastery = masteryData();
        if (category === 'skin-mastery' || category === 'auras' || category === 'event-cosmetic') {
            if (document.getElementById('aurasGrid')?.style.display !== 'none') renderAuraMarket();
            if (document.getElementById('eventVaultGrid')?.style.display !== 'none') renderEventVault();
        }
    });
    window.addEventListener('pagehide', persistMasteryNow);
    window.addEventListener('beforeunload', persistMasteryNow);
    document.addEventListener('click', dismissWeatherBadgeForMenu, true);
    document.addEventListener('keydown', dismissWeatherBadgeForMenu, true);
    window.addEventListener('flappy-visual-settings-changed', (event) => {
        if (event.detail?.key === 'showWeatherOverlays' && event.detail.value === false) endWeather();
    });
})();
