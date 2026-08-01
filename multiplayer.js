(() => {
    'use strict';

    const accountStorage = window.FlappyAccountStorage;
    if (!accountStorage) throw new Error('Per-account storage failed to load.');

    const CONFIGURED_SERVER = String(window.FLAPPY_MONKEY_ONLINE?.serverUrl || '').trim() || 'ws://localhost:8080';
    const SAVED_SERVER = String(localStorage.getItem('flappyOnlineServer') || '').trim();
    const DEFAULT_SERVER = !SAVED_SERVER || /^ws:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(SAVED_SERVER)
        ? CONFIGURED_SERVER
        : SAVED_SERVER;
    const SESSION_PREFIX = 'flappyOnlineSession:';
    const PROFILE_PREFIX = 'flappyOnlineProfile:';
    const PENDING_OFFLINE_RESET_PREFIX = 'flappyPendingOfflineReset:';
    const REQUIRE_LOGIN_AFTER_LOGOUT_KEY = 'flappyRequireLoginAfterLogout';
    const GUEST_SESSION_READY_KEY = 'flappyGuestSessionReady';
    const WIDTH = 420;
    const HEIGHT = 620;
    const GROUND_Y = 550;
    const MONKEY_X = 60;
    const MONKEY_SIZE = 72;
    const PIPE_WIDTH = 68;
    const RACE_GRAVITY = 0.09;
    const RACE_JUMP = -4.0;
    const STEP = 1000 / 60;
    const CONNECTION_TIMEOUT_MS = 75_000;
    const RECONNECT_OVERLAY_GRACE_MS = 4_500;
    const GLOBAL_CHAT_SESSION_STARTED_AT = Date.now();
    const PENDING_MOBILE_SCORE_KEY = 'flappyPendingMobileSkinScore';
    const LOCAL_MOBILE_DEVICE = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    function normalizedServerAddress(value) {
        return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
    }

    function sameServerAddress(first, second) {
        return Boolean(first && second && normalizedServerAddress(first) === normalizedServerAddress(second));
    }

    function clearStoredLoginForServer(url) {
        const serverUrl = String(url || '').trim();
        if (!serverUrl) return;
        const keys = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key) keys.push(key);
        }
        for (const key of keys) {
            if (key.startsWith(SESSION_PREFIX) && sameServerAddress(key.slice(SESSION_PREFIX.length), serverUrl)) {
                localStorage.removeItem(key);
            } else if (key.startsWith(PROFILE_PREFIX) && sameServerAddress(key.slice(PROFILE_PREFIX.length), serverUrl)) {
                localStorage.removeItem(key);
            }
        }
    }

    function readBestCachedProfile(url = DEFAULT_SERVER) {
        const exact = readJson(PROFILE_PREFIX + url, null);
        const activeIdentity = accountStorage.readActiveAccount(localStorage);
        // A cached profile is never enough to select account progress. Without
        // the active per-account identity this is a guest session, and exposing
        // stale account data here can let guest defaults overwrite that account.
        if (!activeIdentity || !sameServerAddress(activeIdentity.serverUrl, url)) return null;
        const exactForActiveAccount = exact?.id === activeIdentity.accountId ? exact : null;
        if (exactForActiveAccount) return exactForActiveAccount;

        let matchingProfile = null;
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith(PROFILE_PREFIX)) continue;
            if (!sameServerAddress(key.slice(PROFILE_PREFIX.length), url)) continue;
            const candidate = readJson(key, null);
            if (candidate?.id === activeIdentity.accountId) {
                matchingProfile = candidate;
                break;
            }
        }

        const durableIdentity = accountStorage.readCachedIdentity(localStorage, activeIdentity);
        return {
            ...(matchingProfile || {}),
            id: activeIdentity.accountId,
            username: String(matchingProfile?.username || durableIdentity?.username || localStorage.getItem('customUsername') || ''),
            profilePicture: String(matchingProfile?.profilePicture || localStorage.getItem('profilePic') || ''),
            usernameCanChangeAt: Math.max(0, Number(matchingProfile?.usernameCanChangeAt ?? durableIdentity?.usernameCanChangeAt) || 0)
        };
    }

    const state = {
        socket: null,
        socketUrl: DEFAULT_SERVER,
        connecting: null,
        playerId: null,
        authenticated: false,
        onlineOptIn: sessionStorage.getItem('flappyOnlineOptIn') === 'yes',
        account: readBestCachedProfile(DEFAULT_SERVER),
        room: null,
        pendingRoomSettings: null,
        roomSettingsRevision: 0,
        social: { friends: [], incoming: [], outgoing: [], blocked: [], groups: [], messages: [] },
        activeFriendId: null,
        activeGroupId: null,
        pendingMessageAttachment: null,
        pendingMessageDraft: null,
        pendingGroupIcon: null,
        editingGroupId: null,
        pendingGroupAction: false,
        pendingProfileAction: null,
        publicProfile: null,
        pendingSocialAction: false,
        pendingOwnerAction: false,
        pendingOwnerReset: null,
        pendingRedeem: false,
        redeemNotice: '',
        redeemNoticeKind: '',
        pendingGift: null,
        inbox: { gifts: [], receipts: [], announcements: [] },
        activityFeed: [],
        party: null,
        partyInvitations: [],
        ranked: null,
        rankedTiers: [],
        rankedLeaderboard: [],
        rankedQueued: false,
        liveEvent: null,
        liveEvents: [],
        liveEventDefinitions: {},
        clan: null,
        clanInvitations: [],
        pendingClanIcon: null,
        pendingClanBanner: null,
        dangerAction: null,
        serverOffset: 0,
        serverProtocolVersion: 0,
        serverBuild: '',
        serverCapabilities: [],
        socialMessageMediaCache: new Map(),
        socialProfilePictureCache: new Map(),
        socialGroupIconCache: new Map(),
        deletedSocialMessageIds: new Set(),
        clearedFriendConversations: new Map(),
        pendingChatAction: null,
        toastTimer: null
    };

    const race = {
        active: false,
        started: false,
        matchId: null,
        seed: 0,
        settings: null,
        localStartAt: 0,
        lastTick: 0,
        accumulator: 0,
        frame: 0,
        y: 250,
        velocity: 0,
        score: 0,
        alive: true,
        lives: 1,
        invincibleUntil: 0,
        respawnUntil: 0,
        passed: new Set(),
        pipeSchedule: [],
        remotes: new Map(),
        deathEffects: [],
        lastStateSentAt: 0,
        animationFrame: null,
        resultOpen: false
    };
    const monkeyWorld = {
        active: false,
        joined: false,
        world: null,
        players: new Map(),
        messages: [],
        x: 1600,
        y: 1120,
        direction: 'down',
        keys: new Set(),
        touchX: 0,
        touchY: 0,
        touchPointerId: null,
        lastTick: 0,
        lastSentAt: 0,
        animationFrame: null,
        chatBubbles: new Map(),
        images: new Map(),
        nearbyBuilding: null,
        pausedForMenu: false,
        menuReturnTimer: null,
        lastRosterSyncAt: 0,
        cameraX: 0,
        cameraY: 0,
        moving: false,
        walkTime: 0,
        currentInterior: null,
        interiorX: 50,
        interiorY: 80,
        nearbyInteriorStation: null,
        onlineHubReturn: false,
        resumeAfterReconnect: null,
        pendingChatText: '',
        pendingChatNeedsResend: false
    };
    const onlineDefense = {
        room: null,
        rank: null,
        leaderboard: [],
        active: false,
        selectedTower: 'scout',
        enemies: [],
        wave: 0,
        lives: 20,
        score: 0,
        spawnRemaining: 0,
        nextSpawnAt: 0,
        nextWaveAt: 0,
        localStartAt: 0,
        lastFrameAt: 0,
        lastSimulationAt: 0,
        lastProgressAt: 0,
        towerCooldowns: new Map(),
        towerAbilityCooldowns: new Map(),
        towerAttackCounts: new Map(),
        towerPartyMeters: new Map(),
        towerRhythm: new Map(),
        towerBossSlayerUntil: new Map(),
        towerOrnaments: new Map(),
        towerNextOrnamentAt: new Map(),
        timedBuffs: {},
        animationFrame: null,
        simulationTimer: null,
        resultOpen: false,
        completed: false,
        readySent: false,
        selectedPlacementId: null,
        awaitingWaveStart: true,
        simulationSpeed: 1,
        shots: [],
        effects: [],
        traps: [],
        weather: null,
        lastWeatherWave: -10,
        screenShakeUntil: 0,
        kills: 0,
        hoverPoint: null,
        bananaRewardsEarned: 0,
        clearedWave: 0,
        treasureIndex: -1,
        spawnedThisWave: 0,
        globalFreezeUntil: 0,
        rallyUntil: 0,
        powers: {
            repair: { uses: 2, readyWave: 0 },
            freeze: { uses: 2, readyWave: 0 },
            bomb: { uses: 2, readyWave: 0 },
            rally: { uses: 2, readyWave: 0 }
        }
    };
    let pendingRegistration = null;
    let lastCosmeticsSignature = '';
    let lastOnlineProfileDispatchSignature = '';
    let liveEventListExpanded = false;
    let queuedCosmeticsSyncForce = false;
    let cosmeticsSyncTimer = null;
    let reconnectTimer = null;
    let reconnectOverlayTimer = null;
    let reconnectAttempt = 0;
    let pendingOfflineResetSubmitting = false;
    let onlineConsentResolve = null;
    let lastProfilePictureUpload = '';
    const startupReadyAt = Date.now() + 1700;

    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
    }

    function currentSkin() {
        return localStorage.getItem('selectedMonkeySkin') || 'Default Monkey.png';
    }

    function currentTitle() {
        return localStorage.getItem('selectedTitle') || 'None';
    }

    function normalizedTitleStyle(value) {
        const source = value && typeof value === 'object' ? value : {};
        const allowedFx = new Set(['none', 'fire', 'sparkle', 'glitch', 'neonpulse']);
        const fx = allowedFx.has(String(source.fx || '').toLowerCase()) ? String(source.fx).toLowerCase() : 'none';
        const color = /^#[0-9a-f]{6}$/i.test(String(source.color || '')) ? String(source.color).toLowerCase() : '#ffffff';
        return {
            fx,
            color,
            glow: Boolean(source.glow),
            rgb: Boolean(source.rgb),
            rgbSpeed: Math.max(.35, Math.min(8, Number(source.rgbSpeed) || 1.5))
        };
    }

    function currentTitleStyle() {
        return normalizedTitleStyle({
            fx: localStorage.getItem('selectedTitleFX') || 'none',
            color: localStorage.getItem('customTitleColor') || '#ffffff',
            glow: localStorage.getItem('titleGlowEnabled') === 'true',
            rgb: localStorage.getItem('titleRGBEnabled') === 'true',
            rgbSpeed: Number(localStorage.getItem('titleRGBSpeed')) || 1.5
        });
    }

    function baseGameIsActivelyRunning() {
        try {
            return typeof started !== 'undefined'
                && Boolean(started)
                && !(typeof gameOverFlag !== 'undefined' && gameOverFlag)
                && !(typeof victory !== 'undefined' && victory);
        } catch (_) {
            return false;
        }
    }

    function scheduleAccountCosmeticsSync(force = false) {
        queuedCosmeticsSyncForce ||= Boolean(force);
        clearTimeout(cosmeticsSyncTimer);
        cosmeticsSyncTimer = setTimeout(() => {
            cosmeticsSyncTimer = null;
            if (baseGameIsActivelyRunning()) {
                scheduleAccountCosmeticsSync(queuedCosmeticsSyncForce);
                return;
            }
            const shouldForce = queuedCosmeticsSyncForce;
            queuedCosmeticsSyncForce = false;
            syncAccountCosmetics(shouldForce);
        }, baseGameIsActivelyRunning() ? 3500 : 650);
    }

    function buildAccountSyncProfile() {
        accountStorage.snapshotActiveAccount?.(localStorage);
        const cloudProgress = typeof accountStorage.exportCloudProgress === 'function'
            ? accountStorage.exportCloudProgress(localStorage)
            : {};
        return {
            skin: currentSkin(),
            equippedTitle: currentTitle(),
            titleStyle: currentTitleStyle(),
            totalXP: Math.max(0, Number.parseInt(localStorage.getItem('monkeyXP') || '0', 10) || 0),
            progressRevision: Math.max(0, Math.floor(Number(state.account?.progressRevision) || 0)),
            unlockedSkins: typeof monkeySkins !== 'undefined' ? monkeySkins.filter((skin) => skin.unlocked).map((skin) => skin.name).slice(0, 500) : [],
            customEmojiIds: [...(typeof window.flappyOwnedCustomEmojiIds === 'function' ? window.flappyOwnedCustomEmojiIds() : [])],
            showcase: buildProfileShowcase(),
            cloudProgress
        };
    }

    function syncAccountCosmetics(force = false) {
        if (!state.authenticated || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
        const profile = buildAccountSyncProfile();
        const cloudProgress = profile.cloudProgress;
        const signature = `${profile.skin}\n${profile.equippedTitle}\n${JSON.stringify(profile.titleStyle)}\n${profile.totalXP}\n${profile.unlockedSkins.join('|')}\n${profile.customEmojiIds.join('|')}\n${JSON.stringify(profile.showcase)}\n${JSON.stringify(cloudProgress)}`;
        if (!force && signature === lastCosmeticsSignature) return;
        lastCosmeticsSignature = signature;
        send({ type: 'update_account_profile', ...profile });
    }

    function buildProfileShowcase() {
        const numeric = (key) => Math.max(0, Number.parseInt(localStorage.getItem(key) || '0', 10) || 0);
        const unlockedNames = (collection, name = 'name') => Array.isArray(collection) ? collection.filter((item) => item?.unlocked).map((item) => item[name] || item.name).filter(Boolean) : [];
        const achievements = typeof window.flappyUnlockedAchievementNames === 'function'
            ? window.flappyUnlockedAchievementNames()
            : readJson('unlockedAchievements', []);
        return {
            statistics: {
                'Banana Coins': typeof monkeyCoins !== 'undefined' ? Math.max(0, Math.floor(Number(monkeyCoins) || 0)) : numeric('monkeyCoins'),
                'Best Score': numeric('highScore'),
                'Games Played': numeric('gamesPlayed'),
                'Total Score': numeric('totalScore'),
                'Pipes Passed': numeric('totalPipesPassed'),
                'Bananas Collected': numeric('totalBananas'),
                'Total XP': numeric('monkeyXP'),
                'Tower Defense Best Wave': numeric('towerDefenseBestWave'),
                'Tower Defense Wins': numeric('towerDefenseWins')
            },
            badgeMetrics: {
                normalPipes: numeric('totalPipesPassed'),
                bananaCoinsSpent: numeric('lifetimeBananaCoinsSpent'),
                season1FreeClaims: readJson('bananaPassFreeClaims', []).length,
                ghostPowerups: numeric('totalGhostCollected'),
                firePowerups: numeric('totalFireCollected'),
                glitchPowerups: numeric('totalGlitchCollected')
            },
            achievements: (Array.isArray(achievements) ? achievements : []).map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean),
            inventory: {
                skins: typeof monkeySkins !== 'undefined' ? unlockedNames(monkeySkins) : [],
                titles: typeof titles !== 'undefined' ? unlockedNames(titles) : [],
                pipeSkins: typeof pipeThemes !== 'undefined' ? unlockedNames(pipeThemes) : [],
                titleStyles: typeof titleFXOptions !== 'undefined' ? unlockedNames(titleFXOptions) : [],
                themes: typeof profileBackgrounds !== 'undefined' ? unlockedNames(profileBackgrounds) : [],
                trails: typeof trails !== 'undefined' ? unlockedNames(trails) : [],
                explosionVfx: typeof explosionVfxOptions !== 'undefined' ? unlockedNames(explosionVfxOptions) : [],
                equippedExplosionVfx: typeof explosionVfxOptions !== 'undefined' ? [explosionVfxOptions.find((effect) => effect.id === selectedExplosionVfx)?.name || 'No Explosion'] : [],
                emojis: (window.flappyCustomEmojis || []).filter((emoji) => profileOwnsEmoji(emoji.id)).map((emoji) => emoji.name),
                boosts: { 'Extra Life Tickets': numeric('extraLifeTokens'), 'Banana Doubler Tickets': numeric('coinDoublerTickets'), 'Score Booster Tickets': numeric('scoreBoosterTickets'), '2x Monkey XP Tokens': numeric('xpBoostTokens'), 'Crate Luck Boosts': numeric('crateLuckBoostTokens'), 'Revive Tokens': numeric('reviveTokens') }
            }
        };
    }

    function profileOwnsEmoji(id) {
        return typeof window.flappyOwnedCustomEmojiIds === 'function' && window.flappyOwnedCustomEmojiIds().has(id);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
    }

    function platformBadgeHtml(platform) {
        const kind = platform === 'mobile' ? 'mobile' : platform === 'pc' ? 'pc' : '';
        if (!kind) return '';
        const label = kind === 'mobile' ? 'Playing on mobile' : 'Playing on PC';
        return `<span class="mp-platform-badge ${kind}" role="img" aria-label="${label}" title="${label}"></span>`;
    }

    function drawPlatformBadge(context, x, y, platform, size = 17) {
        if (!['mobile', 'pc'].includes(platform)) return;
        context.save();
        context.translate(x, y);
        context.lineWidth = Math.max(1.5, size * .11);
        context.strokeStyle = platform === 'mobile' ? '#7cfff0' : '#9fc7ff';
        context.fillStyle = 'rgba(6,25,35,.94)';
        if (platform === 'mobile') {
            context.beginPath();
            context.roundRect(-size * .32, -size * .48, size * .64, size * .96, size * .13);
            context.fill(); context.stroke();
            context.fillStyle = '#eaff9b';
            context.fillRect(-size * .10, size * .31, size * .20, size * .055);
        } else {
            context.beginPath();
            context.roundRect(-size * .48, -size * .38, size * .96, size * .65, size * .08);
            context.fill(); context.stroke();
            context.beginPath();
            context.moveTo(-size * .19, size * .47);
            context.lineTo(size * .19, size * .47);
            context.moveTo(0, size * .27);
            context.lineTo(0, size * .47);
            context.stroke();
        }
        context.restore();
    }

    function sharedTitleHtml(profile, extraClass = '') {
        const title = String(profile?.equippedTitle || '').trim();
        if (!title || title.toLowerCase() === 'none') return '';
        const style = normalizedTitleStyle(profile?.titleStyle);
        const classes = [
            'mp-equipped-title',
            'mp-shared-title',
            `mp-title-fx-${style.fx}`,
            style.glow ? 'mp-title-glow' : '',
            style.rgb ? 'mp-title-rgb' : '',
            extraClass
        ].filter(Boolean).join(' ');
        const seconds = Math.max(.35, Math.min(8, style.rgbSpeed)).toFixed(2);
        return `<span class="${classes}" style="--mp-title-color:${style.color};--mp-title-speed:${seconds}s">${escapeHtml(title)}</span>`;
    }

    function localTitleProfile() {
        return { equippedTitle: currentTitle(), titleStyle: currentTitleStyle() };
    }

    function applySharedTitleUpdate(profile, update) {
        return profile?.id === update.userId || profile?.profileId === update.userId
            ? { ...profile, equippedTitle: update.equippedTitle, titleStyle: normalizedTitleStyle(update.titleStyle) }
            : profile;
    }

    function applyLiveTitleUpdate(update) {
        if (!update?.userId) return;
        state.activityFeed = state.activityFeed.map((entry) =>
            entry.userId === update.userId ? { ...entry, equippedTitle: update.equippedTitle, titleStyle: update.titleStyle } : entry
        );
        for (const key of ['friends', 'incoming', 'outgoing', 'blocked']) {
            state.social[key] = (state.social[key] || []).map((profile) => applySharedTitleUpdate(profile, update));
        }
        state.social.groups = (state.social.groups || []).map((group) => ({
            ...group,
            members: (group.members || []).map((profile) => applySharedTitleUpdate(profile, update))
        }));
        if (state.party) state.party.members = (state.party.members || []).map((profile) => applySharedTitleUpdate(profile, update));
        if (state.clan) state.clan.members = (state.clan.members || []).map((profile) => applySharedTitleUpdate(profile, update));
        if (state.room) state.room.players = (state.room.players || []).map((profile) => applySharedTitleUpdate(profile, update));
        if (onlineDefense.room) onlineDefense.room.players = (onlineDefense.room.players || []).map((profile) => applySharedTitleUpdate(profile, update));
        if (state.publicProfile) state.publicProfile = applySharedTitleUpdate(state.publicProfile, update);
        for (const [id, player] of monkeyWorld.players) monkeyWorld.players.set(id, applySharedTitleUpdate(player, update));
        monkeyWorld.messages = monkeyWorld.messages.map((message) =>
            message.fromId === update.userId ? { ...message, equippedTitle: update.equippedTitle, titleStyle: update.titleStyle } : message
        );
        if (state.account?.id === update.userId) state.account = { ...state.account, equippedTitle: update.equippedTitle, titleStyle: update.titleStyle };
        renderProfile();
        if (state.room) renderLobby();
        if (onlineDefense.room) renderDefenseRoom();
        if (elements.mpActivityModal.classList.contains('open')) renderActivityFeed();
        if (elements.mpSocialCenter.classList.contains('open')) renderSocial();
        if (monkeyWorld.joined) renderMonkeyWorldChat();
        if (state.publicProfile && elements.mpPublicProfileModal.classList.contains('open')) renderPublicProfile(state.publicProfile);
    }

    function rankIconSource(ranked = {}) {
        const rankName = String(ranked.rank || ranked.name || '').toLowerCase().replace(/[^a-z]/g, ' ').trim();
        if (rankName === 'monkey king') return 'rank-icons/monkeyking.svg';
        const match = /^(bronze|silver|gold|platinum|diamond|master|champion) (i|ii|iii)$/.exec(rankName);
        if (match) return `rank-icons/${match[1]}${match[2] === 'i' ? '' : `-${match[2]}`}.svg`;
        return String(ranked.icon || 'rank-icons/bronze.svg');
    }

    function messageHtml(value) {
        return typeof window.flappyRenderMessageText === 'function'
            ? window.flappyRenderMessageText(value)
            : escapeHtml(value).replace(/\n/g, '<br>');
    }

    function messageCanvasText(value) {
        let text = String(value || '');
        for (const emoji of window.flappyCustomEmojis || []) text = text.split(emoji.token).join(`[${emoji.name}]`);
        return text;
    }

    function canvasMessageParts(value, characterBudget = 40) {
        const emojis = window.flappyCustomEmojis || [];
        const parts = [];
        let remaining = String(value || '');
        let budget = characterBudget;
        while (remaining && budget > 0) {
            let match = null;
            for (const emoji of emojis) {
                const index = remaining.indexOf(emoji.token);
                if (index >= 0 && (!match || index < match.index)) match = { index, emoji };
            }
            if (!match) {
                const text = remaining.slice(0, budget);
                if (text) parts.push({ type:'text', text });
                break;
            }
            const text = remaining.slice(0, match.index).slice(0, budget);
            if (text) { parts.push({ type:'text', text }); budget -= text.length; }
            if (budget <= 0) break;
            parts.push({ type:'emoji', emoji:match.emoji });
            remaining = remaining.slice(match.index + match.emoji.token.length);
        }
        return parts;
    }

    function sanitizeOutgoingMessage(value) {
        let text = String(value || '');
        const owned = typeof window.flappyOwnedCustomEmojiIds === 'function' ? window.flappyOwnedCustomEmojiIds() : new Set();
        let removedLockedEmoji = false;
        for (const emoji of window.flappyCustomEmojis || []) {
            if (owned.has(emoji.id)) continue;
            if (text.includes(emoji.token)) removedLockedEmoji = true;
            text = text.split(emoji.token).join('');
        }
        if (removedLockedEmoji) showToast('Buy that custom emoji in the Banana Market before using it.', true);
        return text.trim();
    }

    const installedEmojiPickers = [];
    function ownedMessageEmojis() {
        const owned = typeof window.flappyOwnedCustomEmojiIds === 'function' ? window.flappyOwnedCustomEmojiIds() : new Set();
        return (window.flappyCustomEmojis || []).filter((emoji) => owned.has(emoji.id));
    }

    function insertMessageEmoji(input, token) {
        const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        const leading = start > 0 && !/\s/.test(input.value[start - 1]) ? ' ' : '';
        const trailing = end < input.value.length && !/\s/.test(input.value[end]) ? ' ' : '';
        input.setRangeText(`${leading}${token}${trailing}`, start, end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }

    function renderEmojiPicker(picker) {
        const owned = typeof window.flappyOwnedCustomEmojiIds === 'function' ? window.flappyOwnedCustomEmojiIds() : new Set();
        const emojis = window.flappyCustomEmojis || [];
        picker.panel.innerHTML = emojis.length
            ? emojis.map((emoji) => {
                const unlocked = owned.has(emoji.id);
                return `<button type="button" data-message-emoji="${escapeHtml(emoji.id)}" title="${escapeHtml(unlocked ? emoji.name : `${emoji.name} - buy for 25 Bananas in the Banana Market`)}"${unlocked ? '' : ' class="locked" disabled aria-disabled="true"'}><img src="${escapeHtml(emoji.file)}" alt="${escapeHtml(emoji.name)}"><span>${escapeHtml(emoji.name)}${unlocked ? '' : '<small>LOCKED - 25 Bananas</small>'}</span></button>`;
            }).join('')
            : '<div class="fm-emoji-empty">No custom emojis are available yet.</div>';
    }

    function installEmojiPicker(form, input) {
        if (!form || !input || form.querySelector('.fm-emoji-picker')) return;
        const picker = document.createElement('div');
        picker.className = 'fm-emoji-picker';
        picker.innerHTML = '<button class="fm-emoji-toggle" type="button" title="Custom emojis" aria-label="Open custom emoji picker">🐵</button><div class="fm-emoji-panel" aria-hidden="true"></div>';
        const submit = form.querySelector('button[type="submit"]');
        form.insertBefore(picker, submit || null);
        const record = { root: picker, panel: picker.querySelector('.fm-emoji-panel'), input };
        installedEmojiPickers.push(record);
        renderEmojiPicker(record);
        picker.querySelector('.fm-emoji-toggle').addEventListener('click', () => {
            const opening = !picker.classList.contains('open');
            document.querySelectorAll('.fm-emoji-picker.open').forEach((other) => other.classList.remove('open'));
            picker.classList.toggle('open', opening);
            record.panel.setAttribute('aria-hidden', String(!opening));
        });
        record.panel.addEventListener('click', (event) => {
            const button = event.target.closest('[data-message-emoji]');
            if (!button) return;
            const emoji = (window.flappyCustomEmojis || []).find((item) => item.id === button.dataset.messageEmoji);
            if (emoji) insertMessageEmoji(input, emoji.token);
            picker.classList.remove('open');
            record.panel.setAttribute('aria-hidden', 'true');
        });
    }

    const multiplayerButton = document.createElement('button');
    multiplayerButton.id = 'multiplayerBtn';
    multiplayerButton.type = 'button';
    multiplayerButton.textContent = '🌐 Online Race';
    const monkeyWorldButton = document.createElement('button');
    monkeyWorldButton.id = 'monkeyWorldBtn';
    monkeyWorldButton.type = 'button';
    const onlineDefenseButton = document.createElement('button');
    onlineDefenseButton.id = 'onlineDefenseBtn';
    onlineDefenseButton.type = 'button';
    onlineDefenseButton.textContent = 'Online Defense';
    const onlineHubButton = document.createElement('button');
    onlineHubButton.id = 'onlineHubBtn';
    onlineHubButton.type = 'button';
    onlineHubButton.textContent = 'Online';
    monkeyWorldButton.textContent = '🏝️ Monkey World';
    const muteButton = document.getElementById('muteBtn');
    const mainButtons = muteButton?.closest('.button-row') || document.querySelector('.button-row');
    if (mainButtons) {
        if (muteButton?.parentElement === mainButtons) {
            mainButtons.insertBefore(onlineHubButton, muteButton);
        } else {
            mainButtons.appendChild(onlineHubButton);
        }
    }
    const onlinePopulation = document.createElement('div');
    onlinePopulation.id = 'onlinePopulation';
    onlinePopulation.textContent = '🐵 Offline';
    if (mainButtons?.parentElement) mainButtons.insertAdjacentElement('afterend', onlinePopulation);

    function fitLobbyNavigation() {
        if (!mainButtons) return;
        const buttons = [...mainButtons.querySelectorAll(':scope > button')];
        const compactMobileViewport = window.innerWidth <= 760 || (window.innerHeight <= 520 && window.innerWidth > window.innerHeight);
        mainButtons.style.setProperty('width', compactMobileViewport ? '100%' : 'min(1360px, calc(100vw - 32px))', 'important');
        mainButtons.style.setProperty('max-width', 'none', 'important');
        if (window.innerWidth >= 900 && !compactMobileViewport) {
            mainButtons.style.setProperty('flex-wrap', 'wrap', 'important');
            mainButtons.style.setProperty('justify-content', 'center', 'important');
            mainButtons.style.setProperty('gap', '8px', 'important');
            buttons.forEach((button) => {
                button.style.setProperty('flex', '0 0 auto', 'important');
                button.style.setProperty('min-width', 'max-content', 'important');
                button.style.setProperty('padding-left', '12px', 'important');
                button.style.setProperty('padding-right', '12px', 'important');
                button.style.setProperty('font-size', 'clamp(10px, .9vw, 13px)', 'important');
                button.style.setProperty('letter-spacing', '0', 'important');
                button.style.setProperty('white-space', 'nowrap', 'important');
            });
        } else {
            mainButtons.style.setProperty('flex-wrap', 'wrap', 'important');
            mainButtons.style.setProperty('justify-content', 'center', 'important');
            mainButtons.style.setProperty('gap', '7px', 'important');
            buttons.forEach((button) => {
                button.style.setProperty('flex', '1 1 135px', 'important');
                button.style.setProperty('min-width', '0', 'important');
                button.style.setProperty('white-space', 'normal', 'important');
                button.style.setProperty('line-height', '1.15', 'important');
            });
        }
    }
    fitLobbyNavigation();
    window.addEventListener('resize', fitLobbyNavigation);

    document.body.insertAdjacentHTML('beforeend', `
        <section id="onlineStartupGate" class="unlocked" aria-hidden="true">
            <div id="startupSplash" class="startup-splash">
                <div class="startup-logo">FLAPPY<br>MONKEY</div>
                <img class="startup-monkey" src="${escapeHtml(currentSkin())}" alt="Flappy Monkey">
                <div id="startupLoadingText" class="startup-loading">Connecting your online profile</div>
                <button id="startupSplashOffline" class="mp-secondary" type="button">Play Offline</button>
            </div>
            <div id="startupAuth" class="startup-auth mp-card">
                <div class="startup-auth-head"><h1>WELCOME, MONKEY!</h1><p>An online account is required only for multiplayer and connected features. The base game always works offline.</p></div>
                <div class="startup-server-row"><input id="startupServerUrl" type="url" value="${escapeHtml(DEFAULT_SERVER)}" spellcheck="false" placeholder="wss://your-server.example"><button id="startupReconnect" class="mp-secondary" type="button">Connect</button></div>
                <div class="mp-auth-layout">
                    <form id="startupLoginForm" class="mp-card mp-form">
                        <h3>Log In</h3>
                        <label>Username or email<input id="startupLoginUsername" type="text" maxlength="254" autocomplete="username" required></label>
                        <label>Password<input id="startupLoginPassword" type="password" maxlength="72" autocomplete="current-password" required></label>
                        <button class="mp-primary" type="submit">Log In & Play</button>
                    </form>
                    <form id="startupRegisterForm" class="mp-card mp-form">
                        <h3>Create Profile</h3>
                        <label>Username<input id="startupRegisterUsername" type="text" minlength="3" maxlength="18" autocomplete="username" required></label>
                        <label>Email<input id="startupRegisterEmail" type="email" maxlength="254" autocomplete="email" required></label>
                        <label>Password<input id="startupRegisterPassword" type="password" minlength="8" maxlength="72" autocomplete="new-password" placeholder="8+ characters, including a number" required></label>
                        <label>Confirm password<input id="startupRegisterConfirm" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></label>
                        <button id="startupRegisterSubmit" class="mp-primary" type="submit">Create Account & Play</button>
                    </form>
                </div>
                <div id="startupAuthError" class="startup-auth-error"></div>
                <p class="mp-note warning">Guest progress is temporary and is erased when the game reloads. Log in or create an account to keep purchases, unlocks, and progress. Your password is sent only to the configured account server; internet servers must use <strong>wss://</strong>.</p>
                <button id="startupStayOffline" class="mp-secondary" type="button" style="display:block;margin:12px auto 0">Play as Guest (Does Not Save)</button>
            </div>
            <form id="startupVerify" class="startup-auth mp-card">
                <div class="startup-auth-head"><h1>CHECK YOUR EMAIL</h1><p id="startupVerifyText">Enter the six-digit code we sent you.</p></div>
                <div class="mp-form" style="max-width:430px;margin:0 auto">
                    <label>Verification code<input id="startupVerifyCode" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required style="text-align:center;font-size:30px;letter-spacing:.24em;font-weight:1000"></label>
                    <button id="startupVerifyButton" class="mp-primary" type="submit">Verify Email & Create Account</button>
                    <div class="mp-button-row"><button id="startupResendCode" class="mp-secondary" type="button">Resend Code</button><button id="startupCancelVerify" class="mp-danger" type="button">Start Over</button></div>
                    <div id="startupVerifyError" class="startup-auth-error"></div>
                </div>
            </form>
        </section>
        <div id="onlineConsentModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card mp-online-consent" role="dialog" aria-modal="true" aria-labelledby="onlineConsentTitle">
                <div class="mp-reward-burst">🌐</div>
                <h2 id="onlineConsentTitle">Go Online?</h2>
                <p id="onlineConsentText">This feature connects to the Flappy Monkey server. The normal base game does not need an internet connection.</p>
                <div class="mp-button-row"><button id="onlineConsentYes" class="mp-primary" type="button">Yes, Connect</button><button id="onlineConsentNo" class="mp-secondary" type="button">No, Stay Offline</button></div>
            </section>
        </div>
        <section id="onlineModesScreen" aria-hidden="true">
            <div class="online-hub-shell">
                <header class="online-hub-header"><div><h1>ONLINE MODES</h1><p>Choose where you want to play and connect with other monkeys.</p></div><div class="online-hub-actions"><button id="onlineHubSocial" class="mp-primary" type="button">Friends & Messages</button><button id="onlineHubClose" class="mp-secondary" type="button">Back to Game</button></div></header>
                <main class="online-hub-grid">
                    <article class="online-hub-card"><div class="online-hub-icon">&#127965;</div><div><h2>Monkey World</h2><p>Explore Banana Coast, walk around as your equipped monkey, enter buildings, and use world chat.</p></div><button id="onlineHubWorld" class="mp-primary" type="button">Enter Monkey World</button></article>
                    <article class="online-hub-card"><div class="online-hub-icon">&#128737;</div><div><h2>Online Monkey Defense</h2><p>Play ranked public versus or co-op defense, or invite a friend with a private room code.</p></div><button id="onlineHubDefense" class="mp-primary" type="button">Play Online Defense</button></article>
                    <article class="online-hub-card"><div class="online-hub-icon">&#127937;</div><div><h2>Online Race</h2><p>Race in private or ranked rooms, manage friends and clans, and view your online account.</p></div><button id="onlineHubRace" class="mp-primary" type="button">Open Online Race</button></article>
                </main>
            </div>
        </section>
        <section id="mpSocialCenter" class="mp-overlay" aria-hidden="true"><div class="mp-social-center-shell"><header><div><h1>FRIENDS & MESSAGES</h1><p>Your online friends, profiles, chats, parties, clans, gifts, and invites are available from every online mode.</p></div><button id="mpCloseSocialCenter" class="mp-secondary" type="button">Back to Mode</button></header><div id="mpSocialCenterHost"></div></div></section>
        <section id="multiplayerScreen" aria-hidden="true">
            <div class="mp-shell">
                <header class="mp-topbar">
                    <div class="mp-brand"><h1>ONLINE RACE</h1><p>Private 2–4 player Flappy Monkey matches</p></div>
                    <div class="mp-top-actions">
                        <div id="mpConnection" class="mp-connection">Offline</div>
                        <button id="mpBackBtn" class="mp-secondary" type="button">Back to Game</button>
                    </div>
                </header>

                <main id="mpAuthView" class="mp-card">
                    <h2>Online Account</h2>
                    <div class="mp-form" style="margin-bottom:16px">
                        <label>Multiplayer server
                            <input id="mpServerUrl" type="url" value="${escapeHtml(DEFAULT_SERVER)}" spellcheck="false" autocomplete="url" placeholder="wss://your-server.example">
                        </label>
                    </div>
                    <div class="mp-auth-layout">
                        <form id="mpLoginForm" class="mp-card mp-form">
                            <h3>Log In</h3>
                            <label>Username or email<input id="mpLoginUsername" type="text" maxlength="254" autocomplete="username" required></label>
                            <label>Password<input id="mpLoginPassword" type="password" maxlength="72" autocomplete="current-password" required></label>
                            <button class="mp-primary" type="submit">Log In</button>
                        </form>
                        <form id="mpRegisterForm" class="mp-card mp-form">
                            <h3>Create Account</h3>
                            <label>Username<input id="mpRegisterUsername" type="text" minlength="3" maxlength="18" autocomplete="username" required></label>
                            <label>Email<input id="mpRegisterEmail" type="email" maxlength="254" autocomplete="email" required></label>
                            <label>Password<input id="mpRegisterPassword" type="password" minlength="8" maxlength="72" autocomplete="new-password" placeholder="8+ characters, including a number" required></label>
                            <label>Confirm password<input id="mpRegisterConfirm" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></label>
                            <button class="mp-primary" type="submit">Create Online Profile</button>
                        </form>
                    </div>
                    <div id="mpAuthError" class="mp-error"></div>
                    <p class="mp-note warning">Passwords are never stored in the game. The server stores a salted scrypt hash, and this device stores only a revocable session token. Use a <strong>wss://</strong> server for internet play.</p>
                </main>

                <main id="mpHomeView" class="mp-hidden">
                    <div class="mp-account-summary mp-card">
                        <div><div class="mp-account-name" id="mpAccountName">Online Monkey</div><div style="color:#a9c4b2;font-size:12px">Persistent online profile</div></div>
                        <button id="mpLogoutBtn" class="mp-danger" type="button">Log Out</button>
                    </div>
                    <div id="mpStats" class="mp-stats" style="margin-bottom:18px"></div>
                    <div class="mp-home-grid">
                        <section class="mp-card mp-form">
                            <h2>Create Private Room</h2>
                            <p class="mp-note">You become the host and choose the victory modifier before starting.</p>
                            <button id="mpCreateRoomBtn" class="mp-primary" type="button">Create Room</button>
                        </section>
                        <section class="mp-card mp-form">
                            <h2>Join With Code</h2>
                            <label>Room code<input id="mpJoinCode" type="text" maxlength="5" autocomplete="off" spellcheck="false" placeholder="ABCDE" style="text-transform:uppercase;letter-spacing:.18em;font-weight:1000"></label>
                            <button id="mpJoinRoomBtn" class="mp-primary" type="button">Join Room</button>
                        </section>
                        <section class="mp-card mp-form mp-ranked-home">
                            <h2>Season 1 Ranked</h2>
                            <div id="mpRankedHomeSummary" class="mp-ranked-home-summary"></div>
                            <div class="mp-button-row"><button id="mpRankedQueue" class="mp-primary" type="button">Find Ranked Match</button><button id="mpOpenRanked" class="mp-secondary" type="button">Ranks & Leaderboard</button></div>
                        </section>
                    </div>
                    <section id="mpSocialPanel" class="mp-card mp-social-card">
                        <div class="mp-social-head"><div><h2>Friends & Messages</h2><p class="mp-note">Share your User ID with someone you trust, then add their User ID here.</p></div><div class="mp-add-friend"><input id="mpFriendUserId" type="text" maxlength="60" spellcheck="false" placeholder="Paste a friend's FMU_... User ID"><button id="mpAddFriendBtn" class="mp-primary" type="button">Send Request</button></div></div>
                        <div id="mpSocialError" class="mp-error"></div>
                        <div class="mp-social-layout">
                            <div class="mp-social-lists">
                                <section><h3>Friend Requests</h3><div id="mpFriendRequests" class="mp-social-list"></div></section>
                                <section><h3>Friends</h3><div id="mpFriends" class="mp-social-list"></div></section>
                                <section><div class="mp-list-heading"><h3>Party</h3><button id="mpCreateParty" class="mp-primary" type="button">Create</button></div><div id="mpParty" class="mp-social-list"></div></section>
                                <section><div class="mp-list-heading"><h3>Clan</h3><button id="mpOpenClan" class="mp-primary" type="button">Open</button></div><div id="mpClanSummary" class="mp-social-list"></div></section>
                                <section><div class="mp-list-heading"><h3>Group Chats</h3><button id="mpCreateGroup" class="mp-primary" type="button">New Group</button></div><div id="mpGroups" class="mp-social-list"></div></section>
                                <section><h3>Sent Requests</h3><div id="mpOutgoingRequests" class="mp-social-list"></div></section>
                                <section><h3>Blocked</h3><div id="mpBlockedUsers" class="mp-social-list"></div></section>
                            </div>
                            <section id="mpConversation" class="mp-conversation mp-empty-conversation">
                                <div class="mp-conversation-head"><h3 id="mpConversationTitle">Select a friend</h3><div><button id="mpGroupSettings" class="mp-secondary mp-hidden" type="button">Group Settings</button><button id="mpClearConversation" class="mp-danger mp-hidden" type="button">Clear Chat</button></div></div>
                                <div id="mpMessages" class="mp-messages"><div class="mp-empty-state">Choose a friend to view your private messages.</div></div>
                                <form id="mpMessageForm" class="mp-message-form mp-hidden"><input id="mpMessageFile" class="mp-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button id="mpMessageAttach" class="mp-attach-button" type="button" title="Attach an image or GIF" aria-label="Attach an image or GIF">📎</button><div class="mp-message-compose"><textarea id="mpMessageInput" maxlength="500" rows="2" placeholder="Write a message to your friend..."></textarea><div id="mpMessageAttachment" class="mp-attachment-preview mp-hidden"></div></div><button class="mp-primary" type="submit">Send</button></form>
                            </section>
                        </div>
                    </section>
                    <div id="mpHomeError" class="mp-error"></div>
                    <p class="mp-note">Private rooms only. Online races award account XP and clan quest score, but no Banana Coins, skins, campaign progress, or normal-mode records.</p>
                </main>

                <main id="mpLobbyView" class="mp-hidden">
                    <div class="mp-lobby-layout">
                        <section class="mp-card">
                            <h2 id="mpLobbyTitle">Private Room</h2>
                            <div id="mpRoomCode" class="mp-room-code">-----</div>
                            <button id="mpCopyRoomBtn" class="mp-secondary" type="button" style="width:100%">Copy Room Code</button>
                            <div id="mpPlayers" class="mp-players" style="margin-top:15px"></div>
                        </section>
                        <section class="mp-card mp-form">
                            <h2>Victory Modifier</h2>
                            <label>Win condition
                                <select id="mpVictorySelect">
                                    <option value="last_alive">Last Monkey Alive</option>
                                    <option value="target_score">First to Target Score</option>
                                    <option value="timed_score">Highest Score After Time Limit</option>
                                </select>
                            </label>
                            <div class="mp-rule-fields">
                                <label id="mpTargetField">Target score<input id="mpTargetScore" type="number" min="5" max="500" value="25"></label>
                                <label id="mpDurationField">Time limit (seconds)<input id="mpDuration" type="number" min="30" max="600" value="120"></label>
                                <label>Lives
                                    <select id="mpLivesSelect"><option value="1">One Life</option><option value="3">Three Lives</option></select>
                                </label>
                                <label>Pipe gap
                                    <select id="mpGapSelect"><option value="wide">Wide</option><option value="normal" selected>Normal</option><option value="tight">Tight</option><option value="tiny">Tiny</option></select>
                                </label>
                                <label>Moving pipes
                                    <select id="mpMovingPipes"><option value="off">Off</option><option value="on">Vertical Movement</option></select>
                                </label>
                                <label>Friendly Practice
                                    <select id="mpFriendlyPractice"><option value="off">Off</option><option value="on">On · Respawns</option></select>
                                </label>
                            </div>
                            <p id="mpRuleDescription" class="mp-note"></p>
                            <div class="mp-button-row mp-lobby-actions">
                                <button id="mpReadyBtn" class="mp-primary" type="button">Ready</button>
                                <button id="mpStartMatchBtn" class="mp-primary" type="button">Start Match</button>
                                <button id="mpLeaveRoomBtn" class="mp-danger" type="button">Leave Room</button>
                            </div>
                            <div id="mpLobbyError" class="mp-error"></div>
                        </section>
                    </div>
                </main>

                <main id="mpRaceView" class="mp-hidden">
                    <div class="mp-race-head">
                        <div id="mpRaceObjective" class="mp-objective">Get ready…</div>
                        <div id="mpRaceTimer" class="mp-race-timer"></div>
                    </div>
                    <div class="mp-race-stage">
                    <div class="mp-canvas-wrap"><canvas id="multiplayerCanvas" width="420" height="620"></canvas></div>
                        <aside id="mpRaceStandings" class="mp-race-standings"><h3>Live Standings</h3></aside>
                    </div>
                    <p class="mp-race-help">Press SPACE, controller A, or tap the race to flap. Online races do not change normal progression.</p>
                </main>
            </div>
        </section>
        <div id="mpResult" class="mp-result" aria-hidden="true">
            <section class="mp-card mp-result-card">
                <h2 id="mpResultTitle">Race Complete!</h2>
                <div id="mpResultRows"></div>
                <button id="mpReturnLobbyBtn" class="mp-primary" type="button" style="width:100%;margin-top:14px">Return to Room</button>
            </section>
        </div>
        <div id="mpAccountDangerModal" class="mp-result" aria-hidden="true">
            <section class="mp-card mp-danger-card">
                <h2 id="mpDangerTitle">Reset Progress?</h2>
                <p id="mpDangerDescription" class="mp-note warning"></p>
                <form id="mpDangerForm" class="mp-form">
                    <label>Account password<input id="mpDangerPassword" type="password" maxlength="72" autocomplete="current-password" required></label>
                    <label id="mpDangerPhraseLabel">Type RESET to confirm<input id="mpDangerPhrase" type="text" maxlength="6" autocomplete="off" spellcheck="false" required></label>
                    <div id="mpDangerError" class="mp-error"></div>
                    <div class="mp-button-row"><button id="mpDangerConfirm" class="mp-danger" type="submit">Reset Progress</button><button id="mpDangerCancel" class="mp-secondary" type="button">Cancel</button></div>
                </form>
            </section>
        </div>
        <button id="mpInboxButton" type="button" aria-label="Open gifts and announcements"><img class="mp-inbox-gift-art" src="Birthday Bash Present.png" alt="" aria-hidden="true"><span id="mpInboxBadge" class="mp-inbox-badge" aria-hidden="true">!</span></button>
        <button id="mpActivityButton" type="button" aria-label="Open global live activity feed">🌐 Live Feed</button>
        <button id="mpConnectShortcut" type="button" aria-label="Connect to Flappy Monkey online services">Connect Online</button>
        <button id="mpGoOfflineShortcut" type="button" aria-label="Disconnect and keep playing offline">Go Offline</button>
        <button id="mpFriendsShortcut" type="button" aria-label="Open friends and messages">👥 Friends</button>
        <div id="mpInboxModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card">
                <div class="mp-inbox-header"><h2>Gifts & Announcements</h2><button id="mpCloseInbox" class="mp-secondary" type="button">Close</button></div>
                <div class="mp-inbox-tabs"><button id="mpShowGifts" class="mp-primary" type="button">Gifts</button><button id="mpShowAnnouncements" class="mp-secondary" type="button">Announcements</button></div>
                <div id="mpInboxList" class="mp-inbox-list"></div>
            </section>
        </div>
        <div id="mpActivityModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card mp-activity-card">
                <div class="mp-public-profile-head"><div><h2>Global Live Activity</h2><div class="mp-note">Chat with everyone currently connected to Flappy Monkey.</div></div><button id="mpCloseActivity" class="mp-secondary" type="button">Close</button></div>
                <div id="mpActivityList" class="mp-activity-list"></div>
                <form id="mpActivityForm" class="mp-activity-form"><textarea id="mpActivityInput" maxlength="240" rows="2" placeholder="Message everyone online…"></textarea><button class="mp-primary" type="submit">Send</button></form>
                <div id="mpActivityError" class="mp-error"></div>
            </section>
        </div>
        <div id="mpGiftModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card" style="width:min(560px,100%)">
                <h2 id="mpGiftTitle">Send a Gift</h2>
                <form id="mpGiftForm" class="mp-gift-form">
                    <label>Banana Market item<select id="mpGiftItem"></select></label>
                    <label>Message (optional)<textarea id="mpGiftMessage" maxlength="180" rows="3" placeholder="Write something for your friend..."></textarea></label>
                    <div id="mpGiftCost" class="mp-note"></div>
                    <div id="mpGiftError" class="mp-error"></div>
                    <div class="mp-button-row"><button class="mp-primary" type="submit">Wrap & Send Gift</button><button id="mpCancelGift" class="mp-secondary" type="button">Cancel</button></div>
                </form>
            </section>
        </div>
        <div id="mpPublicProfileModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card mp-public-profile-card">
                <div class="mp-public-profile-head"><h2>Player Profile</h2><button id="mpClosePublicProfile" class="mp-secondary" type="button">Close</button></div>
                <div id="mpPublicProfileContent"><div class="mp-empty-state">Loading profile…</div></div>
            </section>
        </div>
        <div id="mpGroupModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card mp-group-card">
                <div class="mp-public-profile-head"><h2 id="mpGroupModalTitle">Create Group Chat</h2><button id="mpCloseGroupModal" class="mp-secondary" type="button">Close</button></div>
                <form id="mpGroupForm" class="mp-form">
                    <label>Group name<input id="mpGroupName" type="text" minlength="2" maxlength="32" placeholder="Banana Buddies" required></label>
                    <div><strong>Group icon</strong><div class="mp-group-icon-row"><img id="mpGroupIconPreview" src="Default Monkey.png" alt="Group icon preview"><input id="mpGroupIconFile" class="mp-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button id="mpChooseGroupIcon" class="mp-secondary" type="button">Choose Image/GIF</button><button id="mpClearGroupIcon" class="mp-secondary" type="button">Clear Icon</button></div></div>
                    <div><strong>Choose accepted friends</strong><div id="mpGroupMembers" class="mp-group-members"></div></div>
                    <div id="mpGroupError" class="mp-error"></div>
                    <div class="mp-button-row"><button id="mpSaveGroup" class="mp-primary" type="submit">Create Group</button><button id="mpLeaveGroup" class="mp-danger mp-hidden" type="button">Leave Group</button><button id="mpDeleteGroup" class="mp-danger mp-hidden" type="button">Delete Group</button></div>
                </form>
            </section>
        </div>
        <div id="mpClanModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card mp-clan-card"><div class="mp-public-profile-head"><h2>Clan Headquarters</h2><button id="mpCloseClan" class="mp-secondary" type="button">Close</button></div><div id="mpClanContent"></div><div id="mpClanError" class="mp-error"></div></section>
        </div>
        <div id="mpRankedModal" class="mp-overlay" aria-hidden="true">
            <section class="mp-card mp-overlay-card mp-ranked-card"><div class="mp-public-profile-head"><h2>Season 1 Ranked</h2><button id="mpCloseRanked" class="mp-secondary" type="button">Close</button></div><div id="mpRankedContent"></div><div id="mpRankedError" class="mp-error"></div></section>
        </div>
        <section id="monkeyWorldScreen" aria-hidden="true">
            <header class="mw-topbar"><div><h1>MONKEY WORLD</h1><p id="mwWorldStatus">Explore the Banana Coast</p></div><div class="mw-top-actions"><span id="mwTimeOfDay">DAY</span><span id="mwRoomCode"></span><button id="mwSocial" class="mp-primary" type="button">Friends & Messages</button><button id="mwLeave" class="mp-secondary" type="button">Back to Game</button></div></header>
            <main id="mwJoinPanel" class="mw-join-panel mp-card"><div class="mw-join-hero"><span>🏝️</span><div><h2>Explore Banana Coast</h2><p>Walk around as your equipped monkey, chat, visit buildings, and show off your skins, titles, rank, level, and clan.</p></div></div><div class="mw-join-grid"><button id="mwJoinPublic" class="mp-primary" type="button"><strong>Public World</strong><span>Join anyone online · no room key</span></button><button id="mwCreatePrivate" type="button"><strong>Create Private World</strong><span>Get a code for friends</span></button><form id="mwJoinPrivate"><input id="mwPrivateCode" maxlength="5" placeholder="WORLD CODE" required><button class="mp-secondary" type="submit">Join Private</button></form></div><div id="mwJoinError" class="mp-error"></div></main>
            <main id="mwGame" class="mw-game mp-hidden"><canvas id="monkeyWorldCanvas" width="1920" height="1080"></canvas><div class="mw-location"><strong id="mwLocation">Banana Coast Plaza</strong><span>Explore · meet friends · enter every landmark</span></div><button id="mwChatToggle" class="mw-chat-toggle" type="button" aria-label="Open world chat">💬</button><aside id="mwChat" class="mw-chat"><div class="mw-chat-head"><strong>WORLD CHAT</strong><span id="mwPlayerCount">0 monkeys</span><button id="mwChatClose" type="button" aria-label="Collapse world chat">×</button></div><div id="mwChatMessages"></div><form id="mwChatForm"><input id="mwChatInput" maxlength="180" placeholder="Chat with the world…"><button type="submit">Send</button></form></aside><div class="mw-controls"><b>WASD</b> / Left Stick to walk <span>·</span> <b>E</b> / A to enter</div><div id="mwTouchStick" class="mw-touch-stick" aria-label="Touch movement control"><i id="mwTouchKnob" class="mw-touch-knob"></i></div><button id="mwInteract" class="mp-primary mp-hidden" type="button">Enter</button><div id="mwGameError" class="mp-error"></div></main>
            <div id="mwBuildingModal" class="mp-overlay" aria-hidden="true"><section class="mp-card mp-overlay-card mw-building-card"><div class="mp-public-profile-head"><h2 id="mwBuildingTitle">Building</h2><button id="mwCloseBuilding" class="mp-secondary" type="button">Close</button></div><div id="mwBuildingContent"></div></section></div>
        </section>
        <section id="onlineDefenseScreen" aria-hidden="true">
            <header class="od-topbar"><div><h1>ONLINE MONKEY DEFENSE</h1><p>Build an original live defense together or battle on parallel Banana Coast paths.</p></div><div class="od-top-actions"><span id="odConnection">Offline</span><button class="od-guide-open" data-open-defense-guide="online" type="button" aria-label="Open Monkey Defense Guide" title="Open Monkey Defense Guide">ⓘ Guide</button><button id="odSocial" class="mp-primary" type="button">Friends & Messages</button><button id="odLeave" class="mp-secondary" type="button">Back to Game</button></div></header>
            <main id="odMenu" class="od-menu">
                <section class="od-hero mp-card"><div><span class="od-shield">&#128737;</span><h2>Defend Banana Coast Online</h2><p>Public matchmaking uses the same Online Rank as Online Race. Private room-code matches use the same rules without changing rank.</p></div><div id="odRankCard" class="od-rank-card"><strong>Shared Online Rank</strong><span>Connecting to your ranked profile...</span><div class="od-rank-track"><i style="width:0%"></i></div></div></section>
                <div class="od-menu-grid">
                    <section class="mp-card"><h2>Public Ranked</h2><p>Get matched with another real player. Complete 20 waves, protect your lives, and climb the Defense leaderboard.</p><div class="od-stack"><button id="odQueueVersus" class="mp-primary" type="button">Find Ranked Versus</button><button id="odQueueCoop" class="mp-primary" type="button">Find Ranked Co-op</button><button id="odCancelQueue" class="mp-danger mp-hidden" type="button">Cancel Search</button></div><div id="odQueueStatus" class="od-status"></div></section>
                    <section class="mp-card"><h2>Private Room</h2><p>Create a room for a friend or enter their five-character code. Private matches never award or remove rank.</p><div class="od-stack"><button id="odCreateVersus" class="mp-secondary" type="button">Create Versus Room</button><button id="odCreateCoop" class="mp-secondary" type="button">Create Co-op Room</button><form id="odJoinForm" class="od-code-form"><input id="odJoinCode" maxlength="5" placeholder="ROOM CODE" required><button class="mp-primary" type="submit">Join</button></form></div></section>
                </div>
                <section class="mp-card od-leaderboard-card"><h2>Online Rank Leaderboard</h2><div id="odLeaderboard"></div></section>
                <div id="odMenuError" class="mp-error"></div>
            </main>
            <main id="odLobby" class="od-lobby mp-hidden">
                <section class="mp-card"><span id="odLobbyBadge" class="od-mode-badge">PRIVATE VERSUS</span><h2>Defense Room</h2><div id="odRoomCode" class="mp-room-code">-----</div><button id="odCopyCode" class="mp-secondary" type="button">Copy Room Code</button><div id="odLobbyPlayers" class="od-lobby-players"></div><p id="odLobbyNote">Waiting for another defender.</p><div class="mp-button-row"><button id="odStartPrivate" class="mp-primary" type="button">Start Defense</button><button id="odLeaveRoom" class="mp-danger" type="button">Leave Room</button></div><div id="odLobbyError" class="mp-error"></div></section>
            </main>
            <main id="odGame" class="od-game mp-hidden">
                <div class="od-game-heading"><div><strong id="odGameMode">VERSUS DEFENSE</strong><span>Defend the Banana Grove from the Monkey Invaders.</span></div></div>
                <div class="od-game-stats"><div><small>Bananas</small><strong id="odBananas">180</strong></div><div><small>Grove Hearts</small><strong id="odLives">20</strong></div><div><small>Wave</small><strong id="odWaveText">0 / 100</strong></div><div><small>Invaders Defeated</small><strong id="odKills">0</strong></div><div><small>Market Reward</small><strong id="odMarketReward">+0</strong></div><div><small>Score</small><strong id="odScore">0</strong></div></div>
                <div class="od-stage"><canvas id="onlineDefenseCanvas" width="900" height="600"></canvas><aside class="od-build-side"><h2>Build & Upgrade</h2><div id="odSelection">Choose a Monkey Defender below, then place it on open ground.</div><div class="od-upgrade-paths"><button id="odUpgradePower" class="od-action" type="button" disabled>Power Path</button><button id="odUpgradeTactical" class="od-action" type="button" disabled>Tactical Path</button></div><button id="odSell" class="od-action od-sell" type="button" disabled>Sell selected defender</button><h3>Emergency Abilities</h3><div class="od-powers-grid"><button id="odPowerRepair" class="od-power" type="button">Heal +4<small>2 uses left</small></button><button id="odPowerFreeze" class="od-power" type="button">Track Freeze<small>2 uses left</small></button><button id="odPowerBomb" class="od-power" type="button">Banana Bomb<small>2 uses left</small></button><button id="odPowerRally" class="od-power" type="button">Tower Rally<small>2 uses left</small></button></div><h3>Online Defenders</h3><div id="odOpponentStats"></div><button id="odForfeit" class="mp-danger" type="button">Leave Match</button></aside></div>
                <aside class="od-tower-panel"><h2>Monkey Defenders</h2><p>Ordered from weakest to strongest. Pick one, then click open ground off the path.</p><div id="odTowerDeck" class="od-tower-deck"></div></aside>
                <div class="od-bottom"><button id="odStartWave" class="od-wave" type="button">Start Wave 1</button><button id="odFastForward" class="od-wave od-fast" type="button">Fast Forward: 1x</button><div id="odDefenseStatus">Pick a defender, prepare the grove, then start the first wave.</div></div>
                <div id="odGameError" class="mp-error"></div>
            </main>
            <div id="odResult" class="mp-result" aria-hidden="true"><section class="mp-card mp-result-card"><h2 id="odResultTitle">Defense Complete</h2><div id="odResultBody"></div><button id="odResultReturn" class="mp-primary" type="button">Return to Online Defense</button></section></div>
        </section>
        <div id="mpLiveEventBanner" class="mp-live-event-banner" aria-live="polite"></div>
        <div id="mpGlobalAnnouncement" role="status" aria-live="assertive"></div>
        <div id="mpToast" class="mp-toast"></div>
    `);

    const elements = Object.fromEntries([
        'onlineStartupGate','startupSplash','startupLoadingText','startupSplashOffline','startupAuth','startupServerUrl','startupReconnect','startupStayOffline','startupLoginForm','startupLoginUsername','startupLoginPassword','startupRegisterForm','startupRegisterUsername','startupRegisterEmail','startupRegisterPassword','startupRegisterConfirm','startupAuthError','startupVerify','startupVerifyText','startupVerifyCode','startupVerifyButton','startupResendCode','startupCancelVerify','startupVerifyError','onlineConsentModal','onlineConsentTitle','onlineConsentText','onlineConsentYes','onlineConsentNo','multiplayerScreen','mpConnection','mpBackBtn','mpAuthView','mpServerUrl','mpLoginForm','mpLoginUsername','mpLoginPassword','mpRegisterForm','mpRegisterUsername','mpRegisterEmail','mpRegisterPassword','mpRegisterConfirm','mpAuthError','mpHomeView','mpAccountName','mpLogoutBtn','mpStats','mpCreateRoomBtn','mpJoinCode','mpJoinRoomBtn','mpSocialPanel','mpFriendUserId','mpAddFriendBtn','mpSocialError','mpFriendRequests','mpFriends','mpCreateGroup','mpGroups','mpOutgoingRequests','mpBlockedUsers','mpConversation','mpConversationTitle','mpGroupSettings','mpClearConversation','mpMessages','mpMessageForm','mpMessageInput','mpMessageFile','mpMessageAttach','mpMessageAttachment','mpHomeError','mpLobbyView','mpRoomCode','mpCopyRoomBtn','mpPlayers','mpVictorySelect','mpTargetField','mpTargetScore','mpDurationField','mpDuration','mpLivesSelect','mpGapSelect','mpMovingPipes','mpFriendlyPractice','mpRuleDescription','mpReadyBtn','mpStartMatchBtn','mpLeaveRoomBtn','mpLobbyError','mpRaceView','mpRaceObjective','mpRaceTimer','mpRaceStandings','multiplayerCanvas','mpResult','mpResultTitle','mpResultRows','mpReturnLobbyBtn','mpAccountDangerModal','mpDangerTitle','mpDangerDescription','mpDangerForm','mpDangerPassword','mpDangerPhraseLabel','mpDangerPhrase','mpDangerError','mpDangerConfirm','mpDangerCancel','mpInboxButton','mpInboxBadge','mpActivityButton','mpConnectShortcut','mpGoOfflineShortcut','mpFriendsShortcut','mpInboxModal','mpCloseInbox','mpShowGifts','mpShowAnnouncements','mpInboxList','mpActivityModal','mpCloseActivity','mpActivityList','mpActivityForm','mpActivityInput','mpActivityError','mpGiftModal','mpGiftTitle','mpGiftForm','mpGiftItem','mpGiftMessage','mpGiftCost','mpGiftError','mpCancelGift','mpPublicProfileModal','mpClosePublicProfile','mpPublicProfileContent','mpGroupModal','mpGroupModalTitle','mpCloseGroupModal','mpGroupForm','mpGroupName','mpGroupIconPreview','mpGroupIconFile','mpChooseGroupIcon','mpClearGroupIcon','mpGroupMembers','mpGroupError','mpSaveGroup','mpLeaveGroup','mpDeleteGroup','mpGlobalAnnouncement','mpToast'
    ].map((id) => [id, document.getElementById(id)]));
    for (const id of ['onlineModesScreen','onlineHubClose','onlineHubSocial','onlineHubWorld','onlineHubDefense','onlineHubRace','mpSocialCenter','mpCloseSocialCenter','mpSocialCenterHost']) elements[id] = document.getElementById(id);
    elements.startupRegisterSubmit = document.getElementById('startupRegisterSubmit');
    elements.mpCreateParty = document.getElementById('mpCreateParty');
    elements.mpParty = document.getElementById('mpParty');
    elements.mpOpenClan = document.getElementById('mpOpenClan');
    elements.mpClanSummary = document.getElementById('mpClanSummary');
    elements.mpClanModal = document.getElementById('mpClanModal');
    elements.mpCloseClan = document.getElementById('mpCloseClan');
    elements.mpClanContent = document.getElementById('mpClanContent');
    elements.mpClanError = document.getElementById('mpClanError');
    elements.mpRankedHomeSummary = document.getElementById('mpRankedHomeSummary');
    elements.mpRankedQueue = document.getElementById('mpRankedQueue');
    elements.mpOpenRanked = document.getElementById('mpOpenRanked');
    elements.mpRankedModal = document.getElementById('mpRankedModal');
    elements.mpCloseRanked = document.getElementById('mpCloseRanked');
    elements.mpRankedContent = document.getElementById('mpRankedContent');
    elements.mpRankedError = document.getElementById('mpRankedError');
    elements.mpLiveEventBanner = document.getElementById('mpLiveEventBanner');
    for (const id of ['monkeyWorldScreen','mwWorldStatus','mwTimeOfDay','mwRoomCode','mwSocial','mwLeave','mwJoinPanel','mwJoinPublic','mwCreatePrivate','mwJoinPrivate','mwPrivateCode','mwJoinError','mwGame','monkeyWorldCanvas','mwLocation','mwChatToggle','mwChat','mwChatClose','mwPlayerCount','mwChatMessages','mwChatForm','mwChatInput','mwTouchStick','mwTouchKnob','mwInteract','mwGameError','mwBuildingModal','mwBuildingTitle','mwCloseBuilding','mwBuildingContent']) elements[id] = document.getElementById(id);
    for (const id of ['onlineDefenseScreen','odConnection','odSocial','odLeave','odMenu','odRankCard','odQueueVersus','odQueueCoop','odCancelQueue','odQueueStatus','odCreateVersus','odCreateCoop','odJoinForm','odJoinCode','odLeaderboard','odMenuError','odLobby','odLobbyBadge','odRoomCode','odCopyCode','odLobbyPlayers','odLobbyNote','odStartPrivate','odLeaveRoom','odLobbyError','odGame','odGameMode','odWaveText','odBananas','odLives','odKills','odMarketReward','odScore','onlineDefenseCanvas','odTowerDeck','odSelection','odUpgradePower','odUpgradeTactical','odSell','odPowerRepair','odPowerFreeze','odPowerBomb','odPowerRally','odStartWave','odFastForward','odDefenseStatus','odOpponentStats','odForfeit','odGameError','odResult','odResultTitle','odResultBody','odResultReturn']) elements[id] = document.getElementById(id);
    elements.mpLobbyTitle = document.getElementById('mpLobbyTitle');
    const raceContext = elements.multiplayerCanvas.getContext('2d');
    raceContext.imageSmoothingEnabled = false;
    const raceImages = new Map();
    const defenseContext = elements.onlineDefenseCanvas.getContext('2d');
    const socialHomeParent = elements.mpSocialPanel.parentNode;
    const socialHomeNextSibling = elements.mpSocialPanel.nextSibling;

    function setConnection(text, kind = '') {
        elements.mpConnection.textContent = text;
        elements.mpConnection.className = `mp-connection ${kind}`.trim();
    }

    function showToast(message, error = false) {
        clearTimeout(state.toastTimer);
        elements.mpToast.textContent = message;
        elements.mpToast.className = `mp-toast show${error ? ' error' : ''}`;
        state.toastTimer = setTimeout(() => { elements.mpToast.className = 'mp-toast'; }, 3600);
    }

    function showRewardModal(title, rewards) {
        let overlay = document.getElementById('mpRewardModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mpRewardModal';
            overlay.className = 'mp-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `
            <section class="mp-card mp-overlay-card mp-reward-card" role="dialog" aria-modal="true" aria-labelledby="mpRewardTitle">
                <div class="mp-reward-burst">🎉</div>
                <h2 id="mpRewardTitle">${escapeHtml(title)}</h2>
                <p class="mp-note">These rewards were added to your account.</p>
                <div class="mp-reward-list">${rewards.map((reward) => `
                    <div class="mp-reward-item"><strong>${escapeHtml(reward.label)}</strong><span>×${Math.max(1, Number(reward.amount) || 1).toLocaleString()}</span></div>
                `).join('')}</div>
                <button class="mp-primary" id="mpCloseRewardModal" type="button" style="width:100%;margin-top:14px">Awesome!</button>
            </section>`;
        const close = () => {
            overlay.classList.remove('open');
            overlay.setAttribute('aria-hidden', 'true');
        };
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        overlay.querySelector('#mpCloseRewardModal').addEventListener('click', close);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); }, { once: true });
        overlay.querySelector('#mpCloseRewardModal').focus();
    }

    function showGlobalAnnouncement(announcement) {
        if (!announcement?.text) return;
        clearTimeout(state.announcementTimer);
        elements.mpGlobalAnnouncement.textContent = announcement.text;
        elements.mpGlobalAnnouncement.classList.add('show');
        state.announcementTimer = setTimeout(() => elements.mpGlobalAnnouncement.classList.remove('show'), 9000);
    }

    function giftCatalog() {
        const catalog = typeof window.getGiftableMarketItems === 'function'
            ? window.getGiftableMarketItems()
            : [];
        return catalog.length ? catalog : [
            { giftType: 'crate_ticket', itemId: 'holiday', label: 'Holiday Monkey Skin Crate', price: 200 },
            { giftType: 'crate_ticket', itemId: 'summer', label: 'Summer Monkey Skin Crate', price: 200 },
            { giftType: 'crate_ticket', itemId: 'sport', label: 'Sport Monkey Skin Crate', price: 200 },
            { giftType: 'crate_ticket', itemId: 'crystal', label: 'Crystals & Gems Monkey Skin Crate', price: 200 }
        ];
    }

    function giftTypeLabel(type) {
        return ({ crate_ticket: 'Monkey Skin Crate', skin: 'Monkey Skin', trail: 'Monkey Trail', pipe_skin: 'Pipe Skin', powerup: 'Power-Up', explosion_vfx: 'Explosion VFX', title_fx: 'Title Style', profile_background: 'Profile Theme', cosmetic: 'Cosmetic', custom_emoji: 'Custom Chat Emoji' })[type] || 'Banana Market Item';
    }

    function localRewardReceipts() {
        try {
            const saved = JSON.parse(localStorage.getItem('flappyLocalRewardReceipts') || '[]');
            return Array.isArray(saved) ? saved.filter(entry => entry?.id && entry?.title) : [];
        } catch (_) {
            return [];
        }
    }

    function mergedRewardReceipts() {
        const receipts = new Map();
        for (const entry of [...(state.inbox.receipts || []), ...localRewardReceipts()]) {
            if (entry?.id) receipts.set(entry.id, entry);
        }
        return [...receipts.values()];
    }

    function receiptRewardLabel(reward) {
        if (reward?.type === 'skin' && reward.itemId) return String(reward.itemId).replace(/\.[^.]+$/, '');
        const raw = String(reward?.label || reward?.itemId || 'Reward').trim();
        const catalogs = [
            ...(typeof monkeySkins !== 'undefined' ? monkeySkins.map((item) => item.name) : []),
            ...(typeof titles !== 'undefined' ? titles.map((item) => item.name) : []),
            ...(typeof profileBackgrounds !== 'undefined' ? profileBackgrounds.map((item) => item.name) : []),
            ...(typeof explosionVfxOptions !== 'undefined' ? explosionVfxOptions.map((item) => item.name) : []),
            ...(typeof pipeThemes !== 'undefined' ? pipeThemes.map((item) => item.name) : []),
            ...(typeof trails !== 'undefined' ? trails.map((item) => item.name) : []),
            ...(typeof titleFXOptions !== 'undefined' ? titleFXOptions.map((item) => item.name) : []),
            ...(window.flappyCustomEmojis || []).map((item) => item.name)
        ].filter(Boolean);
        const exact = catalogs.find((name) => name.toLocaleLowerCase() === raw.toLocaleLowerCase());
        if (exact) return exact;
        const prefixMatches = catalogs.filter((name) => name.toLocaleLowerCase().startsWith(raw.toLocaleLowerCase()));
        return prefixMatches.length === 1 ? prefixMatches[0] : raw;
    }

    window.flappyAddLocalRewardReceipt = receipt => {
        if (!receipt?.id || !receipt?.title) return false;
        const receipts = localRewardReceipts().filter(entry => entry.id !== receipt.id);
        receipts.push(receipt);
        localStorage.setItem('flappyLocalRewardReceipts', JSON.stringify(receipts.slice(-30)));
        if (!state.inbox.receipts.some(entry => entry.id === receipt.id)) state.inbox.receipts.push(receipt);
        renderInbox(state.inboxView || 'announcements');
        updateInboxButton();
        return true;
    };

    function unreadInboxCount() {
        const gifts = state.inbox.gifts.filter((gift) => !gift.claimedAt).length;
        const seen = localStorage.getItem('flappyLastAnnouncementSeen') || '';
        const newestNotice = [...state.inbox.announcements, ...mergedRewardReceipts()]
            .sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).at(-1);
        const announcements = newestNotice && newestNotice.id !== seen ? 1 : 0;
        return gifts + announcements;
    }

    const MAIN_MENU_BLOCKING_IDS = [
        'onlineStartupGate', 'onlineConsentModal', 'onlineModesScreen', 'mpSocialCenter', 'multiplayerScreen', 'monkeyWorldScreen', 'onlineDefenseScreen', 'mpInboxModal', 'mpGiftModal', 'mpAccountDangerModal', 'mpRewardModal',
        'settingsPopup', 'skinMenu', 'titlesMenu', 'modeMenu', 'shopMenu', 'profileMenu', 'bananaPassMenu', 'inventoryMenu', 'collectionIndexPopup',
        'musicOptionsPopup', 'powerupsInfoPopup', 'monkeyDefenseGuidePopup', 'customTitleColorPopup', 'socialsPopup', 'unlockPopup',
        'crateOpeningPopup', 'crateOddsPopup', 'dailyQuestPopup', 'secretDecodePopup', 'towerDefenseScreen'
    ];

    function elementIsVisible(element) {
        if (!element || !element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isBaseMainMenuVisible() {
        if (typeof started !== 'undefined' && started) return false;
        const mainCanvas = document.getElementById('canvas');
        if (!elementIsVisible(mainCanvas)) return false;
        return !MAIN_MENU_BLOCKING_IDS.some((id) => elementIsVisible(document.getElementById(id)));
    }

    function isMainMenuScreen() {
        return Boolean(state.authenticated && isBaseMainMenuVisible());
    }

    function updateInboxButton() {
        elements.mpInboxButton.classList.toggle('open-account', isMainMenuScreen());
        const count = unreadInboxCount();
        elements.mpInboxBadge.classList.toggle('show', count > 0);
        const badgeAriaHidden = count > 0 ? 'false' : 'true';
        if (elements.mpInboxBadge.getAttribute('aria-hidden') !== badgeAriaHidden) {
            elements.mpInboxBadge.setAttribute('aria-hidden', badgeAriaHidden);
        }
        elements.mpInboxButton.setAttribute('aria-label', count > 0
            ? `Open gifts and announcements. ${count} new item${count === 1 ? '' : 's'}.`
            : 'Open gifts and announcements');
    }

    function renderInbox(view = state.inboxView || 'gifts') {
        state.inboxView = view;
        elements.mpShowGifts.className = view === 'gifts' ? 'mp-primary' : 'mp-secondary';
        elements.mpShowAnnouncements.className = view === 'announcements' ? 'mp-primary' : 'mp-secondary';
        if (view === 'announcements') {
            const announcements = [
                ...state.inbox.announcements.map((entry) => ({ ...entry, noticeType: 'announcement' })),
                ...mergedRewardReceipts().map((entry) => ({ ...entry, noticeType: 'receipt' }))
            ].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
            elements.mpInboxList.innerHTML = announcements.length ? announcements.map((entry) => `
                <article class="mp-inbox-entry">
                    <div class="mp-gift-title">${entry.noticeType === 'receipt' ? `✅ ${escapeHtml(entry.title)}` : '📣 Global Announcement'}</div>
                    ${entry.noticeType === 'receipt'
                        ? `<div class="mp-receipt-rewards">${(entry.rewards || []).map((reward) => `<span>${escapeHtml(receiptRewardLabel(reward))} ×${Math.max(1, Number(reward.amount) || 1).toLocaleString()}</span>`).join('')}</div>`
                        : `<p style="white-space:pre-wrap">${messageHtml(entry.text)}</p>`}
                    <div class="mp-message-time">${escapeHtml(new Date(entry.createdAt).toLocaleString())}</div>
                    ${entry.noticeType === 'announcement' && state.account?.isOwner ? `<button class="mp-danger mp-delete-announcement" type="button" data-delete-announcement="${escapeHtml(entry.id)}">Delete Announcement</button>` : ''}
                </article>
            `).join('') : '<div class="mp-empty-state">No announcements yet.</div>';
        } else {
            const gifts = [...state.inbox.gifts].reverse();
            elements.mpInboxList.innerHTML = gifts.length ? gifts.map((gift) => `
                <article class="mp-inbox-entry mp-gift-entry">
                    <div class="mp-gift-title">🎁 ${escapeHtml(gift.label)}</div>
                    <div style="color:#bce2c8">From <strong>${escapeHtml(gift.fromName)}</strong></div>
                    ${gift.message ? `<div class="mp-gift-message">“${escapeHtml(gift.message)}”</div>` : ''}
                    <div class="mp-message-time">${escapeHtml(new Date(gift.createdAt).toLocaleString())}</div>
                    ${gift.claimedAt ? '<div style="margin-top:8px;color:#8ce5a7;font-weight:900">CLAIMED</div>' : `<button class="mp-primary" type="button" data-claim-gift="${escapeHtml(gift.id)}" style="width:100%;margin-top:9px">Claim Gift</button>`}
                </article>
            `).join('') : '<div class="mp-empty-state">No gifts yet.</div>';
        }
        updateInboxButton();
    }

    function openInbox(view = 'gifts') {
        const newestNotice = [...state.inbox.announcements, ...mergedRewardReceipts()]
            .sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).at(-1);
        if (newestNotice) {
            localStorage.setItem('flappyLastAnnouncementSeen', newestNotice.id);
        }
        renderInbox(view);
        elements.mpInboxModal.classList.add('open');
        elements.mpInboxModal.setAttribute('aria-hidden', 'false');
    }

    function closeInbox() {
        elements.mpInboxModal.classList.remove('open');
        elements.mpInboxModal.setAttribute('aria-hidden', 'true');
    }

    function updateActivityButton() {
        const onMainMenu = Boolean(state.account && isBaseMainMenuVisible());
        const inOnlineScreen = elements.multiplayerScreen.classList.contains('open') && state.account;
        elements.mpActivityButton.classList.toggle('open-account', Boolean(onMainMenu || inOnlineScreen));
        const offlineMainMenu = isBaseMainMenuVisible() && !state.authenticated;
        elements.mpConnectShortcut.classList.toggle('open-account', Boolean(offlineMainMenu));
        const onlineMainMenu = isBaseMainMenuVisible() && state.authenticated;
        elements.mpGoOfflineShortcut.classList.toggle('open-account', Boolean(onlineMainMenu));
        const baseMainMenu = isBaseMainMenuVisible();
        const connected = Boolean(state.authenticated && state.socket?.readyState === WebSocket.OPEN);
        elements.mpFriendsShortcut.classList.toggle('open-account', baseMainMenu);
        elements.mpFriendsShortcut.disabled = !connected;
        elements.mpFriendsShortcut.setAttribute('aria-disabled', String(!connected));
        elements.mpFriendsShortcut.title = connected
            ? 'Open Friends & Messages'
            : 'Connect Online to use Friends & Messages';
    }

    function renderActivityFeed() {
        const blockedIds = new Set((state.social.blocked || []).map((profile) => profile.id));
        const entries = state.activityFeed.filter((entry) => entry.special || !blockedIds.has(entry.userId));
        elements.mpActivityList.innerHTML = entries.length ? entries.map((entry) => {
            const time = new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            const ownerDelete = state.account?.isOwner ? `<button class="mp-message-delete" type="button" data-delete-activity="${escapeHtml(entry.id)}">Delete</button>` : '';
            const profileButton = entry.userId ? `<button class="mp-chat-profile" type="button" data-chat-profile="${escapeHtml(entry.userId)}">View Profile</button>` : '';
            return `<article class="mp-activity-entry ${entry.special ? 'special' : ''}"><div class="mp-activity-name">${entry.special ? '🔴 ' : ''}${escapeHtml(entry.username || 'Monkey')}${platformBadgeHtml(entry.platform)} ${profileButton}</div>${sharedTitleHtml(entry.userId === state.account?.id ? localTitleProfile() : entry, 'mp-chat-title')}<div>${messageHtml(entry.text)}</div><div class="mp-message-meta"><span class="mp-message-time">${escapeHtml(time)}</span>${ownerDelete}</div></article>`;
        }).join('') : '<div class="mp-empty-state">No global activity yet. Start the conversation!</div>';
        elements.mpActivityList.scrollTop = elements.mpActivityList.scrollHeight;
    }

    async function openActivityFeed() {
        elements.mpActivityError.textContent = '';
        if (!await requestOnlineAccess('Global Live Activity Feed')) return;
        try {
            await connect();
            await waitForAuthenticatedAccount();
            send({ type: 'get_activity_feed', since: GLOBAL_CHAT_SESSION_STARTED_AT });
            send({ type: 'get_party' });
            elements.mpActivityModal.classList.add('open');
            elements.mpActivityModal.setAttribute('aria-hidden', 'false');
            renderActivityFeed();
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function closeActivityFeed() {
        elements.mpActivityModal.classList.remove('open');
        elements.mpActivityModal.setAttribute('aria-hidden', 'true');
    }

    function renderLiveEvent() {
        const now = Date.now() + state.serverOffset;
        const events = (state.liveEvents.length ? state.liveEvents : state.liveEvent ? [state.liveEvent] : [])
            .filter((event) => event && Number(event.endsAt) > now)
            .sort((first, second) => Number(first.endsAt) - Number(second.endsAt))
            .map((event) => ({
                ...event,
                definition: event.definition || state.liveEventDefinitions[event.id] || {}
            }));
        if (!events.length) {
            state.liveEvent = null;
            state.liveEvents = [];
            window.flappyLiveEvent = null;
            window.flappyLiveEvents = [];
            elements.mpLiveEventBanner.classList.remove('show');
            elements.mpLiveEventBanner.classList.remove('expanded');
            elements.mpLiveEventBanner.innerHTML = '';
            return;
        }
        const timeLabel = (event, compact = false) => {
            const remaining = Math.max(0, Math.ceil((event.endsAt - now) / 1000));
            const hours = Math.floor(remaining / 3600);
            const minutes = Math.floor((remaining % 3600) / 60);
            const seconds = String(remaining % 60).padStart(2, '0');
            return compact
                ? hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}:${seconds}`
                : `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${seconds}s`;
        };
        state.liveEvents = events;
        state.liveEvent = events[0];
        window.flappyLiveEvents = events;
        window.flappyLiveEvent = events[0];
        if (events.length === 1) {
            liveEventListExpanded = false;
            elements.mpLiveEventBanner.classList.remove('expanded');
            const event = events[0];
            elements.mpLiveEventBanner.innerHTML = `<span>${escapeHtml(event.icon || '🌐')}</span><div><strong>LIVE EVENT · ${escapeHtml(event.name)}</strong><small>${escapeHtml(event.description || event.definition.description || '')}</small></div><b>${timeLabel(event)}</b>`;
        } else {
            const hiddenCount = Math.max(0, events.length - 3);
            const shown = liveEventListExpanded ? events : events.slice(0, 3);
            elements.mpLiveEventBanner.classList.toggle('expanded', liveEventListExpanded);
            elements.mpLiveEventBanner.innerHTML = `
                <span class="mp-live-event-count"><b>${events.length}</b><small>LIVE<br>EVENTS</small></span>
                <div class="mp-live-event-chips">${shown.map((event) => `
                    <span class="mp-live-event-chip" title="${escapeHtml(event.description || event.definition.description || '')}">
                        <i>${escapeHtml(event.icon || '🌐')}</i><strong>${escapeHtml(event.name)}</strong><time>${timeLabel(event, true)}</time>
                    </span>`).join('')}</div>
                ${hiddenCount ? `<button class="mp-live-event-more" type="button" aria-expanded="${liveEventListExpanded}" aria-label="${liveEventListExpanded ? 'Hide extra live events' : `Show ${hiddenCount} more live events`}">${liveEventListExpanded ? 'Hide' : `+${hiddenCount}`}</button>` : ''}`;
        }
        elements.mpLiveEventBanner.classList.add('show');
    }

    elements.mpLiveEventBanner.addEventListener('click', (event) => {
        const more = event.target.closest('.mp-live-event-more');
        if (!more) return;
        event.preventDefault();
        event.stopPropagation();
        liveEventListExpanded = !liveEventListExpanded;
        renderLiveEvent();
    });
    document.addEventListener('click', (event) => {
        if (!liveEventListExpanded || event.target.closest('#mpLiveEventBanner')) return;
        liveEventListExpanded = false;
        renderLiveEvent();
    });

    const MONKEY_WORLD_WIDTH = 3200;
    const MONKEY_WORLD_HEIGHT = 1800;
    const MONKEY_WORLD_BUILDINGS = [
        { id: 'market', name: 'Banana Market', icon: '🍌', x: 250, y: 270, w: 900, h: 560, color: '#df922c', highlight: '#ffca4d', roof: '#ffe367', doorX: 885, doorY: 742, collision: { x: 230, y: 205, w: 875, h: 445 }, occlusion: { x: 235, y: 260, w: 950, h: 620, frontY: 835 } },
        { id: 'wardrobe', name: 'Monkey Style', icon: '👕', x: 1290, y: 170, w: 620, h: 440, color: '#784ac3', highlight: '#bc78ed', roof: '#e2a6ff', doorX: 1635, doorY: 602, collision: { x: 1290, y: 165, w: 610, h: 385 }, occlusion: { x: 1270, y: 150, w: 670, h: 535, frontY: 630 } },
        { id: 'cafe', name: 'Banana Café', icon: '🥤', x: 2070, y: 240, w: 570, h: 450, color: '#d85c42', highlight: '#ff9670', roof: '#ffcc77', doorX: 2385, doorY: 640, collision: { x: 2060, y: 260, w: 560, h: 345 }, occlusion: { x: 2040, y: 215, w: 650, h: 555, frontY: 720 } },
        { id: 'arcade', name: 'Monkey Arcade', icon: '🕹️', x: 2600, y: 600, w: 600, h: 500, color: '#2d5fc9', highlight: '#5aa7ff', roof: '#78e5ff', doorX: 2785, doorY: 1045, collision: { x: 2760, y: 610, w: 440, h: 260 }, occlusion: { x: 2580, y: 580, w: 620, h: 600, frontY: 1110 } },
        { id: 'clan', name: 'Clan Hall', icon: '🛡️', x: 1840, y: 970, w: 940, h: 640, color: '#237648', highlight: '#54bb68', roof: '#ffe06c', doorX: 2145, doorY: 1415, collisions: [{ x: 1885, y: 965, w: 725, h: 390 }, { x: 2580, y: 1300, w: 155, h: 260 }], occlusion: { x: 1825, y: 950, w: 980, h: 700, frontY: 1560 } }
    ];
    const monkeyWorldRenderer = window.FlappyMonkeyWorldRenderer
        ? new window.FlappyMonkeyWorldRenderer(MONKEY_WORLD_WIDTH, MONKEY_WORLD_HEIGHT)
        : null;

    function worldImage(path) {
        if (!monkeyWorld.images.has(path)) {
            const image = new Image();
            image.loading = 'eager';
            image.src = path || 'Default Monkey.png';
            // Chromium may stop advancing an animated GIF that only exists as
            // an off-DOM canvas source. Keep a tiny, invisible live source in
            // the document so drawImage() receives the current animation frame.
            if (/\.gif(?:$|[?#])/i.test(String(path || ''))) {
                image.className = 'mw-animated-skin-source';
                image.alt = '';
                image.setAttribute('aria-hidden', 'true');
                document.body.appendChild(image);
            }
            monkeyWorld.images.set(path, image);
        }
        return monkeyWorld.images.get(path);
    }

    function stopMonkeyWorldLoop() {
        monkeyWorld.active = false;
        if (monkeyWorld.animationFrame) cancelAnimationFrame(monkeyWorld.animationFrame);
        monkeyWorld.animationFrame = null;
        monkeyWorld.keys.clear();
        monkeyWorld.touchX = 0;
        monkeyWorld.touchY = 0;
        monkeyWorld.touchPointerId = null;
        if (elements.mwTouchKnob) elements.mwTouchKnob.style.transform = 'translate(0px, 0px)';
    }

    function closeStaleScreensForMonkeyWorld() {
        monkeyWorld.pausedForMenu = false;
        elements.monkeyWorldScreen.classList.remove('menu-underlay');
        closeOnlineHub();
        if (elements.multiplayerScreen.classList.contains('open')) closeMultiplayer();
        if (elements.onlineDefenseScreen.classList.contains('open')) closeOnlineDefense();
        closeSharedSocial();
        for (const modal of [elements.mpInboxModal, elements.mpGiftModal, elements.mpClanModal, elements.mpRankedModal, elements.mpPublicProfileModal, elements.mpAccountDangerModal]) {
            modal?.classList.remove('open');
            modal?.setAttribute('aria-hidden', 'true');
        }
        const closers = [
            ['settingsPopup', 'closeSettingsBtn'], ['skinMenu', 'closeSkinMenu'], ['titlesMenu', 'closeTitlesMenu'],
            ['modeMenu', 'closeModeMenu'], ['shopMenu', 'closeShopMenu'], ['profileMenu', 'closeProfileMenu'],
            ['bananaPassMenu', 'closeBananaPass'], ['inventoryMenu', 'closeInventory']
        ];
        for (const [menuId, closeId] of closers) {
            const menu = document.getElementById(menuId);
            if (elementIsVisible(menu)) document.getElementById(closeId)?.click();
        }
        const defenseScreen = document.getElementById('towerDefenseScreen');
        if (elementIsVisible(defenseScreen)) document.getElementById('tdExit')?.click();
    }

    async function openMonkeyWorld() {
        if (!await requestOnlineAccess('Monkey World')) return;
        try {
            await connect();
            await waitForAuthenticatedAccount();
            closeStaleScreensForMonkeyWorld();
            scheduleAccountCosmeticsSync(true);
            elements.monkeyWorldScreen.classList.add('open');
            elements.monkeyWorldScreen.setAttribute('aria-hidden', 'false');
            elements.mwJoinPanel.classList.toggle('mp-hidden', monkeyWorld.joined);
            elements.mwGame.classList.toggle('mp-hidden', !monkeyWorld.joined);
            elements.mwJoinError.textContent = '';
            if (monkeyWorld.joined) startMonkeyWorldLoop();
        } catch (error) { showToast(error.message, true); }
    }

    function closeMonkeyWorld({ leave = true } = {}) {
        if (leave && monkeyWorld.joined) send({ type: 'leave_monkey_world' });
        if (leave && state.party) send({ type: 'leave_party' });
        monkeyWorld.joined = false;
        monkeyWorld.world = null;
        monkeyWorld.resumeAfterReconnect = null;
        monkeyWorld.pendingChatText = '';
        monkeyWorld.pendingChatNeedsResend = false;
        monkeyWorld.pausedForMenu = false;
        clearTimeout(monkeyWorld.menuReturnTimer);
        monkeyWorld.menuReturnTimer = null;
        elements.monkeyWorldScreen.classList.remove('menu-underlay');
        monkeyWorld.players.clear();
        stopMonkeyWorldLoop();
        elements.monkeyWorldScreen.classList.remove('open');
        elements.monkeyWorldScreen.setAttribute('aria-hidden', 'true');
        elements.mwGame.classList.add('mp-hidden');
        elements.mwJoinPanel.classList.remove('mp-hidden');
    }

    function startMonkeyWorldLoop() {
        if (monkeyWorld.active) return;
        monkeyWorld.active = true;
        monkeyWorld.lastTick = performance.now();
        monkeyWorld.animationFrame = requestAnimationFrame(monkeyWorldLoop);
    }

    function renderMonkeyWorldChat() {
        const blocked = new Set((state.social.blocked || []).map((profile) => profile.id));
        const canManage = state.account?.isOwner || monkeyWorld.world?.canManage;
        const messages = monkeyWorld.messages.filter((message) => !blocked.has(message.fromId));
        elements.mwChatMessages.innerHTML = messages.length ? messages.map((message) => {
            const time = new Date(Number(message.createdAt) || Date.now()).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
            const name = message.fromId ? `<button class="mw-chat-name" data-chat-profile="${escapeHtml(message.fromId)}" type="button">${escapeHtml(message.username)}${platformBadgeHtml(message.platform)}</button>` : `<strong>${escapeHtml(message.username)}</strong>`;
            const remove = canManage ? `<button class="mw-chat-delete" data-delete-world-message="${escapeHtml(message.id)}" type="button">Delete</button>` : '';
            return `<article><div class="mw-chat-message-head">${name}<span>${escapeHtml(time)}</span>${remove}</div>${sharedTitleHtml(message.fromId === state.account?.id ? localTitleProfile() : message, 'mp-chat-title')}<div class="mw-chat-message-body">${messageHtml(message.text)}</div></article>`;
        }).join('') : '<div class="mp-empty-state">World chat is quiet. Say hello!</div>';
        elements.mwChatMessages.scrollTop = elements.mwChatMessages.scrollHeight;
        elements.mwPlayerCount.textContent = `${monkeyWorld.players.size} ${monkeyWorld.players.size === 1 ? 'monkey' : 'monkeys'}`;
    }

    function applyMonkeyWorldState(world) {
        const previousMessageIds = new Set(monkeyWorld.messages.map((message) => message.id));
        monkeyWorld.world = world;
        monkeyWorld.joined = true;
        monkeyWorld.resumeAfterReconnect = null;
        monkeyWorld.messages = Array.isArray(world.messages) ? world.messages : [];
        monkeyWorld.players = new Map((world.players || []).map((player) => [player.id, { ...player, receivedAt: performance.now() }]));
        const local = [...monkeyWorld.players.values()].find((player) => player.profileId === state.account?.id);
        if (local && !monkeyWorld.active) {
            monkeyWorld.x = local.x;
            monkeyWorld.y = local.y;
            monkeyWorld.direction = local.direction || 'down';
            monkeyWorld.cameraX = Math.max(0, monkeyWorld.x - innerWidth / 2);
            monkeyWorld.cameraY = Math.max(0, monkeyWorld.y - innerHeight / 2);
        }
        for (const message of monkeyWorld.messages) if (!previousMessageIds.has(message.id)) monkeyWorld.chatBubbles.set(message.fromId, { text: message.text, until: performance.now() + 5500 });
        const pendingChat = monkeyWorld.pendingChatText;
        const chatWasReceived = pendingChat && monkeyWorld.messages.some((message) => message.fromId === state.account?.id && message.text === pendingChat);
        if (chatWasReceived) {
            monkeyWorld.pendingChatText = '';
            monkeyWorld.pendingChatNeedsResend = false;
        } else if (pendingChat && monkeyWorld.pendingChatNeedsResend) {
            monkeyWorld.pendingChatNeedsResend = false;
            send({ type: 'monkey_world_chat', text: pendingChat });
        }
        elements.mwGameError.textContent = '';
        elements.mwJoinPanel.classList.add('mp-hidden');
        elements.mwGame.classList.remove('mp-hidden');
        elements.mwWorldStatus.textContent = world.public ? 'Public Banana Coast' : 'Private Banana Coast';
        elements.mwRoomCode.textContent = world.public ? 'PUBLIC WORLD' : `PRIVATE · ${world.code}`;
        if (monkeyWorld.pausedForMenu) {
            elements.monkeyWorldScreen.classList.add('open', 'menu-underlay');
            elements.monkeyWorldScreen.setAttribute('aria-hidden', 'false');
        }
        renderMonkeyWorldChat();
        startMonkeyWorldLoop();
    }

    function monkeyWorldJoinRequest() {
        const world = monkeyWorld.world || monkeyWorld.resumeAfterReconnect;
        if (world?.public !== false) return { type: 'join_public_monkey_world' };
        const code = String(world.code || '').trim();
        return code ? { type: 'join_private_monkey_world', code } : { type: 'join_public_monkey_world' };
    }

    function rejoinMonkeyWorld(message = 'Rejoining Monkey World…') {
        if (!state.authenticated || state.socket?.readyState !== WebSocket.OPEN) return false;
        monkeyWorld.resumeAfterReconnect = monkeyWorld.world
            ? { public: monkeyWorld.world.public, code: monkeyWorld.world.code || '' }
            : (monkeyWorld.resumeAfterReconnect || { public: true, code: '' });
        monkeyWorld.joined = false;
        stopMonkeyWorldLoop();
        elements.mwGameError.textContent = message;
        return send(monkeyWorldJoinRequest());
    }

    function sendMonkeyWorldChat(text) {
        monkeyWorld.pendingChatText = text;
        monkeyWorld.pendingChatNeedsResend = false;
        if (!monkeyWorld.joined) {
            monkeyWorld.pendingChatNeedsResend = true;
            rejoinMonkeyWorld();
            return true;
        }
        return send({ type: 'monkey_world_chat', text });
    }

    function worldBuildingNear(x, y) {
        return MONKEY_WORLD_BUILDINGS.find((building) => Math.hypot(x - building.doorX, y - building.doorY) < 105) || null;
    }

    function distanceToWorldPath(x, y, points) {
        let closest = Infinity;
        for (let index = 1; index < points.length; index += 1) {
            const [x1, y1] = points[index - 1], [x2, y2] = points[index];
            const dx = x2 - x1, dy = y2 - y1;
            const ratio = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / Math.max(1, dx * dx + dy * dy)));
            closest = Math.min(closest, Math.hypot(x - (x1 + dx * ratio), y - (y1 + dy * ratio)));
        }
        return closest;
    }

    function isWorldWalkable(x, y) {
        const paths = [
            // These widths cover the painted roads and their sidewalks. The
            // previous centre-line-only mask created invisible walls.
            { width: 350, points: [[80,900],[650,845],[1070,880],[1570,835],[2070,880],[2550,820],[3140,830]] },
            { width: 330, points: [[1600,80],[1580,510],[1580,830],[1570,1190],[1570,1690]] },
            { width: 290, points: [[540,900],[700,650],[900,835]] },
            { width: 300, points: [[1960,930],[2310,690],[2700,650]] },
            { width: 300, points: [[100,1410],[520,1320],[820,1510],[1190,1500],[1570,1390]] },
            { width: 290, points: [[1490,1050],[1790,1330],[2050,1700]] },
            // Curved arcade sidewalk and the road continuing south past it.
            // Its old mask began too far right and stranded players beside
            // the cabinet garden even though the painted pavement continued.
            { width: 440, points: [[2350,720],[2440,850],[2660,930],[2660,1010],[2785,1045],[2865,1120],[3050,1360],[3150,1600]] },
            { width: 240, points: [[900,900],[900,720]] },
            { width: 235, points: [[1580,510],[1635,650]] },
            { width: 245, points: [[2260,700],[2440,760]] },
            { width: 280, points: [[2020,1680],[2440,1580],[2800,1580],[3150,1660]] },
            // Stone stairs and the upper cliff walk.
            { width: 210, points: [[1080,170],[1100,390],[1210,560],[1430,700]] },
            // Market deck, bridges and the complete lower-left boardwalk loop.
            { width: 235, points: [[30,700],[190,760],[390,850],[570,980],[680,1160],[580,1320]] },
            { width: 225, points: [[60,1180],[270,1240],[520,1340],[720,1480],[940,1510],[1170,1450],[1280,1580]] },
            { width: 225, points: [[80,1420],[250,1530],[520,1590],[790,1660],[1080,1690],[1280,1580]] },
            // The visible southern beach and the Clan Hall stairs/forecourt.
            { width: 320, points: [[1160,1690],[1430,1600],[1700,1660],[2000,1580],[2240,1650]] },
            { width: 250, points: [[1840,1710],[1940,1590],[2050,1510]] },
            // Clan Hall route: road -> right-side garden gate -> front steps
            // -> southern beach. The hall itself remains solid.
            { width: 260, points: [[3150,1080],[3060,1240],[2910,1370],[2760,1430],[2670,1520],[2470,1600],[2220,1600],[2050,1660]] },
            { width: 235, points: [[2760,1430],[2870,1540],[3090,1630]] }
        ];
        const pavedAreas = [
            { x: 1635, y: 960, rx: 650, ry: 485 },
            // Broad public forecourts traced from the painted scene/reference.
            // Building footprints are still rejected separately below.
            { x: 760, y: 855, rx: 560, ry: 330 },
            { x: 1580, y: 600, rx: 390, ry: 245 },
            { x: 2390, y: 680, rx: 480, ry: 300 },
            { x: 2810, y: 1060, rx: 520, ry: 390 },
            { x: 2300, y: 1580, rx: 620, ry: 265 },
            { x: 2050, y: 1660, rx: 300, ry: 205 },
            { x: 520, y: 1450, rx: 430, ry: 260 },
            { x: 1540, y: 1680, rx: 440, ry: 165 }
        ];
        if (pavedAreas.some((area) => ((x - area.x) / area.rx) ** 2 + ((y - area.y) / area.ry) ** 2 <= 1)) return true;
        return paths.some((path) => distanceToWorldPath(x, y, path.points) <= path.width / 2);
    }

    function collidesWorldBuilding(x, y) {
        return MONKEY_WORLD_BUILDINGS.some((building) => {
            const doorwayThreshold = Math.abs(x - building.doorX) <= 62 && y >= building.doorY - 48;
            if (doorwayThreshold) return false;
            // The monkey position represents its feet. A small foot radius is
            // enough; the previous 25px expansion blocked visible sidewalks.
            const footRadius = 12;
            const boxes = building.collisions || [building.collision || building];
            return boxes.some((box) => x > box.x - footRadius && x < box.x + box.w + footRadius
                && y > box.y - footRadius && y < box.y + box.h + footRadius);
        });
    }

    function openWorldBuilding(building) {
        if (!building) return;
        monkeyWorld.currentInterior = building.id;
        monkeyWorld.nearbyInteriorStation = null;
        monkeyWorld.keys.clear();
        elements.mwBuildingModal.dataset.building = building.id;
        elements.mwBuildingTitle.textContent = `${building.icon} ${building.name}`;
        const roomIntro = {
            market: ['Fresh finds from every corner of Banana Coast.', 'Shelves of crates, boosts, cosmetics, and collectible treats.'],
            wardrobe: ['Your private tropical dressing studio.', 'Try on unlocked monkeys and titles before heading back outside.'],
            cafe: ['A sunny lounge overlooking the coast.', 'Take a break, meet explorers, and enjoy a banana smoothie.'],
            arcade: ['Neon games and friendly high-score challenges.', 'Jump back into an online mode or hang out beside the cabinets.'],
            clan: ['The headquarters of Banana Coast clans.', state.clan ? `Welcome, [${escapeHtml(state.clan.tag)}] ${escapeHtml(state.clan.name)}.` : 'Create a clan or accept an invitation from Friends & Messages.']
        }[building.id];
        const action = (icon, title, copy, attributes) => `<button class="mw-building-action" ${attributes} type="button"><span>${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div><b aria-hidden="true">›</b></button>`;
        const actions = building.id === 'market'
            ? [action('🎁','Crate Counter','Preview crate contents and open saved crates','data-world-shop="crates"'), action('⚡','Boost Shelf','Buy, stack, activate, or deactivate boost tickets','data-world-shop="boosts"'), action('✨','Cosmetics Wall','Browse trails, styles, themes, and emojis','data-world-shop="cosmetics"')]
            : building.id === 'wardrobe'
                ? [action('🐵','Monkey Wardrobe','Choose and preview an unlocked monkey','data-world-wardrobe="skins"'), action('🎟️','Title Studio','Equip titles and title styles','data-world-wardrobe="titles"')]
                : building.id === 'cafe'
                    ? [action('🥤','Smoothie Bar','Enjoy a fresh banana smoothie','data-world-activity="smoothie"'), action('💬','Friends Table','Meet friends, manage parties, and read messages','data-world-social')]
                    : building.id === 'arcade'
                        ? [action('🎮','Online Cabinets','Browse every online game mode','data-world-online'), action('🏆','Profile Terminal','Open friends, profiles, messages, and achievements','data-world-social')]
                        : [action('🛡️','Clan Command Table','Open your Clan Headquarters','id="mwOpenClanHall"'), action('👥','Recruitment Board','Invite friends and manage your social list','data-world-social')];
        elements.mwBuildingContent.innerHTML = `<div class="mw-building-menu mw-building-menu-${building.id}"><section class="mw-building-menu-hero"><span>${building.icon}</span><div><p class="mw-interior-kicker">WELCOME TO</p><h3>${escapeHtml(building.name)}</h3><strong>${roomIntro[0]}</strong><p>${roomIntro[1]}</p></div></section><section class="mw-building-services"><div class="mw-building-services-head"><div><small>BUILDING SERVICES</small><h4>What would you like to do?</h4></div><span>${actions.length} destinations</span></div><div class="mw-building-action-grid">${actions.join('')}</div></section><footer class="mw-building-menu-footer"><span>Choose a service above. Your monkey stays safely outside while you browse.</span><button class="mp-danger" data-world-exit type="button">Exit to Banana Coast</button></footer></div>`;
        elements.mwBuildingModal.classList.add('open');
        elements.mwBuildingModal.setAttribute('aria-hidden', 'false');
    }

    function closeWorldBuilding() {
        monkeyWorld.currentInterior = null;
        monkeyWorld.nearbyInteriorStation = null;
        monkeyWorld.keys.clear();
        elements.mwBuildingModal.classList.remove('open');
        elements.mwBuildingModal.setAttribute('aria-hidden', 'true');
        delete elements.mwBuildingModal.dataset.building;
    }

    const WORLD_EXTERNAL_MENU_IDS = [
        'shopMenu','skinMenu','titlesMenu','inventoryMenu','unlockPopup','crateOpeningPopup','crateOddsPopup',
        'powerupsInfoPopup','customTitleColorPopup','mpRewardModal','mpGiftModal','mpSocialCenter','mpClanModal','onlineModesScreen'
    ];

    function worldExternalMenuVisible() {
        return WORLD_EXTERNAL_MENU_IDS.some((id) => elementIsVisible(document.getElementById(id)));
    }

    function scheduleWorldMenuReturn(delay = 320) {
        clearTimeout(monkeyWorld.menuReturnTimer);
        if (!monkeyWorld.pausedForMenu || !monkeyWorld.joined) return;
        monkeyWorld.menuReturnTimer = setTimeout(() => {
            monkeyWorld.menuReturnTimer = null;
            if (worldExternalMenuVisible()) {
                scheduleWorldMenuReturn(220);
                return;
            }
            restoreWorldAfterMenu(true);
        }, delay);
    }

    function pauseWorldForExistingMenu(menuButtonId, followup) {
        closeWorldBuilding();
        for (const id of ['settingsPopup','musicOptionsPopup','skinMenu','titlesMenu','modeMenu','shopMenu','profileMenu','bananaPassMenu','inventoryMenu','powerupsInfoPopup','socialsPopup']) {
            const panel = document.getElementById(id);
            if (!panel) continue;
            if (id === 'inventoryMenu') {
                panel.classList.remove('open');
                panel.setAttribute('aria-hidden', 'true');
                panel.style.removeProperty('display');
            } else {
                panel.style.display = 'none';
            }
        }
        const defenseScreen = document.getElementById('towerDefenseScreen');
        if (defenseScreen) defenseScreen.style.display = 'none';
        closeOnlineHub({ restoreWorld:false });
        monkeyWorld.pausedForMenu = true;
        // Keep Monkey World rendered underneath the base-game menu. This
        // prevents the normal lobby from flashing through while a picker is
        // rebuilding or during the frame in which the player closes it.
        elements.monkeyWorldScreen.classList.add('menu-underlay');
        document.getElementById(menuButtonId)?.click();
        if (followup) setTimeout(followup, 0);
        scheduleWorldMenuReturn();
    }

    function restoreWorldAfterMenu(force = false) {
        if (!monkeyWorld.pausedForMenu || !monkeyWorld.joined) return;
        if (!force && worldExternalMenuVisible()) {
            scheduleWorldMenuReturn();
            return;
        }
        clearTimeout(monkeyWorld.menuReturnTimer);
        monkeyWorld.menuReturnTimer = null;
        monkeyWorld.pausedForMenu = false;
        elements.monkeyWorldScreen.classList.remove('menu-underlay');
        elements.monkeyWorldScreen.classList.add('open');
        syncAccountCosmetics(true);
        startMonkeyWorldLoop();
    }
    window.restoreMonkeyWorldAfterMenu = restoreWorldAfterMenu;

    // Base-game pickers briefly hide/rebuild after purchases, skin changes, and
    // crate transitions. Use a grace period and include every nested overlay so
    // that temporary rebuild is not mistaken for the player closing the menu.
    for (const menuId of ['shopMenu', 'skinMenu', 'titlesMenu']) {
        const menu = document.getElementById(menuId);
        if (!menu) continue;
        new MutationObserver(() => {
            if (monkeyWorld.pausedForMenu && !elementIsVisible(menu)) scheduleWorldMenuReturn();
        }).observe(menu, { attributes:true, attributeFilter:['style', 'class'] });
    }
    new MutationObserver(() => {
        if (!monkeyWorld.pausedForMenu) return;
        if (worldExternalMenuVisible()) {
            elements.monkeyWorldScreen.classList.add('open', 'menu-underlay');
            elements.monkeyWorldScreen.setAttribute('aria-hidden', 'false');
        }
        scheduleWorldMenuReturn();
    }).observe(document.body, { subtree:true, attributes:true, attributeFilter:['style','class','aria-hidden'] });

    function monkeyWorldPhase() {
        const elapsed = ((Date.now() + state.serverOffset - Number(monkeyWorld.world?.dayCycleStartedAt || Date.now())) / 1000 % 360 + 360) % 360;
        if (elapsed < 45) return { name: 'DAWN', color: 'rgba(255,154,92,.16)' };
        if (elapsed < 180) return { name: 'DAY', color: 'rgba(255,244,157,.02)' };
        if (elapsed < 225) return { name: 'SUNSET', color: 'rgba(255,92,78,.2)' };
        return { name: 'NIGHT', color: 'rgba(12,20,66,.4)' };
    }

    function monkeyWorldViewport() {
        const canvas = elements.monkeyWorldCanvas;
        const rect = canvas.getBoundingClientRect();
        const cssWidth = Math.max(1, Math.round(rect.width || innerWidth));
        const cssHeight = Math.max(1, Math.round(rect.height || innerHeight));
        // Preserve the phone's real aspect ratio and zoom its camera out. The
        // old 640px minimum squeezed a landscape buffer into portrait.
        const mobileCameraZoom = LOCAL_MOBILE_DEVICE || matchMedia('(pointer: coarse)').matches ? 1.62 : 1;
        const viewWidth = Math.min(MONKEY_WORLD_WIDTH, Math.round(cssWidth * mobileCameraZoom));
        const viewHeight = Math.min(MONKEY_WORLD_HEIGHT, Math.round(cssHeight * mobileCameraZoom));
        const mobileWorld = LOCAL_MOBILE_DEVICE || matchMedia('(pointer: coarse)').matches || cssWidth <= 760;
        const density = Math.min(mobileWorld ? 1.35 : 1.75, Math.max(1, Number(devicePixelRatio) || 1));
        const pixelWidth = Math.round(cssWidth * density);
        const pixelHeight = Math.round(cssHeight * density);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }
        const context = canvas.getContext('2d');
        context.setTransform(pixelWidth / viewWidth, 0, 0, pixelHeight / viewHeight, 0, 0);
        return { context, viewWidth, viewHeight };
    }

    function worldLocationName(x, y) {
        const nearby = MONKEY_WORLD_BUILDINGS.find((building) => Math.hypot(x - building.doorX, y - building.doorY) < 330);
        if (nearby) return nearby.name;
        if (y > 1450) return 'Sunset Beach';
        if (x < 650) return 'Palm Cove';
        if (x > 2550) return 'Arcade Point';
        if (y < 430) return 'Coastal Gardens';
        return 'Banana Coast Plaza';
    }

    function drawWorldPlayer(context, player, now) {
        const moving = Boolean(player.moving || (player.profileId === state.account?.id && monkeyWorld.moving));
        const step = moving ? Math.sin(now * .014 + Number(player.x || 0) * .01) : Math.sin(now * .0025 + Number(player.y || 0) * .01) * .2;
        const bob = moving ? Math.abs(step) * -7 : step * 3;
        const lean = moving ? step * .045 : 0;
        const perspective = .78 + Math.max(0, Math.min(1, Number(player.y || 0) / MONKEY_WORLD_HEIGHT)) * .30;
        const spriteWidth = 104 * perspective;
        const spriteHeight = 104 * perspective;
        context.save();
        context.globalAlpha = .34;
        context.fillStyle = '#062a27';
        context.beginPath();
        context.ellipse(player.x, player.y + 7, (42 - Math.abs(step) * 4) * perspective, (16 - Math.abs(step) * 2) * perspective, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();

        const image = worldImage(player.skin);
        context.save();
        context.translate(player.x, player.y - 48 + bob);
        context.rotate(lean);
        const facingLeft = player.direction === 'left';
        if (facingLeft) context.scale(-1, 1);
        if (moving) context.scale(1 - Math.abs(step) * .035, 1 + Math.abs(step) * .055);
        context.imageSmoothingEnabled = false;
        if (image.complete && image.naturalWidth) context.drawImage(image, -spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight);
        else {
            const fallback = context.createRadialGradient(-12, -18, 4, 0, 0, 52);
            fallback.addColorStop(0, '#fff2a0'); fallback.addColorStop(1, '#d77720');
            context.fillStyle = fallback; context.beginPath(); context.arc(0, 0, 48, 0, Math.PI * 2); context.fill();
        }
        context.restore();

        const tag = player.clan ? `[${player.clan.tag}] ` : '';
        const label = `${tag}${player.username}`;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.font = '900 15px Arial';
        const hasRankIcon = Boolean(player.ranked?.icon);
        const rankIconSpace = hasRankIcon ? 30 : 0;
        const platformIconSpace = ['mobile','pc'].includes(player.platform) ? 24 : 0;
        const labelWidth = Math.min(310, context.measureText(label).width + 42 + rankIconSpace + platformIconSpace);
        const labelTextX = player.x + (rankIconSpace - platformIconSpace) / 2;
        const equippedTitle = player.equippedTitle && player.equippedTitle !== 'None' ? String(player.equippedTitle).slice(0, 35) : '';
        const nameTop = player.y - (equippedTitle ? 154 : 128) + bob;
        const nameCenter = nameTop + 16;
        context.fillStyle = 'rgba(3,24,23,.9)';
        context.strokeStyle = player.profileId === state.account?.id ? '#ffe36c' : 'rgba(183,238,211,.75)';
        context.lineWidth = 3;
        context.beginPath(); context.roundRect(player.x - labelWidth / 2, nameTop, labelWidth, 31, 14); context.fill(); context.stroke();
        context.fillStyle = '#fffbe7'; context.fillText(label, labelTextX, nameCenter, labelWidth - 24 - rankIconSpace - platformIconSpace);
        if (hasRankIcon) {
            const rankImage = worldImage(rankIconSource(player.ranked));
            if (rankImage.complete && rankImage.naturalWidth) context.drawImage(rankImage, player.x - labelWidth / 2 + 8, nameTop + 3, 25, 25);
        }
        if (platformIconSpace) drawPlatformBadge(context, player.x + labelWidth / 2 - 17, nameCenter, player.platform, 17);
        if (equippedTitle) {
            const style = normalizedTitleStyle(player.titleStyle);
            context.font = '900 10px Arial';
            const titleWidth = Math.min(250, context.measureText(equippedTitle).width + 20);
            context.fillStyle = 'rgba(4,37,32,.9)';
            context.strokeStyle = style.fx === 'glitch' ? 'rgba(66,238,255,.8)' : 'rgba(255,225,103,.78)';
            context.lineWidth = 2;
            const titleTop = player.y - 118 + bob;
            const titleY = titleTop + 10;
            context.beginPath(); context.roundRect(player.x - titleWidth / 2, titleTop, titleWidth, 20, 9); context.fill(); context.stroke();
            const hue = (now / (style.rgbSpeed * 1000) * 360) % 360;
            let titleColor = style.rgb ? `hsl(${hue},100%,82%)` : style.color;
            if (style.fx === 'fire') titleColor = '#fff0a8';
            else if (style.fx === 'sparkle') titleColor = '#fff8c9';
            else if (style.fx === 'glitch') {
                context.globalAlpha = .7;
                context.fillStyle = '#00efff';
                context.fillText(equippedTitle, player.x - 1.4, titleY, titleWidth - 12);
                context.fillStyle = '#ff43c8';
                context.fillText(equippedTitle, player.x + 1.4, titleY, titleWidth - 12);
                context.globalAlpha = 1;
                titleColor = '#ffffff';
            } else if (style.fx === 'neonpulse') {
                titleColor = `hsl(${hue},100%,86%)`;
            }
            context.shadowColor = titleColor;
            context.shadowBlur = style.glow || style.fx !== 'none' ? 6 : 0;
            context.fillStyle = titleColor;
            context.fillText(equippedTitle, player.x, titleY, titleWidth - 12);
            context.shadowBlur = 0;
            if (style.fx === 'fire') {
                const emberOffset = 4 + Math.sin(now * .006) * 2;
                context.fillStyle = '#ff8b22';
                context.beginPath(); context.arc(player.x - titleWidth / 2 + 7, titleY - emberOffset, 1.5, 0, Math.PI * 2); context.fill();
                context.beginPath(); context.arc(player.x + titleWidth / 2 - 7, titleY - 7 + emberOffset * .35, 1.2, 0, Math.PI * 2); context.fill();
            } else if (style.fx === 'sparkle') {
                context.fillStyle = '#fff69b';
                context.font = '900 9px Arial';
                context.fillText('✦', player.x - titleWidth / 2 + 5, titleY - 5);
                context.fillText('✦', player.x + titleWidth / 2 - 5, titleY + 4);
            }
        }
        context.font = '900 10px Arial'; context.fillStyle = '#ffe36c';
        context.fillText(`LEVEL ${Math.max(1, Number(player.level) || 1)}`, player.x, player.y - 91 + bob);
        const bubble = monkeyWorld.chatBubbles.get(player.profileId);
        if (bubble && bubble.until > now) {
            const rawText = String(bubble.text || '');
            const parts = canvasMessageParts(rawText, 54);
            const hasEmoji = parts.some((part) => part.type === 'emoji');
            if (hasEmoji) {
                context.save();
                context.font = '900 12px Arial';
                const emojiSize = 34;
                const gap = 3;
                const measuredParts = parts.map((part) => ({
                    ...part,
                    width: part.type === 'emoji' ? emojiSize : context.measureText(part.text).width
                }));
                const naturalWidth = measuredParts.reduce((total, part) => total + part.width, 0) + Math.max(0, measuredParts.length - 1) * gap;
                const contentScale = Math.min(1, 300 / Math.max(1, naturalWidth));
                const contentWidth = naturalWidth * contentScale;
                const bubbleWidth = Math.max(54, contentWidth + 24);
                const bubbleHeight = Math.max(42, emojiSize * contentScale + 12);
                const bubbleY = equippedTitle ? player.y - 218 + bob : player.y - 190 + bob;
                context.fillStyle = 'rgba(255,255,255,.97)';
                context.strokeStyle = '#164b3d';
                context.lineWidth = 3;
                context.beginPath();
                context.roundRect(player.x - bubbleWidth / 2, bubbleY, bubbleWidth, bubbleHeight, 15);
                context.fill();
                context.stroke();

                context.translate(player.x - contentWidth / 2, bubbleY + bubbleHeight / 2);
                context.scale(contentScale, contentScale);
                context.textAlign = 'left';
                context.textBaseline = 'middle';
                context.fillStyle = '#12372f';
                let cursorX = 0;
                for (const part of measuredParts) {
                    if (part.type === 'emoji') {
                        const emojiImage = worldImage(part.emoji.file);
                        if (emojiImage.complete && emojiImage.naturalWidth) {
                            context.drawImage(emojiImage, cursorX, -emojiSize / 2, emojiSize, emojiSize);
                        } else {
                            context.fillText(`[${part.emoji.name}]`, cursorX, 0);
                        }
                    } else {
                        context.fillText(part.text, cursorX, 0);
                    }
                    cursorX += part.width + gap;
                }
                context.restore();
            } else {
                const text = messageCanvasText(rawText).slice(0, 54);
                context.font = '900 12px Arial';
                const width = Math.min(320, context.measureText(text).width + 30);
                const bubbleY = equippedTitle ? player.y - 202 + bob : player.y - 174 + bob;
                context.fillStyle = 'rgba(255,255,255,.96)'; context.strokeStyle = '#164b3d'; context.lineWidth = 3;
                context.beginPath(); context.roundRect(player.x - width / 2, bubbleY, width, 36, 14); context.fill(); context.stroke();
                context.fillStyle = '#12372f'; context.fillText(text, player.x, bubbleY + 18, width - 16);
            }
        }
    }

    function drawMonkeyWorld(now = performance.now()) {
        const { context, viewWidth, viewHeight } = monkeyWorldViewport();
        const maximumCameraX = Math.max(0, MONKEY_WORLD_WIDTH - viewWidth);
        const maximumCameraY = Math.max(0, MONKEY_WORLD_HEIGHT - viewHeight);
        monkeyWorld.cameraX = Math.max(0, Math.min(maximumCameraX, monkeyWorld.cameraX));
        monkeyWorld.cameraY = Math.max(0, Math.min(maximumCameraY, monkeyWorld.cameraY));
        if (monkeyWorldRenderer) monkeyWorldRenderer.render(context, {
            cameraX: monkeyWorld.cameraX,
            cameraY: monkeyWorld.cameraY,
            viewWidth,
            viewHeight,
            now,
            buildings: MONKEY_WORLD_BUILDINGS
        });
        else { context.fillStyle = '#26a8bd'; context.fillRect(0, 0, viewWidth, viewHeight); }

        context.save();
        context.translate(-monkeyWorld.cameraX, -monkeyWorld.cameraY);
        for (const building of MONKEY_WORLD_BUILDINGS) {
            const near = building.id === monkeyWorld.nearbyBuilding?.id;
            const pulse = .5 + Math.sin(now * .006) * .5;
            context.textAlign = 'center';
            context.fillStyle = near ? `rgba(255,227,91,${.18 + pulse * .18})` : 'rgba(255,255,255,.07)';
            context.beginPath(); context.arc(building.doorX, building.doorY + 8, near ? 66 + pulse * 8 : 43, 0, Math.PI * 2); context.fill();
            if (near) {
                context.fillStyle = '#fff4a1'; context.strokeStyle = '#173d30'; context.lineWidth = 6; context.font = '900 17px Arial';
                const enterPrompt = LOCAL_MOBILE_DEVICE || matchMedia('(pointer: coarse)').matches
                    ? `TAP TO ENTER ${building.name.toUpperCase()}`
                    : `E · ENTER ${building.name.toUpperCase()}`;
                context.strokeText(enterPrompt, building.doorX, building.doorY + 84);
                context.fillText(enterPrompt, building.doorX, building.doorY + 84);
            }
        }
        const players = [...monkeyWorld.players.values()].filter((player) => player.profileId !== state.account?.id);
        players.push({ ...(monkeyWorld.players.get([...monkeyWorld.players.keys()].find((id) => monkeyWorld.players.get(id)?.profileId === state.account?.id)) || {}), profileId: state.account?.id, username: state.account?.username || 'You', platform:state.account?.platform || (LOCAL_MOBILE_DEVICE ? 'mobile' : 'pc'), skin: currentSkin(), equippedTitle: currentTitle(), titleStyle: currentTitleStyle(), level: state.account?.level || 1, clan: state.account?.clan, ranked: state.account?.ranked, x: monkeyWorld.x, y: monkeyWorld.y, direction: monkeyWorld.direction, moving: monkeyWorld.moving });
        players.sort((first, second) => first.y - second.y);
        for (const player of players) drawWorldPlayer(context, player, now);
        context.restore();
        monkeyWorldRenderer?.drawForeground?.(context, {
            cameraX: monkeyWorld.cameraX,
            cameraY: monkeyWorld.cameraY,
            players,
            buildings: MONKEY_WORLD_BUILDINGS
        });

        const phase = monkeyWorldPhase();
        elements.mwTimeOfDay.textContent = phase.name;
        context.fillStyle = phase.color; context.fillRect(0, 0, viewWidth, viewHeight);
        elements.mwLocation.textContent = worldLocationName(monkeyWorld.x, monkeyWorld.y);
    }

    function monkeyWorldLoop(now) {
        if (!monkeyWorld.active || !monkeyWorld.joined) { monkeyWorld.animationFrame = null; return; }
        if (document.hidden || window.flappyAppSuspended) {
            monkeyWorld.lastTick = now;
            monkeyWorld.animationFrame = requestAnimationFrame(monkeyWorldLoop);
            return;
        }
        const delta = Math.min(.15, Math.max(0, (now - monkeyWorld.lastTick) / 1000));
        monkeyWorld.lastTick = now;
        let dx = 0, dy = 0;
        if (monkeyWorld.keys.has('KeyW') || monkeyWorld.keys.has('ArrowUp')) dy -= 1;
        if (monkeyWorld.keys.has('KeyS') || monkeyWorld.keys.has('ArrowDown')) dy += 1;
        if (monkeyWorld.keys.has('KeyA') || monkeyWorld.keys.has('ArrowLeft')) dx -= 1;
        if (monkeyWorld.keys.has('KeyD') || monkeyWorld.keys.has('ArrowRight')) dx += 1;
        dx += Number(monkeyWorld.touchX || 0);
        dy += Number(monkeyWorld.touchY || 0);
        const pad = navigator.getGamepads?.()[0];
        if (pad) { if (Math.abs(pad.axes[0] || 0) > .18) dx += pad.axes[0]; if (Math.abs(pad.axes[1] || 0) > .18) dy += pad.axes[1]; }
        const interactPressed = Boolean(pad?.buttons?.[0]?.pressed);
        if (interactPressed && !monkeyWorld.gamepadInteractDown) {
            if (!elements.mwBuildingModal.classList.contains('open') && monkeyWorld.nearbyBuilding) openWorldBuilding(monkeyWorld.nearbyBuilding);
        }
        monkeyWorld.gamepadInteractDown = interactPressed;
        const length = Math.hypot(dx, dy) || 1;
        const insideBuilding = elements.mwBuildingModal.classList.contains('open') && Boolean(monkeyWorld.currentInterior);
        const canWalk = !monkeyWorld.pausedForMenu && !insideBuilding;
        monkeyWorld.moving = Boolean((dx || dy) && canWalk);
        if (monkeyWorld.moving) {
            dx /= length; dy /= length;
            monkeyWorld.walkTime += delta;
            const nextX = Math.max(120, Math.min(MONKEY_WORLD_WIDTH - 120, monkeyWorld.x + dx * 285 * delta));
            const nextY = Math.max(135, Math.min(MONKEY_WORLD_HEIGHT - 145, monkeyWorld.y + dy * 285 * delta));
            if (isWorldWalkable(nextX, monkeyWorld.y) && !collidesWorldBuilding(nextX, monkeyWorld.y)) monkeyWorld.x = nextX;
            if (isWorldWalkable(monkeyWorld.x, nextY) && !collidesWorldBuilding(monkeyWorld.x, nextY)) monkeyWorld.y = nextY;
            monkeyWorld.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        }
        const mobileCameraZoom = LOCAL_MOBILE_DEVICE || matchMedia('(pointer: coarse)').matches ? 1.62 : 1;
        const viewWidth = Math.min(MONKEY_WORLD_WIDTH, (elements.monkeyWorldCanvas.clientWidth || innerWidth) * mobileCameraZoom);
        const viewHeight = Math.min(MONKEY_WORLD_HEIGHT, (elements.monkeyWorldCanvas.clientHeight || innerHeight) * mobileCameraZoom);
        const targetCameraX = Math.max(0, Math.min(MONKEY_WORLD_WIDTH - viewWidth, monkeyWorld.x - viewWidth / 2));
        const targetCameraY = Math.max(0, Math.min(MONKEY_WORLD_HEIGHT - viewHeight, monkeyWorld.y - viewHeight / 2));
        const cameraEase = Math.min(1, delta * 7.5);
        monkeyWorld.cameraX += (targetCameraX - monkeyWorld.cameraX) * cameraEase;
        monkeyWorld.cameraY += (targetCameraY - monkeyWorld.cameraY) * cameraEase;
        const building = worldBuildingNear(monkeyWorld.x, monkeyWorld.y);
        monkeyWorld.nearbyBuilding = building;
        elements.mwInteract.classList.toggle('mp-hidden', !building);
        if (building) elements.mwInteract.textContent = `Enter ${building.name}`;
        if (now - monkeyWorld.lastSentAt > 100) { monkeyWorld.lastSentAt = now; send({ type: 'monkey_world_player_state', x: monkeyWorld.x, y: monkeyWorld.y, direction: monkeyWorld.direction, moving: monkeyWorld.moving }); }
        if (now - monkeyWorld.lastRosterSyncAt > 2500) {
            monkeyWorld.lastRosterSyncAt = now;
            send({ type: 'get_monkey_world_state' });
        }
        const mobileWorld = LOCAL_MOBILE_DEVICE || matchMedia('(pointer: coarse)').matches || innerWidth <= 760;
        if (!mobileWorld || !monkeyWorld.lastRenderAt || now - monkeyWorld.lastRenderAt >= 30) {
            drawMonkeyWorld(now);
            monkeyWorld.lastRenderAt = now;
        }
        monkeyWorld.animationFrame = requestAnimationFrame(monkeyWorldLoop);
    }

    function openGiftModal(userId) {
        const friend = state.social.friends.find((profile) => profile.id === userId);
        if (!friend) return;
        state.giftFriendId = userId;
        const catalog = giftCatalog();
        elements.mpGiftTitle.textContent = `Send a Gift to ${friend.username}`;
        elements.mpGiftItem.innerHTML = catalog.map((item, index) => `<option value="${index}">[${escapeHtml(giftTypeLabel(item.giftType))}] ${escapeHtml(item.label)} — ${Number(item.price).toLocaleString()} Bananas</option>`).join('');
        elements.mpGiftMessage.value = '';
        elements.mpGiftError.textContent = '';
        updateGiftCost();
        elements.mpGiftModal.classList.add('open');
        elements.mpGiftModal.setAttribute('aria-hidden', 'false');
    }

    function updateGiftCost() {
        const item = giftCatalog()[Number(elements.mpGiftItem.value) || 0];
        const balance = Number.parseInt(localStorage.getItem('monkeyCoins') || '0', 10);
        elements.mpGiftCost.textContent = item ? `Cost: ${item.price.toLocaleString()} Bananas · You have ${balance.toLocaleString()}.` : '';
    }

    function closeGiftModal() {
        state.giftFriendId = null;
        elements.mpGiftModal.classList.remove('open');
        elements.mpGiftModal.setAttribute('aria-hidden', 'true');
    }

    function claimGift(giftId) {
        const gift = state.inbox.gifts.find((entry) => entry.id === giftId);
        if (!gift || gift.claimedAt) return;
        const marker = `flappyClaimedGift:${gift.id}`;
        try {
            if (localStorage.getItem(marker) !== 'applied') {
                const applied = typeof window.applyGiftedMarketItem === 'function' && window.applyGiftedMarketItem(gift);
                if (!applied) throw new Error('This version of the game cannot apply that market item yet.');
                localStorage.setItem(marker, 'applied');
            }
            send({ type: 'claim_gift', giftId: gift.id });
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function copyText(text, button) {
        const done = () => {
            const old = button.dataset.copyLabel || button.textContent;
            button.dataset.copyLabel = old;
            button.textContent = '✓ Copied!';
            button.classList.add('copy-success');
            button.setAttribute('aria-label', 'User ID copied to clipboard');
            showToast('✓ User ID copied to clipboard!');
            clearTimeout(button._copyFeedbackTimer);
            button._copyFeedbackTimer = setTimeout(() => {
                button.textContent = old;
                button.classList.remove('copy-success');
                button.removeAttribute('aria-label');
            }, 2200);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        } else fallbackCopy(text, done);
    }

    function fallbackCopy(text, done) {
        const input = document.createElement('textarea');
        input.value = text;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        try { document.execCommand('copy'); done(); } catch (_) { showToast('Could not copy automatically.', true); }
        input.remove();
    }

    function sessionKey(url = state.socketUrl) { return SESSION_PREFIX + url; }
    function profileKey(url = state.socketUrl) { return PROFILE_PREFIX + url; }
    function pendingOfflineResetKey(accountId = state.account?.id, url = state.socketUrl) {
        return accountId ? `${PENDING_OFFLINE_RESET_PREFIX}${url}:${accountId}` : '';
    }

    function clearPendingOfflineReset(accountId = state.account?.id, url = state.socketUrl) {
        const key = pendingOfflineResetKey(accountId, url);
        if (key) localStorage.removeItem(key);
    }

    function hasSavedLogin(url = state.socketUrl) {
        return Boolean(localStorage.getItem(sessionKey(url)) && readBestCachedProfile(url)?.id);
    }

    // A saved desktop session opts back into its own automatic reconnect on the
    // next launch. Explicitly choosing Stay Offline still applies for this run.
    if (!state.onlineOptIn && hasSavedLogin()) {
        state.onlineOptIn = true;
        sessionStorage.setItem('flappyOnlineOptIn', 'yes');
    }

    function cancelReconnect() {
        clearTimeout(reconnectTimer);
        clearTimeout(reconnectOverlayTimer);
        reconnectTimer = null;
        reconnectOverlayTimer = null;
        reconnectAttempt = 0;
    }

    function requestOnlineAccess(featureName = 'this online feature') {
        if (state.onlineOptIn) return Promise.resolve(true);
        if (onlineConsentResolve) return new Promise((resolve) => {
            const previous = onlineConsentResolve;
            onlineConsentResolve = (allowed) => { previous(allowed); resolve(allowed); };
        });
        elements.onlineConsentTitle.textContent = `Connect for ${featureName}?`;
        elements.onlineConsentText.textContent = `${featureName} needs the Flappy Monkey server. Your normal base game remains fully playable offline.`;
        elements.onlineConsentModal.classList.add('open');
        elements.onlineConsentModal.setAttribute('aria-hidden', 'false');
        elements.onlineConsentYes.focus();
        return new Promise((resolve) => { onlineConsentResolve = resolve; });
    }

    function finishOnlineConsent(allowed) {
        elements.onlineConsentModal.classList.remove('open');
        elements.onlineConsentModal.setAttribute('aria-hidden', 'true');
        const resolve = onlineConsentResolve;
        onlineConsentResolve = null;
        if (allowed) {
            state.onlineOptIn = true;
            sessionStorage.setItem('flappyOnlineOptIn', 'yes');
        }
        resolve?.(allowed);
    }

    function goOffline(message = 'Offline mode enabled. The base game remains fully playable.') {
        state.onlineOptIn = false;
        state.authenticated = false;
        sessionStorage.removeItem('flappyOnlineOptIn');
        cancelReconnect();
        closeSocket();
        elements.onlineStartupGate.classList.add('unlocked');
        elements.onlineStartupGate.setAttribute('aria-hidden', 'true');
        elements.multiplayerScreen.classList.remove('open');
        elements.multiplayerScreen.setAttribute('aria-hidden', 'true');
        updateInboxButton();
        updateActivityButton();
        onlinePopulation.textContent = '🐵 Offline';
        showToast(message);
    }

    function showStartupReconnect(message = '') {
        if (!state.onlineOptIn) return;
        const cached = readBestCachedProfile(state.socketUrl) || state.account;
        if (cached) state.account = cached;
        elements.onlineStartupGate.classList.remove('unlocked');
        elements.onlineStartupGate.setAttribute('aria-hidden', 'false');
        elements.startupAuth.classList.remove('open');
        elements.startupVerify.classList.remove('open');
        elements.startupSplash.style.display = '';
        elements.startupLoadingText.textContent = message || `Reconnecting ${state.account?.username || 'your account'}…`;
    }

    function queueReconnectOverlay(message) {
        if (reconnectOverlayTimer || !state.onlineOptIn) return;
        const show = () => {
            reconnectOverlayTimer = null;
            if (state.onlineOptIn && !state.authenticated && state.socket?.readyState !== WebSocket.OPEN) {
                showStartupReconnect(message);
            }
        };
        if (!elements.onlineStartupGate.classList.contains('unlocked')) show();
        else reconnectOverlayTimer = setTimeout(show, RECONNECT_OVERLAY_GRACE_MS);
    }

    function scheduleReconnect() {
        if (!state.onlineOptIn || !hasSavedLogin() || reconnectTimer) return;
        const baseDelay = Math.min(20_000, 1000 * (2 ** Math.min(reconnectAttempt, 5)));
        const delay = Math.round(baseDelay * (.85 + Math.random() * .3));
        reconnectAttempt += 1;
        setConnection('Reconnecting…', 'error');
        queueReconnectOverlay(`Connection interrupted — reconnecting ${state.account?.username || 'your account'} automatically…`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect(state.socketUrl).catch(() => scheduleReconnect());
        }, delay);
    }

    function closeSocket() {
        if (state.socket) {
            state.socket.onclose = null;
            state.socket.close();
        }
        state.socket = null;
        state.connecting = null;
        state.playerId = null;
        setConnection('Offline');
    }

    function send(message) {
        if (state.socket?.readyState !== WebSocket.OPEN) {
            showToast('Not connected to the multiplayer server.', true);
            return false;
        }
        state.socket.send(JSON.stringify(message));
        return true;
    }

    window.flappyOnlineSend = send;
    window.flappyOnlineState = () => ({
        connected: state.socket?.readyState === WebSocket.OPEN,
        authenticated: state.authenticated,
        playerId: state.playerId,
        account: state.account ? { ...state.account } : null,
        serverBuild: state.serverBuild,
        serverCapabilities: [...state.serverCapabilities]
    });
    // The local profile menu can open before the first server event fires.
    // Expose the current cached/live account so its public User ID is always
    // rendered immediately, including while reconnecting or playing offline.
    window.flappyGetActiveOnlineAccount = () => state.account ? { ...state.account } : null;
    window.flappyActiveOnlineAccount = state.account ? { ...state.account } : null;
    window.flappyRequestOnlineAccess = requestOnlineAccess;
    window.flappyOpenAccountCreation = async () => {
        state.onlineOptIn = true;
        sessionStorage.setItem('flappyOnlineOptIn', 'yes');
        elements.onlineStartupGate.classList.remove('unlocked');
        elements.onlineStartupGate.setAttribute('aria-hidden', 'false');
        showStartupAuth('Create an account below to save progress and unlock online play.');
        requestAnimationFrame(() => elements.startupRegisterUsername?.focus({ preventScroll:true }));
        try {
            await connect(DEFAULT_SERVER);
        } catch (error) {
            elements.startupAuthError.textContent = `${error.message} The account form will stay open so you can retry.`;
        }
    };

    function connect(explicitUrl = '') {
        const requestedUrl = String(explicitUrl || elements.startupServerUrl.value || elements.mpServerUrl.value || DEFAULT_SERVER).trim();
        if (!/^wss?:\/\//i.test(requestedUrl)) return Promise.reject(new Error('Server address must begin with ws:// or wss://.'));
        if (state.socket?.readyState === WebSocket.OPEN && state.socketUrl === requestedUrl) return Promise.resolve();
        if (state.connecting && state.socketUrl === requestedUrl) return state.connecting;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        closeSocket();
        state.socketUrl = requestedUrl;
        elements.mpServerUrl.value = requestedUrl;
        elements.startupServerUrl.value = requestedUrl;
        localStorage.setItem('flappyOnlineServer', requestedUrl);
        state.account = readBestCachedProfile(requestedUrl);
        setConnection('Connecting…');

        state.connecting = new Promise((resolve, reject) => {
            const socket = new WebSocket(requestedUrl);
            state.socket = socket;
            let settled = false;
            const resolveConnection = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (state.socket === socket) state.connecting = null;
                resolve();
            };
            const rejectConnection = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (state.socket === socket) state.connecting = null;
                reject(error);
            };
            const timeout = setTimeout(() => {
                rejectConnection(new Error('The multiplayer server is taking too long to wake up.'));
                try { socket.close(4000, 'Connection timed out'); } catch (_) {}
            }, CONNECTION_TIMEOUT_MS);
            socket.addEventListener('open', () => {
                if (state.socket !== socket) {
                    socket.close(1000, 'Superseded connection');
                    return;
                }
                setConnection('Connected', 'online');
                onlinePopulation.textContent = '🐵 Online · loading player count…';
                const token = localStorage.getItem(sessionKey());
                if (token) send({ type: 'resume_session', token });
                resolveConnection();
            });
            socket.addEventListener('message', (event) => handleServerMessage(event.data));
            socket.addEventListener('close', () => {
                window.dispatchEvent(new CustomEvent('flappy-online-disconnected'));
                rejectConnection(new Error('The multiplayer connection closed before it was ready.'));
                if (state.socket === socket) {
                    state.socket = null;
                    state.connecting = null;
                    setConnection('Disconnected', 'error');
                    onlinePopulation.textContent = state.onlineOptIn ? '🐵 Reconnecting…' : '🐵 Offline';
                    if (race.active) stopRace('Connection lost.');
                    if (monkeyWorld.joined || elements.monkeyWorldScreen.classList.contains('open')) {
                        monkeyWorld.resumeAfterReconnect = monkeyWorld.world
                            ? { public: monkeyWorld.world.public, code: monkeyWorld.world.code || '' }
                            : { public: true, code: '' };
                        monkeyWorld.joined = false;
                        stopMonkeyWorldLoop();
                        elements.mwGameError.textContent = 'Connection lost — rejoining Monkey World…';
                    }
                    if (state.onlineOptIn && hasSavedLogin()) {
                        state.authenticated = false;
                        scheduleReconnect();
                    } else if (state.authenticated) {
                        state.authenticated = false;
                        lockAccountGate('Connection lost. Log in again to continue.');
                    }
                }
            });
            socket.addEventListener('error', () => {
                setConnection('Connection failed', 'error');
                rejectConnection(new Error('Could not reach the multiplayer server yet.'));
            });
        });
        return state.connecting;
    }

    function showStartupAuth(message = '') {
        setStartupRegistrationBusy(false);
        elements.startupSplash.style.display = 'none';
        elements.startupVerify.classList.remove('open');
        elements.startupAuth.classList.add('open');
        elements.startupAuthError.textContent = message;
        requestAnimationFrame(() => setTimeout(() => {
            window.focus();
            elements.startupLoginUsername.focus({ preventScroll: true });
        }, 0));
    }

    function showEmailVerification(message) {
        setStartupRegistrationBusy(false);
        pendingRegistration = { id: message.pendingId, email: message.email };
        elements.startupSplash.style.display = 'none';
        elements.startupAuth.classList.remove('open');
        elements.startupVerify.classList.add('open');
        elements.startupVerifyText.textContent = `Enter the six-digit code sent to ${message.email}. It expires in 10 minutes.`;
        elements.startupVerifyCode.value = message.devCode || '';
        elements.startupVerifyError.textContent = message.devCode ? `Local test code: ${message.devCode}` : '';
        elements.startupVerifyCode.focus();
    }

    function setStartupRegistrationBusy(busy) {
        if (!elements.startupRegisterSubmit) return;
        elements.startupRegisterSubmit.disabled = Boolean(busy);
        elements.startupRegisterSubmit.textContent = busy ? 'Sending Code...' : 'Create Account & Play';
    }

    function lockAccountGate(message = '') {
        elements.onlineStartupGate.classList.remove('unlocked');
        elements.onlineStartupGate.setAttribute('aria-hidden', 'false');
        showStartupAuth(message);
    }

    function finishLocalLogout(message = 'You logged out. Log in again to play.') {
        // Preserve the signed-in account's live save in its isolated slot, then
        // reload to the account gate. Guest play is never entered implicitly:
        // the player must choose it from that gate after seeing that it does not
        // save progress.
        const loggedOutIdentity = typeof accountStorage.logoutActiveAccount === 'function'
            ? accountStorage.logoutActiveAccount(localStorage)
            : null;
        clearStoredLoginForServer(loggedOutIdentity?.serverUrl || state.socketUrl);
        sessionStorage.removeItem(GUEST_SESSION_READY_KEY);
        sessionStorage.setItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY, 'yes');
        sessionStorage.setItem('flappyOnlineOptIn', 'yes');
        cancelReconnect();
        state.authenticated = false;
        state.account = null;
        lastCosmeticsSignature = '';
        state.room = null;
        state.social = { friends: [], incoming: [], outgoing: [], blocked: [], groups: [], messages: [] };
        state.deletedSocialMessageIds.clear();
        state.clearedFriendConversations.clear();
        state.pendingChatAction = null;
        state.pendingMessageDraft = null;
        state.activeFriendId = null;
        state.activeGroupId = null;
        state.inbox = { gifts: [], receipts: [], announcements: [] };
        state.party = null;
        state.partyInvitations = [];
        state.clan = null;
        state.clanInvitations = [];
        state.ranked = null;
        state.rankedQueued = false;
        updateInboxButton();
        renderSocial();
        updateOnlineSettingsPanel();
        setView(elements.mpAuthView);
        sessionStorage.setItem('flappyPostReloadNotice', message);
        location.reload();
    }

    function startGuestSession() {
        const activeIdentity = accountStorage.readActiveAccount(localStorage);
        if (typeof accountStorage.logoutActiveAccount === 'function') {
            accountStorage.logoutActiveAccount(localStorage);
        }
        const identityServer = activeIdentity?.serverUrl || state.socketUrl;
        clearStoredLoginForServer(identityServer);
        sessionStorage.removeItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY);
        sessionStorage.setItem(GUEST_SESSION_READY_KEY, 'yes');
        sessionStorage.removeItem('flappyOnlineOptIn');
        sessionStorage.setItem('flappyPostReloadNotice', 'Guest mode started. Guest purchases, unlocks, and progress are erased when the game reloads.');
        cancelReconnect();
        closeSocket();
        location.reload();
    }

    function logoutAccount() {
        if (state.authenticated && state.socket?.readyState === WebSocket.OPEN) {
            // Logout is also the final save barrier for the signed-in account.
            // Include the live cloud snapshot in the same request so the server
            // cannot acknowledge logout before recent purchases/unlocks exist in
            // durable account storage.
            clearTimeout(cosmeticsSyncTimer);
            cosmeticsSyncTimer = null;
            queuedCosmeticsSyncForce = false;
            send({ type: 'logout', ...buildAccountSyncProfile() });
            return;
        }
        // Offline logout is necessarily local; it forgets the saved token and
        // account cache without touching the account's separate game save.
        finishLocalLogout('You logged out locally while offline. Log in again whenever you reconnect.');
    }

    function unlockAccountGate() {
        const finish = () => {
            elements.onlineStartupGate.classList.add('unlocked');
            elements.onlineStartupGate.setAttribute('aria-hidden', 'true');
        };
        const delay = Math.max(0, startupReadyAt - Date.now());
        if (delay) {
            elements.startupLoadingText.textContent = `Welcome back, ${state.account?.username || 'Monkey'}!`;
            setTimeout(finish, delay);
        } else finish();
    }

    function clearMultiplayerErrors() {
        elements.mpAuthError.textContent = '';
        elements.mpHomeError.textContent = '';
        elements.mpLobbyError.textContent = '';
        elements.startupAuthError.textContent = '';
        elements.startupVerifyError.textContent = '';
    }

    function setView(view) {
        for (const element of [elements.mpAuthView, elements.mpHomeView, elements.mpLobbyView, elements.mpRaceView]) element.classList.add('mp-hidden');
        view.classList.remove('mp-hidden');
    }

    async function openMultiplayer() {
        if (!await requestOnlineAccess('Online Race')) return;
        elements.multiplayerScreen.classList.add('open');
        elements.multiplayerScreen.setAttribute('aria-hidden', 'false');
        if (race.active) setView(elements.mpRaceView);
        else if (state.room) setView(elements.mpLobbyView);
        else if (state.account) { renderAccount(); setView(elements.mpHomeView); }
        else setView(elements.mpAuthView);
        if (!state.authenticated && hasSavedLogin()) showStartupReconnect(`Connecting ${state.account?.username || 'your saved account'}…`);
        connect().catch((error) => {
            elements.mpAuthError.textContent = error.message;
            if (hasSavedLogin()) {
                showStartupReconnect(`${error.message} Retrying automatically…`);
                scheduleReconnect();
            } else {
                showStartupAuth(error.message);
                setView(elements.mpAuthView);
            }
        });
    }

    function closeMultiplayer() {
        if (state.room) send({ type: 'leave_room' });
        if (state.party) send({ type: 'leave_party' });
        state.room = null;
        stopRace();
        closeResult();
        elements.multiplayerScreen.classList.remove('open');
        elements.multiplayerScreen.setAttribute('aria-hidden', 'true');
    }

    function renderAccount() {
        if (!state.account) return;
        ensureOnlineSettingsPanel();
        elements.mpAccountName.innerHTML = `<span>${escapeHtml(state.account.username)}${platformBadgeHtml(state.account.platform)}</span>${sharedTitleHtml({ ...state.account, ...localTitleProfile() })}`;
        const stats = state.account.stats || {};
        elements.mpStats.innerHTML = [
            ['Matches', stats.matches || 0], ['Wins', stats.wins || 0], ['Best Score', stats.bestScore || 0],
            ['Survival Wins', stats.survivalWins || 0], ['Target Wins', stats.targetWins || 0], ['Timed Wins', stats.timedWins || 0]
        ].map(([label, value]) => `<div class="mp-stat"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span></div>`).join('');
        updateOnlineSettingsPanel();
        renderRanked();
    }

    function socialPersonHtml(profile, kind) {
        const unread = kind === 'friend'
            ? state.social.messages.filter((message) => message.fromId === profile.id && !message.readAt).length
            : 0;
        let actions = kind === 'friend'
            ? `<button class="mp-primary" type="button" data-social-action="message" data-user-id="${escapeHtml(profile.id)}">Message${unread ? `<span class="mp-unread">${unread}</span>` : ''}</button><button class="mp-primary mp-gift-action" type="button" data-social-action="gift" data-user-id="${escapeHtml(profile.id)}"><img class="mp-gift-button-art" src="Birthday Bash Present.png" alt="" aria-hidden="true"><span>Gift</span></button><button type="button" data-social-action="remove" data-user-id="${escapeHtml(profile.id)}">Remove</button><button class="mp-danger" type="button" data-social-action="block" data-user-id="${escapeHtml(profile.id)}">Block</button>`
            : kind === 'incoming'
                ? `<button class="mp-primary" type="button" data-social-action="accept" data-user-id="${escapeHtml(profile.id)}">Accept</button><button type="button" data-social-action="decline" data-user-id="${escapeHtml(profile.id)}">Decline</button><button class="mp-danger" type="button" data-social-action="block" data-user-id="${escapeHtml(profile.id)}">Block</button>`
                : kind === 'outgoing'
                    ? `<button type="button" data-social-action="cancel" data-user-id="${escapeHtml(profile.id)}">Cancel Request</button>`
                    : `<button type="button" data-social-action="unblock" data-user-id="${escapeHtml(profile.id)}">Unblock</button>`;
        if (kind === 'friend') {
            const lobbyInvite = state.room?.phase === 'lobby' ? `<button class="mp-secondary" type="button" data-social-action="lobby-invite" data-user-id="${escapeHtml(profile.id)}">Lobby Invite</button>` : '';
            const worldInvite = monkeyWorld.joined ? `<button class="mp-secondary" type="button" data-social-action="world-invite" data-user-id="${escapeHtml(profile.id)}">World Invite</button>` : '';
            const defenseInvite = onlineDefense.room?.code && onlineDefense.room.phase === 'lobby' ? `<button class="mp-secondary" type="button" data-social-action="defense-invite" data-user-id="${escapeHtml(profile.id)}">Defense Invite</button>` : '';
            const partyInvite = state.party?.leaderId === state.account?.id && !state.party.members.some((member) => member.id === profile.id)
                ? `<button class="mp-secondary" type="button" data-social-action="party-invite" data-user-id="${escapeHtml(profile.id)}">Party Invite</button>` : '';
            const invitationSent = (state.clan?.pendingInvitationIds || []).includes(profile.id);
            const clanInvite = ['owner', 'officer'].includes(state.clan?.myRole) && !profile.clan
                ? `<button class="mp-secondary" type="button" data-social-action="clan-invite" data-user-id="${escapeHtml(profile.id)}" ${invitationSent ? 'disabled' : ''}>${invitationSent ? 'Invite Sent' : 'Clan Invite'}</button>` : '';
            actions = `<button class="mp-secondary" type="button" data-social-action="profile" data-user-id="${escapeHtml(profile.id)}">View Profile</button>${partyInvite}${lobbyInvite}${worldInvite}${defenseInvite}${clanInvite}${actions}`;
        }
        const equippedTitle = sharedTitleHtml(profile);
        const presence = profile.presence || (profile.online ? 'Online' : 'Offline');
        const clanTag = profile.clan ? `<span class="mp-clan-tag" style="color:${escapeHtml(profile.clan.tagColor || '#ffe56c')}">[${escapeHtml(profile.clan.tag)}]</span> ` : '';
        return `<div class="mp-social-person"><img src="${escapeHtml(profile.profilePicture || profile.skin)}" alt=""><div><div class="mp-social-name">${profile.ranked ? `<img class="mp-inline-rank" src="${escapeHtml(rankIconSource(profile.ranked))}" alt="${escapeHtml(profile.ranked.rank)}">` : ''}${clanTag}${escapeHtml(profile.username)}${platformBadgeHtml(profile.platform)} <span class="mp-level-badge">Lv. ${Math.max(1, Number(profile.level) || 1)}</span></div>${equippedTitle}<div class="mp-social-status ${profile.online ? 'online' : ''}">${escapeHtml(presence)}</div></div><div class="mp-social-actions">${actions}</div></div>`;
    }

    function renderParty() {
        elements.mpCreateParty.classList.toggle('mp-hidden', Boolean(state.party));
        if (!state.party) {
            elements.mpParty.innerHTML = state.partyInvitations.length ? state.partyInvitations.map((invite) => `
                <div class="mp-party-invite"><strong>${escapeHtml(invite.leader.username)}${platformBadgeHtml(invite.leader.platform)} invited you</strong><span>${invite.memberCount}/8 members</span><div><button class="mp-primary" type="button" data-party-action="accept" data-party-id="${escapeHtml(invite.id)}">Accept</button><button class="mp-secondary" type="button" data-party-action="decline" data-party-id="${escapeHtml(invite.id)}">Decline</button></div></div>
            `).join('') : '<div class="mp-empty-state">Create a party to queue with friends.</div>';
            return;
        }
        const leader = state.party.leaderId === state.account?.id;
        elements.mpParty.innerHTML = `
            <div class="mp-party-summary"><strong>Party · ${state.party.members.length}/8</strong>${state.party.members.map((member) => `
                <div class="mp-party-member"><img src="${escapeHtml(member.profilePicture || member.skin)}" alt=""><span>${escapeHtml(member.username)}${platformBadgeHtml(member.platform)}${member.id === state.party.leaderId ? ' 👑' : ''}${sharedTitleHtml(member.id === state.account?.id ? localTitleProfile() : member)}<small>${escapeHtml(member.presence || (member.online ? 'Online' : 'Offline'))}</small></span>${leader && member.id !== state.account?.id ? `<div><button type="button" data-party-action="promote" data-user-id="${escapeHtml(member.id)}">Leader</button><button class="mp-danger" type="button" data-party-action="kick" data-user-id="${escapeHtml(member.id)}">Kick</button></div>` : ''}</div>
            `).join('')}<button class="mp-danger" type="button" data-party-action="leave">${leader && state.party.members.length === 1 ? 'Disband Party' : 'Leave Party'}</button></div>`;
    }

    function clanRewardText(reward = {}) {
        return `${reward.label || 'Reward'} ×${Math.max(1, Number(reward.amount) || 1).toLocaleString()}`;
    }

    function renderClanSummary() {
        if (state.clan) {
            elements.mpClanSummary.innerHTML = `<div class="mp-clan-mini" style="border-color:${escapeHtml(state.clan.color)}"><strong><span style="color:${escapeHtml(state.clan.tagColor)}">[${escapeHtml(state.clan.tag)}]</span> ${escapeHtml(state.clan.name)}</strong><span>Clan Level ${state.clan.level} · ${state.clan.members.length} members</span></div>`;
        } else if (state.clanInvitations.length) {
            elements.mpClanSummary.innerHTML = state.clanInvitations.map((invite) => `<div class="mp-party-invite"><strong>[${escapeHtml(invite.tag)}] ${escapeHtml(invite.name)}</strong><span>${invite.memberCount} members</span><div><button class="mp-primary" data-clan-action="accept" data-clan-id="${escapeHtml(invite.id)}" type="button">Accept</button><button class="mp-secondary" data-clan-action="decline" data-clan-id="${escapeHtml(invite.id)}" type="button">Decline</button></div></div>`).join('');
        } else elements.mpClanSummary.innerHTML = '<div class="mp-empty-state">No clan yet.</div>';
    }

    function renderClanModal() {
        elements.mpClanError.textContent = '';
        if (!state.clan) {
            elements.mpClanContent.innerHTML = `
                ${state.clanInvitations.length ? `<div class="mp-clan-invites"><h3>Clan Invitations</h3>${state.clanInvitations.map((invite) => `<div class="mp-party-invite"><strong>[${escapeHtml(invite.tag)}] ${escapeHtml(invite.name)}</strong><span>Invited by ${escapeHtml(invite.owner.username)}</span><div><button class="mp-primary" data-clan-action="accept" data-clan-id="${escapeHtml(invite.id)}" type="button">Accept</button><button class="mp-secondary" data-clan-action="decline" data-clan-id="${escapeHtml(invite.id)}" type="button">Decline</button></div></div>`).join('')}</div>` : ''}
                <form id="mpCreateClanForm" class="mp-form"><h3>Create a Clan</h3><label>Unique clan name<input id="mpClanName" maxlength="30" required placeholder="Jungle Legends"></label><label>Unique clan tag (2–5)<input id="mpClanTag" maxlength="5" required placeholder="JUNG"></label><button class="mp-primary" type="submit">Create Clan</button></form>`;
            return;
        }
        const clan = state.clan;
        const canManage = ['owner', 'officer'].includes(clan.myRole);
        const isOwner = clan.myRole === 'owner';
        const bannerStyle = clan.banner ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.55)),url('${escapeHtml(clan.banner)}')` : `background:${escapeHtml(clan.color)}`;
        elements.mpClanContent.innerHTML = `
            <div class="mp-clan-hero" style="${bannerStyle}">${clan.icon ? `<img src="${escapeHtml(clan.icon)}" alt="Clan icon">` : '<div class="mp-clan-fallback">🐵</div>'}<div><h3><span style="color:${escapeHtml(clan.tagColor)}">[${escapeHtml(clan.tag)}]</span> ${escapeHtml(clan.name)}</h3><strong>Clan Level ${clan.level}</strong><span>${Number(clan.xp).toLocaleString()} Clan XP · ${Number(clan.totalScore).toLocaleString()} quest score</span></div></div>
            <div class="mp-clan-columns"><section><h3>Members</h3><div class="mp-clan-members">${clan.members.map((member) => `<div class="mp-party-member"><img src="${escapeHtml(member.profilePicture || member.skin)}" alt=""><span>${escapeHtml(member.username)}${platformBadgeHtml(member.platform)}${sharedTitleHtml(member.id === state.account?.id ? localTitleProfile() : member)}<small>${escapeHtml(member.role)} · ${escapeHtml(member.presence || 'Offline')}</small></span>${isOwner && member.id !== state.account?.id ? `<div><button data-clan-action="officer" data-user-id="${escapeHtml(member.id)}" type="button">${member.role === 'officer' ? 'Demote' : 'Officer'}</button><button data-clan-action="owner" data-user-id="${escapeHtml(member.id)}" type="button">Owner</button><button class="mp-danger" data-clan-action="kick" data-user-id="${escapeHtml(member.id)}" type="button">Kick</button></div>` : ''}</div>`).join('')}</div><button class="mp-danger" data-clan-action="leave" type="button">${isOwner && clan.members.length === 1 ? 'Disband Clan' : 'Leave Clan'}</button></section>
            <section><h3>Clan Quests</h3><div class="mp-clan-quests">${clan.quests.map((quest) => { const percent = Math.min(100, clan.totalScore / quest.goal * 100); return `<article class="${quest.completedAt ? 'complete' : ''}"><strong>${escapeHtml(quest.label)}</strong><span>Reward: ${escapeHtml(clanRewardText(quest.reward))}</span><div><i style="width:${percent}%"></i></div><small>${quest.completedAt ? 'COMPLETED' : `${Math.min(clan.totalScore, quest.goal).toLocaleString()} / ${quest.goal.toLocaleString()}`}</small></article>`; }).join('')}</div></section></div>
            ${isOwner ? `<form id="mpClanBrandingForm" class="mp-form mp-clan-branding"><h3>Clan Branding</h3><p class="mp-note">Icon unlocks at Level 2, banner at Level 3, and colors at Level 4.</p><div class="mp-button-row"><input id="mpClanIconFile" class="mp-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button id="mpChooseClanIcon" type="button" ${clan.brandingUnlocks.icon ? '' : 'disabled'}>Choose Icon</button><input id="mpClanBannerFile" class="mp-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button id="mpChooseClanBanner" type="button" ${clan.brandingUnlocks.banner ? '' : 'disabled'}>Choose Banner</button></div><div class="mp-clan-colors"><label>Clan color<input id="mpClanColor" type="color" value="${escapeHtml(clan.color)}" ${clan.brandingUnlocks.colors ? '' : 'disabled'}></label><label>Tag color<input id="mpClanTagColor" type="color" value="${escapeHtml(clan.tagColor)}" ${clan.brandingUnlocks.colors ? '' : 'disabled'}></label></div><button class="mp-primary" type="submit">Save Branding</button></form>` : canManage ? '<p class="mp-note">As a clan officer, use the Clan Invite button on accepted friends.</p>' : ''}`;
    }

    function openClanModal() {
        renderClanModal();
        elements.mpClanModal.classList.add('open');
        elements.mpClanModal.setAttribute('aria-hidden', 'false');
    }

    function closeClanModal() {
        state.pendingClanIcon = null;
        state.pendingClanBanner = null;
        elements.mpClanModal.classList.remove('open');
        elements.mpClanModal.setAttribute('aria-hidden', 'true');
        if (monkeyWorld.joined && monkeyWorld.pausedForMenu) restoreWorldAfterMenu();
    }

    function rankBadgeHtml(ranked, compact = false) {
        if (!ranked) return '';
        return `<span class="mp-rank-badge ${compact ? 'compact' : ''}"><img src="${escapeHtml(rankIconSource(ranked))}" alt=""><span><strong>${escapeHtml(ranked.rank || 'Bronze I')}</strong><small>${Number(ranked.rp || 0).toLocaleString()} RP</small></span></span>`;
    }

    function renderRanked() {
        const ranked = state.ranked;
        if (!ranked) {
            elements.mpRankedHomeSummary.innerHTML = '<div class="mp-empty-state">Connect to load your rank.</div>';
            elements.mpRankedContent.innerHTML = '<div class="mp-empty-state">Loading ranked information…</div>';
            return;
        }
        elements.mpRankedHomeSummary.innerHTML = `${rankBadgeHtml(ranked)}<div class="mp-rank-progress"><i style="width:${Number(ranked.progress) || 0}%"></i></div><small>${ranked.nextRank ? `${Number(ranked.nextRp).toLocaleString()} RP for ${escapeHtml(ranked.nextRank)}` : 'Monkey King RP is uncapped forever'}</small>`;
        elements.mpRankedQueue.textContent = state.rankedQueued ? 'Cancel Ranked Queue' : 'Find Ranked Match';
        const ladder = state.rankedTiers.map((tier) => `<div class="mp-rank-tier ${tier.name === ranked.rank ? 'current' : ''}"><img src="${escapeHtml(rankIconSource(tier))}" alt=""><span><strong>${escapeHtml(tier.name)}</strong><small>${Number(tier.minimumRp).toLocaleString()} RP</small></span></div>`).join('');
        const leaders = state.rankedLeaderboard.length ? state.rankedLeaderboard.map((entry) => `<button class="mp-ranked-leader" type="button" data-ranked-profile="${escapeHtml(entry.id)}"><b>#${entry.place}</b><img src="${escapeHtml(rankIconSource(entry.ranked))}" alt=""><span><strong>${entry.clan ? `[${escapeHtml(entry.clan.tag)}] ` : ''}${escapeHtml(entry.username)}${platformBadgeHtml(entry.platform)}</strong><small>${escapeHtml(entry.ranked.rank)} · ${Number(entry.ranked.rp).toLocaleString()} RP</small></span></button>`).join('') : '<div class="mp-empty-state">No one has completed a Season 1 ranked match yet.</div>';
        const history = ranked.history?.length ? ranked.history.map((entry) => `<div class="mp-rank-history"><strong>Season ${entry.season} Ranked</strong><span>${escapeHtml(entry.highestRank)} · ${Number(entry.peakRp).toLocaleString()} peak RP · ${Number(entry.progress)}% rank progress</span></div>`).join('') : '<div class="mp-empty-state">Season history appears here after a season reset.</div>';
        const ownerTools = state.account?.isOwner ? `<form id="mpOwnerRankForm" class="mp-form mp-owner-rank"><h3>Owner Rank Controls</h3><input id="mpOwnerRankUser" placeholder="FMU_... User ID" required><select id="mpOwnerRankSelect">${state.rankedTiers.map((tier) => `<option value="${escapeHtml(tier.name)}">${escapeHtml(tier.name)}</option>`).join('')}</select><div class="mp-button-row"><button class="mp-primary" type="submit">Set Rank</button><button id="mpOwnerRemoveRank" class="mp-danger" type="button">Remove Rank</button><button id="mpOwnerResetRanks" class="mp-danger" type="button">Reset Everyone</button></div></form>` : '';
        elements.mpRankedContent.innerHTML = `<div class="mp-ranked-current">${rankBadgeHtml(ranked)}<div><div class="mp-rank-progress"><i style="width:${Number(ranked.progress) || 0}%"></i></div><span>${ranked.nextRank ? `${Number(ranked.nextRp - ranked.rp).toLocaleString()} RP remaining to ${escapeHtml(ranked.nextRank)}` : 'Monkey King cannot demote. Keep earning uncapped RP to climb the leaderboard.'}</span></div></div><div class="mp-ranked-columns"><section><h3>All Ranks</h3><div class="mp-rank-ladder">${ladder}</div></section><section><h3>Global Leaderboard</h3><div class="mp-ranked-leaders">${leaders}</div><h3>Rank History</h3>${history}</section></div>${ownerTools}`;
    }

    function openRankedModal() {
        elements.mpRankedError.textContent = '';
        renderRanked();
        elements.mpRankedModal.classList.add('open');
        elements.mpRankedModal.setAttribute('aria-hidden', 'false');
        send({ type: 'get_ranked' });
    }

    function closeRankedModal() {
        elements.mpRankedModal.classList.remove('open');
        elements.mpRankedModal.setAttribute('aria-hidden', 'true');
    }

    async function openSharedSocial() {
        if (!await requestOnlineAccess('Friends & Messages')) return;
        try {
            await connect();
            await waitForAuthenticatedAccount();
            if (monkeyWorld.joined && elements.monkeyWorldScreen.classList.contains('open')) {
                monkeyWorld.pausedForMenu = true;
                monkeyWorld.keys.clear();
                elements.monkeyWorldScreen.classList.add('menu-underlay');
            }
            elements.mpSocialCenterHost.appendChild(elements.mpSocialPanel);
            elements.mpSocialCenter.classList.add('open');
            elements.mpSocialCenter.setAttribute('aria-hidden', 'false');
            send({ type: 'get_social' });
            send({ type: 'get_party' });
            send({ type: 'get_clan' });
            renderSocial();
            if (typeof applyProfileTheme === 'function') applyProfileTheme();
        } catch (error) { showToast(error.message, true); }
    }

    function closeSharedSocial() {
        elements.mpSocialCenter.classList.remove('open');
        elements.mpSocialCenter.setAttribute('aria-hidden', 'true');
        if (socialHomeNextSibling?.parentNode === socialHomeParent) socialHomeParent.insertBefore(elements.mpSocialPanel, socialHomeNextSibling);
        else socialHomeParent.appendChild(elements.mpSocialPanel);
        if (monkeyWorld.joined && monkeyWorld.pausedForMenu && elements.monkeyWorldScreen.classList.contains('open')) restoreWorldAfterMenu();
    }

    function renderSocial() {
        const social = state.social || { friends: [], incoming: [], outgoing: [], blocked: [], groups: [], messages: [] };
        social.groups = Array.isArray(social.groups) ? social.groups : [];
        const empty = '<div class="mp-empty-state">None right now.</div>';
        elements.mpFriendRequests.innerHTML = social.incoming.length ? social.incoming.map((profile) => socialPersonHtml(profile, 'incoming')).join('') : empty;
        elements.mpFriends.innerHTML = social.friends.length ? social.friends.map((profile) => socialPersonHtml(profile, 'friend')).join('') : '<div class="mp-empty-state">Add a friend with their User ID.</div>';
        elements.mpGroups.innerHTML = social.groups.length ? social.groups.map((group) => {
            const icon = group.icon || group.members?.[0]?.skin || 'Default Monkey.png';
            return `<button class="mp-group-list-item" type="button" data-group-id="${escapeHtml(group.id)}"><img src="${escapeHtml(icon)}" alt=""><span><strong>${escapeHtml(group.name)}</strong><small>${Number(group.members?.length || 0)} members</small></span></button>`;
        }).join('') : '<div class="mp-empty-state">No group chats yet.</div>';
        elements.mpOutgoingRequests.innerHTML = social.outgoing.length ? social.outgoing.map((profile) => socialPersonHtml(profile, 'outgoing')).join('') : empty;
        elements.mpBlockedUsers.innerHTML = social.blocked.length ? social.blocked.map((profile) => socialPersonHtml(profile, 'blocked')).join('') : empty;
        renderParty();
        renderClanSummary();

        const activeGroup = social.groups.find((group) => group.id === state.activeGroupId);
        if (activeGroup) {
            state.activeFriendId = null;
            elements.mpConversationTitle.textContent = `${activeGroup.name} · ${activeGroup.members.length} members`;
            const memberMap = new Map(activeGroup.members.map((member) => [member.id, member]));
            const conversation = [...(activeGroup.messages || [])]
                .filter((message) => message.text || message.mediaData || message.mediaUrl)
                .sort((a, b) => a.createdAt - b.createdAt);
            elements.mpMessages.innerHTML = conversation.length ? conversation.map((message) => {
                const mine = message.fromId === state.account?.id;
                const sender = mine
                    ? { ...(memberMap.get(message.fromId) || state.account || {}), ...localTitleProfile(), username: state.account?.username || 'You' }
                    : memberMap.get(message.fromId);
                const safeText = messageHtml(message.text);
                const time = new Date(message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                const mediaSource = message.mediaData || '';
                const media = mediaSource ? `<a href="${escapeHtml(mediaSource)}" target="_blank" rel="noopener noreferrer"><img class="mp-message-media" src="${escapeHtml(mediaSource)}" alt="${escapeHtml(message.mediaName || 'Shared image or GIF')}" loading="lazy"></a>` : '';
                const deleteButton = mine || activeGroup.isOwner ? `<button class="mp-message-delete" type="button" data-delete-message="${escapeHtml(message.id)}" aria-label="Delete this group message">Delete</button>` : '';
                return `<div class="mp-message ${mine ? 'mine' : ''}"><div class="mp-group-sender">${escapeHtml(sender?.username || 'Former member')}${platformBadgeHtml(sender?.platform)}</div>${sharedTitleHtml(sender, 'mp-message-title')}${safeText ? `<div>${safeText}</div>` : ''}${media}<div class="mp-message-meta"><div class="mp-message-time">${escapeHtml(time)}</div>${deleteButton}</div></div>`;
            }).join('') : '<div class="mp-empty-state">No group messages yet. Say hello!</div>';
            elements.mpMessageForm.classList.remove('mp-hidden');
            elements.mpClearConversation.classList.add('mp-hidden');
            elements.mpGroupSettings.classList.remove('mp-hidden');
            elements.mpMessages.scrollTop = elements.mpMessages.scrollHeight;
            return;
        }
        state.activeGroupId = null;
        elements.mpGroupSettings.classList.add('mp-hidden');

        const activeFriend = social.friends.find((profile) => profile.id === state.activeFriendId);
        if (!activeFriend) {
            state.activeFriendId = null;
            elements.mpConversationTitle.textContent = 'Select a friend';
            elements.mpMessages.innerHTML = '<div class="mp-empty-state">Choose a friend to view your private messages.</div>';
            elements.mpMessageForm.classList.add('mp-hidden');
            elements.mpClearConversation.classList.add('mp-hidden');
            return;
        }
        elements.mpConversationTitle.textContent = `${activeFriend.username} · ${activeFriend.presence || (activeFriend.online ? 'Online' : 'Offline')}`;
        const conversation = social.messages
            .filter((message) => message.fromId === activeFriend.id || message.toId === activeFriend.id)
            .filter((message) => message.text || message.mediaData || message.mediaUrl)
            .sort((a, b) => a.createdAt - b.createdAt);
        elements.mpMessages.innerHTML = conversation.length ? conversation.map((message) => {
            const mine = message.fromId === state.account?.id;
            const sender = mine
                ? { ...(state.account || {}), ...localTitleProfile(), username: state.account?.username || 'You' }
                : activeFriend;
            const safeText = messageHtml(message.text);
            const time = new Date(message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            const mediaSource = message.mediaData || message.mediaUrl || '';
            const media = mediaSource ? `<a href="${escapeHtml(mediaSource)}" target="_blank" rel="noopener noreferrer"><img class="mp-message-media" src="${escapeHtml(mediaSource)}" alt="${escapeHtml(message.mediaName || 'Shared image or GIF')}" loading="lazy"></a>` : '';
            const deleteButton = mine ? `<button class="mp-message-delete" type="button" data-delete-message="${escapeHtml(message.id)}" aria-label="Delete this message">Delete</button>` : '';
            return `<div class="mp-message ${mine ? 'mine' : ''}"><div class="mp-group-sender">${escapeHtml(sender?.username || 'Monkey')}${platformBadgeHtml(sender?.platform)}</div>${sharedTitleHtml(sender, 'mp-message-title')}${safeText ? `<div>${safeText}</div>` : ''}${media}<div class="mp-message-meta"><div class="mp-message-time">${escapeHtml(time)}</div>${deleteButton}</div></div>`;
        }).join('') : '<div class="mp-empty-state">No messages yet. Say hello!</div>';
        elements.mpMessageForm.classList.remove('mp-hidden');
        elements.mpClearConversation.classList.toggle('mp-hidden', conversation.length === 0);
        elements.mpMessages.scrollTop = elements.mpMessages.scrollHeight;
        if (conversation.some((message) => message.fromId === activeFriend.id && !message.readAt)) {
            send({ type: 'mark_friend_messages_read', userId: activeFriend.id });
        }
    }

    function hydrateSocialSnapshot(nextSocial) {
        const social = nextSocial || { friends: [], incoming: [], outgoing: [], blocked: [], groups: [], messages: [] };
        const hydrateProfile = (profile) => {
            if (!profile) return profile;
            if (profile.profilePicture) state.socialProfilePictureCache.set(profile.id, profile.profilePicture);
            else if (profile.profilePictureRetained && state.socialProfilePictureCache.has(profile.id)) {
                profile.profilePicture = state.socialProfilePictureCache.get(profile.id);
            }
            return profile;
        };
        const hydrateMessage = (message) => {
            if (!message) return message;
            if (message.mediaData) state.socialMessageMediaCache.set(message.id, message.mediaData);
            else if (message.mediaRetained && state.socialMessageMediaCache.has(message.id)) {
                message.mediaData = state.socialMessageMediaCache.get(message.id);
            }
            return message;
        };
        for (const key of ['friends', 'incoming', 'outgoing', 'blocked']) {
            social[key] = (Array.isArray(social[key]) ? social[key] : []).map(hydrateProfile);
        }
        social.messages = (Array.isArray(social.messages) ? social.messages : [])
            .map(hydrateMessage)
            .filter((message) => {
                if (state.deletedSocialMessageIds.has(message.id)) return false;
                const otherId = message.fromId === state.account?.id ? message.toId : message.fromId;
                const clearedAt = Number(state.clearedFriendConversations.get(otherId) || 0);
                return !clearedAt || Number(message.createdAt || 0) > clearedAt;
            });
        social.groups = (Array.isArray(social.groups) ? social.groups : []).map((group) => {
            if (group.icon) state.socialGroupIconCache.set(group.id, group.icon);
            else if (group.iconRetained && state.socialGroupIconCache.has(group.id)) {
                group.icon = state.socialGroupIconCache.get(group.id);
            }
            group.members = (Array.isArray(group.members) ? group.members : []).map(hydrateProfile);
            group.messages = (Array.isArray(group.messages) ? group.messages : [])
                .map(hydrateMessage)
                .filter((message) => !state.deletedSocialMessageIds.has(message.id));
            return group;
        });
        return social;
    }

    function selectFriend(userId) {
        state.activeFriendId = userId;
        state.activeGroupId = null;
        clearPendingMessageAttachment();
        renderSocial();
        elements.mpMessageInput.focus();
    }

    function selectGroup(groupId) {
        state.activeGroupId = groupId;
        state.activeFriendId = null;
        clearPendingMessageAttachment();
        renderSocial();
        elements.mpMessageInput.focus();
    }

    function clearPendingMessageAttachment() {
        state.pendingMessageAttachment = null;
        elements.mpMessageFile.value = '';
        elements.mpMessageAttachment.textContent = '';
        elements.mpMessageAttachment.classList.add('mp-hidden');
    }

    function showPendingMessageAttachment(file) {
        elements.mpMessageAttachment.innerHTML = `<span>📎 ${escapeHtml(file.name)} (${Math.max(1, Math.ceil(file.size / 1024))} KB)</span><button type="button" data-remove-attachment aria-label="Remove attachment">×</button>`;
        elements.mpMessageAttachment.classList.remove('mp-hidden');
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('That image could not be read.'));
            reader.readAsDataURL(file);
        });
    }

    function decodedDataUrlBytes(dataUrl) {
        const base64 = String(dataUrl || '').split(',')[1] || '';
        return Math.max(0, Math.floor(base64.length * 3 / 4) - ((base64.match(/=*$/) || [''])[0].length));
    }

    async function prepareChatAttachment(file) {
        const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (!supported.includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF file.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image no larger than 8 MB.');
        if (file.type === 'image/gif') {
            if (file.size > 320 * 1024) throw new Error('Animated GIFs must be 320 KB or smaller. Still images are compressed automatically.');
            const data = await readFileAsDataUrl(file);
            return { data, name:file.name, size:decodedDataUrlBytes(data) };
        }
        if (file.size <= 280 * 1024) {
            const data = await readFileAsDataUrl(file);
            return { data, name:file.name, size:decodedDataUrlBytes(data) };
        }

        const objectUrl = URL.createObjectURL(file);
        try {
            const image = new Image();
            image.decoding = 'async';
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error('That image format could not be decoded.'));
                image.src = objectUrl;
            });
            let scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { alpha:true });
            let best = '';
            for (let resize = 0; resize < 5; resize += 1) {
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                for (const quality of [.84, .74, .64, .54, .46]) {
                    const candidate = canvas.toDataURL('image/webp', quality);
                    best = candidate;
                    if (decodedDataUrlBytes(candidate) <= 240 * 1024) {
                        const cleanName = file.name.replace(/\.[^.]+$/, '') + '.webp';
                        return { data:candidate, name:cleanName, size:decodedDataUrlBytes(candidate) };
                    }
                }
                scale *= .78;
            }
            if (best && decodedDataUrlBytes(best) <= 320 * 1024) {
                return { data:best, name:file.name.replace(/\.[^.]+$/, '') + '.webp', size:decodedDataUrlBytes(best) };
            }
            throw new Error('That image could not be compressed enough. Try a smaller image.');
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function openGroupModal(group = null) {
        state.editingGroupId = group?.id || null;
        state.pendingGroupIcon = null;
        const ownerCanEdit = !group || group.isOwner;
        elements.mpGroupModalTitle.textContent = group ? 'Group Chat Settings' : 'Create Group Chat';
        elements.mpGroupName.value = group?.name || '';
        elements.mpGroupName.disabled = !ownerCanEdit;
        elements.mpGroupIconPreview.src = group?.icon || group?.members?.[0]?.skin || 'Default Monkey.png';
        elements.mpChooseGroupIcon.disabled = !ownerCanEdit;
        elements.mpClearGroupIcon.disabled = !ownerCanEdit;
        const selected = new Set((group?.members || []).map((member) => member.id));
        elements.mpGroupMembers.innerHTML = state.social.friends.length ? state.social.friends.map((friend) => `
            <label class="mp-group-member"><input type="checkbox" value="${escapeHtml(friend.id)}" ${selected.has(friend.id) ? 'checked' : ''} ${ownerCanEdit ? '' : 'disabled'}><img src="${escapeHtml(friend.profilePicture || friend.skin)}" alt=""><span>${escapeHtml(friend.username)}${platformBadgeHtml(friend.platform)}</span></label>
        `).join('') : '<div class="mp-empty-state">Add accepted friends before creating a group.</div>';
        elements.mpSaveGroup.classList.toggle('mp-hidden', !ownerCanEdit);
        elements.mpSaveGroup.textContent = group ? 'Save Group' : 'Create Group';
        elements.mpLeaveGroup.classList.toggle('mp-hidden', !group);
        elements.mpDeleteGroup.classList.toggle('mp-hidden', !group?.isOwner);
        elements.mpGroupError.textContent = '';
        elements.mpGroupModal.classList.add('open');
        elements.mpGroupModal.setAttribute('aria-hidden', 'false');
    }

    function closeGroupModal() {
        state.editingGroupId = null;
        state.pendingGroupIcon = null;
        elements.mpGroupIconFile.value = '';
        elements.mpGroupModal.classList.remove('open');
        elements.mpGroupModal.setAttribute('aria-hidden', 'true');
    }

    function openDangerModal(action) {
        if (action === 'reset' && window.flappyGuestSession) return;
        state.dangerAction = action;
        elements.mpDangerPassword.value = '';
        elements.mpDangerPhrase.value = '';
        elements.mpDangerError.textContent = '';
        const deleting = action === 'delete';
        elements.mpDangerTitle.textContent = deleting ? 'DELETE ACCOUNT PERMANENTLY?' : 'RESET ALL PROGRESS?';
        elements.mpDangerDescription.textContent = deleting
            ? 'This permanently deletes the account, email association, User ID, friends, messages, online stats, items, cosmetics, and every other saved result. It cannot be undone.'
            : 'This resets Monkey XP and level, RP and rank, redeemed codes, personal reward receipts, items, cosmetics, currencies, scores, achievements, campaign progress, and defense progress. Your account, email, User ID, friends, messages, settings, current login, and global owner announcements are kept.';
        elements.mpDangerPhraseLabel.childNodes[0].textContent = `Type ${deleting ? 'DELETE' : 'RESET'} to confirm`;
        elements.mpDangerPhrase.maxLength = deleting ? 6 : 5;
        elements.mpDangerConfirm.textContent = deleting ? 'Permanently Delete Account' : 'Reset All Progress';
        elements.mpAccountDangerModal.classList.add('open');
        elements.mpAccountDangerModal.setAttribute('aria-hidden', 'false');
        elements.mpDangerPassword.focus();
    }

    function closeDangerModal() {
        state.dangerAction = null;
        elements.mpDangerPassword.value = '';
        elements.mpDangerPhrase.value = '';
        elements.mpDangerError.textContent = '';
        elements.mpAccountDangerModal.classList.remove('open');
        elements.mpAccountDangerModal.setAttribute('aria-hidden', 'true');
    }

    function resetAccountSnapshot(account) {
        if (!account) return null;
        const ranked = {
            season: account.ranked?.season || 1,
            rp: 0,
            peakRp: 0,
            matches: 0,
            wins: 0,
            active: false,
            rank: 'Bronze I',
            rankIndex: 0,
            progress: 0,
            history: []
        };
        return {
            ...account,
            skin: 'Default Monkey.png',
            equippedTitle: 'None',
            totalXP: 0,
            level: 1,
            stats: { matches: 0, wins: 0, survivalWins: 0, targetWins: 0, timedWins: 0, bestScore: 0, totalScore: 0 },
            ranked,
            defenseRanked: { ...ranked },
            entitlements: { skins: [], titles: [] },
            pendingGrants: [],
            redeemedCodeCount: 0,
            badgeCount: 0,
            badges: []
        };
    }

    function clearLocalProgress({ account = null, keepSession = false, deleteAccount = false, pendingOfflineReset = false } = {}) {
        const serverUrl = state.socketUrl;
        const cachedAccount = readBestCachedProfile(serverUrl);
        const activeIdentity = accountStorage.readActiveAccount(localStorage);
        const activeAccountId = state.account?.id || account?.id || cachedAccount?.id || activeIdentity?.accountId;
        const profileToKeep = account || state.account || cachedAccount || (activeAccountId ? {
            id: activeAccountId,
            username: localStorage.getItem('customUsername') || '',
            profilePicture: localStorage.getItem('profilePic') || ''
        } : null);
        if (!deleteAccount) {
            if (profileToKeep?.id) {
                accountStorage.writeCachedIdentity(localStorage, {
                    serverUrl: activeIdentity?.serverUrl || serverUrl,
                    accountId: profileToKeep.id
                }, profileToKeep);
            }
            sessionStorage.setItem('flappyResetIdentityRestore', JSON.stringify(
                accountStorage.captureResetIdentity(localStorage, profileToKeep)
            ));
        }
        sessionStorage.setItem('flappyFinishProgressReset', 'yes');
        if (account?.cloudProgress) {
            sessionStorage.setItem('flappyResetCloudMeta', JSON.stringify(account.cloudProgress));
        }
        ['monkeyXP','achievementsUnlockedCount','unlockedAchievements'].forEach((key) => localStorage.removeItem(key));
        try { if (typeof totalXP !== 'undefined') totalXP = 0; } catch (_) {}
        try { if (typeof achievementsUnlockedCount !== 'undefined') achievementsUnlockedCount = 0; } catch (_) {}
        if (deleteAccount) {
            accountStorage.deleteActiveAccount(localStorage, activeAccountId ? { serverUrl, accountId: activeAccountId } : null);
        } else {
            accountStorage.resetActiveAccount(localStorage);
            if (account?.cloudProgress && typeof accountStorage.writeCloudMeta === 'function') {
                accountStorage.writeCloudMeta(localStorage, account.cloudProgress);
            }
        }
        if (keepSession && profileToKeep) {
            localStorage.setItem(profileKey(serverUrl), JSON.stringify(profileToKeep));
        } else if (!keepSession) {
            localStorage.removeItem(sessionKey(serverUrl));
            localStorage.removeItem(profileKey(serverUrl));
        }
        if (pendingOfflineReset && activeAccountId) {
            localStorage.setItem(pendingOfflineResetKey(activeAccountId, serverUrl), 'yes');
        }
        location.reload();
    }

    function persistProfile(account) {
        state.account = account;
        const localXp = Math.max(0, Number.parseInt(localStorage.getItem('monkeyXP') || '0', 10) || 0);
        const serverXp = Math.max(0, Math.floor(Number(account.totalXP) || 0));
        const pendingAuthoritativeXp = [...(account.pendingGrants || [])].reverse()
            .map((grant) => Number(grant?.resultingTotalXP))
            .find((value) => Number.isFinite(value));
        const shouldApplyServerXp = Number.isFinite(pendingAuthoritativeXp) || serverXp > localXp;
        if (shouldApplyServerXp && serverXp !== localXp) {
            localStorage.setItem('monkeyXP', String(serverXp));
            if (typeof totalXP !== 'undefined') totalXP = serverXp;
            if (typeof updateXPBar === 'function') updateXPBar();
            window.dispatchEvent(new CustomEvent('flappy-xp-changed', { detail: { totalXP: serverXp, source: Number.isFinite(pendingAuthoritativeXp) ? 'owner-authoritative' : 'online-mode' } }));
        }
        if (account.ranked) applySharedRank(account.ranked, false);
        localStorage.setItem(profileKey(), JSON.stringify(account));
        if (account.id) {
            accountStorage.writeCachedIdentity(localStorage, {
                serverUrl: state.socketUrl,
                accountId: account.id
            }, account);
        }
        localStorage.setItem('customUsername', account.username || '');
        if (account.profilePicture) localStorage.setItem('profilePic', account.profilePicture);
        window.flappyActiveOnlineAccount = account;
        const profileDispatchSignature = JSON.stringify([
            account.id,
            account.username,
            account.profilePicture,
            account.totalXP,
            account.level,
            account.profileLikes,
            account.progressRevision,
            account.ranked,
            account.entitlements,
            account.unlockedSkins,
            (account.pendingGrants || []).map(grant => grant.id)
        ]);
        if (profileDispatchSignature !== lastOnlineProfileDispatchSignature) {
            lastOnlineProfileDispatchSignature = profileDispatchSignature;
            window.dispatchEvent(new CustomEvent('flappy-online-profile', { detail: account }));
        }
        applyAccountRewards(account);
        renderAccount();
        const localPicture = localStorage.getItem('profilePic') || '';
        if (state.authenticated && !account.profilePicture && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(localPicture) && localPicture !== lastProfilePictureUpload) {
            lastProfilePictureUpload = localPicture;
            send({ type: 'update_profile_picture', mediaData: localPicture });
        }
    }

    function applySharedRank(ranked, save = true) {
        if (!ranked) return;
        state.ranked = ranked;
        onlineDefense.rank = ranked;
        if (state.account) state.account.ranked = ranked;
        if (save && state.account) localStorage.setItem(profileKey(), JSON.stringify(state.account));
        renderRanked();
        renderDefenseRank();
    }

    function badgeIconSymbol(value) {
        return ({ KEY: '🔑', CROWN: '👑', BANANA: '🍌', PASS: '🎫', ROCKET: '🚀', PIPE: '🚧', GIFT: '🎁', 'STAR+': '🌠', STAR: '⭐', GHOST: '👻', FIRE: '🔥', GLITCH: '⚡', FRIENDS: '🐵' })[value] || value || '🏅';
    }

    function profileInventoryItemHtml(section, name, count = 1) {
        const label = String(name || 'Item');
        let preview = '<span class="mp-inventory-generic">◆</span>';
        if (section === 'skins' && typeof monkeySkins !== 'undefined') {
            const skin = monkeySkins.find((item) => item.name === label || item.file === label);
            if (skin?.file) preview = `<img src="${escapeHtml(skin.file)}" alt="">`;
        } else if (section === 'emojis') {
            const emoji = (window.flappyCustomEmojis || []).find((item) => item.name === label || item.id === label);
            if (emoji?.file) preview = `<img src="${escapeHtml(emoji.file)}" alt="">`;
        } else if (section === 'trails' && typeof trails !== 'undefined') {
            const trail = trails.find((item) => item.name === label || item.id === label);
            const color = trail?.color === 'rainbow' ? 'linear-gradient(135deg,#ff5b67,#ffe35b,#58e69b,#6e8cff,#d66bff)' : (trail?.color || '#ffe36b');
            preview = `<span class="mp-inventory-trail" style="background:${color}">✦</span>`;
        } else if ((section === 'explosionVfx' || section === 'equippedExplosionVfx') && typeof explosionVfxOptions !== 'undefined') {
            const effect = explosionVfxOptions.find((item) => item.name === label || item.id === label);
            preview = `<span class="mp-inventory-generic" style="background:radial-gradient(circle,${escapeHtml(effect?.color || '#ffe36b')},#10281e 72%);font-size:24px">${escapeHtml(effect?.icon || '✦')}</span>`;
        } else if (section === 'themes' && typeof profileBackgrounds !== 'undefined') {
            const theme = profileBackgrounds.find((item) => item.name === label || item.id === label);
            preview = `<span class="mp-inventory-theme" style="background:${theme?.css || '#1a1a2e'}"></span>`;
        } else if (section === 'pipeSkins') {
            preview = '<span class="mp-inventory-pipes"><i></i><i></i></span>';
        } else if (section === 'titleStyles') {
            const effect = /fire/i.test(label) ? 'fire' : /glitch/i.test(label) ? 'glitch' : /neon/i.test(label) ? 'neon' : 'sparkle';
            preview = `<span class="mp-inventory-titlefx ${effect}"><i></i></span>`;
        } else if (section === 'titles') {
            preview = '<span class="mp-inventory-title-icon"><i></i><b></b></span>';
        } else if (section === 'boosts') {
            const file = /crate|luck/i.test(label) ? 'powerup-crate-luck.png'
                : /revive/i.test(label) ? 'powerup-revive.png'
                : /\bxp\b|experience/i.test(label) ? 'powerup-xp-boost.png'
                : /life/i.test(label) ? 'powerup-extra-life.png'
                : /doubler|banana/i.test(label) ? 'powerup-banana-doubler.png'
                : 'powerup-score-booster.png';
            preview = `<img class="mp-inventory-boost" src="${file}" alt="">`;
        }
        const quantity = Math.max(1, Math.floor(Number(count) || 1));
        const quantityBadge = section === 'boosts' ? `<b class="mp-inventory-count" aria-label="${quantity} owned">×${quantity}</b>` : '';
        return `<article class="mp-inventory-item">${preview}<span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(section.replace(/([A-Z])/g, ' $1').trim())}</small></span>${quantityBadge}</article>`;
    }

    function renderPublicProfile(profile) {
        state.publicProfile = profile;
        const stats = profile.stats || {};
        const picture = profile.profilePicture || profile.skin || 'Default Monkey.png';
        const canInviteToClan = ['owner', 'officer'].includes(state.clan?.myRole)
            && !profile.clan
            && state.social.friends.some((friend) => friend.id === profile.id);
        const invitationSent = (state.clan?.pendingInvitationIds || []).includes(profile.id);
        const showcase = profile.showcase || {};
        const inventory = showcase.inventory || {};
        const showcaseStats = Object.entries(showcase.statistics || {}).filter(([, value]) => Number(value) > 0);
        const achievements = Array.isArray(showcase.achievements) ? showcase.achievements : [];
        const badges = Array.isArray(profile.badges) ? profile.badges : [];
        const unlockedBadgeCount = badges.filter((badge) => badge.unlocked).length;
        const alreadyFriend = state.social.friends.some((friend) => friend.id === profile.id);
        const incomingRequest = state.social.incoming.some((friend) => friend.id === profile.id);
        const outgoingRequest = state.social.outgoing.some((friend) => friend.id === profile.id);
        const canAddFriend = profile.id !== state.account?.id && !alreadyFriend && !incomingRequest && !outgoingRequest;
        const inventorySections = { ...inventory };
        const titleProfile = profile.id === state.account?.id
            ? { ...profile, ...localTitleProfile() }
            : profile;
        const title = sharedTitleHtml(titleProfile);
        elements.mpPublicProfileContent.innerHTML = `
            <div class="mp-public-profile-hero">
                <img class="mp-public-profile-picture" src="${escapeHtml(picture)}" alt="${escapeHtml(profile.username)} profile picture">
                <div><h3>${profile.clan ? `<span class="mp-clan-tag" style="color:${escapeHtml(profile.clan.tagColor)}">[${escapeHtml(profile.clan.tag)}]</span> ` : ''}${escapeHtml(profile.username)}${platformBadgeHtml(profile.platform)} <span class="mp-level-badge">Lv. ${Math.max(1, Number(profile.level) || 1)}</span></h3>${title}<div class="mp-profile-user-id"><code>${escapeHtml(profile.id)}</code><button id="mpCopyPublicUserId" class="mp-secondary" type="button">Copy User ID</button></div>${profile.clan ? `<div class="mp-profile-clan">${escapeHtml(profile.clan.name)} · Clan Level ${Number(profile.clan.level) || 1}</div>` : ''}<div class="mp-social-status ${profile.online ? 'online' : ''}">${escapeHtml(profile.presence || (profile.online ? 'Online' : 'Offline'))}</div></div>
            </div>
            ${profile.ranked ? `<div class="mp-profile-ranked">${rankBadgeHtml(profile.ranked)}<div><strong>Season 1 Ranked</strong><span>${Number(profile.ranked.progress || 0)}% progress · ${Number(profile.ranked.peakRp || 0).toLocaleString()} peak RP</span></div></div>` : ''}
            ${profile.ranked?.history?.length ? `<div class="mp-profile-history">${profile.ranked.history.map((entry) => `<div class="mp-rank-history"><strong>Season ${entry.season} Ranked</strong><span>${escapeHtml(entry.highestRank)} · ${Number(entry.peakRp).toLocaleString()} peak RP · ${Number(entry.progress)}% rank progress</span></div>`).join('')}</div>` : ''}
            <div class="mp-stats">${[
                ['Matches', stats.matches || 0], ['Wins', stats.wins || 0], ['Best Score', stats.bestScore || 0],
                ['Total Score', stats.totalScore || 0], ['Level', profile.level || 1], ['Total XP', profile.totalXP || 0]
            ].map(([label, value]) => `<div class="mp-stat"><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div>
            ${showcaseStats.length ? `<section class="mp-profile-showcase"><h3>Game Statistics</h3><div class="mp-stats">${showcaseStats.map(([label, value]) => `<div class="mp-stat"><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div></section>` : ''}
            <section class="mp-profile-showcase"><h3>Achievements</h3>${achievements.length ? `<div class="mp-profile-achievements">${achievements.map((name) => `<span>🏆 ${escapeHtml(name)}</span>`).join('')}</div>` : '<p class="mp-empty-state">No showcased achievements yet.</p>'}</section>
            <div class="mp-button-row"><button id="mpProfileBadgesButton" class="mp-primary" type="button">View Badges · ${unlockedBadgeCount}/${badges.length}</button><button id="mpProfileInventoryButton" class="mp-secondary" type="button">View Inventory</button>${canAddFriend ? '<button id="mpProfileAddFriend" class="mp-primary" type="button">Add Friend</button>' : outgoingRequest ? '<button type="button" disabled>Request Sent</button>' : incomingRequest ? '<button id="mpProfileAcceptFriend" class="mp-primary" type="button">Accept Friend</button>' : ''}<button id="mpProfileLikeButton" class="${profile.likedByYou ? 'mp-primary' : 'mp-secondary'}" type="button" ${profile.canLike ? '' : 'disabled'}>${profile.likedByYou ? 'Liked' : 'Like Profile'} · ${Number(profile.likeCount || 0).toLocaleString()}</button>${canInviteToClan ? `<button id="mpProfileClanInvite" class="mp-primary" type="button" ${invitationSent ? 'disabled' : ''}>${invitationSent ? 'Invite Sent' : 'Invite to Clan'}</button>` : ''}</div>
            <section id="mpProfileBadges" class="mp-profile-badges mp-hidden"><div class="mp-profile-submenu-head"><div><h3>Player Badges</h3><small>${unlockedBadgeCount} of ${badges.length} unlocked · progress is synchronized across modes</small></div><button id="mpProfileBadgesClose" class="mp-secondary" type="button">Close Badges</button></div><div class="mp-badge-grid">${badges.map((badge) => { const progress = Math.max(0, Number(badge.progress) || 0); const target = Math.max(1, Number(badge.target) || 1); const percent = Math.min(100, progress / target * 100); return `<article class="mp-badge-card ${badge.unlocked ? 'unlocked' : 'locked'}"><div class="mp-badge-icon">${badge.unlocked ? escapeHtml(badgeIconSymbol(badge.icon)) : '?'}</div><div><strong>${escapeHtml(badge.name)}</strong><small>${escapeHtml(badge.category || 'Badge')}</small><p>${escapeHtml(badge.description)}</p><div class="mp-badge-progress"><i style="width:${percent}%"></i></div><span>${badge.unlocked ? 'Unlocked' : `${Math.min(progress, target).toLocaleString()} / ${target.toLocaleString()}`}</span></div></article>`; }).join('') || '<p class="mp-empty-state">Badges have not synchronized yet.</p>'}</div></section>
            <section id="mpProfileInventory" class="mp-profile-inventory mp-hidden"><h3>Read-Only Inventory</h3>${Object.entries(inventorySections).map(([section, items]) => { const values = Array.isArray(items) ? items.map((name) => ({ name, count:1 })) : Object.entries(items || {}).filter(([, count]) => Number(count) > 0).map(([name, count]) => ({ name, count })); return values.length ? `<div><strong>${escapeHtml(section.replace(/([A-Z])/g, ' $1'))}</strong><div class="mp-inventory-grid">${values.map((item) => profileInventoryItemHtml(section, item.name, item.count)).join('')}</div></div>` : ''; }).join('') || '<p class="mp-empty-state">This player has not synced inventory details yet.</p>'}<small>Viewing only — items cannot be equipped or used from another player’s profile.</small></section>
        `;
        elements.mpPublicProfileModal.classList.add('open');
        elements.mpPublicProfileModal.setAttribute('aria-hidden', 'false');
        document.getElementById('mpCopyPublicUserId')?.addEventListener('click', (event) => copyText(profile.id, event.currentTarget));
        const likeButton = document.getElementById('mpProfileLikeButton');
        if (likeButton && profile.canLike) likeButton.addEventListener('click', () => {
            state.pendingSocialAction = true;
            send({ type: 'toggle_profile_like', userId: profile.id });
        });
        document.getElementById('mpProfileClanInvite')?.addEventListener('click', () => sendSocialAction({ type: 'invite_to_clan', userId: profile.id }));
        document.getElementById('mpProfileInventoryButton')?.addEventListener('click', () => document.getElementById('mpProfileInventory')?.classList.toggle('mp-hidden'));
        const toggleBadges = () => document.getElementById('mpProfileBadges')?.classList.toggle('mp-hidden');
        document.getElementById('mpProfileBadgesButton')?.addEventListener('click', toggleBadges);
        document.getElementById('mpProfileBadgesClose')?.addEventListener('click', toggleBadges);
        document.getElementById('mpProfileAddFriend')?.addEventListener('click', () => sendSocialAction({ type: 'send_friend_request', targetUserId: profile.id }));
        document.getElementById('mpProfileAcceptFriend')?.addEventListener('click', () => sendSocialAction({ type: 'accept_friend_request', userId: profile.id }));
    }

    function closePublicProfile() {
        state.publicProfile = null;
        elements.mpPublicProfileModal.classList.remove('open');
        elements.mpPublicProfileModal.setAttribute('aria-hidden', 'true');
    }

    const queuedGrantClaimIds = new Set();
    let queuedGrantClaimTimer = null;

    function queueGrantClaim(grantId) {
        const id = String(grantId || '').trim();
        if (!id) return;
        queuedGrantClaimIds.add(id);
        clearTimeout(queuedGrantClaimTimer);
        queuedGrantClaimTimer = setTimeout(() => {
            queuedGrantClaimTimer = null;
            const grantIds = [...queuedGrantClaimIds];
            if (!grantIds.length) return;
            accountStorage.snapshotActiveAccount?.(localStorage);
            const cloudProgress = typeof accountStorage.exportCloudProgress === 'function'
                ? accountStorage.exportCloudProgress(localStorage)
                : {};
            if (send({ type:'claim_grants', grantIds, cloudProgress })) {
                grantIds.forEach((claimedId) => queuedGrantClaimIds.delete(claimedId));
            } else {
                grantIds.forEach((claimedId) => queuedGrantClaimIds.add(claimedId));
            }
        }, 80);
    }

    function applyAccountRewards(account) {
        const entitlements = account.entitlements || { skins: [], titles: [] };
        const skinOwnershipKeys = new Set(
            [...(entitlements.skins || []), ...(account.unlockedSkins || [])]
                .map((value) => String(value || '')
                    .normalize('NFKD')
                    .replace(/\.[^.]+$/, '')
                    .toLocaleLowerCase('en-US')
                    .replace(/[^a-z0-9]/g, ''))
                .filter(Boolean)
        );
        try {
            let rewardsChanged = false;
            if (typeof titles !== 'undefined') {
                titles.filter((title) => title.grantOnly).forEach((title) => {
                    const shouldUnlock = entitlements.titles.includes(title.name);
                    if (title.unlocked !== shouldUnlock) {
                        title.unlocked = shouldUnlock;
                        rewardsChanged = true;
                    }
                });
                entitlements.titles.forEach((name) => {
                    const title = titles.find((entry) => entry.name === name);
                    if (title && !title.unlocked) {
                        title.unlocked = true;
                        rewardsChanged = true;
                    }
                });
                if (rewardsChanged && typeof saveUnlockedTitles === 'function') saveUnlockedTitles();
                if (rewardsChanged && typeof refreshTitlesMenu === 'function') refreshTitlesMenu();
            }
            if (typeof monkeySkins !== 'undefined') {
                const ownsSkin = (skin) => [skin.file, skin.name].some((value) => skinOwnershipKeys.has(
                    String(value || '')
                        .normalize('NFKD')
                        .replace(/\.[^.]+$/, '')
                        .toLocaleLowerCase('en-US')
                        .replace(/[^a-z0-9]/g, '')
                ));
                monkeySkins.filter((skin) => skin.grantOnly).forEach((skin) => {
                    const shouldUnlock = ownsSkin(skin);
                    if (skin.unlocked !== shouldUnlock) {
                        skin.unlocked = shouldUnlock;
                        rewardsChanged = true;
                    }
                });
                monkeySkins.forEach((skin) => {
                    if (ownsSkin(skin) && !skin.unlocked) {
                        skin.unlocked = true;
                        rewardsChanged = true;
                    }
                });
                const equipped = monkeySkins.find((entry) => entry.file === currentSkin());
                if (equipped?.grantOnly && !equipped.unlocked) {
                    if (typeof selectedSkin !== 'undefined') selectedSkin = 'Default Monkey.png';
                    localStorage.setItem('selectedMonkeySkin', 'Default Monkey.png');
                    if (typeof updateLobbyMonkeyPreview === 'function') updateLobbyMonkeyPreview();
                }
                if (rewardsChanged && typeof saveUnlockedSkins === 'function') saveUnlockedSkins();
                if (rewardsChanged && typeof refreshSkinMenu === 'function') refreshSkinMenu();
            }
            if (rewardsChanged) {
                window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ source:'account-entitlements' } }));
            }
        } catch (error) {
            console.error('Unable to apply online entitlements:', error);
        }

        for (const grant of account.pendingGrants || []) applyPendingGrant(grant);
    }

    function applyPendingGrant(grant) {
        const marker = `flappyOnlineGrant:${grant.id}`;
        if (localStorage.getItem(marker) === 'applied') {
            queueGrantClaim(grant.id);
            return;
        }
        try {
            const removing = grant.operation === 'remove';
            const direction = removing ? -1 : 1;
            if (grant.type === 'banana_coins') {
                const value = Math.max(0, Number.parseInt(localStorage.getItem('monkeyCoins') ?? '200', 10) + direction * grant.amount);
                localStorage.setItem('monkeyCoins', value);
                if (typeof monkeyCoins !== 'undefined') monkeyCoins = value;
            } else if (grant.type === 'xp') {
                const authoritativeTotal = Number(grant.resultingTotalXP);
                const value = Number.isFinite(authoritativeTotal)
                    ? Math.max(0, Math.floor(authoritativeTotal))
                    : Math.max(0, Number.parseInt(localStorage.getItem('monkeyXP') || '0', 10) + direction * grant.amount);
                localStorage.setItem('monkeyXP', value);
                if (typeof totalXP !== 'undefined') totalXP = value;
                if (removing) reconcileLevelRewardsAfterXpRemoval(value);
                if (typeof updateXPBar === 'function') updateXPBar();
                window.dispatchEvent(new CustomEvent('flappy-xp-changed', {
                    detail: { totalXP:value, source:removing ? 'owner-removal' : 'owner-grant' }
                }));
            } else if (grant.type === 'powerup') {
                const value = Math.max(0, Number.parseInt(localStorage.getItem(grant.itemId) || '0', 10) + direction * grant.amount);
                const boostId = ({ extraLifeTokens:'extraLifeToken', coinDoublerTickets:'coinDoubler', scoreBoosterTickets:'scoreBooster', xpBoostTokens:'xpBoost', crateLuckBoostTokens:'crateLuck', reviveTokens:'revive' })[grant.itemId];
                if (boostId && typeof setBoostTicketCount === 'function') setBoostTicketCount(boostId, value);
                else localStorage.setItem(grant.itemId, value);
            } else if (grant.type === 'explosion_vfx' && typeof explosionVfxOptions !== 'undefined') {
                applyLocalCosmeticOwnership(grant, !removing);
            } else if (grant.type === 'crate_ticket') {
                const key = `flappyFreeCrateTickets:${grant.itemId}`;
                const value = Math.max(0, Number.parseInt(localStorage.getItem(key) || '0', 10) + direction * grant.amount);
                localStorage.setItem(key, value);
                if (typeof refreshCratesGrid === 'function') refreshCratesGrid();
            } else if (['trail','pipe_skin','title_fx','profile_background','custom_emoji'].includes(grant.type)) {
                const applied = applyLocalCosmeticOwnership(grant, !removing);
                if (!applied) throw new Error(`This build could not apply ${grant.label}.`);
            } else if (removing && grant.type === 'skin' && typeof monkeySkins !== 'undefined') {
                const skin = monkeySkins.find((entry) => entry.file === grant.itemId || entry.name === grant.itemId);
                if (skin && skin.file !== 'Default Monkey.png') {
                    skin.unlocked = false;
                    if (typeof selectedSkin !== 'undefined' && selectedSkin === skin.file) selectedSkin = 'Default Monkey.png';
                    if (localStorage.getItem('selectedMonkeySkin') === skin.file) localStorage.setItem('selectedMonkeySkin', 'Default Monkey.png');
                    if (typeof saveUnlockedSkins === 'function') saveUnlockedSkins();
                    if (typeof refreshSkinMenu === 'function') refreshSkinMenu();
                    if (typeof updateLobbyMonkeyPreview === 'function') updateLobbyMonkeyPreview();
                }
            } else if (removing && grant.type === 'title' && typeof titles !== 'undefined') {
                const title = titles.find((entry) => entry.name === grant.itemId);
                if (title) title.unlocked = false;
                if (typeof selectedTitle !== 'undefined' && selectedTitle === grant.itemId) selectedTitle = 'None';
                if (localStorage.getItem('selectedTitle') === grant.itemId) localStorage.setItem('selectedTitle', 'None');
                if (typeof refreshTitlesMenu === 'function') refreshTitlesMenu();
            }
            localStorage.setItem(marker, 'applied');
            queueGrantClaim(grant.id);
            showToast(`Owner ${removing ? 'removed' : 'sent'}: ${grant.label}${grant.amount > 1 ? ` ×${grant.amount}` : ''}`);
        } catch (error) {
            showToast(`Could not apply owner account change: ${error.message}`, true);
        }
    }

    async function handleServerMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch (_) { return; }
        window.dispatchEvent(new CustomEvent('flappy-online-message', { detail: message }));
        if (message.serverNow) state.serverOffset = message.serverNow - Date.now();
        if (message.type === 'server_hello') {
            state.playerId = message.playerId;
            state.serverProtocolVersion = Number(message.protocolVersion || 0);
            state.serverBuild = String(message.build || 'legacy-unidentified');
            state.serverCapabilities = Array.isArray(message.capabilities) ? message.capabilities : [];
            if (message.birthdayBash) {
                window.dispatchEvent(new CustomEvent('flappy-birthday-state', {
                    detail: { ...message.birthdayBash, serverNow: Number(message.serverNow) || Date.now() }
                }));
            }
        } else if (message.type === 'server_population') {
            onlinePopulation.textContent = `🐵 ${Number(message.playersOnline || 0).toLocaleString()} players online · ${Number(message.matchesActive || 0).toLocaleString()} matches active · ${Number(message.worldsActive || 0).toLocaleString()} worlds`;
        } else if (message.type === 'auth_success') {
            cancelReconnect();
            sessionStorage.removeItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY);
            sessionStorage.removeItem(GUEST_SESSION_READY_KEY);
            window.flappyGuestSession = false;
            const isSessionResume = message.resumed === true;
            const targetIdentity = { serverUrl:state.socketUrl, accountId:message.account.id };
            const durableTargetIdentity = accountStorage.readCachedIdentity(localStorage, targetIdentity);
            const cachedBeforeAuth = readBestCachedProfile(state.socketUrl);
            const serverProgressRevision = Math.max(0, Number(message.account?.progressRevision) || 0);
            const cachedTargetRevision = cachedBeforeAuth?.id === message.account.id
                ? Number(cachedBeforeAuth.progressRevision) || 0
                : null;
            const serverResetIsNewer = accountStorage.shouldApplyServerReset(
                localStorage,
                targetIdentity,
                serverProgressRevision,
                {
                    created:Boolean(message.created),
                    fallbackRevision:durableTargetIdentity ? durableTargetIdentity.progressRevision : cachedTargetRevision
                }
            );
            if (message.token) localStorage.setItem(sessionKey(), message.token);
            localStorage.setItem(profileKey(), JSON.stringify(message.account));
            let activation;
            try {
                activation = accountStorage.activateAccount(localStorage, {
                    serverUrl: state.socketUrl,
                    accountId: message.account.id,
                    fresh: Boolean(message.created)
                });
            } catch (error) {
                state.authenticated = false;
                const details = `Could not load this account's separate save: ${error.message}`;
                elements.mpAuthError.textContent = details;
                elements.startupAuthError.textContent = details;
                lockAccountGate(details);
                return;
            }
            if (serverResetIsNewer) {
                // An owner or another signed-in device reset this account while
                // this desktop still had the old XP/cosmetics. The reset revision
                // is authoritative: wipe before any profile sync can upload that
                // stale progress back to the server.
                accountStorage.resetActiveAccount(localStorage);
                accountStorage.restoreResetIdentity(localStorage, {
                    customUsername: message.account.username || '',
                    profilePic: message.account.profilePicture || ''
                });
                if (message.account.cloudProgress && typeof accountStorage.writeCloudMeta === 'function') {
                    accountStorage.writeCloudMeta(localStorage, message.account.cloudProgress);
                }
                accountStorage.writeCachedIdentity(localStorage, {
                    serverUrl: state.socketUrl,
                    accountId: message.account.id
                }, message.account);
                localStorage.setItem(profileKey(), JSON.stringify(message.account));
                location.reload();
                return;
            }
            const cloudRevision = Math.max(0, Number(message.account?.cloudProgress?.revision) || 0);
            const cloudRestore = cloudRevision > 0
                && typeof accountStorage.restoreCloudProgressForActivation === 'function'
                // A saved account slot is the authoritative copy for this
                // device. Its purchases may not have reached an older server,
                // so even a higher cloud revision must not roll it backward.
                // Cloud import is for first use on a device with no local slot.
                ? accountStorage.restoreCloudProgressForActivation(localStorage, message.account.cloudProgress, activation)
                : { restored:false, reason:'missing' };
            if (activation.reloadRequired || (cloudRestore.restored && !isSessionResume)) {
                location.reload();
                return;
            }
            if (cloudRestore.restored && isSessionResume) {
                /* A reconnect can discover a newer cloud snapshot while the
                   player is mid-run or inside a menu. Keep the live document
                   stable; update the lightweight counters now and let the
                   complete restored save naturally initialize next launch. */
                try {
                    if (typeof totalXP !== 'undefined') totalXP = Math.max(0, Number.parseInt(localStorage.getItem('monkeyXP') || '0', 10) || 0);
                    if (typeof monkeyCoins !== 'undefined') monkeyCoins = Math.max(0, Number.parseInt(localStorage.getItem('monkeyCoins') || '0', 10) || 0);
                    if (typeof updateXPBar === 'function') updateXPBar();
                } catch (_) {}
            }
            state.authenticated = true;
            const pendingMobileScore = Math.max(0, Math.floor(Number(localStorage.getItem(PENDING_MOBILE_SCORE_KEY)) || 0));
            if (LOCAL_MOBILE_DEVICE && pendingMobileScore >= 25) {
                send({ type:'claim_mobile_score_skin', score:pendingMobileScore });
            }
            clearMultiplayerErrors();
            const offlineResetMarker = pendingOfflineResetKey(message.account.id);
            if (offlineResetMarker && localStorage.getItem(offlineResetMarker) === 'yes' && !pendingOfflineResetSubmitting) {
                pendingOfflineResetSubmitting = true;
                state.account = message.account;
                showStartupReconnect('Finishing the progress reset saved while you were offline…');
                if (send({ type: 'reset_account_progress', confirmation: 'RESET', offlineConfirmed: true })) return;
                pendingOfflineResetSubmitting = false;
            }
            persistProfile(message.account);
            scheduleAccountCosmeticsSync(true);
            elements.mpLoginPassword.value = '';
            elements.mpRegisterPassword.value = '';
            elements.mpRegisterConfirm.value = '';
            pendingRegistration = null;
            elements.startupVerify.classList.remove('open');
            setView(elements.mpHomeView);
            send({ type: 'get_social' });
            send({ type: 'get_inbox' });
            send({ type: 'get_activity_feed', since: GLOBAL_CHAT_SESSION_STARTED_AT });
            send({ type: 'get_party' });
            send({ type: 'get_clan' });
            send({ type: 'get_ranked' });
            send({ type: 'get_live_event' });
            if (monkeyWorld.resumeAfterReconnect && elements.monkeyWorldScreen.classList.contains('open')) {
                send(monkeyWorldJoinRequest());
            }
            updateInboxButton();
            unlockAccountGate();
            if (message.created) showToast('Online profile created!');
            else if (!isSessionResume) showToast('Logged in successfully.');
        } else if (message.type === 'auth_failed') {
            cancelReconnect();
            state.authenticated = false;
            clearMultiplayerErrors();
            localStorage.removeItem(sessionKey());
            localStorage.removeItem(profileKey());
            state.account = null;
            state.social = { friends: [], incoming: [], outgoing: [], blocked: [], groups: [], messages: [] };
            state.activeFriendId = null;
            state.inbox = { gifts: [], receipts: [], announcements: [] };
            state.party = null;
            state.partyInvitations = [];
            state.clan = null;
            state.clanInvitations = [];
            state.ranked = null;
            state.rankedQueued = false;
            updateInboxButton();
            renderSocial();
            updateOnlineSettingsPanel();
            setView(elements.mpAuthView);
            elements.mpAuthError.textContent = message.message;
            lockAccountGate(message.message);
        } else if (message.type === 'verification_required') {
            setStartupRegistrationBusy(false);
            elements.mpAuthError.textContent = '';
            elements.startupAuthError.textContent = '';
            showEmailVerification(message);
            showToast(message.resent
                ? 'A new verification code was sent.'
                : message.resumed
                    ? 'Continuing your email verification.'
                    : 'Verification code sent.');
        } else if (message.type === 'logged_out') {
            clearMultiplayerErrors();
            finishLocalLogout();
        } else if (message.type === 'account_profile') {
            const localPresentation = localTitleProfile();
            const serverPresentation = {
                equippedTitle: String(message.account?.equippedTitle || 'None'),
                titleStyle: normalizedTitleStyle(message.account?.titleStyle)
            };
            const presentationNeedsResync = localPresentation.equippedTitle !== serverPresentation.equippedTitle
                || JSON.stringify(localPresentation.titleStyle) !== JSON.stringify(serverPresentation.titleStyle);
            persistProfile(presentationNeedsResync
                ? { ...message.account, ...localPresentation }
                : message.account);
            // A progress-revision correction can reject the first cosmetic
            // update. Retry once with the corrected revision so title changes
            // still reach rooms, profiles, chats, and Monkey World.
            if (presentationNeedsResync) scheduleAccountCosmeticsSync(true);
            if (state.pendingProfileAction?.kind === 'picture') {
                state.pendingProfileAction.resolve(message.account);
                state.pendingProfileAction = null;
            }
        } else if (message.type === 'mobile_skin_unlocked') {
            localStorage.removeItem(PENDING_MOBILE_SCORE_KEY);
            persistProfile(message.account);
            showToast(message.granted
                ? `MOBILE ONLY reward unlocked! Mobile Monkey earned with a score of ${Number(message.score) || 25}.`
                : 'Mobile Monkey is already saved to this account.');
        } else if (message.type === 'account_title_update') {
            applyLiveTitleUpdate(message);
        } else if (message.type === 'username_changed') {
            persistProfile(message.account);
            if (state.pendingProfileAction?.kind === 'username') {
                state.pendingProfileAction.resolve(message.account);
                state.pendingProfileAction = null;
            }
            showToast(`Username updated to ${message.account.username}.`);
        } else if (message.type === 'public_profile') {
            state.pendingSocialAction = false;
            renderPublicProfile(message.profile);
        } else if (message.type === 'profile_likes_updated') {
            if (state.account?.id === message.userId) {
                state.account.profileLikes = message.likeCount;
                persistProfile(state.account);
            }
        } else if (message.type === 'social_snapshot') {
            state.social = hydrateSocialSnapshot(message.social);
            state.pendingSocialAction = false;
            state.pendingMessageDraft = null;
            elements.mpSocialError.textContent = '';
            renderSocial();
        } else if (message.type === 'group_chat_saved') {
            state.pendingGroupAction = false;
            state.activeGroupId = message.groupId;
            closeGroupModal();
            showToast(message.created ? 'Group chat created!' : 'Group chat updated!');
        } else if (message.type === 'inbox_snapshot') {
            state.inbox = message.inbox || { gifts: [], receipts: [], announcements: [] };
            state.inbox.receipts = Array.isArray(state.inbox.receipts) ? state.inbox.receipts : [];
            renderInbox(state.inboxView || 'gifts');
        } else if (message.type === 'activity_feed_snapshot') {
            state.activityFeed = Array.isArray(message.entries) ? message.entries : [];
            renderActivityFeed();
        } else if (message.type === 'activity_feed_entry') {
            if (!state.activityFeed.some((entry) => entry.id === message.entry.id)) state.activityFeed.push(message.entry);
            state.activityFeed = state.activityFeed.slice(-250);
            renderActivityFeed();
        } else if (message.type === 'activity_feed_deleted') {
            state.activityFeed = state.activityFeed.filter((entry) => entry.id !== message.entryId);
            renderActivityFeed();
        } else if (message.type === 'party_state') {
            state.party = message.party || null;
            state.partyInvitations = Array.isArray(message.invitations) ? message.invitations : [];
            renderSocial();
        } else if (message.type === 'clan_state') {
            state.clan = message.clan || null;
            state.clanInvitations = Array.isArray(message.invitations) ? message.invitations : [];
            state.pendingSocialAction = false;
            elements.mpSocialError.textContent = '';
            renderSocial();
            if (elements.mpClanModal.classList.contains('open')) renderClanModal();
        } else if (message.type === 'clan_invite_received') {
            state.pendingSocialAction = false;
            showToast(`${message.invitedBy?.username || 'A friend'} invited you to [${message.clan?.tag || 'CLAN'}] ${message.clan?.name || 'a clan'}!`);
        } else if (message.type === 'clan_invite_sent') {
            state.pendingSocialAction = false;
            elements.mpSocialError.textContent = '';
            showToast(message.alreadyInvited
                ? `${message.target?.username || 'That friend'} already has this clan invitation.`
                : `Clan invitation sent to ${message.target?.username || 'your friend'}!`);
        } else if (message.type === 'clan_invite_accepted') {
            showToast(`${message.member?.username || 'A player'} joined [${message.clan?.tag || 'CLAN'}] ${message.clan?.name || 'your clan'}!`);
        } else if (message.type === 'ranked_state') {
            applySharedRank(message.ranked || state.account?.ranked || null);
            state.rankedTiers = Array.isArray(message.tiers) ? message.tiers : [];
            state.rankedLeaderboard = Array.isArray(message.leaderboard) ? message.leaderboard : [];
            state.rankedQueued = Boolean(message.queued);
            elements.mpRankedError.textContent = message.queueStatus || '';
            renderRanked();
        } else if (message.type === 'ranked_match_found') {
            state.rankedQueued = false;
            showToast(`Season ${message.season} Ranked match found!`);
        } else if (message.type === 'owner_rank_action') {
            elements.mpRankedError.textContent = message.message;
            showToast(message.message);
        } else if (message.type === 'live_event_state') {
            state.liveEvents = Array.isArray(message.events) ? message.events : message.event ? [message.event] : [];
            state.liveEvent = state.liveEvents[0] || null;
            state.liveEventDefinitions = message.definitions || state.liveEventDefinitions;
            renderLiveEvent();
            window.dispatchEvent(new CustomEvent('flappy-live-event', { detail: window.flappyLiveEvents }));
        } else if (message.type === 'birthday_bash_state') {
            window.dispatchEvent(new CustomEvent('flappy-birthday-state', {
                detail: { ...(message.event || {}), serverNow: Number(message.serverNow) || Date.now() }
            }));
        } else if (message.type === 'birthday_bash_claimed') {
            persistProfile(message.account);
            window.dispatchEvent(new CustomEvent('flappy-birthday-state', {
                detail: { ...(message.event || {}), serverNow: Number(message.serverNow) || Date.now() }
            }));
            if (message.granted) {
                showRewardModal('Birthday Bash Reward', [{ label: 'Birthday Bash Monkey', amount: 1 }]);
                showToast('Birthday Bash Monkey unlocked permanently!');
            }
        } else if (message.type === 'owner_live_event_action') {
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (ownerMessage) ownerMessage.textContent = message.message;
            showToast(message.message);
        } else if (message.type === 'monkey_world_state') {
            showOnlineActivity('world');
            applyMonkeyWorldState(message.world);
        } else if (message.type === 'monkey_world_player_state') {
            if (message.player?.profileId !== state.account?.id) monkeyWorld.players.set(message.player.id, { ...message.player, receivedAt: performance.now() });
        } else if (message.type === 'left_monkey_world') {
            monkeyWorld.joined = false;
            stopMonkeyWorldLoop();
            elements.mwGame.classList.add('mp-hidden');
            elements.mwJoinPanel.classList.remove('mp-hidden');
        } else if (message.type === 'monkey_world_kicked') {
            monkeyWorld.joined = false;
            stopMonkeyWorldLoop();
            elements.mwGame.classList.add('mp-hidden');
            elements.mwJoinPanel.classList.remove('mp-hidden');
            elements.mwJoinError.textContent = 'The private-world owner removed you from that world.';
        } else if (message.type === 'lobby_invite') {
            showToast(`${message.from.username} invited you to an Online Race lobby.`);
            if (await gameConfirm(`${message.from.username} invited you to Online Race room ${message.code}. Join now?`, { title:'Online Race Invite', confirmLabel:'Join Race' })) {
                elements.multiplayerScreen.classList.add('open');
                elements.multiplayerScreen.setAttribute('aria-hidden', 'false');
                syncAccountCosmetics(true);
                send({ type: 'join_room', code: message.code, skin: currentSkin(), equippedTitle: currentTitle(), titleStyle: currentTitleStyle() });
            }
        } else if (message.type === 'lobby_invite_sent') {
            showToast(`Lobby invite sent to ${message.target.username}.`);
        } else if (message.type === 'monkey_world_invite') {
            showToast(`${message.from.username} invited you to Monkey World.`);
            if (await gameConfirm(`${message.from.username} invited you to ${message.public ? 'a public' : `private world ${message.code}`}. Join now?`, { title:'Monkey World Invite', confirmLabel:'Join World' })) {
                closeSharedSocial();
                closeOnlineHub();
                openMonkeyWorld().then(() => send({ type: message.public ? 'join_public_monkey_world' : 'join_private_monkey_world', code: message.code }));
            }
        } else if (message.type === 'monkey_world_invite_sent') {
            showToast(`Monkey World invite sent to ${message.target.username}.`);
        } else if (message.type === 'defense_invite_received') {
            showToast(`${message.from.username} invited you to Online Defense.`);
            if (await gameConfirm(`${message.from.username} invited you to a private ${message.mode === 'coop' ? 'co-op' : 'versus'} defense room. Join now?`, { title:'Defense Invite', confirmLabel:'Join Defense' })) {
                closeSharedSocial();
                closeOnlineHub();
                openOnlineDefense().then(() => send({ type: 'defense_join_room', code: message.code }));
            }
        } else if (message.type === 'defense_invite_sent') {
            showToast(`Online Defense invite sent to ${message.target.username}.`);
        } else if (message.type === 'gift_received') {
            if (!state.inbox.gifts.some((gift) => gift.id === message.gift.id)) state.inbox.gifts.push(message.gift);
            updateInboxButton();
            showToast(`🎁 New gift from ${message.gift.fromName}!`);
        } else if (message.type === 'chat_action_complete') {
            state.pendingSocialAction = false;
            if (message.action === 'delete' && message.messageId) {
                state.socialMessageMediaCache.delete(message.messageId);
            }
            state.pendingChatAction = null;
            showToast(message.action === 'clear' ? 'Conversation cleared for both players.' : 'Message deleted for everyone.');
        } else if (message.type === 'gift_sent') {
            const requestId = message.gift.requestId;
            const chargeMarker = `flappyGiftCharged:${requestId}`;
            if (!message.duplicate && localStorage.getItem(chargeMarker) !== 'yes') {
                const balance = Number.parseInt(localStorage.getItem('monkeyCoins') || '0', 10);
                const next = Math.max(0, balance - Number(message.gift.price || 0));
                localStorage.setItem('monkeyCoins', next);
                localStorage.setItem('lifetimeBananaCoinsSpent', String((Number.parseInt(localStorage.getItem('lifetimeBananaCoinsSpent') || '0', 10) || 0) + Number(message.gift.price || 0)));
                if (typeof monkeyCoins !== 'undefined') monkeyCoins = next;
                localStorage.setItem(chargeMarker, 'yes');
                if (typeof refreshShopGrid === 'function') refreshShopGrid();
            }
            if (message.account) persistProfile(message.account);
            state.pendingGift = null;
            closeGiftModal();
            showToast(`Gift sent to ${message.target.username}!`);
        } else if (message.type === 'gift_claimed') {
            const gift = state.inbox.gifts.find((entry) => entry.id === message.gift.id);
            if (gift) gift.claimedAt = message.gift.claimedAt || Date.now();
            renderInbox('gifts');
            showToast(`${message.gift.label} added to your game!`);
        } else if (message.type === 'announcement_live') {
            if (!state.inbox.announcements.some((entry) => entry.id === message.announcement.id)) state.inbox.announcements.push(message.announcement);
            showGlobalAnnouncement(message.announcement);
            updateInboxButton();
        } else if (message.type === 'announcement_sent') {
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (ownerMessage) ownerMessage.textContent = 'Global announcement sent to every connected player and saved in their inbox.';
        } else if (message.type === 'announcement_deleted') {
            state.inbox.announcements = state.inbox.announcements.filter((entry) => entry.id !== message.announcementId);
            renderInbox(state.inboxView || 'announcements');
            showToast('Global announcement deleted.');
        } else if (message.type === 'grant_all_sent') {
            state.pendingOwnerAction = false;
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (ownerMessage) ownerMessage.textContent = `${message.label} sent to ${message.count.toLocaleString()} accounts.`;
            showToast(`Game-wide grant sent to ${message.count.toLocaleString()} accounts.`);
        } else if (message.type === 'owner_grant_every_item_sent') {
            state.pendingOwnerAction = false;
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            const details = `Complete collection granted to ${message.target.username} (${Number(message.itemCount || 0).toLocaleString()} entries).`;
            if (ownerMessage) ownerMessage.textContent = details;
            showToast(details);
        } else if (message.type === 'owner_progress_reset_action') {
            state.pendingOwnerAction = false;
            const requestedReset = state.pendingOwnerReset;
            state.pendingOwnerReset = null;
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (ownerMessage) ownerMessage.textContent = message.message;
            showToast(message.message);
            const currentAccountId = String(state.account?.id || '').toUpperCase();
            const resetTouchesThisAccount = Boolean(
                message.resetAll
                || requestedReset?.resetAll
                || (message.targetId && String(message.targetId).toUpperCase() === currentAccountId)
                || (requestedReset?.targetId && String(requestedReset.targetId).toUpperCase() === currentAccountId)
            );
            if (resetTouchesThisAccount) {
                clearLocalProgress({
                    account: resetAccountSnapshot(state.account),
                    keepSession: Boolean(localStorage.getItem(sessionKey()))
                });
                return;
            }
        } else if (message.type === 'progress_reset') {
            pendingOfflineResetSubmitting = false;
            // Clear the queued-offline marker before reloading. Leaving this set
            // made the next automatic login submit another reset, which caused an
            // endless reset -> reconnect -> reset loop.
            clearPendingOfflineReset(message.account?.id || state.account?.id);
            closeDangerModal();
            showToast('All game progress was reset. Your account is still logged in.');
            clearLocalProgress({ account: message.account, keepSession: true });
        } else if (message.type === 'account_deleted') {
            closeDangerModal();
            clearLocalProgress({ keepSession: false, deleteAccount: true });
        } else if (message.type === 'grant_received') {
            persistProfile(message.account);
        } else if (message.type === 'grant_sent') {
            state.pendingOwnerAction = false;
            const removing = message.grant.operation === 'remove';
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (ownerMessage) ownerMessage.textContent = `${removing ? 'Removed' : 'Sent'} ${message.grant.label} ${removing ? 'from' : 'to'} ${message.target.username}.`;
            showToast(`${message.grant.label} ${removing ? 'removed from' : 'sent to'} ${message.target.username}.`);
        } else if (message.type === 'redeem_success') {
            state.pendingRedeem = false;
            const rewards = (message.rewards || []).map((reward) => `${reward.label} ×${Math.max(1, Number(reward.amount) || 1).toLocaleString()}`);
            state.redeemNotice = `Redeemed! ${rewards.join(' + ')}`;
            state.redeemNoticeKind = 'success';
            persistProfile(message.account);
            const status = document.getElementById('redeemCodeStatus');
            if (status) {
                status.className = 'redeem-code-status success';
                status.textContent = state.redeemNotice;
            }
            const input = document.getElementById('redeemCodeInput');
            if (input) input.value = '';
            if (message.receipt && !state.inbox.receipts.some((entry) => entry.id === message.receipt.id)) {
                state.inbox.receipts.push(message.receipt);
            }
            showRewardModal(`Code Redeemed: ${message.code || 'Success'}`, message.rewards || []);
            showToast(`Code redeemed: ${rewards.join(' + ')}`);
        } else if (message.type === 'defense_rank_state') {
            applySharedRank(message.ranked || onlineDefense.rank);
            onlineDefense.leaderboard = Array.isArray(message.leaderboard) ? message.leaderboard : onlineDefense.leaderboard;
            elements.odQueueStatus.textContent = message.queueStatus || (message.queuedMode ? `Searching for a ranked ${message.queuedMode} match...` : '');
            elements.odCancelQueue.classList.toggle('mp-hidden', !message.queuedMode);
            elements.odQueueVersus.disabled = Boolean(message.queuedMode);
            elements.odQueueCoop.disabled = Boolean(message.queuedMode);
            renderDefenseRank();
        } else if (message.type === 'defense_room_state') {
            showOnlineActivity('defense');
            onlineDefense.room = message.room;
            renderDefenseRoom();
            if (onlineDefense.active) updateDefenseHud();
        } else if (message.type === 'defense_match_start') {
            showOnlineActivity('defense');
            startDefenseMatch(message.room);
        } else if (message.type === 'defense_wave_start') {
            beginOnlineDefenseWave(Number(message.wave), Number(message.startedAt) - state.serverOffset);
        } else if (message.type === 'defense_match_end') {
            showDefenseResult(message);
        } else if (message.type === 'defense_left') {
            stopDefenseLoop();
            onlineDefense.room = null;
            onlineDefense.resultOpen = false;
            setDefenseView(elements.odMenu);
            send({ type: 'defense_get_rank' });
        } else if (message.type === 'room_state') {
            showOnlineActivity('race');
            const incomingRevision = Math.max(0, Number(message.room?.settingsRevision) || 0);
            if (state.pendingRoomSettings) {
                const pending = state.pendingRoomSettings;
                const confirmed = incomingRevision >= pending.revision && roomSettingsMatch(message.room?.settings, pending.settings);
                if (confirmed) state.pendingRoomSettings = null;
                else if (incomingRevision < pending.revision && message.room) message.room.settings = { ...message.room.settings, ...pending.settings };
            }
            state.roomSettingsRevision = Math.max(state.roomSettingsRevision, incomingRevision);
            state.room = message.room;
            elements.mpHomeError.textContent = '';
            elements.mpLobbyError.textContent = '';
            renderLobby();
            if (!race.active && !race.resultOpen) setView(elements.mpLobbyView);
        } else if (message.type === 'left_room') {
            state.room = null;
            state.pendingRoomSettings = null;
            elements.mpLobbyError.textContent = '';
            if (!race.active) setView(elements.mpHomeView);
        } else if (message.type === 'match_start') {
            showOnlineActivity('race');
            elements.mpLobbyError.textContent = '';
            startRace(message);
        } else if (message.type === 'player_state') {
            if (race.started && message.player.id !== state.playerId) {
                const previous = race.remotes.get(message.player.id);
                const next = { ...message.player, receivedAt: performance.now() };
                if (previous?.alive !== false && next.alive === false) {
                    spawnRaceDeathExplosion(next.explosionVfx, next.y);
                }
                race.remotes.set(message.player.id, next);
            }
        } else if (message.type === 'match_end') {
            showResults(message);
        } else if (message.type === 'error') {
            setStartupRegistrationBusy(false);
            if (pendingOfflineResetSubmitting && localStorage.getItem(pendingOfflineResetKey()) === 'yes') {
                pendingOfflineResetSubmitting = false;
                const details = 'Your local progress is reset, but this online server is an older build and could not clear XP, rank, or redeemed codes. Update/redeploy multiplayer-server.js, then reconnect to finish the account reset.';
                elements.startupAuthError.textContent = details;
                lockAccountGate(details);
                showToast(details, true);
                return;
            } else if (message.message === 'Join Monkey World before chatting.' && elements.monkeyWorldScreen.classList.contains('open')) {
                monkeyWorld.pendingChatNeedsResend = Boolean(monkeyWorld.pendingChatText);
                rejoinMonkeyWorld('World connection refreshed — sending your message…');
            } else if (state.pendingProfileAction) {
                state.pendingProfileAction.reject(new Error(message.message));
                state.pendingProfileAction = null;
            } else if (elements.mpActivityModal.classList.contains('open')) {
                elements.mpActivityError.textContent = message.message;
            } else if (elements.mpClanModal.classList.contains('open')) {
                elements.mpClanError.textContent = message.message;
            } else if (elements.mpRankedModal.classList.contains('open')) {
                elements.mpRankedError.textContent = message.message;
            } else if (elements.onlineDefenseScreen.classList.contains('open')) {
                (onlineDefense.active ? elements.odGameError : onlineDefense.room ? elements.odLobbyError : elements.odMenuError).textContent = message.message;
            } else if (elements.monkeyWorldScreen.classList.contains('open')) {
                (monkeyWorld.joined ? elements.mwGameError : elements.mwJoinError).textContent = message.message;
            } else if (state.pendingGroupAction || elements.mpGroupModal.classList.contains('open')) {
                state.pendingGroupAction = false;
                elements.mpGroupError.textContent = message.message;
                elements.mpSaveGroup.disabled = false;
                elements.mpSaveGroup.textContent = state.editingGroupId ? 'Save Group' : 'Create Group';
            } else if (elements.mpAccountDangerModal.classList.contains('open')) {
                elements.mpDangerError.textContent = message.message;
            } else if (state.pendingGift) {
                state.pendingGift = null;
                elements.mpGiftError.textContent = message.message;
            } else if (state.pendingSocialAction) {
                state.pendingSocialAction = false;
                if (state.pendingMessageDraft) {
                    elements.mpMessageInput.value = state.pendingMessageDraft.text;
                    state.pendingMessageAttachment = state.pendingMessageDraft.attachment;
                    if (state.pendingMessageAttachment) showPendingMessageAttachment(state.pendingMessageAttachment);
                    state.pendingMessageDraft = null;
                }
                if (state.pendingChatAction?.type === 'delete') {
                    state.deletedSocialMessageIds.delete(state.pendingChatAction.messageId);
                } else if (state.pendingChatAction?.type === 'clear') {
                    state.clearedFriendConversations.delete(state.pendingChatAction.friendId);
                }
                state.pendingChatAction = null;
                elements.mpSocialError.textContent = message.message;
                send({ type: 'get_social' });
            } else if (state.pendingOwnerAction) {
                state.pendingOwnerAction = false;
                state.pendingOwnerReset = null;
                const ownerMessage = document.getElementById('onlineOwnerMessage');
                if (ownerMessage) ownerMessage.textContent = message.message;
            } else if (state.pendingRedeem) {
                state.pendingRedeem = false;
                state.redeemNotice = message.message;
                state.redeemNoticeKind = 'error';
                const status = document.getElementById('redeemCodeStatus');
                const submit = document.getElementById('redeemCodeSubmit');
                if (status) {
                    status.className = 'redeem-code-status error';
                    status.textContent = message.message;
                }
                if (submit) {
                    submit.disabled = false;
                    submit.textContent = 'Redeem Code';
                }
            } else if (!state.authenticated) {
                elements.mpAuthError.textContent = message.message;
                if (elements.startupVerify.classList.contains('open')) elements.startupVerifyError.textContent = message.message;
                else elements.startupAuthError.textContent = message.message;
            } else if (state.room) {
                elements.mpLobbyError.textContent = message.message;
            } else {
                elements.mpHomeError.textContent = message.message;
            }
            showToast(message.message, true);
        }
    }

    function renderLobby() {
        const room = state.room;
        if (!room) return;
        elements.mpRoomCode.textContent = room.code;
        elements.mpLobbyTitle.textContent = room.ranked ? 'Season 1 Ranked Match' : 'Private Room';
        const me = room.players.find((player) => player.id === state.playerId);
        const isHost = room.hostId === state.playerId;
        elements.mpPlayers.innerHTML = room.players.map((player) => `
            <div class="mp-player">
                <img src="${escapeHtml(player.skin)}" alt="">
                <div><div class="mp-player-name">${player.ranked ? `<img class="mp-inline-rank" src="${escapeHtml(rankIconSource(player.ranked))}" title="${escapeHtml(player.ranked.rank)}" alt="">` : ''}${player.clan ? `<span class="mp-clan-tag" style="color:${escapeHtml(player.clan.tagColor)}">[${escapeHtml(player.clan.tag)}]</span> ` : ''}${escapeHtml(player.name)}${platformBadgeHtml(player.platform)} <span class="mp-level-badge">Lv. ${Math.max(1, Number(player.level) || 1)}</span></div>${sharedTitleHtml(player.id === state.playerId ? localTitleProfile() : player)}<div class="mp-player-state ${player.isHost ? 'host' : player.ready ? 'ready' : ''}">${player.isHost ? 'Host' : player.ready ? 'Ready' : 'Not ready'}</div></div>
                <div style="color:${player.connected ? '#74ee9b' : '#ff8991'};font-size:10px;font-weight:900">${player.connected ? 'ONLINE' : 'LEFT'}</div>
            </div>
        `).join('');
        elements.mpVictorySelect.value = room.settings.victory;
        elements.mpTargetScore.value = room.settings.targetScore;
        elements.mpDuration.value = room.settings.durationSeconds;
        elements.mpLivesSelect.value = String(room.settings.lives || 1);
        elements.mpGapSelect.value = room.settings.pipeGap || 'normal';
        elements.mpMovingPipes.value = room.settings.movingPipes ? 'on' : 'off';
        elements.mpFriendlyPractice.value = room.settings.friendlyPractice ? 'on' : 'off';
        for (const input of [elements.mpVictorySelect, elements.mpTargetScore, elements.mpDuration, elements.mpLivesSelect, elements.mpGapSelect, elements.mpMovingPipes, elements.mpFriendlyPractice]) input.disabled = !isHost;
        if (room.ranked) for (const input of [elements.mpVictorySelect, elements.mpTargetScore, elements.mpDuration, elements.mpLivesSelect, elements.mpGapSelect, elements.mpMovingPipes, elements.mpFriendlyPractice]) input.disabled = true;
        elements.mpReadyBtn.classList.toggle('mp-hidden', isHost);
        elements.mpReadyBtn.textContent = me?.ready ? 'Not Ready' : 'Ready Up';
        elements.mpStartMatchBtn.classList.toggle('mp-hidden', !isHost);
        if (room.ranked) {
            elements.mpReadyBtn.classList.add('mp-hidden');
            elements.mpStartMatchBtn.classList.add('mp-hidden');
        }
        const guestsReady = room.players.filter((player) => !player.isHost && player.connected).every((player) => player.ready);
        elements.mpStartMatchBtn.disabled = room.players.filter((player) => player.connected).length < room.minimumPlayers || !guestsReady;
        renderRuleFields();
    }

    function renderRuleFields() {
        const victory = elements.mpVictorySelect.value;
        const friendly = elements.mpFriendlyPractice.value === 'on';
        elements.mpTargetField.classList.toggle('mp-hidden', victory !== 'target_score');
        elements.mpDurationField.classList.toggle('mp-hidden', victory !== 'timed_score' && !friendly);
        const victoryText = victory === 'last_alive'
            ? 'Each player gets an equally difficult independent pipe course. The final surviving monkey wins; score and survival time break a simultaneous fall.'
            : victory === 'target_score'
                ? `Independent courses prevent mirror-score ties. The first monkey to reach ${elements.mpTargetScore.value || 25} points wins immediately.`
                : `Everyone flies an independent course. After ${elements.mpDuration.value || 120} seconds, highest score wins; survival time breaks equal scores.`;
        const extras = `${elements.mpLivesSelect.value === '3' ? 'Three lives' : 'One life'} · ${elements.mpGapSelect.options[elements.mpGapSelect.selectedIndex].text} gaps · ${elements.mpMovingPipes.value === 'on' ? 'Moving pipes' : 'Stationary pipes'}`;
        elements.mpRuleDescription.textContent = friendly
            ? `Friendly Practice: players respawn after falling. Highest score after ${elements.mpDuration.value || 120} seconds wins. ${extras}.`
            : `${victoryText} ${extras}.`;
    }

    function collectRoomSettings() {
        return {
            victory: elements.mpVictorySelect.value,
            targetScore: Number(elements.mpTargetScore.value),
            durationSeconds: Number(elements.mpDuration.value),
            lives: Number(elements.mpLivesSelect.value),
            pipeGap: elements.mpGapSelect.value,
            movingPipes: elements.mpMovingPipes.value === 'on',
            friendlyPractice: elements.mpFriendlyPractice.value === 'on'
        };
    }

    function roomSettingsMatch(first, second) {
        if (!first || !second) return false;
        return first.victory === second.victory
            && Number(first.targetScore) === Number(second.targetScore)
            && Number(first.durationSeconds) === Number(second.durationSeconds)
            && Number(first.lives) === Number(second.lives)
            && first.pipeGap === second.pipeGap
            && Boolean(first.movingPipes) === Boolean(second.movingPipes)
            && Boolean(first.friendlyPractice) === Boolean(second.friendlyPractice);
    }

    function sendSettings() {
        if (state.room?.hostId !== state.playerId) return;
        const settings = collectRoomSettings();
        const revision = Math.max(Date.now(), state.roomSettingsRevision + 1, (state.pendingRoomSettings?.revision || 0) + 1);
        state.pendingRoomSettings = { revision, settings };
        state.roomSettingsRevision = revision;
        if (state.room) state.room.settings = { ...state.room.settings, ...settings };
        send({
            type: 'update_settings',
            settings,
            settingsRevision: revision
        });
        renderRuleFields();
    }

    function startRace(message) {
        race.active = true;
        race.started = false;
        race.resultOpen = false;
        race.matchId = message.matchId;
        race.seed = courseSeedForPlayer(message.seed >>> 0, state.playerId);
        race.settings = message.settings;
        race.localStartAt = message.startAt - state.serverOffset;
        race.lastTick = performance.now();
        race.accumulator = 0;
        race.frame = 0;
        race.y = 140;
        race.velocity = -2;
        race.score = 0;
        race.alive = true;
        race.lives = Number(message.settings.lives) === 3 ? 3 : 1;
        race.invincibleUntil = 0;
        race.respawnUntil = 0;
        race.passed = new Set();
        race.pipeSchedule = [];
        race.deathEffects = [];
        race.remotes = new Map(message.players
            .filter((player) => player.id !== state.playerId)
            .map((player) => [player.id, { ...player, y: 140, velocity: 0, frame: 0, receivedAt: performance.now() }]));
        setView(elements.mpRaceView);
        closeResult();
        elements.multiplayerScreen.scrollTop = 0;
        if (!race.animationFrame) race.animationFrame = requestAnimationFrame(raceLoop);
    }

    function courseSeedForPlayer(roomSeed, playerId) {
        let value = roomSeed >>> 0;
        for (const character of String(playerId || 'player')) {
            value = Math.imul(value ^ character.charCodeAt(0), 0x45d9f3b) >>> 0;
            value ^= value >>> 16;
        }
        return value >>> 0;
    }

    function stopRace(message = '') {
        race.active = false;
        race.started = false;
        if (race.animationFrame) cancelAnimationFrame(race.animationFrame);
        race.animationFrame = null;
        if (message) showToast(message, true);
    }

    function flapRace() {
        if (!race.active || !race.started || !race.alive) return;
        race.velocity = RACE_JUMP;
        sendRaceState(true);
    }

    function randomForPipe(index) {
        let value = (race.seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0;
        value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
        return (value >>> 0) / 4294967296;
    }

    function pipeDifficulty(index) {
        return index < 50 ? 0 : Math.min(1, (index - 50) / 500);
    }

    function pipeRules(index) {
        const difficulty = pipeDifficulty(index);
        const gapAdjustments = { wide: 70, normal: 0, tight: -55, tiny: -105 };
        return {
            gap: Math.max(105, 320 - difficulty * 140 + (gapAdjustments[race.settings?.pipeGap] || 0)),
            speed: 1.2 + difficulty * 1.8,
            interval: Math.floor(220 - difficulty * 100)
        };
    }

    function ensurePipeSchedule(throughFrame) {
        // The base game's resetGame() creates the first pipe immediately.
        if (!race.pipeSchedule.length) race.pipeSchedule.push({ index: 0, spawnFrame: 0 });
        let latest = race.pipeSchedule[race.pipeSchedule.length - 1];
        while (latest.spawnFrame <= throughFrame) {
            const next = { index: latest.index + 1, spawnFrame: latest.spawnFrame + pipeRules(latest.index).interval };
            race.pipeSchedule.push(next);
            latest = next;
        }
    }

    function pipeFor(index) {
        ensurePipeSchedule(race.frame + 260);
        const scheduled = race.pipeSchedule[index];
        if (!scheduled) return null;
        const rules = pipeRules(index);
        const randomExtra = index >= 150 ? 52 : index >= 100 ? 34 : index >= 50 ? 20 : 0;
        const minimumTop = Math.max(28, 50 - randomExtra);
        const maximumTop = GROUND_Y - rules.gap - 150 + randomExtra;
        const baseTop = minimumTop + randomForPipe(index) * Math.max(1, maximumTop - minimumTop);
        const oscillation = race.settings?.movingPipes
            ? Math.sin(race.frame * 0.021 + randomForPipe(index + 100000) * Math.PI * 2) * (36 + (index >= 300 ? 10 : 0))
            : 0;
        const top = Math.max(80, Math.min(GROUND_Y - rules.gap - 80, baseTop + oscillation));
        const x = WIDTH + 140 - (race.frame - scheduled.spawnFrame) * rules.speed;
        return { index, x, top, bottom: top + rules.gap, gap: rules.gap, speed: rules.speed };
    }

    function visiblePipes() {
        ensurePipeSchedule(race.frame + 260);
        return race.pipeSchedule
            .map((entry) => pipeFor(entry.index))
            .filter((pipe) => pipe && pipe.x < WIDTH + 160 && pipe.x + PIPE_WIDTH > -80);
    }

    function eliminateLocalPlayer(fatal = false) {
        if (!race.alive) return;
        if (race.settings?.friendlyPractice) {
            spawnRaceDeathExplosion(
                typeof selectedExplosionVfx !== 'undefined' ? selectedExplosionVfx : 'none',
                race.y
            );
            race.alive = false;
            race.respawnUntil = performance.now() + 1200;
            race.velocity = 0;
            sendRaceState(true);
            return;
        }
        race.lives = fatal ? 0 : Math.max(0, race.lives - 1);
        if (race.lives > 0) {
            // Match a non-fatal hit in the base game: keep the current motion
            // and use the same 150-frame invincibility window.
            race.invincibleUntil = race.frame + 150;
            sendRaceState(true);
            return;
        }
        spawnRaceDeathExplosion(
            typeof selectedExplosionVfx !== 'undefined' ? selectedExplosionVfx : 'none',
            race.y
        );
        race.alive = false;
        race.velocity = 0;
        sendRaceState(true);
    }

    function updateRaceStep() {
        if (!race.started) return;
        if (!race.alive && race.settings?.friendlyPractice) {
            if (performance.now() >= race.respawnUntil) {
                race.alive = true;
                race.y = 140;
                race.velocity = -2;
                race.invincibleUntil = race.frame + 75;
                sendRaceState(true);
            }
            return;
        }
        if (!race.alive) return;
        race.frame += 1;
        race.velocity += RACE_GRAVITY;
        race.y += race.velocity;
        if (race.y < -50 || race.y + MONKEY_SIZE >= GROUND_Y) {
            // Base Flappy Monkey makes ground/ceiling contact immediately fatal;
            // extra hearts only absorb pipe hits.
            eliminateLocalPlayer(true);
            return;
        }
        for (const pipe of visiblePipes()) {
            if (!race.passed.has(pipe.index) && pipe.x + PIPE_WIDTH < MONKEY_X) {
                race.passed.add(pipe.index);
                race.score += 1;
                sendRaceState(true);
            }
            const overlapsX = MONKEY_X + MONKEY_SIZE > pipe.x && MONKEY_X < pipe.x + PIPE_WIDTH;
            const overlapsY = race.y < pipe.top || race.y + MONKEY_SIZE > pipe.bottom;
            if (overlapsX && overlapsY && race.frame >= race.invincibleUntil) {
                eliminateLocalPlayer();
                return;
            }
        }
    }

    function sendRaceState(force = false) {
        const now = performance.now();
        if (!force && now - race.lastStateSentAt < 100) return;
        race.lastStateSentAt = now;
        send({ type: 'player_state', matchId: race.matchId, score: race.score, alive: race.settings?.friendlyPractice ? true : race.alive, lives: race.lives, respawning: Boolean(race.settings?.friendlyPractice && !race.alive), y: race.y, velocity: race.velocity, frame: race.frame });
    }

    function imageForSkin(file) {
        if (typeof animatedSkins !== 'undefined' && animatedSkins[file]) return animatedSkins[file];
        if (!raceImages.has(file)) {
            const image = new Image();
            image.src = file || 'Default Monkey.png';
            raceImages.set(file, image);
        }
        return raceImages.get(file);
    }

    function playerColor(id) {
        let hash = 0;
        for (const character of String(id)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
        return `hsl(${Math.abs(hash) % 360},90%,67%)`;
    }

    function normalizeRaceExplosionVfx(value) {
        const raw = String(value || '').trim().toLowerCase();
        const names = {
            'banana burst':'bananas',
            'star explosion':'stars',
            hypernova:'hypernova',
            'water splash':'water',
            'fire explosion':'fire'
        };
        return ['bananas','stars','hypernova','water','fire'].includes(raw) ? raw : names[raw] || 'none';
    }

    function spawnRaceDeathExplosion(value, playerY) {
        const type = normalizeRaceExplosionVfx(value);
        if (type === 'none') return;
        const glyphs = { bananas:['🍌'], stars:['★','✦','⭐'] }[type] || [''];
        const colors = {
            bananas:['#ffd83d','#fff19b'],
            stars:['#ffffff','#ffe766','#79e9ff'],
            water:['#d8fbff','#55dfff','#168eff'],
            fire:['#fff27a','#ff9b32','#ff3520'],
            hypernova:['#ffffff','#72e8ff','#b76cff','#ff62da']
        }[type];
        race.deathEffects.push({
            type,
            startedAt: performance.now(),
            x: MONKEY_X + MONKEY_SIZE / 2,
            y: Math.max(35, Math.min(GROUND_Y - 18, Number(playerY) + MONKEY_SIZE / 2)),
            particles: Array.from({ length: 38 }, (_, index) => {
                const angle = index / 38 * Math.PI * 2 + (Math.random() - .5) * .28;
                return {
                    angle,
                    speed: 72 + Math.random() * 155,
                    size: 7 + Math.random() * 12,
                    spin: (Math.random() - .5) * 7,
                    glyph: glyphs[index % glyphs.length],
                    color: colors[index % colors.length]
                };
            })
        });
        race.deathEffects = race.deathEffects.slice(-8);
    }

    function drawRaceDeathExplosions() {
        const now = performance.now();
        race.deathEffects = race.deathEffects.filter((effect) => now - effect.startedAt <= 1650);
        for (const effect of race.deathEffects) {
            const age = (now - effect.startedAt) / 1000;
            const fade = Math.max(0, 1 - age / 1.65);
            raceContext.save();
            raceContext.globalCompositeOperation = 'lighter';
            if (effect.type === 'hypernova') {
                ['#fff','#72e8ff','#b76cff','#ff62da'].forEach((color, ring) => {
                    raceContext.globalAlpha = fade * (1 - ring * .14);
                    raceContext.strokeStyle = color;
                    raceContext.lineWidth = 7 - ring;
                    raceContext.beginPath();
                    raceContext.arc(effect.x, effect.y, 15 + age * (70 + ring * 28), 0, Math.PI * 2);
                    raceContext.stroke();
                });
            }
            for (const particle of effect.particles) {
                const travel = particle.speed * age;
                const x = effect.x + Math.cos(particle.angle) * travel;
                const gravity = effect.type === 'water' ? 130 : effect.type === 'fire' ? -35 : 55;
                const y = effect.y + Math.sin(particle.angle) * travel + gravity * age * age;
                raceContext.save();
                raceContext.translate(x, y);
                raceContext.rotate(particle.spin * age);
                raceContext.globalAlpha = fade;
                raceContext.fillStyle = particle.color;
                if (effect.type === 'bananas' || effect.type === 'stars') {
                    raceContext.font = `${particle.size + 6}px Arial`;
                    raceContext.textAlign = 'center';
                    raceContext.fillText(particle.glyph, 0, 0);
                } else {
                    raceContext.beginPath();
                    raceContext.arc(0, 0, particle.size * (.5 + .5 * fade), 0, Math.PI * 2);
                    raceContext.fill();
                }
                raceContext.restore();
            }
            raceContext.restore();
        }
    }

    function drawStyledPipe(pipe) {
        const theme = localStorage.getItem('selectedPipeTheme') || 'classic';
        let pipeFill = '#666';
        const pipeStroke = '#333';
        const capFill = '#444';
        let specialOutline = false;
        if (theme === 'neon') {
            pipeFill = '#00ffff';
            raceContext.shadowColor = '#ff00ff';
            raceContext.shadowBlur = 18;
            specialOutline = true;
        } else if (theme === 'galaxy') {
            const gradient = raceContext.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, pipe.top);
            gradient.addColorStop(0, '#220033');
            gradient.addColorStop(1, '#aa00ff');
            pipeFill = gradient;
        } else if (theme === 'rainbow') pipeFill = `hsl(${race.frame * 3 % 360},100%,60%)`;
        else if (theme === 'sockmonkey') pipeFill = '#8B4513';
        else if (theme === 'lava') {
            const gradient = raceContext.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, pipe.top);
            gradient.addColorStop(0, '#ff4500');
            gradient.addColorStop(1, '#8b0000');
            pipeFill = gradient;
        } else if (theme === 'crystal') {
            pipeFill = '#a0f0ff';
            raceContext.shadowColor = '#ffffff';
            raceContext.shadowBlur = 15;
        } else if (theme === 'gold') pipeFill = '#ffcc00';
        else if (theme === 'underwater') pipeFill = '#3a8ab5';
        else if (theme === 'crown') {
            pipeFill = '#ffd84a';
            raceContext.shadowColor = '#fff2a6';
            raceContext.shadowBlur = 16;
        } else if (theme === 'mint') {
            pipeFill = '#57e5c2';
            raceContext.shadowColor = '#c4fff0';
            raceContext.shadowBlur = 13;
        }

        raceContext.fillStyle = pipeFill;
        raceContext.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.top);
        raceContext.lineWidth = 6;
        raceContext.strokeStyle = specialOutline ? '#ffffff' : pipeStroke;
        raceContext.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.top);
        raceContext.shadowBlur = 0;
        raceContext.fillStyle = capFill;
        raceContext.fillRect(pipe.x - 8, pipe.top - 28, 84, 34);
        raceContext.strokeRect(pipe.x - 8, pipe.top - 28, 84, 34);
        raceContext.fillStyle = pipeFill;
        raceContext.fillRect(pipe.x, pipe.bottom, PIPE_WIDTH, GROUND_Y - pipe.bottom);
        raceContext.strokeStyle = specialOutline ? '#ffffff' : pipeStroke;
        if (specialOutline) raceContext.shadowBlur = 18;
        raceContext.strokeRect(pipe.x, pipe.bottom, PIPE_WIDTH, GROUND_Y - pipe.bottom);
        raceContext.shadowBlur = 0;
        raceContext.fillStyle = capFill;
        raceContext.fillRect(pipe.x - 8, pipe.bottom, 84, 34);
        raceContext.strokeRect(pipe.x - 8, pipe.bottom, 84, 34);
        raceContext.shadowBlur = 0;
    }

    function drawRacePlayer(player, local = false) {
        let y = race.started ? (local ? race.y : player.y) : 140;
        if (race.started && !local && player.alive !== false && Number.isFinite(player.receivedAt)) {
            const elapsedFrames = Math.min(300, Math.max(0, (performance.now() - player.receivedAt) / STEP));
            const velocity = Number.isFinite(player.velocity) ? player.velocity : 0;
            y += velocity * elapsedFrames + RACE_GRAVITY * elapsedFrames * (elapsedFrames + 1) / 2;
            y = Math.min(GROUND_Y - MONKEY_SIZE, y);
        }
        if (!Number.isFinite(y)) return;
        const image = imageForSkin(local ? currentSkin() : player.skin);
        const color = playerColor(local ? state.playerId : player.id);
        raceContext.save();
        raceContext.globalAlpha = player.alive === false ? .22 : local ? 1 : .6;
        raceContext.shadowColor = color;
        raceContext.shadowBlur = local ? 16 : 11;
        if (image.complete && image.naturalWidth) raceContext.drawImage(image, MONKEY_X, y, MONKEY_SIZE, MONKEY_SIZE);
        else {
            raceContext.fillStyle = color;
            raceContext.beginPath();
            raceContext.arc(MONKEY_X + MONKEY_SIZE / 2, y + MONKEY_SIZE / 2, MONKEY_SIZE / 2 - 4, 0, Math.PI * 2);
            raceContext.fill();
        }
        raceContext.shadowBlur = 0;
        raceContext.globalAlpha = 1;
        const title = local ? currentTitle() : player.equippedTitle;
        const name = local ? state.account?.username || 'You' : player.name;
        const clan = local ? state.account?.clan : player.clan;
        const ranked = local ? state.account?.ranked : player.ranked;
        const displayName = `${clan ? `[${clan.tag}] ` : ''}${name}`;
        const level = local ? Math.max(1, Number(state.account?.level) || 1) : Math.max(1, Number(player.level) || 1);
        const levelText = ` · Lv.${level}`;
        raceContext.textAlign = 'left';
        raceContext.fillStyle = color;
        raceContext.strokeStyle = '#061018';
        raceContext.lineWidth = 3;
        raceContext.font = '900 11px Arial';
        const nameWidth = raceContext.measureText(displayName).width;
        raceContext.font = '900 9px Arial';
        const levelWidth = raceContext.measureText(levelText).width;
        const labelX = MONKEY_X + MONKEY_SIZE / 2 - (nameWidth + levelWidth) / 2;
        raceContext.font = '900 11px Arial';
        raceContext.strokeText(displayName, labelX, y - 16);
        raceContext.fillText(displayName, labelX, y - 16);
        if (ranked?.icon) {
            const rankImage = imageForSkin(rankIconSource(ranked));
            if (rankImage.complete && rankImage.naturalWidth) raceContext.drawImage(rankImage, labelX - 14, y - 27, 12, 12);
        }
        raceContext.font = '900 9px Arial';
        raceContext.fillStyle = '#ffe56c';
        raceContext.strokeText(levelText, labelX + nameWidth, y - 16);
        raceContext.fillText(levelText, labelX + nameWidth, y - 16);
        if (title && title !== 'None') {
            const titleStyle = local ? currentTitleStyle() : normalizedTitleStyle(player.titleStyle);
            const hue = (performance.now() / (titleStyle.rgbSpeed * 1000) * 360) % 360;
            let titleColor = title === 'Flappy Monkey Developer' ? '#59f4ff' : titleStyle.color;
            if (titleStyle.rgb || titleStyle.fx === 'neonpulse') titleColor = `hsl(${hue},100%,82%)`;
            if (titleStyle.fx === 'fire') titleColor = '#fff0a8';
            if (titleStyle.fx === 'sparkle') titleColor = '#fff8c9';
            raceContext.font = '900 9px Arial';
            raceContext.strokeStyle = '#061018';
            raceContext.lineWidth = 3;
            raceContext.textAlign = 'center';
            if (titleStyle.fx === 'glitch') {
                raceContext.globalAlpha = .72;
                raceContext.fillStyle = '#00efff';
                raceContext.fillText(title, MONKEY_X + MONKEY_SIZE / 2 - 1.2, y - 4);
                raceContext.fillStyle = '#ff43c8';
                raceContext.fillText(title, MONKEY_X + MONKEY_SIZE / 2 + 1.2, y - 4);
                raceContext.globalAlpha = 1;
                titleColor = '#ffffff';
            }
            raceContext.shadowColor = titleColor;
            raceContext.shadowBlur = titleStyle.glow || titleStyle.fx !== 'none' ? 5 : 0;
            raceContext.fillStyle = titleColor;
            raceContext.strokeText(title, MONKEY_X + MONKEY_SIZE / 2, y - 4);
            raceContext.fillText(title, MONKEY_X + MONKEY_SIZE / 2, y - 4);
            raceContext.shadowBlur = 0;
            if (titleStyle.fx === 'sparkle') {
                raceContext.fillStyle = '#fff59a';
                raceContext.fillText('✦', MONKEY_X + 4, y - 8);
                raceContext.fillText('✦', MONKEY_X + MONKEY_SIZE - 4, y);
            }
        }
        raceContext.restore();
    }

    function drawRaceBackground() {
        const themes = ['day','sunset','night','snow','candy','forest','jungle','enchanted','aurora','volcano','space','underwater'];
        const theme = themes[Math.floor(race.score / 50) % themes.length] || 'day';
        let sky;
        if (theme === 'day') sky = '#87CEEB';
        else {
            sky = raceContext.createLinearGradient(0, 0, 0, HEIGHT);
            const colors = {
                sunset: ['#ff7e5f','#feb47b'], night: ['#0a001f','#1a0044'], snow: ['#aebfd5','#e5edf6'],
                candy: ['#ff69b4','#ffffff'], forest: ['#1e3c2f','#2e5c3f'], jungle: ['#063d24','#2f8a45'],
                enchanted: ['#2a0a4a','#a8b0ff'], aurora: ['#0f0c29','#302b63'], volcano: ['#4b0000','#ff4500'],
                space: ['#0a001f','#1a0044'], underwater: ['#0a1f3d','#3a8ab5']
            };
            const pair = colors[theme] || colors.night;
            sky.addColorStop(0, pair[0]);
            sky.addColorStop(1, pair[1]);
        }
        raceContext.fillStyle = sky;
        raceContext.fillRect(0, 0, WIDTH, HEIGHT);

        let cloudColor = 'rgba(255,255,255,.7)';
        if (['night','space','aurora'].includes(theme)) cloudColor = 'rgba(180,180,255,.3)';
        if (theme === 'snow') cloudColor = 'rgba(240,240,255,.95)';
        if (theme === 'volcano') cloudColor = 'rgba(80,0,0,.5)';
        if (theme === 'underwater') cloudColor = 'rgba(160,232,255,.25)';
        raceContext.fillStyle = cloudColor;
        raceContext.beginPath(); raceContext.ellipse(80, 120, 45, 25, 0, 0, Math.PI * 2); raceContext.fill();
        raceContext.beginPath(); raceContext.ellipse(280, 90, 55, 30, 0, 0, Math.PI * 2); raceContext.fill();
        raceContext.beginPath(); raceContext.ellipse(180, 180, 40, 20, 0, 0, Math.PI * 2); raceContext.fill();
        raceContext.fillStyle = theme === 'snow' ? '#e0e8f0' : theme === 'volcano' ? '#4b0000' : theme === 'candy' ? '#ff1493' : theme === 'underwater' ? '#e2c8a0' : '#8B5A2B';
        raceContext.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
        raceContext.fillStyle = theme === 'snow' ? '#c0d0e0' : theme === 'volcano' ? '#8b0000' : theme === 'candy' ? '#ff69b4' : theme === 'underwater' ? '#d4b38a' : '#5C3A1F';
        raceContext.fillRect(0, GROUND_Y, WIDTH, 20);
    }

    function drawRace() {
        drawRaceBackground();
        for (const pipe of visiblePipes()) {
            drawStyledPipe(pipe);
        }

        for (const player of race.remotes.values()) drawRacePlayer(player, false);
        drawRacePlayer({ id: state.playerId, alive: race.alive }, true);
        drawRaceDeathExplosions();

        raceContext.textAlign = 'left';
        raceContext.shadowColor = '#000';
        raceContext.shadowBlur = 10;
        raceContext.fillStyle = '#fff';
        raceContext.font = 'bold 52px Arial';
        raceContext.fillText(String(race.score), 20, 60);
        raceContext.shadowBlur = 0;
        const heartSize = 26, heartGap = 6;
        const maximumLives = Number(race.settings?.lives) === 3 ? 3 : 1;
        const startX = WIDTH - (heartSize * maximumLives + heartGap * (maximumLives - 1)) - 15;
        raceContext.shadowColor = '#000';
        raceContext.shadowBlur = 6;
        for (let index = 0; index < maximumLives; index += 1) drawRaceHeart(startX + index * (heartSize + heartGap), 30, heartSize, index < race.lives);
        raceContext.shadowBlur = 0;

        const now = Date.now();
        if (!race.started) {
            const countdown = Math.max(0, Math.ceil((race.localStartAt - now) / 1000));
            raceContext.fillStyle = 'rgba(0,0,0,.52)';
            raceContext.fillRect(0, 0, WIDTH, HEIGHT);
            raceContext.textAlign = 'center';
            raceContext.fillStyle = '#ffe66f';
            raceContext.font = '1000 100px Arial';
            raceContext.fillText(countdown || 'GO!', WIDTH / 2, HEIGHT / 2 + 35);
        } else if (!race.alive) {
            raceContext.fillStyle = 'rgba(0,0,0,.42)';
            raceContext.fillRect(0, 0, WIDTH, HEIGHT);
            raceContext.textAlign = 'center';
            raceContext.fillStyle = '#ff9aa2';
            raceContext.font = '1000 28px Arial';
            const respawning = race.settings?.friendlyPractice;
            const seconds = Math.max(1, Math.ceil((race.respawnUntil - performance.now()) / 1000));
            raceContext.fillText(respawning ? `RESPAWNING IN ${seconds}` : 'ELIMINATED — SPECTATING', WIDTH / 2, HEIGHT / 2, WIDTH - 28);
        }
    }

    function drawRaceHeart(x, y, size, filled) {
        const pixel = Math.max(1, Math.floor(size / 10));
        raceContext.imageSmoothingEnabled = false;
        raceContext.fillStyle = '#000';
        raceContext.fillRect(x + 3 * pixel, y, pixel * 4, pixel);
        raceContext.fillRect(x + 2 * pixel, y + pixel, pixel * 6, pixel);
        raceContext.fillRect(x + pixel, y + 2 * pixel, pixel * 8, pixel);
        raceContext.fillRect(x, y + 3 * pixel, pixel * 10, pixel);
        raceContext.fillRect(x, y + 4 * pixel, pixel * 10, pixel * 3);
        raceContext.fillRect(x + pixel, y + 7 * pixel, pixel * 8, pixel);
        raceContext.fillRect(x + 2 * pixel, y + 8 * pixel, pixel * 6, pixel);
        raceContext.fillRect(x + 3 * pixel, y + 9 * pixel, pixel * 4, pixel);
        if (filled) {
            raceContext.fillStyle = '#FF5555';
            raceContext.fillRect(x + pixel, y + pixel, pixel * 8, pixel);
            raceContext.fillRect(x + pixel, y + 2 * pixel, pixel * 8, pixel);
            raceContext.fillRect(x + pixel, y + 3 * pixel, pixel * 8, pixel * 4);
            raceContext.fillRect(x + 2 * pixel, y + 7 * pixel, pixel * 6, pixel);
            raceContext.fillRect(x + 3 * pixel, y + 8 * pixel, pixel * 4, pixel);
            raceContext.fillStyle = '#fff';
            raceContext.fillRect(x + 2 * pixel, y + 2 * pixel, pixel * 2, pixel);
            raceContext.fillRect(x + 3 * pixel, y + 3 * pixel, pixel, pixel);
        }
        raceContext.imageSmoothingEnabled = true;
    }

    function updateRaceHud() {
        const settings = race.settings || {};
        elements.mpRaceObjective.textContent = settings.friendlyPractice
            ? `Friendly Practice · You: ${race.score} · ${race.lives} ♥`
            : settings.victory === 'last_alive'
            ? 'Last Monkey Alive'
            : settings.victory === 'target_score'
                ? `First to ${settings.targetScore} · You: ${race.score}`
                : `Highest Score · You: ${race.score}`;
        if (settings.victory === 'timed_score' || settings.friendlyPractice) {
            const elapsed = Math.max(0, (Date.now() - race.localStartAt) / 1000);
            const remaining = Math.max(0, settings.durationSeconds - elapsed);
            const minutes = Math.floor(remaining / 60);
            const seconds = Math.floor(remaining % 60).toString().padStart(2, '0');
            elements.mpRaceTimer.textContent = `${minutes}:${seconds}`;
        } else elements.mpRaceTimer.textContent = '';

        const players = [
            { id: state.playerId, name: state.account?.username || 'You', level: state.account?.level || 1, equippedTitle: currentTitle(), score: race.score, alive: race.alive, lives: race.lives, local: true },
            ...race.remotes.values()
        ].sort((a, b) => b.score - a.score || Number(b.alive) - Number(a.alive) || String(a.name).localeCompare(String(b.name)));
        elements.mpRaceStandings.innerHTML = '<h3>Live Standings · Independent Courses</h3>' + players.map((player, index) => `
            <div class="mp-standing ${player.local ? 'you' : ''} ${player.alive === false ? 'out' : ''}">
                <span class="mp-standing-place">#${index + 1}</span><span class="mp-standing-player"><span class="mp-standing-name">${player.ranked ? `<img class="mp-inline-rank" src="${escapeHtml(rankIconSource(player.ranked))}" alt="">` : ''}${player.clan ? `<span class="mp-clan-tag" style="color:${escapeHtml(player.clan.tagColor)}">[${escapeHtml(player.clan.tag)}]</span> ` : ''}${escapeHtml(player.name)}${platformBadgeHtml(player.platform)}${player.local ? ' (You)' : ''} · Lv.${Math.max(1, Number(player.level) || 1)}</span>${sharedTitleHtml(player.local ? localTitleProfile() : player, 'mp-standing-title')}</span><span class="mp-standing-score">${Number(player.score || 0)} ${'♥'.repeat(Math.max(0, Number(player.lives) || 0))}${player.alive === false ? ' ✕' : ''}</span>
            </div>
        `).join('');
    }

    function raceLoop(now) {
        if (!race.active) { race.animationFrame = null; return; }
        if (document.hidden || window.flappyAppSuspended) {
            race.lastTick = now;
            race.accumulator = 0;
            race.animationFrame = requestAnimationFrame(raceLoop);
            return;
        }
        if (!race.started && Date.now() >= race.localStartAt) {
            race.started = true;
            race.lastTick = now;
            race.accumulator = 0;
            sendRaceState(true);
        }
        const elapsed = Math.min(250, Math.max(0, now - race.lastTick));
        race.lastTick = now;
        if (race.started) {
            if (!LOCAL_MOBILE_DEVICE) {
                // Match the original high-refresh desktop race behavior.
                updateRaceStep();
                race.accumulator = 0;
            } else {
                race.accumulator += elapsed;
                let updateCount = 0;
                while (race.accumulator >= STEP && updateCount < 15) {
                    updateRaceStep();
                    race.accumulator -= STEP;
                    updateCount += 1;
                }
                if (updateCount === 15) race.accumulator %= STEP;
            }
            sendRaceState(false);
        }
        drawRace();
        updateRaceHud();
        race.animationFrame = requestAnimationFrame(raceLoop);
    }

    function showResults(message) {
        stopRace();
        race.resultOpen = true;
        const winnerSet = new Set(message.winnerIds || []);
        const standings = message.standings || [];
        const localEntry = standings.find((entry) => entry.profileId === state.account?.id);
        const localWon = winnerSet.has(localEntry?.id || state.playerId);
        const winner = standings.find((entry) => winnerSet.has(entry.id));
        const rankedChanges = Array.isArray(message.rankedChanges) ? message.rankedChanges : [];
        const localRankedChange = rankedChanges.find((change) => change.accountId === state.account?.id);
        elements.mpResultTitle.textContent = localWon
            ? 'YOU WON!'
            : winnerSet.size > 1
                ? 'TIE GAME!'
                : winner
                    ? `${winner.name} WON!`
                    : 'RACE COMPLETE';
        elements.mpResultRows.innerHTML = standings.map((entry) => `
            <div class="mp-result-row ${winnerSet.has(entry.id) ? 'winner' : ''}">
                <div class="mp-result-place">#${entry.place}</div>
                <div><strong>${entry.ranked ? `<img class="mp-inline-rank" src="${escapeHtml(rankIconSource(entry.ranked))}" alt="">` : ''}${entry.clan ? `<span class="mp-clan-tag" style="color:${escapeHtml(entry.clan.tagColor)}">[${escapeHtml(entry.clan.tag)}]</span> ` : ''}${escapeHtml(entry.name)}${platformBadgeHtml(entry.platform)}${entry.profileId === state.account?.id ? ' (You)' : ''} · Lv.${Math.max(1, Number(entry.level) || 1)}</strong>${sharedTitleHtml(entry.profileId === state.account?.id ? localTitleProfile() : entry)}${winnerSet.has(entry.id) ? '<div style="color:#ffe479;font-size:10px">WINNER</div>' : ''}</div>
                <strong>${entry.score} pts${message.ranked ? `<small class="mp-rp-change ${(rankedChanges.find((change) => change.accountId === entry.profileId)?.delta || 0) >= 0 ? 'gain' : 'loss'}">${(rankedChanges.find((change) => change.accountId === entry.profileId)?.delta || 0) >= 0 ? '+' : ''}${rankedChanges.find((change) => change.accountId === entry.profileId)?.delta || 0} RP</small>` : ''}</strong>
            </div>
        `).join('');
        elements.mpReturnLobbyBtn.textContent = message.ranked ? 'Return to Ranked Menu' : 'Return to Room';
        if (localRankedChange) showToast(`${localRankedChange.delta >= 0 ? '+' : ''}${localRankedChange.delta} RP · ${localRankedChange.after}${localRankedChange.awardedMonkeyKingSkin ? ' · Monkey King skin unlocked!' : ''}`);
        elements.mpResult.classList.add('open');
        elements.mpResult.setAttribute('aria-hidden', 'false');
    }

    function closeResult() {
        race.resultOpen = false;
        elements.mpResult.classList.remove('open');
        elements.mpResult.setAttribute('aria-hidden', 'true');
    }

    function ensureRedeemCodesPanel(grid) {
        let panel = document.getElementById('redeemCodesSettingsPanel');
        if (!panel) {
            panel = document.createElement('section');
            panel.id = 'redeemCodesSettingsPanel';
            panel.className = 'settings-upgrade-panel redeem-code-settings';
            grid.appendChild(panel);
        }
        updateRedeemCodesPanel();
    }

    const OFFLINE_REDEEM_CODES = Object.freeze({
        'FLAPPY MONKEY': [
            { type:'skin', itemId:'Jungle Monkey.png', label:'Jungle Monkey' },
            { type:'banana_coins', amount:125 },
            { type:'powerup', itemId:'extraLifeTokens', amount:1 },
            { type:'powerup', itemId:'scoreBoosterTickets', amount:1 }
        ],
        BANANAS1:[{ type:'banana_coins', amount:200 }],
        HOLIDAYCRATE1:[{ type:'crate_ticket', itemId:'holiday', amount:1 }],
        SUMMERCRATE1:[{ type:'crate_ticket', itemId:'summer', amount:1 }],
        SPORTCRATE1:[{ type:'crate_ticket', itemId:'sport', amount:1 }],
        'CRYSTALS&GEMSCRATE1':[{ type:'crate_ticket', itemId:'crystal', amount:1 }],
        EXTRALIFETICKET1:[{ type:'powerup', itemId:'extraLifeTokens', amount:1 }],
        BANANADOUBLERTICKET1:[{ type:'powerup', itemId:'coinDoublerTickets', amount:1 }],
        SCOREBOOSTERTICKET1:[{ type:'powerup', itemId:'scoreBoosterTickets', amount:1 }],
        '2XMONKEYXPTOKEN1':[{ type:'powerup', itemId:'xpBoostTokens', amount:1 }],
        CRATELUCKBOOST1:[{ type:'powerup', itemId:'crateLuckBoostTokens', amount:1 }],
        REVIVETOKEN1:[{ type:'powerup', itemId:'reviveTokens', amount:1 }],
        MONKEYXP1:[{ type:'xp', amount:250 }],
        POWERUPS1:[
            { type:'powerup', itemId:'extraLifeTokens', amount:1 },
            { type:'powerup', itemId:'coinDoublerTickets', amount:1 },
            { type:'powerup', itemId:'scoreBoosterTickets', amount:1 }
        ]
    });

    function levelForTotalXp(value) {
        let level = 1;
        let spent = 0;
        const xp = Math.max(0, Math.floor(Number(value) || 0));
        while (xp >= spent + 100 * level) {
            spent += 100 * level;
            level += 1;
        }
        return level;
    }

    function reconcileLevelRewardsAfterXpRemoval(value) {
        if (typeof monkeySkins === 'undefined' || typeof titles === 'undefined') return;
        const currentLevel = levelForTotalXp(value);
        const entitledSkins = new Set(state.account?.entitlements?.skins || []);
        const entitledTitles = new Set(state.account?.entitlements?.titles || []);
        let equippedWasRemoved = false;
        monkeySkins.filter((skin) => Number(skin.unlockLevel) > currentLevel).forEach((skin) => {
            const separatelyGranted = entitledSkins.has(skin.file) || entitledSkins.has(skin.name);
            if (separatelyGranted) return;
            skin.unlocked = false;
            if ((typeof selectedSkin !== 'undefined' && selectedSkin === skin.file) || localStorage.getItem('selectedMonkeySkin') === skin.file) {
                equippedWasRemoved = true;
            }
        });
        const levelLinkedTitles = new Set(monkeySkins.filter((skin) => skin.unlockLevel && skin.linkedTitle).map((skin) => skin.linkedTitle));
        for (const title of titles) {
            if (!levelLinkedTitles.has(title.name) || entitledTitles.has(title.name)) continue;
            title.unlocked = monkeySkins.some((skin) => skin.unlocked && skin.linkedTitle === title.name);
        }
        if (equippedWasRemoved) {
            if (typeof selectedSkin !== 'undefined') selectedSkin = 'Default Monkey.png';
            localStorage.setItem('selectedMonkeySkin', 'Default Monkey.png');
            if (typeof updateLobbyMonkeyPreview === 'function') updateLobbyMonkeyPreview();
        }
        if (typeof selectedTitle !== 'undefined') {
            const equippedTitle = titles.find((entry) => entry.name === selectedTitle);
            if (equippedTitle && !equippedTitle.unlocked) {
                selectedTitle = 'None';
                localStorage.setItem('selectedTitle', 'None');
            }
        }
        if (typeof saveUnlockedSkins === 'function') saveUnlockedSkins();
        if (typeof saveUnlockedTitles === 'function') saveUnlockedTitles();
        if (typeof refreshSkinMenu === 'function') refreshSkinMenu();
        if (typeof refreshTitlesMenu === 'function') refreshTitlesMenu();
        if (typeof refreshInventoryMenu === 'function') refreshInventoryMenu();
        window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ source:'xp-removal', currentLevel } }));
    }

    function applyLocalCosmeticOwnership(reward, owned) {
        const type = String(reward?.type || reward?.giftType || '');
        const itemId = String(reward?.itemId || '');
        let item = null;
        if (type === 'explosion_vfx' && typeof explosionVfxOptions !== 'undefined') {
            item = explosionVfxOptions.find((entry) => entry.id === itemId);
            if (!item || item.id === 'none') return false;
            item.unlocked = owned;
            if (!owned && typeof selectedExplosionVfx !== 'undefined' && selectedExplosionVfx === item.id) {
                selectedExplosionVfx = 'none';
                localStorage.setItem('selectedExplosionVfx', 'none');
            }
            if (typeof saveUnlockedExplosionVfx === 'function') saveUnlockedExplosionVfx();
        } else if (type === 'profile_background' && typeof profileBackgrounds !== 'undefined') {
            item = profileBackgrounds.find((entry) => entry.id === itemId);
            if (!item || item.id === 'none') return false;
            item.unlocked = owned;
            if (!owned && typeof selectedProfileBg !== 'undefined' && selectedProfileBg === item.id) {
                selectedProfileBg = 'none';
                localStorage.setItem('selectedProfileBg', 'none');
                if (typeof applyProfileTheme === 'function') applyProfileTheme();
            }
            if (typeof saveUnlockedProfileBgs === 'function') saveUnlockedProfileBgs();
        } else if (type === 'pipe_skin' && typeof pipeThemes !== 'undefined') {
            item = pipeThemes.find((entry) => entry.id === itemId);
            if (!item || item.id === 'classic') return false;
            item.unlocked = owned;
            if (!owned && typeof selectedPipeTheme !== 'undefined' && selectedPipeTheme === item.id) {
                selectedPipeTheme = 'classic';
                localStorage.setItem('selectedPipeTheme', 'classic');
            }
            if (typeof saveUnlockedPipeThemes === 'function') saveUnlockedPipeThemes();
        } else if (type === 'trail' && typeof trails !== 'undefined') {
            item = trails.find((entry) => entry.id === itemId);
            if (!item || item.id === 'none') return false;
            item.unlocked = owned;
            if (!owned && typeof selectedTrail !== 'undefined' && selectedTrail === item.id) {
                selectedTrail = 'none';
                localStorage.setItem('selectedTrail', 'none');
            }
            if (typeof saveUnlockedTrails === 'function') saveUnlockedTrails();
        } else if (type === 'title_fx' && typeof titleFXOptions !== 'undefined') {
            item = titleFXOptions.find((entry) => entry.id === itemId);
            if (!item || item.id === 'none') return false;
            item.unlocked = owned;
            if (!owned && typeof selectedTitleFX !== 'undefined' && selectedTitleFX === item.id) {
                selectedTitleFX = 'none';
                localStorage.setItem('selectedTitleFX', 'none');
            }
            if (typeof saveUnlockedTitleFX === 'function') saveUnlockedTitleFX();
        } else if (type === 'custom_emoji' && typeof ownedCustomEmojiIds !== 'undefined') {
            if (!(window.flappyCustomEmojis || []).some((entry) => entry.id === itemId)) return false;
            if (owned) ownedCustomEmojiIds.add(itemId);
            else ownedCustomEmojiIds.delete(itemId);
            if (typeof saveOwnedCustomEmojis === 'function') saveOwnedCustomEmojis();
            window.dispatchEvent(new CustomEvent('flappy-emojis-changed'));
        } else {
            return false;
        }
        if (typeof refreshShopGrid === 'function') refreshShopGrid();
        if (typeof refreshInventoryMenu === 'function') refreshInventoryMenu();
        window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:type, itemId, owned } }));
        return true;
    }

    function applyLocalReward(reward, operation = 'grant') {
        const direction = operation === 'remove' ? -1 : 1;
        const amount = Math.max(1, Math.floor(Number(reward.amount) || 1));
        if (reward.type === 'banana_coins') {
            const value = Math.max(0, Number.parseInt(localStorage.getItem('monkeyCoins') ?? '200', 10) + direction * amount);
            localStorage.setItem('monkeyCoins', value);
            if (typeof monkeyCoins !== 'undefined') monkeyCoins = value;
            if (typeof refreshShopGrid === 'function') refreshShopGrid();
        } else if (reward.type === 'xp') {
            const value = Math.max(0, Number.parseInt(localStorage.getItem('monkeyXP') || '0', 10) + direction * amount);
            localStorage.setItem('monkeyXP', value);
            if (typeof totalXP !== 'undefined') totalXP = value;
            if (direction < 0) reconcileLevelRewardsAfterXpRemoval(value);
            if (typeof updateXPBar === 'function') updateXPBar();
        } else if (reward.type === 'powerup') {
            const value = Math.max(0, Number.parseInt(localStorage.getItem(reward.itemId) || '0', 10) + direction * amount);
            const boostId = ({ extraLifeTokens:'extraLifeToken', coinDoublerTickets:'coinDoubler', scoreBoosterTickets:'scoreBooster', xpBoostTokens:'xpBoost', crateLuckBoostTokens:'crateLuck', reviveTokens:'revive' })[reward.itemId];
            if (boostId && typeof setBoostTicketCount === 'function') setBoostTicketCount(boostId, value);
            else localStorage.setItem(reward.itemId, value);
        } else if (reward.type === 'crate_ticket') {
            const key = `flappyFreeCrateTickets:${reward.itemId}`;
            localStorage.setItem(key, Math.max(0, Number.parseInt(localStorage.getItem(key) || '0', 10) + direction * amount));
            if (typeof refreshCratesGrid === 'function') refreshCratesGrid();
        } else if (['explosion_vfx','profile_background','pipe_skin','trail','title_fx','custom_emoji'].includes(reward.type)) {
            applyLocalCosmeticOwnership(reward, direction > 0);
        } else if (reward.type === 'skin' && typeof monkeySkins !== 'undefined') {
            const skin = monkeySkins.find((entry) => entry.file === reward.itemId || entry.name === reward.itemId || entry.name === reward.label);
            if (skin) {
                skin.unlocked = direction > 0;
                if (typeof saveUnlockedSkins === 'function') saveUnlockedSkins();
                if (typeof refreshSkinMenu === 'function') refreshSkinMenu();
                if (typeof refreshInventoryMenu === 'function') refreshInventoryMenu();
                window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'skins' } }));
            }
        } else if (reward.type === 'title' && typeof titles !== 'undefined') {
            const title = titles.find((entry) => entry.name === reward.itemId || entry.name === reward.label);
            if (title) {
                title.unlocked = direction > 0;
                if (typeof saveUnlockedTitles === 'function') saveUnlockedTitles();
                if (typeof refreshTitlesMenu === 'function') refreshTitlesMenu();
                window.dispatchEvent(new CustomEvent('flappy-collection-changed', { detail:{ category:'titles' } }));
            }
        }
    }

    function redeemCodeOffline(code) {
        const normalized = String(code || '').trim().toUpperCase().replace(/\s+/g, ' ');
        const rewards = OFFLINE_REDEEM_CODES[normalized];
        if (!rewards) return { ok:false, message:'That code is not in this game build. Connect online to check server-added codes.' };
        let redeemed = [];
        try { redeemed = JSON.parse(localStorage.getItem('redeemedRewardCodes') || '[]'); } catch (_) {}
        if (!Array.isArray(redeemed)) redeemed = [];
        if (redeemed.includes(normalized)) return { ok:false, message:'That code has already been redeemed on this profile.' };
        rewards.forEach((reward) => applyLocalReward(reward));
        redeemed.push(normalized);
        localStorage.setItem('redeemedRewardCodes', JSON.stringify(redeemed));
        window.dispatchEvent(new CustomEvent('flappy-redeem-code-applied', { detail:{ code:normalized, offline:true } }));
        return { ok:true, message:`${normalized} redeemed offline. Rewards were added to this local profile.` };
    }

    let redeemSettingsRenderSignature = '';
    let onlineAccountSettingsRenderSignature = '';

    function updateRedeemCodesPanel() {
        const panel = document.getElementById('redeemCodesSettingsPanel');
        if (!panel) return;
        const renderSignature = JSON.stringify([
            state.account?.id || '',
            Boolean(state.authenticated),
            state.redeemNotice || '',
            state.redeemNoticeKind || '',
            Boolean(state.pendingRedeem)
        ]);
        if (renderSignature === redeemSettingsRenderSignature && panel.childElementCount) return;
        redeemSettingsRenderSignature = renderSignature;
        if (!state.account) {
            panel.innerHTML = '<h3>Redeem Codes</h3><p class="redeem-code-help">Log in once to create a profile. After that, built-in codes can be redeemed while offline.</p>';
            return;
        }
        const offline = !state.authenticated;
        panel.innerHTML = `
            <h3>Redeem Codes</h3>
            <p class="redeem-code-help">${offline ? 'Offline mode: built-in codes in this game build can be redeemed once on this local profile. Server-added codes require a connection.' : 'Enter an active code. Each code can be redeemed once on this account.'}</p>
            <form id="redeemCodeForm" class="redeem-code-form">
                <input id="redeemCodeInput" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="ENTER CODE" aria-label="Redeem code">
                <button id="redeemCodeSubmit" type="submit" ${state.pendingRedeem ? 'disabled' : ''}>${state.pendingRedeem ? 'Checking...' : 'Redeem Code'}</button>
            </form>
            <div id="redeemCodeStatus" class="redeem-code-status ${escapeHtml(state.redeemNoticeKind)}" aria-live="polite">${escapeHtml(state.redeemNotice)}</div>`;
        const form = document.getElementById('redeemCodeForm');
        const input = document.getElementById('redeemCodeInput');
        const submit = document.getElementById('redeemCodeSubmit');
        input.addEventListener('input', () => {
            input.value = input.value
                .toUpperCase()
                .replace(/[^A-Z0-9 &-]/g, '')
                .replace(/ {2,}/g, ' ')
                .slice(0, 32);
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const code = input.value.trim();
            const status = document.getElementById('redeemCodeStatus');
            if (code.length < 3) {
                status.className = 'redeem-code-status error';
                status.textContent = 'Enter a complete reward code.';
                return;
            }
            if (offline) {
                const result = redeemCodeOffline(code);
                state.redeemNotice = result.message;
                state.redeemNoticeKind = result.ok ? 'success' : 'error';
                status.className = `redeem-code-status ${state.redeemNoticeKind}`;
                status.textContent = result.message;
                if (result.ok) input.value = '';
                return;
            }
            state.pendingRedeem = true;
            state.redeemNotice = 'Checking code...';
            state.redeemNoticeKind = '';
            status.className = 'redeem-code-status';
            status.textContent = state.redeemNotice;
            submit.disabled = true;
            submit.textContent = 'Checking...';
            if (!send({ type: 'redeem_code', code })) {
                state.pendingRedeem = false;
                submit.disabled = false;
                submit.textContent = 'Redeem Code';
            }
        });
        window.refreshFlappyInputFocusFix?.(panel);
    }

    function ensureOnlineSettingsPanel() {
        const popup = document.getElementById('settingsPopup');
        if (!popup) return;
        let grid = popup.querySelector('.settings-upgrade-grid');
        if (!grid) {
            const actions = popup.querySelector('.settings-actions');
            if (!actions) return;
            grid = document.createElement('div');
            grid.className = 'settings-upgrade-grid';
            actions.parentElement.insertBefore(grid, actions);
        }
        ensureRedeemCodesPanel(grid);
        let panel = document.getElementById('onlineAccountSettingsPanel');
        if (!panel) {
            panel = document.createElement('section');
            panel.id = 'onlineAccountSettingsPanel';
            panel.className = 'settings-upgrade-panel online-account-settings';
            grid.appendChild(panel);
        }
        updateOnlineSettingsPanel();
    }

    function resetOwnerGrantControls() {
        const scope = document.getElementById('ownerGrantScope');
        const target = document.getElementById('ownerTargetUserId');
        const action = document.getElementById('ownerGrantAction');
        const type = document.getElementById('ownerGrantType');
        const amount = document.getElementById('ownerGrantAmount');
        if (!scope || !target || !action || !type || !amount) return;
        const offlineOwner = Boolean(state.account?.isOwner && !state.authenticated);
        scope.value = 'one';
        action.value = 'grant';
        type.value = 'banana_coins';
        amount.value = '1';
        target.value = offlineOwner ? state.account.id : '';
        const resetTarget = document.getElementById('ownerResetProgressUserId');
        if (resetTarget) resetTarget.value = '';
        const message = document.getElementById('onlineOwnerMessage');
        if (message && !offlineOwner) message.textContent = '';
        // setupOwnerPanel owns the dependent catalog and disabled states.
        type.dispatchEvent(new Event('change', { bubbles:true }));
    }

    function updateOnlineSettingsPanel() {
        updateRedeemCodesPanel();
        const panel = document.getElementById('onlineAccountSettingsPanel');
        if (!panel) return;
        const renderSignature = JSON.stringify([
            state.account?.id || '',
            state.account?.username || '',
            state.account?.email || '',
            Boolean(state.account?.isOwner),
            Boolean(state.authenticated),
            (state.account?.badges || []).map((badge) => `${badge.id}:${badge.name}`).sort().join('|')
        ]);
        if (renderSignature === onlineAccountSettingsRenderSignature && panel.childElementCount) return;
        onlineAccountSettingsRenderSignature = renderSignature;
        if (!state.account) {
            panel.innerHTML = '<h3>Online Account</h3><p style="color:#b8cdbd;font-size:11px">Open Online Race to create an account or log in. Your permanent User ID will appear here.</p>';
            return;
        }
        panel.innerHTML = `
            <h3>Online Account</h3>
            <div style="color:#fff0a0;font-weight:900;margin-bottom:7px">${escapeHtml(state.account.username)}${state.account.isOwner ? ' · GAME OWNER' : ''}</div>
            <div style="color:#b9d0bf;font-size:10px;font-weight:800;margin-bottom:8px">VERIFIED EMAIL: ${escapeHtml(state.account.email || 'Verified')}</div>
            <label style="display:block;color:#b9d0bf;font-size:10px;font-weight:900;margin-bottom:5px">USER ID</label>
            <div class="online-id-row"><input id="onlineUserId" type="text" readonly value="${escapeHtml(state.account.id)}"><button id="copyOnlineUserId" type="button">Copy User ID</button></div>
            <p style="margin:7px 0 0;color:#94aa9b;font-size:10px">This permanent ID is unique to your server account. Share it only when you want the owner to grant you something.</p>
            <button id="logoutOnlineAccount" type="button" style="width:100%;margin-top:9px;background:#712f38;border-color:#a84e55">Log Out of Online Account</button>
            <button id="deleteOnlineAccount" type="button" style="width:100%;margin-top:7px;color:#ffd9dc;background:#4e151d;border-color:#ff707a">Delete Account Permanently</button>
            ${state.account.isOwner ? ownerPanelHtml() : ''}
        `;
        document.getElementById('copyOnlineUserId')?.addEventListener('click', (event) => copyText(state.account.id, event.currentTarget));
        document.getElementById('logoutOnlineAccount')?.addEventListener('click', logoutAccount);
        document.getElementById('deleteOnlineAccount')?.addEventListener('click', () => openDangerModal('delete'));
        if (state.account.isOwner) setupOwnerPanel();
        window.refreshFlappyInputFocusFix?.(panel);
    }

    function ownerPanelHtml() {
        return `
            <div class="mp-owner-panel">
                <h3 style="margin-bottom:8px">Owner Account Items</h3>
                <p style="margin:0 0 8px;color:#b9d0bf;font-size:10px;line-height:1.4">Grant items or remove them from an account. Coin, XP, and power-up removals stop at zero.</p>
                <div class="mp-owner-grid">
                    <select id="ownerGrantScope" title="Recipients"><option value="one">One User</option><option value="all">Every Account</option></select>
                    <input id="ownerTargetUserId" type="text" placeholder="Paste target User ID" spellcheck="false">
                    <select id="ownerGrantAction" title="Action"><option value="grant">Grant</option><option value="remove">Remove</option></select>
                    <select id="ownerGrantType"><option value="banana_coins">Banana Coins</option><option value="xp">Monkey XP</option><option value="powerup">Power-Up</option><option value="crate_ticket">Free Crate Ticket</option><option value="skin">Monkey Skin</option><option value="title">Player Title</option><option value="profile_background">Menu Background Theme</option><option value="pipe_skin">Pipe Skin</option><option value="trail">Monkey Trail</option><option value="title_fx">Title Style</option><option value="explosion_vfx">Death / Explosion VFX</option><option value="custom_emoji">Custom Emoji</option><option value="badge">Player Badge</option></select>
                    <select id="ownerGrantItem"></select>
                    <input id="ownerGrantAmount" type="number" min="1" max="100000" value="1" title="Amount">
                </div>
                <button id="sendOwnerGrant" type="button" style="width:100%;margin-top:8px">Grant Item to User ID</button>
                <button id="ownerGrantEveryItem" class="mp-owner-grant-everything" type="button" style="width:100%;margin-top:7px">Grant Every Item to User ID</button>
                <button id="ownerOpenRanked" type="button" style="width:100%;margin-top:7px">Manage Ranked Season 1</button>
                <section class="mp-owner-reset-tools">
                    <header class="mp-owner-reset-header">
                        <span class="mp-owner-reset-icon" aria-hidden="true">↻</span>
                        <div>
                            <h3>Progress Reset</h3>
                            <p>Wipe game progress while keeping account identity, login, friends, messages, and settings.</p>
                        </div>
                    </header>
                    <div class="mp-owner-reset-single">
                        <label for="ownerResetProgressUserId">Reset one account</label>
                        <span>Enter the exact permanent User ID.</span>
                        <div class="mp-owner-reset-row">
                            <input id="ownerResetProgressUserId" type="text" placeholder="FMU_... User ID" spellcheck="false">
                            <button id="ownerResetOneProgress" class="mp-danger" type="button">Reset User Progress</button>
                        </div>
                    </div>
                    <div class="mp-owner-reset-all-zone">
                        <div class="mp-owner-reset-all-copy">
                            <strong><span aria-hidden="true">⚠</span> All-account danger zone</strong>
                            <span>Resets every player—including the owner. A typed confirmation is required.</span>
                        </div>
                        <button id="ownerResetAllProgress" class="mp-danger mp-owner-reset-all" type="button">Reset Every Account's Progress</button>
                    </div>
                </section>
                <div class="mp-owner-live-events"><select id="ownerLiveEventSelect"><option value="banana_storm">🍌 Banana Storm · 20m</option><option value="xp_frenzy">⚡ XP Frenzy · 20m</option><option value="score_rush">🚀 Score Rush · 15m</option><option value="crate_carnival">🎁 Crate Carnival · 20m</option><option value="powerup_party">✨ Power-Up Party · 15m</option><option value="gem_rush">💎 Gem Rush · 10m</option><option value="summer_splash">🏖️ Summer Splash · 10m</option><option value="holiday_magic">🎄 Holiday Magic · 10m</option><option value="sports_mania">🏆 Sports Mania · 10m</option><option value="health_8x">❤️ 8× Health · 20m</option><option value="birthday_bash">🎂 Birthday Bash · 24h</option></select><button id="ownerStartLiveEvent" class="mp-primary" type="button">Start / Restart Selected</button><button id="ownerStopLiveEvent" class="mp-danger" type="button">Stop Selected</button><button id="ownerStopAllLiveEvents" class="mp-danger" type="button">Stop All Events</button></div>
                <div class="mp-owner-announcement"><textarea id="ownerAnnouncementText" maxlength="260" placeholder="Global announcement shown over every menu and game mode..."></textarea><button id="sendOwnerAnnouncement" class="mp-primary" type="button">Send to Everyone</button></div>
                <div id="onlineOwnerMessage" class="mp-owner-message"></div>
            </div>`;
    }

    function setupOwnerPanel() {
        const offlineOwner = Boolean(state.account?.isOwner && !state.authenticated);
        const scope = document.getElementById('ownerGrantScope');
        const targetInput = document.getElementById('ownerTargetUserId');
        const action = document.getElementById('ownerGrantAction');
        const type = document.getElementById('ownerGrantType');
        const item = document.getElementById('ownerGrantItem');
        const amount = document.getElementById('ownerGrantAmount');
        const submit = document.getElementById('sendOwnerGrant');
        const grantEverything = document.getElementById('ownerGrantEveryItem');
        if (offlineOwner) {
            scope.value = 'one';
            scope.disabled = true;
            targetInput.value = state.account.id;
            targetInput.disabled = true;
            ['ownerOpenRanked','ownerGrantEveryItem','ownerResetOneProgress','ownerResetAllProgress','ownerStartLiveEvent','ownerStopLiveEvent','ownerStopAllLiveEvents','sendOwnerAnnouncement'].forEach((id) => {
                const button = document.getElementById(id);
                if (button) { button.disabled = true; button.title = 'This owner action changes server or other-player data and requires an online connection.'; }
            });
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (ownerMessage) ownerMessage.textContent = 'Offline Owner Tools: you can grant or remove local items for your own cached owner profile. Global events, announcements, ranks, resets, and other accounts stay server-protected.';
        }
        document.getElementById('ownerOpenRanked')?.addEventListener('click', openRankedModal);
        document.getElementById('ownerResetOneProgress')?.addEventListener('click', async () => {
            const targetId = document.getElementById('ownerResetProgressUserId')?.value.trim().toUpperCase();
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (!targetId) { if (ownerMessage) ownerMessage.textContent = 'Paste the account User ID to reset.'; return; }
            const required = 'RESET';
            const confirmation = await gamePrompt(
                `This removes every item, level, rank, redeemed code, receipt, score, achievement, and mode progression from:\n${targetId}`,
                '',
                { title:'Reset User Progress', inputLabel:'Type RESET', requiredText:required, warning:'This cannot be undone. Double-check the User ID before continuing.', confirmLabel:'Reset Progress', danger:true, backdropCancel:false }
            );
            if (confirmation?.trim().toUpperCase() !== required) {
                if (confirmation !== null && ownerMessage) ownerMessage.textContent = 'Reset cancelled because the confirmation text did not match.';
                return;
            }
            state.pendingOwnerAction = true;
            state.pendingOwnerReset = { targetId, resetAll:false };
            if (ownerMessage) ownerMessage.textContent = 'Resetting that account…';
            send({ type: 'owner_reset_account_progress', userId: targetId, confirmation });
        });
        document.getElementById('ownerResetAllProgress')?.addEventListener('click', async () => {
            const required = 'RESET ALL';
            const confirmation = await gamePrompt(
                'This wipes game progress for EVERY account, including yours. Account identity, login, friends, messages, and settings remain.',
                '',
                { title:'Reset Every Account?', inputLabel:'Type RESET ALL', requiredText:required, warning:'IRREVERSIBLE: Every player will lose all items, levels, ranks, redeemed-code history, scores, and mode progression.', confirmLabel:'Reset Everyone', danger:true, backdropCancel:false }
            );
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (confirmation?.trim().toUpperCase() !== required) {
                if (confirmation !== null && ownerMessage) ownerMessage.textContent = 'Game-wide reset cancelled because the confirmation text did not match.';
                return;
            }
            state.pendingOwnerAction = true;
            state.pendingOwnerReset = { targetId:'', resetAll:true };
            if (ownerMessage) ownerMessage.textContent = 'Resetting every account…';
            send({ type: 'owner_reset_all_account_progress', confirmation });
        });
        document.getElementById('ownerStartLiveEvent')?.addEventListener('click', async () => {
            const eventId = document.getElementById('ownerLiveEventSelect')?.value;
            if (await gameConfirm('Start this event alongside any other active events? Restarting an already-active event refreshes its timer.', { title:'Start Live Event?', confirmLabel:'Start Event' })) send({ type: 'start_live_event', eventId });
        });
        document.getElementById('ownerStopLiveEvent')?.addEventListener('click', async () => {
            const eventId = document.getElementById('ownerLiveEventSelect')?.value;
            if (await gameConfirm('Stop only the selected live event? Other active events will keep running.', { title:'Stop Selected Event?', confirmLabel:'Stop Event', danger:true })) send({ type: 'stop_live_event', eventId });
        });
        document.getElementById('ownerStopAllLiveEvents')?.addEventListener('click', async () => {
            if (await gameConfirm('Stop every active live event now?', { title:'Stop All Live Events?', confirmLabel:'Stop All', danger:true })) send({ type: 'stop_live_event', stopAll:true });
        });
        const refresh = () => {
            const selected = type.value;
            item.innerHTML = '';
            amount.max = selected === 'xp' ? '1000000000' : '100000';
            if (selected === 'powerup') {
                item.innerHTML = '<option value="extraLifeTokens">Extra Life Token</option><option value="coinDoublerTickets">Banana Doubler</option><option value="scoreBoosterTickets">Score Booster</option><option value="xpBoostTokens">2× Monkey XP Token</option><option value="crateLuckBoostTokens">Crate Luck Boost</option><option value="reviveTokens">Revive Token</option>';
            } else if (selected === 'explosion_vfx' && typeof explosionVfxOptions !== 'undefined') {
                item.innerHTML = explosionVfxOptions.filter(effect => effect.id !== 'none').map(effect => `<option value="${escapeHtml(effect.id)}" data-label="${escapeHtml(effect.name)}">${escapeHtml(effect.name)}</option>`).join('');
            } else if (selected === 'crate_ticket') {
                item.innerHTML = '<option value="holiday">Holiday Monkey Skin Crate</option><option value="summer">Summer Monkey Skin Crate</option><option value="sport">Sport Monkey Skin Crate</option><option value="crystal">Crystals & Gems Monkey Skin Crate</option>';
            } else if (selected === 'profile_background' && typeof profileBackgrounds !== 'undefined') {
                item.innerHTML = profileBackgrounds.filter(entry => entry.id !== 'none').map(entry => `<option value="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</option>`).join('');
            } else if (selected === 'pipe_skin' && typeof pipeThemes !== 'undefined') {
                item.innerHTML = pipeThemes.filter(entry => entry.id !== 'classic').map(entry => `<option value="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</option>`).join('');
            } else if (selected === 'trail' && typeof trails !== 'undefined') {
                item.innerHTML = trails.filter(entry => entry.id !== 'none').map(entry => `<option value="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</option>`).join('');
            } else if (selected === 'title_fx' && typeof titleFXOptions !== 'undefined') {
                item.innerHTML = titleFXOptions.filter(entry => entry.id !== 'none').map(entry => `<option value="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</option>`).join('');
            } else if (selected === 'custom_emoji') {
                item.innerHTML = (window.flappyCustomEmojis || []).map(entry => `<option value="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</option>`).join('');
            } else if (selected === 'skin' && typeof monkeySkins !== 'undefined') {
                item.innerHTML = monkeySkins
                    .filter((skin) => action.value !== 'remove' || skin.file !== 'Default Monkey.png')
                    .map((skin) => `<option value="${escapeHtml(skin.file)}" data-label="${escapeHtml(skin.name)}">${escapeHtml(skin.name)}</option>`).join('');
            } else if (selected === 'title' && typeof titles !== 'undefined') {
                item.innerHTML = titles.filter((title) => title.name !== 'None').map((title) => `<option value="${escapeHtml(title.name)}" data-label="${escapeHtml(title.name)}">${escapeHtml(title.name)}</option>`).join('');
            } else if (selected === 'badge') {
                item.innerHTML = (state.account?.badges || []).map((badge) => `<option value="${escapeHtml(badge.id)}">${escapeHtml(badge.name)}</option>`).join('');
            } else {
                item.innerHTML = `<option value="">${selected === 'xp' ? 'Monkey XP' : 'Banana Coins'}</option>`;
            }
            item.disabled = selected === 'banana_coins' || selected === 'xp';
            amount.style.display = ['skin','title','badge','explosion_vfx','profile_background','pipe_skin','trail','title_fx','custom_emoji'].includes(selected) ? 'none' : '';
            const global = !offlineOwner && scope.value === 'all';
            targetInput.disabled = offlineOwner || global;
            targetInput.placeholder = global ? 'All existing accounts' : 'Paste target User ID';
            action.disabled = global;
            if (global) action.value = 'grant';
            submit.textContent = global ? 'Grant Item to Every Account' : `${action.value === 'remove' ? 'Remove Item from' : 'Grant Item to'} User ID`;
            submit.classList.toggle('mp-danger', action.value === 'remove');
        };
        scope.addEventListener('change', refresh);
        action.addEventListener('change', refresh);
        type.addEventListener('change', refresh);
        refresh();
        submit.addEventListener('click', async () => {
            const targetUserId = targetInput.value.trim();
            const global = scope.value === 'all';
            if (offlineOwner) {
                const selectedOption = item.options[item.selectedIndex];
                applyLocalReward({
                    type:type.value,
                    itemId:item.value,
                    category:selectedOption?.dataset.category || '',
                    label:selectedOption?.dataset.label || selectedOption?.textContent || '',
                    amount:Number(amount.value || 1)
                }, action.value);
                document.getElementById('onlineOwnerMessage').textContent = `Offline owner action complete: ${action.value === 'remove' ? 'removed' : 'granted'} ${selectedOption?.textContent || type.value} on your local profile.`;
                return;
            }
            if (!global && !targetUserId) { document.getElementById('onlineOwnerMessage').textContent = 'Paste a target User ID first.'; return; }
            if (global && !await gameConfirm('Grant this item to EVERY existing account? This cannot be undone in one click.', { title:'Grant to Everyone?', confirmLabel:'Grant Item', danger:true })) return;
            const selectedOption = item.options[item.selectedIndex];
            state.pendingOwnerAction = true;
            document.getElementById('onlineOwnerMessage').textContent = action.value === 'remove' ? 'Removing item…' : 'Sending item…';
            send({
                type: global ? 'grant_item_all' : action.value === 'remove' ? 'remove_item' : 'grant_item',
                targetUserId,
                reward: {
                    type: type.value,
                    itemId: item.value,
                    category: selectedOption?.dataset.category || '',
                    label: selectedOption?.dataset.label || selectedOption?.textContent || '',
                    amount: Number(amount.value || 1)
                }
            });
        });
        grantEverything?.addEventListener('click', async () => {
            const targetUserId = targetInput.value.trim().toUpperCase();
            const ownerMessage = document.getElementById('onlineOwnerMessage');
            if (!targetUserId) {
                ownerMessage.textContent = 'Paste the one target User ID first.';
                return;
            }
            const confirmation = await gamePrompt(
                `Grant every permanent skin, title, badge, Banana Market cosmetic, and custom emoji to:\n${targetUserId}`,
                '',
                {
                    title:'Grant the Complete Collection?',
                    inputLabel:'Type GRANT ALL',
                    requiredText:'GRANT ALL',
                    warning:'This grants permanent collection unlocks only. Consumable boosts and crate tickets remain separate owner grants.',
                    confirmLabel:'Grant Every Item',
                    danger:true,
                    backdropCancel:false
                }
            );
            if (confirmation?.trim().toUpperCase() !== 'GRANT ALL') {
                if (confirmation !== null) ownerMessage.textContent = 'Complete collection grant cancelled.';
                return;
            }

            const rewards = [];
            if (typeof trails !== 'undefined') trails.filter((entry) => entry.id !== 'none').forEach((entry) => rewards.push({ type:'trail', itemId:entry.id, label:entry.name }));
            if (typeof pipeThemes !== 'undefined') pipeThemes.filter((entry) => entry.id !== 'classic').forEach((entry) => rewards.push({ type:'pipe_skin', itemId:entry.id, label:entry.name }));
            if (typeof titleFXOptions !== 'undefined') titleFXOptions.filter((entry) => entry.id !== 'none').forEach((entry) => rewards.push({ type:'title_fx', itemId:entry.id, label:entry.name }));
            if (typeof profileBackgrounds !== 'undefined') profileBackgrounds.filter((entry) => entry.id !== 'none').forEach((entry) => rewards.push({ type:'profile_background', itemId:entry.id, label:entry.name }));
            if (typeof explosionVfxOptions !== 'undefined') explosionVfxOptions.filter((entry) => entry.id !== 'none').forEach((entry) => rewards.push({ type:'explosion_vfx', itemId:entry.id, label:entry.name }));
            (window.flappyCustomEmojis || []).forEach((entry) => rewards.push({ type:'custom_emoji', itemId:entry.id, label:entry.name }));
            state.pendingOwnerAction = true;
            ownerMessage.textContent = 'Granting the complete collection…';
            send({
                type:'owner_grant_every_item',
                targetUserId,
                skins:typeof monkeySkins !== 'undefined' ? monkeySkins.map((entry) => ({ file:entry.file, name:entry.name })) : [],
                titles:typeof titles !== 'undefined' ? titles.filter((entry) => entry.name !== 'None').map((entry) => entry.name) : [],
                badgeIds:(state.account?.badges || []).map((badge) => badge.id),
                rewards
            });
        });
        document.getElementById('sendOwnerAnnouncement')?.addEventListener('click', async () => {
            const input = document.getElementById('ownerAnnouncementText');
            const text = input.value.trim();
            if (!text) { document.getElementById('onlineOwnerMessage').textContent = 'Type an announcement first.'; return; }
            if (!await gameConfirm('Show this announcement to every connected player and save it in every player inbox?', { title:'Send Global Announcement?', confirmLabel:'Send to Everyone' })) return;
            state.pendingOwnerAction = true;
            document.getElementById('onlineOwnerMessage').textContent = 'Sending global announcement…';
            send({ type: 'global_announcement', text });
            input.value = '';
        });
    }

    const OFFLINE_DEFENSE_CATALOG = window.FlappyMonkeyDefenseCatalog || { towers: {}, order: [] };
    const ONLINE_DEFENSE_KILL_BANANA_MULTIPLIER = Number(OFFLINE_DEFENSE_CATALOG.economy?.killBananaMultiplier) || 1.2;
    const ONLINE_DEFENSE_MAP = OFFLINE_DEFENSE_CATALOG.maps?.[0] || {
        name: 'Banana Grove',
        theme: { top: '#388454', bottom: '#174a2d', dotA: '#d5f08b', dotB: '#103c25', path: '#c78b45', edge: '#51371f' },
        path: [{ x:-40,y:105 },{ x:172,y:105 },{ x:258,y:210 },{ x:560,y:210 },{ x:671,y:326 },{ x:494,y:426 },{ x:176,y:426 },{ x:92,y:526 },{ x:940,y:526 }]
    };
    const ONLINE_DEFENSE_PESTS = OFFLINE_DEFENSE_CATALOG.pests?.length ? OFFLINE_DEFENSE_CATALOG.pests : [
        { id:'zombie', file:'Zombie Monkey.png', hp:1, speed:1, kind:'pest', color:'#87bd75' }
    ];
    const ONLINE_DEFENSE_PATH_SEGMENTS = [];
    let onlineDefensePathLength = 0;
    for (let index = 1; index < ONLINE_DEFENSE_MAP.path.length; index += 1) {
        const a = ONLINE_DEFENSE_MAP.path[index - 1], b = ONLINE_DEFENSE_MAP.path[index];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        ONLINE_DEFENSE_PATH_SEGMENTS.push({ a, b, start: onlineDefensePathLength, length });
        onlineDefensePathLength += length;
    }
    function onlineDefensePathPoint(distance) {
        const value = Math.max(0, Math.min(onlineDefensePathLength, Number(distance) || 0));
        const segment = ONLINE_DEFENSE_PATH_SEGMENTS.find((entry) => value <= entry.start + entry.length) || ONLINE_DEFENSE_PATH_SEGMENTS.at(-1);
        const ratio = Math.max(0, Math.min(1, (value - segment.start) / Math.max(1, segment.length)));
        return { x: segment.a.x + (segment.b.x - segment.a.x) * ratio, y: segment.a.y + (segment.b.y - segment.a.y) * ratio };
    }
    function distanceFromOnlineDefensePath(x, y) {
        return Math.min(...ONLINE_DEFENSE_PATH_SEGMENTS.map((segment) => {
            const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
            const ratio = Math.max(0, Math.min(1, ((x - segment.a.x) * dx + (y - segment.a.y) * dy) / Math.max(1, dx * dx + dy * dy)));
            return Math.hypot(x - (segment.a.x + dx * ratio), y - (segment.a.y + dy * ratio));
        }));
    }
    const DEFENSE_TOWERS = Object.freeze(Object.fromEntries(OFFLINE_DEFENSE_CATALOG.order.map((id) => [id, { ...OFFLINE_DEFENSE_CATALOG.towers[id] }])));
    function onlineDefenseTowerStats(placement) {
        const base = DEFENSE_TOWERS[placement?.towerType] || DEFENSE_TOWERS.torn;
        const tiers = Math.max(0, (Number(placement?.level) || 1) - 1);
        const rangeGrowth = {
            watergun:7, icecrystal:8, cupid:9, cyborg:7, firework:7, astronaut:7, soldier:8, potgold:6, seashore:6,
            rock:5, neon:7, fourleaf:0, egghunt:6, bbq:6, electric:7, easter:6, sun:7, leprechaun:7, cracked:5, lightning:6
        }[placement?.towerType] ?? 6;
        const stats = {
            ...base,
            damage: Number(base.damage || 0) * (1 + tiers * .35),
            range: Number(base.range || 100) + tiers * rangeGrowth,
            rate: Math.max(5, Number(base.rate || 30) - tiers * 2),
            splash: base.splash ? Number(base.splash) + tiers * 8 : 0,
            slow: base.slow ? Math.max(.25, Number(base.slow) - tiers * .04) : 1
        };
        if (placement?.path === 'power') {
            stats.damage *= 1 + tiers * .24;
            stats.splash += tiers * 8;
            if (!base.damage && stats.effectDuration) stats.effectDuration *= 1 + tiers * .14;
        } else if (placement?.path === 'tactical') {
            stats.range += tiers * 10;
            stats.rate *= Math.pow(.86, tiers);
            stats.effectCooldown = Math.max(30, Number(stats.effectCooldown || 60) * Math.pow(.88, tiers));
            if (stats.slow < 1) stats.slow = Math.max(.25, stats.slow - tiers * .05);
        }
        if (base.passive === 'weather-luck') {
            stats.damage = 0;
            stats.range = 0;
            stats.rate = base.rate;
            stats.weatherLuck = Number(base.weatherLuck || 0) + tiers * (placement?.path === 'power' ? .04 : .025);
            stats.weatherGapReduction = Number(base.weatherGapReduction || 0) + (placement?.path === 'tactical' ? tiers : 0);
        }
        if (Date.now() < onlineDefense.rallyUntil) {
            stats.damage *= 1.35;
            stats.rate *= .76;
        }
        const now = Date.now();
        if (now < Number(onlineDefense.timedBuffs.birthday || 0)) stats.rate *= .78;
        if (now < Number(onlineDefense.timedBuffs.dance || 0)) { stats.damage *= 1.06; stats.rate *= .86; }
        if (now < Number(onlineDefense.timedBuffs.christmas || 0)) {
            const sharedBuff = ['damage','range','speed','crit'][Math.abs(Math.floor(Number(placement?.x || 0) + Number(placement?.y || 0))) % 4];
            if (sharedBuff === 'damage') stats.damage *= 1.12;
            else if (sharedBuff === 'range') stats.range += 10;
            else if (sharedBuff === 'speed') stats.rate *= .9;
            else stats.critChance = Math.max(Number(stats.critChance || 0), .12);
        }
        if (now < Number(onlineDefense.timedBuffs.deepDive || 0) && ['watergun','shark','scuba','seashore'].includes(placement?.towerType)) {
            stats.damage *= 1.22; stats.rate *= .82; stats.range += 10;
        }
        const rhythm = onlineDefense.towerRhythm.get(placement?.id);
        if (rhythm?.until > now && rhythm.stacks > 0) stats.rate *= Math.max(.88, 1 - rhythm.stacks * .035);
        const ornaments = (onlineDefense.towerOrnaments.get(placement?.id) || [])
            .filter((ornament) => Number(ornament.expiresAfterWave || 0) >= onlineDefense.wave);
        ornaments.forEach((ornament) => {
            if (ornament.type === 'red') stats.damage *= 1.05;
            else if (ornament.type === 'blue') stats.range += 5;
            else if (ornament.type === 'green') stats.rate *= .96;
            else if (ornament.type === 'gold') stats.critChance = Math.min(.25, Number(stats.critChance || 0) + .03);
        });
        if (onlineDefense.traps.some((trap) => trap.type === 'peppermint' && trap.until > now && Math.hypot(trap.x - placement.x, trap.y - placement.y) <= 90)) stats.rate *= .9;
        if (onlineDefense.weather) {
            const id = onlineDefense.weather.id;
            if (id === 'rain' && ['watergun', 'seashore'].includes(placement?.towerType)) stats.rate *= .75;
            if (id === 'rain' && placement?.towerType === 'firework') stats.rate *= 1.12;
            if (id === 'rain' && ['electric', 'lightning'].includes(placement?.towerType)) stats.damage *= 1.2;
            if (id === 'rain' && placement?.towerType === 'bbq') stats.rate *= 1.18;
            if (id === 'rain' && placement?.towerType === 'sun') stats.damage *= .82;
            if (id === 'snow' && ['snow', 'icecrystal'].includes(placement?.towerType)) stats.damage *= 1.3;
            if (id === 'snow' && placement?.towerType === 'molten') stats.damage *= .85;
            if (id === 'snow' && ['rock', 'cracked'].includes(placement?.towerType)) stats.damage *= 1.18;
            if (id === 'snow' && ['bbq', 'sun'].includes(placement?.towerType)) stats.damage *= .85;
            if (id === 'heat' && ['molten', 'firework'].includes(placement?.towerType)) stats.damage *= 1.3;
            if (id === 'heat' && ['watergun', 'honey'].includes(placement?.towerType)) stats.rate *= 1.15;
            if (id === 'heat' && ['bbq', 'sun'].includes(placement?.towerType)) stats.damage *= 1.25;
            if (id === 'heat' && ['neon', 'electric'].includes(placement?.towerType)) stats.damage *= .88;
            if (id === 'thunder' && ['cyborg', 'soldier', 'electric', 'lightning'].includes(placement?.towerType)) stats.damage *= 1.25;
            if (id === 'thunder' && placement?.towerType === 'neon') stats.damage *= 1.15;
            if (id === 'thunder') stats.range *= .95;
            if (id === 'fog') stats.range *= .86;
            if (id === 'fog' && ['boxer', 'shark'].includes(placement?.towerType)) stats.damage *= 1.3;
            if (id === 'fog' && ['rock', 'cracked', 'bbq'].includes(placement?.towerType)) stats.damage *= 1.2;
            if (id === 'wind' && ['cupid', 'ninja'].includes(placement?.towerType)) stats.rate *= .78;
            if (id === 'wind' && placement?.towerType === 'neon') stats.rate *= .88;
            if (id === 'wind' && ['astronaut', 'firework'].includes(placement?.towerType)) stats.rate *= 1.12;
            if (id === 'wind' && ['egghunt', 'easter', 'leprechaun'].includes(placement?.towerType)) stats.rate *= 1.15;
            if (id === 'rainbow' && placement?.towerType === 'potgold') stats.damage *= 1.3;
            if (id === 'rainbow' && placement?.towerType === 'leprechaun') stats.damage *= 1.3;
            if (id === 'rainbow' && ['egghunt', 'easter'].includes(placement?.towerType)) stats.damage *= 1.15;
        }
        stats.cooldown = Math.max(84, stats.rate * (1000 / 60));
        return stats;
    }
    onlineDefense.selectedTower = OFFLINE_DEFENSE_CATALOG.order[0] || 'torn';
    elements.odTowerDeck.innerHTML = OFFLINE_DEFENSE_CATALOG.order.map((id, index) => {
        const tower = DEFENSE_TOWERS[id];
        return `<button class="od-tower ${index === 0 ? 'active' : ''}" data-od-tower="${escapeHtml(id)}" type="button"><img data-menu-src="${escapeHtml(tower.file)}" alt="" decoding="async"><span><strong>${escapeHtml(tower.name)}</strong><small>${Number(tower.cost)} Bananas · Defense Power: ${escapeHtml(tower.defenseTier || tower.rarity || 'Standard')} · ${escapeHtml(tower.hint)}</small></span></button>`;
    }).join('');

    function hydrateOnlineDefenseDeck() {
        const images = [...elements.odTowerDeck.querySelectorAll('img[data-menu-src]')];
        const load = (image) => {
            if (!image?.dataset.menuSrc) return;
            image.src = image.dataset.menuSrc;
            delete image.dataset.menuSrc;
        };
        if (!('IntersectionObserver' in window)) {
            images.slice(0, matchMedia('(max-width:760px), (pointer:coarse)').matches ? 8 : 18).forEach(load);
            return;
        }
        const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            load(entry.target);
            observer.unobserve(entry.target);
        }), { root:elements.odTowerDeck, rootMargin:'360px 0px' });
        images.forEach((image) => observer.observe(image));
    }
    hydrateOnlineDefenseDeck();

    function defenseMe() {
        return onlineDefense.room?.players?.find((player) => player.id === state.playerId) || null;
    }

    function setDefenseView(view) {
        for (const section of [elements.odMenu, elements.odLobby, elements.odGame]) section.classList.toggle('mp-hidden', section !== view);
        elements.onlineDefenseScreen.scrollTop = 0;
    }

    function renderDefenseRank() {
        const ranked = onlineDefense.rank;
        const heroRankIcon = elements.onlineDefenseScreen.querySelector('.od-shield');
        if (heroRankIcon) heroRankIcon.innerHTML = ranked
            ? `<img src="${escapeHtml(rankIconSource(ranked))}" alt="${escapeHtml(ranked.rank || 'Online rank')}">`
            : '&#128737;';
        elements.odRankCard.innerHTML = ranked
            ? `<div class="od-rank-summary"><img src="${escapeHtml(rankIconSource(ranked))}" alt=""><div><strong>${escapeHtml(ranked.rank || 'Unranked')}</strong><span>${Number(ranked.rp || 0).toLocaleString()} Online RP${ranked.nextRank ? ` - Next: ${escapeHtml(ranked.nextRank)}` : ' - Maximum rank'}</span></div></div><div class="od-rank-track"><i style="width:${Math.max(0, Math.min(100, Number(ranked.progress) || 0))}%"></i></div>`
            : '<strong>Shared Online Rank</strong><span>Play any public ranked mode to enter the leaderboard.</span>';
        elements.odLeaderboard.innerHTML = onlineDefense.leaderboard.length
            ? onlineDefense.leaderboard.map((entry) => `<div class="od-leaderboard-row"><strong>#${Number(entry.place)}</strong><img src="${escapeHtml(rankIconSource(entry))}" alt=""><b>${escapeHtml(entry.username)}</b><span>${escapeHtml(entry.rank)}</span><strong>${Number(entry.rp || 0).toLocaleString()} RP</strong></div>`).join('')
            : '<div class="od-empty">No ranked defenders yet. The first public match will start the leaderboard.</div>';
    }

    function renderDefenseRoom() {
        const room = onlineDefense.room;
        if (!room) return;
        elements.odLobbyBadge.textContent = `${room.ranked ? 'RANKED' : 'PRIVATE'} ${room.mode === 'coop' ? 'CO-OP' : 'VERSUS'}`;
        elements.odRoomCode.textContent = room.code || 'PUBLIC';
        elements.odCopyCode.classList.toggle('mp-hidden', !room.code);
        elements.odLobbyPlayers.innerHTML = room.players.map((player) => `<div class="od-lobby-player"><img src="${escapeHtml(player.skin || 'Default Monkey.png')}" alt=""><div><strong>${escapeHtml(player.username)}${platformBadgeHtml(player.platform)}</strong>${sharedTitleHtml(player.id === state.playerId ? localTitleProfile() : player)}<span>Level ${Number(player.level || 1)}${player.id === room.hostId ? ' - Host' : ''}</span></div></div>`).join('') + (room.players.length < 2 ? '<div class="od-lobby-player"><div><strong>Waiting for a friend...</strong><span>Share the room code above.</span></div></div>' : '');
        const host = room.hostId === state.playerId;
        elements.odStartPrivate.classList.toggle('mp-hidden', !host);
        elements.odStartPrivate.disabled = room.players.length < 2;
        elements.odLobbyNote.textContent = room.players.length < 2 ? 'Waiting for a second defender.' : host ? 'Both defenders are here. Start whenever you are ready.' : 'Waiting for the host to start the defense.';
        if (!onlineDefense.active && room.phase === 'lobby') setDefenseView(elements.odLobby);
    }

    function updateDefenseHud() {
        const room = onlineDefense.room;
        const me = defenseMe();
        const shownPlayer = room?.mode === 'coop' ? room.players.find((player) => player.id === room.simulationOwnerId) || me : me;
        elements.odGameMode.textContent = `${room?.ranked ? 'RANKED' : 'PRIVATE'} ${room?.mode === 'coop' ? 'CO-OP DEFENSE' : 'VERSUS DEFENSE'}`;
        const shownWave = Math.max(onlineDefense.wave, Number(shownPlayer?.wave) || 0);
        elements.odWaveText.textContent = `${shownWave} / ${Number(room?.targetWave || 100)}${shownWave > 0 && shownWave % 5 === 0 ? ' · BOSS' : ''}`;
        elements.odBananas.textContent = Number(me?.bananas ?? 180).toLocaleString();
        elements.odLives.textContent = Math.max(0, onlineDefense.lives).toLocaleString();
        elements.odKills.textContent = onlineDefense.kills.toLocaleString();
        elements.odMarketReward.textContent = `+${Math.max(0, Math.floor(onlineDefense.bananaRewardsEarned)).toLocaleString()}`;
        elements.odScore.textContent = onlineDefense.score.toLocaleString();
        elements.odOpponentStats.innerHTML = (room?.players || []).map((player) => `<div class="od-player-stat"><strong>${player.id === state.playerId ? 'You' : escapeHtml(player.username)}${platformBadgeHtml(player.platform)}</strong>${sharedTitleHtml(player.id === state.playerId ? localTitleProfile() : player)}<span>Wave ${Number(player.wave || 0)} - ${Number(player.lives || 0)} lives - ${Number(player.score || 0).toLocaleString()} score</span></div>`).join('');
        const placements = room?.placements || [];
        const selected = placements.find((tower) => tower.id === onlineDefense.selectedPlacementId);
        const selectedConfig = selected ? DEFENSE_TOWERS[selected.towerType] : null;
        if (selected && selectedConfig) {
            const level = Math.max(1, Number(selected.level) || 1);
            const selectedStats = onlineDefenseTowerStats(selected);
            const upgradeCost = Math.floor(selectedConfig.cost * (1.15 + level * .65));
            const support = selectedConfig.passive === 'weather-luck';
            const pathLabel = selected.path ? ` · ${support ? (selected.path === 'power' ? 'Lucky Clover' : 'Weather Forecast') : (selected.path === 'power' ? 'Power' : 'Tactical')} Path` : '';
            let statLine = support
                ? `${Math.round(Number(selectedStats.weatherLuck || 0) * 100)}% extra weather luck · shortens the dry-weather gap by ${Math.max(0, Number(selectedStats.weatherGapReduction) || 0)} wave${Number(selectedStats.weatherGapReduction) === 1 ? '' : 's'}`
                : `${Math.round(selectedStats.damage)} damage · ${Math.round(selectedStats.range)} range`;
            elements.odSelection.innerHTML = `<strong>${escapeHtml(selectedConfig.name)} · Level ${level}${pathLabel}</strong><span>${statLine} · ${escapeHtml(selectedConfig.hint)}</span>`;
            if (selected.towerType === 'birthdaybash') {
                const partyTarget = Number(selectedConfig.partyTarget || 28);
                statLine += ` · Party Meter ${Math.min(partyTarget, Number(onlineDefense.towerPartyMeters.get(selected.id) || 0))}/${partyTarget}`;
            }
            if (selected.towerType === 'christmastree') statLine += ` · ${(onlineDefense.towerOrnaments.get(selected.id) || []).length}/6 ornaments`;
            elements.odSelection.innerHTML = `<strong>${escapeHtml(selectedConfig.name)} · Level ${level}${pathLabel}</strong><span>${statLine} · ${escapeHtml(selectedConfig.hint)}</span>`;
            const canUpgrade = level < 3 && selected.ownerId === state.playerId;
            elements.odUpgradePower.disabled = !canUpgrade || Boolean(selected.path && selected.path !== 'power');
            elements.odUpgradeTactical.disabled = !canUpgrade || Boolean(selected.path && selected.path !== 'tactical');
            elements.odUpgradePower.textContent = level >= 3 ? 'Maximum Level' : `${support ? 'Lucky Clover' : 'Power'} Path · ${upgradeCost}`;
            elements.odUpgradeTactical.textContent = level >= 3 ? 'Maximum Level' : `${support ? 'Forecast' : 'Tactical'} Path · ${upgradeCost}`;
            elements.odSell.disabled = selected.ownerId !== state.playerId;
            elements.odSell.textContent = `Sell · ${Math.floor((selectedConfig.cost + Number(selected.spent || 0)) * .65)} Bananas`;
        } else {
            const buildConfig = DEFENSE_TOWERS[onlineDefense.selectedTower];
            const placementLine = buildConfig?.passive === 'weather-luck' ? 'Map-wide support aura.' : `Range ${Math.round(Number(buildConfig?.range) || 0)}.`;
            elements.odSelection.innerHTML = buildConfig ? `<strong>${escapeHtml(buildConfig.name)} · ${Number(buildConfig.cost)} Bananas</strong><span>${escapeHtml(buildConfig.hint)} ${placementLine} Hover over the map: green can be placed, red is blocked.</span>` : 'Choose a Monkey Defender below.';
            elements.odUpgradePower.disabled = true;
            elements.odUpgradePower.textContent = 'Power Path';
            elements.odUpgradeTactical.disabled = true;
            elements.odUpgradeTactical.textContent = 'Tactical Path';
            elements.odSell.disabled = true;
            elements.odSell.textContent = 'Sell selected defender';
        }
        const hostMustStart = room?.mode === 'coop' && room.hostId !== state.playerId;
        elements.odStartWave.disabled = hostMustStart || !onlineDefense.awaitingWaveStart || Date.now() < onlineDefense.localStartAt || onlineDefense.completed;
        elements.odStartWave.textContent = onlineDefense.completed ? 'Defense Complete' : onlineDefense.awaitingWaveStart ? `Start Wave ${Math.min(Number(room?.targetWave || 100), onlineDefense.wave + 1)}` : `Wave ${onlineDefense.wave} in progress`;
        if (hostMustStart && onlineDefense.awaitingWaveStart) elements.odStartWave.textContent = 'Waiting for host';
        updateOnlineDefensePowerButtons();
    }

    function updateOnlineDefensePowerButtons() {
        const entries = [
            [elements.odPowerRepair, 'repair', 'Heal +4'],
            [elements.odPowerFreeze, 'freeze', 'Track Freeze'],
            [elements.odPowerBomb, 'bomb', 'Banana Bomb'],
            [elements.odPowerRally, 'rally', 'Tower Rally']
        ];
        for (const [button, id, label] of entries) {
            const power = onlineDefense.powers[id];
            const waiting = power.uses > 0 && onlineDefense.wave < power.readyWave;
            button.disabled = !onlineDefense.active || onlineDefense.completed || power.uses <= 0 || waiting;
            button.innerHTML = `${label}<small>${power.uses} use${power.uses === 1 ? '' : 's'} left${waiting ? ` · W${power.readyWave}` : ''}</small>`;
        }
    }

    function drawOnlineDefenseStar(ctx, x, y, radius, rotation, color, alpha = 1) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        for (let point = 0; point < 10; point += 1) {
            const angle = -Math.PI / 2 + point * Math.PI / 5;
            const distance = point % 2 ? radius * .42 : radius;
            const px = Math.cos(angle) * distance;
            const py = Math.sin(angle) * distance;
            if (!point) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawOnlineDefenseClover(ctx, x, y, size, rotation, alpha) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = '#6cf27d';
        ctx.strokeStyle = '#e8ffd9';
        ctx.lineWidth = Math.max(1, size * .1);
        ctx.shadowColor = '#55ff76';
        ctx.shadowBlur = size;
        for (const [dx, dy] of [[-.34,-.26],[.34,-.26],[-.34,.26],[.34,.26]]) {
            ctx.beginPath();
            ctx.arc(dx * size, dy * size, size * .36, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(0, size * .28);
        ctx.quadraticCurveTo(size * .34, size * .75, size * .12, size);
        ctx.stroke();
        ctx.restore();
    }

    function drawOnlineDefenseWeather(ctx, now) {
        const weather = onlineDefense.weather;
        if (!weather) return;
        const width = elements.onlineDefenseCanvas.width;
        const height = elements.onlineDefenseCanvas.height;
        const time = now / 30;
        ctx.save();
        if (weather.id === 'rain' || weather.id === 'thunder') {
            ctx.fillStyle = weather.id === 'thunder' ? 'rgba(18,29,58,.2)' : 'rgba(70,151,191,.09)';
            ctx.fillRect(0, 0, width, height);
            ctx.strokeStyle = weather.id === 'thunder' ? 'rgba(194,224,255,.42)' : 'rgba(173,231,255,.4)';
            ctx.lineWidth = 2;
            for (let index = 0; index < 44; index += 1) {
                const x = (index * 73 + time * 7) % (width + 90) - 45;
                const y = (index * 41 + time * 12) % (height + 70) - 35;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y + 25); ctx.stroke();
            }
        } else if (weather.id === 'snow') {
            ctx.fillStyle = 'rgba(222,248,255,.72)';
            for (let index = 0; index < 34; index += 1) {
                const x = (index * 83 + Math.sin(time / 12 + index) * 22) % width;
                const y = (index * 59 + time * 2.2) % height;
                ctx.beginPath(); ctx.arc(x, y, 2 + index % 3, 0, Math.PI * 2); ctx.fill();
            }
        } else if (weather.id === 'heat') {
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, 'rgba(255,195,69,.16)');
            gradient.addColorStop(1, 'rgba(255,83,35,.07)');
            ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        } else if (weather.id === 'fog') {
            for (let index = 0; index < 7; index += 1) {
                ctx.fillStyle = `rgba(226,239,233,${.035 + index * .008})`;
                ctx.beginPath();
                ctx.ellipse(((index * 170 + time) % (width + 260)) - 130, 70 + index * 76, 190, 45, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (weather.id === 'wind') {
            ctx.strokeStyle = 'rgba(218,255,226,.34)';
            ctx.lineWidth = 3;
            for (let index = 0; index < 20; index += 1) {
                const x = (index * 131 + time * 8) % (width + 100) - 50;
                const y = 30 + (index * 47) % (height - 60);
                ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 30, y - 10, x + 68, y); ctx.stroke();
            }
        } else if (weather.id === 'rainbow') {
            ctx.globalAlpha = .2;
            ctx.lineWidth = 14;
            ['#ff5858','#ffb84d','#ffe55c','#66e581','#59bfff','#b77cff'].forEach((color, index) => {
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.arc(width / 2, height + 50, 370 - index * 16, Math.PI, Math.PI * 2);
                ctx.stroke();
            });
        }
        ctx.restore();
    }

    function drawOnlineDefenseEffects(ctx, now) {
        const width = elements.onlineDefenseCanvas.width;
        const height = elements.onlineDefenseCanvas.height;
        onlineDefense.effects = onlineDefense.effects.filter((effect) => effect.until > now);
        for (const effect of onlineDefense.effects) {
            const duration = Math.max(1, effect.until - effect.startedAt);
            const progress = Math.max(0, Math.min(1, (now - effect.startedAt) / duration));
            const fade = Math.min(1, progress * 7, (1 - progress) * 4);
            ctx.save();
            if (effect.type === 'clover-luck') {
                for (let index = 0; index < 44; index += 1) {
                    const delay = ((index * 37) % 90) / 100;
                    const fall = Math.max(0, Math.min(1, (progress - delay * .35) / .68));
                    if (fall <= 0 || fall >= 1) continue;
                    const x = (index * 83 + 37) % width + Math.sin(fall * 9 + index) * 18;
                    const y = -28 + fall * (height + 58);
                    drawOnlineDefenseClover(ctx, x, y, 6 + index % 5, fall * 5 + index, Math.min(1, fall * 5, (1 - fall) * 5));
                }
            } else if (effect.type === 'sun-rays') {
                const sx = width - 92, sy = 88;
                const pulse = 1 + Math.sin(progress * Math.PI * 10) * .07;
                const glow = ctx.createRadialGradient(sx, sy, 6, sx, sy, 74 * pulse);
                glow.addColorStop(0, 'rgba(255,255,225,.98)');
                glow.addColorStop(.18, 'rgba(255,229,77,.92)');
                glow.addColorStop(.55, 'rgba(255,142,31,.45)');
                glow.addColorStop(1, 'rgba(255,91,20,0)');
                ctx.globalAlpha = fade; ctx.fillStyle = glow;
                ctx.beginPath(); ctx.arc(sx, sy, 78 * pulse, 0, Math.PI * 2); ctx.fill();
                effect.points.forEach((point, index) => {
                    const bend = 24 + index * 6;
                    ctx.strokeStyle = 'rgba(255,194,64,.4)'; ctx.lineWidth = 13; ctx.shadowColor = '#ffd34e'; ctx.shadowBlur = 22;
                    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + point.x) / 2 + Math.sin(progress * 12 + index) * bend, (sy + point.y) / 2, point.x, point.y); ctx.stroke();
                    ctx.strokeStyle = '#fff2a2'; ctx.lineWidth = 3; ctx.shadowBlur = 8; ctx.stroke();
                });
            } else if (effect.type === 'rainbow-stars') {
                const colors = ['#ff5d73','#ffb64e','#ffe45b','#67e78d','#55c8ff','#b17aff'];
                ctx.globalAlpha = fade * .2; ctx.lineCap = 'round'; ctx.lineWidth = 8; ctx.shadowColor = '#fff'; ctx.shadowBlur = 11;
                colors.forEach((color, index) => {
                    ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(width / 2, height * .79, 370 - index * 10, Math.PI, Math.PI * 2); ctx.stroke();
                });
                effect.stars.forEach((star, index) => {
                    ctx.globalAlpha = 1;
                    const start = .1 + star.delay;
                    const fall = Math.max(0, Math.min(1, (progress - start) / .68));
                    if (fall <= 0 || fall >= 1) return;
                    const x = star.x + Math.sin(fall * 10 + index) * star.sway;
                    const y = -20 + (star.y + 20) * (fall * fall * (3 - 2 * fall));
                    drawOnlineDefenseStar(ctx, x, y, star.size, fall * 5 + index, colors[index % colors.length], Math.min(fade, fall * 5, (1 - fall) * 6));
                });
            } else if (effect.type === 'lightning-storm') {
                ctx.globalAlpha = fade;
                const storm = ctx.createLinearGradient(0, 0, 0, height * .55);
                storm.addColorStop(0, 'rgba(20,29,61,.62)');
                storm.addColorStop(1, 'rgba(31,64,84,0)');
                ctx.fillStyle = storm; ctx.fillRect(0, 0, width, height * .62);
                ctx.fillStyle = '#394763'; ctx.shadowColor = '#84bfff'; ctx.shadowBlur = 22;
                for (let cloud = 0; cloud < 10; cloud += 1) {
                    const x = 20 + cloud * 94 + Math.sin(cloud + progress * 4) * 16;
                    const y = 48 + (cloud % 3) * 24;
                    ctx.beginPath(); ctx.ellipse(x, y, 74, 28, 0, 0, Math.PI * 2); ctx.fill();
                }
                ctx.strokeStyle = 'rgba(181,223,255,.45)'; ctx.lineWidth = 2; ctx.shadowBlur = 0;
                for (let rain = 0; rain < 48; rain += 1) {
                    const x = (rain * 67 + progress * 1300) % width;
                    const y = (rain * 43 + progress * 920) % height;
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8, y + 24); ctx.stroke();
                }
                let previous = { x:width * .56, y:65 };
                effect.points.forEach((point, index) => {
                    const points = [previous];
                    for (let segment = 1; segment < 8; segment += 1) {
                        const ratio = segment / 8;
                        points.push({ x:previous.x + (point.x - previous.x) * ratio + Math.sin(effect.seed + index * 4 + segment * 2.7) * 14, y:previous.y + (point.y - previous.y) * ratio });
                    }
                    points.push(point);
                    ctx.strokeStyle = '#6ed6ff'; ctx.lineWidth = 10; ctx.shadowColor = '#67cfff'; ctx.shadowBlur = 28;
                    ctx.beginPath(); points.forEach((entry, pointIndex) => pointIndex ? ctx.lineTo(entry.x, entry.y) : ctx.moveTo(entry.x, entry.y)); ctx.stroke();
                    ctx.strokeStyle = '#f4fcff'; ctx.lineWidth = 3; ctx.shadowBlur = 8; ctx.stroke();
                    drawOnlineDefenseStar(ctx, point.x, point.y, 11, progress * 8 + index, '#d9f5ff', fade);
                    previous = point;
                });
            } else if (effect.type === 'earthquake') {
                ctx.globalAlpha = fade;
                ctx.fillStyle = 'rgba(85,48,28,.13)'; ctx.fillRect(0, 0, width, height);
                const origins = effect.points.length ? effect.points : [{ x:width / 2,y:height / 2 }];
                for (let crack = 0; crack < 15; crack += 1) {
                    const origin = origins[crack % origins.length];
                    const angle = effect.seed + crack * 2.399;
                    const length = (95 + crack % 5 * 24) * Math.min(1, progress * 3);
                    ctx.beginPath(); ctx.moveTo(origin.x, origin.y);
                    for (let segment = 1; segment <= 6; segment += 1) {
                        const distance = length * segment / 6;
                        ctx.lineTo(origin.x + Math.cos(angle) * distance + Math.sin(segment * 7 + crack) * 12, origin.y + Math.sin(angle) * distance + Math.cos(segment * 5 + crack) * 9);
                    }
                    ctx.strokeStyle = '#342017'; ctx.lineWidth = 8; ctx.shadowColor = '#f6b56b'; ctx.shadowBlur = 9; ctx.stroke();
                    ctx.strokeStyle = '#d78349'; ctx.lineWidth = 2; ctx.shadowBlur = 0; ctx.stroke();
                }
            } else if (effect.type === 'delayed-gift') {
                const pulse=1+Math.sin(progress*Math.PI*10)*.09;
                ctx.translate(effect.x,effect.y);ctx.scale(pulse,pulse);ctx.rotate(Math.sin(progress*Math.PI*8)*.08);
                ctx.shadowColor='#ffe56b';ctx.shadowBlur=16+progress*18;ctx.fillStyle='#755eff';ctx.fillRect(-16,-14,32,28);ctx.fillStyle='#ffe160';ctx.fillRect(-3,-14,6,28);ctx.fillRect(-16,-3,32,6);
                ctx.strokeStyle='#fff2aa';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-14);ctx.bezierCurveTo(-17,-27,-19,-7,0,-9);ctx.bezierCurveTo(17,-27,19,-7,0,-9);ctx.stroke();
            } else if (effect.type === 'reward-popup') {
                const cardX=width/2-225,cardY=78-Math.max(0,(1-progress*8))*24;ctx.globalAlpha=fade;ctx.shadowColor=effect.color||'#ff77bc';ctx.shadowBlur=24;const card=ctx.createLinearGradient(cardX,cardY,cardX+450,cardY+88);card.addColorStop(0,'rgba(29,14,54,.96)');card.addColorStop(.52,'rgba(72,25,91,.96)');card.addColorStop(1,'rgba(30,64,82,.96)');ctx.fillStyle=card;ctx.fillRect(cardX,cardY,450,88);ctx.strokeStyle=effect.color||'#ffe06b';ctx.lineWidth=3;ctx.strokeRect(cardX,cardY,450,88);ctx.shadowBlur=0;ctx.fillStyle='#ffe36d';ctx.font='900 18px Arial';ctx.textAlign='center';ctx.fillText(effect.title||'PRESENT OPENED!',width/2,cardY+29);const entries=Array.isArray(effect.entries)?effect.entries:[effect.detail||'Reward collected'];ctx.fillStyle='#fff7dc';ctx.font='bold 12px Arial';ctx.fillText(entries.slice(0,2).join('  ·  '),width/2,cardY+52);if(entries.length>2)ctx.fillText(entries.slice(2,4).join('  ·  '),width/2,cardY+70);
            } else if (effect.type === 'screen-punch') {
                if(typeof window.drawDefenseScreenPunchEffect==='function')window.drawDefenseScreenPunchEffect(ctx,width,height,effect,progress);
            } else if (effect.type === 'gravity-tug') {
                const x=effect.x??width/2,y=effect.y??height/2;ctx.globalAlpha=fade;
                for(let arc=0;arc<5;arc++){const angle=(effect.seed||0)+arc/5*Math.PI*2+progress*2.4,outer=34-progress*20+arc*2;ctx.strokeStyle=arc%2?'rgba(120,221,255,.64)':'rgba(197,137,255,.72)';ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(x,y,outer,angle,angle+1.15);ctx.stroke();}
                const tug=ctx.createRadialGradient(x,y,1,x,y,25);tug.addColorStop(0,'rgba(0,0,0,.88)');tug.addColorStop(.35,'rgba(102,46,170,.48)');tug.addColorStop(1,'rgba(112,66,201,0)');ctx.fillStyle=tug;ctx.beginPath();ctx.arc(x,y,25,0,Math.PI*2);ctx.fill();
            } else if (effect.type === 'peppermint-impact' || effect.type === 'peppermint-shockwave') {
                const x=effect.x??width/2,y=effect.y??height/2,large=effect.type==='peppermint-shockwave',count=large?30:12,ringRadius=(large?28:10)+progress*(large?175:55);ctx.globalAlpha=fade;ctx.strokeStyle=large?'rgba(191,255,222,.8)':'rgba(255,117,132,.82)';ctx.lineWidth=large?7*(1-progress)+2:4*(1-progress)+1;ctx.shadowColor=large?'#89f0c0':'#ff7180';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(x,y,ringRadius,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;for(let cane=0;cane<count;cane++){const angle=cane/count*Math.PI*2+(effect.seed||0)+progress*5,distance=(large?25:8)+progress*((large?110:36)+(cane%5)*5),size=large?8+cane%4:6+cane%3;drawOnlineCandyCane(ctx,x+Math.cos(angle)*distance,y+Math.sin(angle)*distance,size,angle+progress*9,fade);}
            } else if (effect.type === 'peppermint-storm') {
                ctx.globalAlpha=fade;
                for(let index=0;index<96;index++){const lane=(index*83+(effect.seed||0)*31)%width,fall=((index*61+progress*(height+260)*1.7)%(height+170))-85,sway=Math.sin(progress*10+index*.83)*18,size=7+(index%6)*1.25;drawOnlineCandyCane(ctx,lane+sway,fall,size,progress*10+index*.71,fade*(.55+(index%4)*.12));}
                const mintWash=ctx.createLinearGradient(0,0,0,height);mintWash.addColorStop(0,'rgba(196,255,229,.025)');mintWash.addColorStop(.55,'rgba(255,118,132,.04)');mintWash.addColorStop(1,'rgba(196,255,229,.02)');ctx.fillStyle=mintWash;ctx.fillRect(0,0,width,height);
            } else if (effect.type === 'singularity') {
                const x=effect.x??width/2,y=effect.y??height/2,formation=Math.min(1,progress/.26),collapse=progress>.82?(progress-.82)/.18:0,strength=formation*(1-collapse),haloRadius=70+strength*210;
                const outer=ctx.createRadialGradient(x,y,8,x,y,haloRadius);outer.addColorStop(0,'rgba(0,0,0,.99)');outer.addColorStop(.2,'rgba(4,1,10,.98)');outer.addColorStop(.44,'rgba(59,13,91,.78)');outer.addColorStop(.7,'rgba(137,61,224,.32)');outer.addColorStop(1,'rgba(95,43,190,0)');ctx.fillStyle=outer;ctx.beginPath();ctx.arc(x,y,haloRadius,0,Math.PI*2);ctx.fill();
                ctx.save();ctx.translate(x,y);ctx.rotate(-.16+Math.sin(progress*9)*.035);const disk=ctx.createLinearGradient(-haloRadius,0,haloRadius,0);disk.addColorStop(0,'rgba(81,205,255,0)');disk.addColorStop(.18,'rgba(81,205,255,.72)');disk.addColorStop(.42,'rgba(241,184,255,.95)');disk.addColorStop(.5,'#fff6da');disk.addColorStop(.62,'rgba(255,119,211,.92)');disk.addColorStop(.84,'rgba(114,60,244,.65)');disk.addColorStop(1,'rgba(81,205,255,0)');ctx.strokeStyle=disk;ctx.shadowColor='#bd72ff';ctx.shadowBlur=20;ctx.lineWidth=7;ctx.beginPath();ctx.ellipse(0,0,haloRadius*.82,haloRadius*.16,0,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=.72;ctx.lineWidth=2.3;for(let band=0;band<3;band++){ctx.beginPath();ctx.ellipse(0,0,haloRadius*(.55+band*.12),haloRadius*(.08+band*.025),0,progress*4+band*.7,progress*4+band*.7+Math.PI*1.25);ctx.stroke();}ctx.restore();
                ctx.globalAlpha=Math.max(.15,strength);for(let debris=0;debris<34;debris++){const phase=(effect.seed||0)+debris*.83+progress*(7+debris%3),startDistance=290+(debris%7)*18,distance=Math.max(20,startDistance*(1-progress*.86)),px=x+Math.cos(phase)*distance,py=y+Math.sin(phase)*distance*.56;ctx.fillStyle=debris%4===0?'#9fe8ff':debris%3===0?'#ff9ce8':'#c69aff';ctx.save();ctx.translate(px,py);ctx.rotate(phase+progress*12);ctx.fillRect(-1.5-debris%3,-1.5,3+debris%4,3);ctx.restore();}
                ctx.globalAlpha=1;const coreRadius=Math.max(7,(29+strength*25)*(1-collapse*.85));ctx.fillStyle='#000';ctx.shadowColor='#d199ff';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(x,y,coreRadius,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(231,210,255,.88)';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,coreRadius+4,Math.PI*.08,Math.PI*.92);ctx.stroke();
                if(collapse>0){ctx.globalAlpha=1-collapse;ctx.strokeStyle='#f4d9ff';ctx.lineWidth=10*(1-collapse)+2;ctx.shadowColor='#fff';ctx.shadowBlur=28;ctx.beginPath();ctx.arc(x,y,30+collapse*300,0,Math.PI*2);ctx.stroke();}
            } else if (effect.type === 'singularity-poof') {
                const x=effect.x??width/2,y=effect.y??height/2;ctx.globalAlpha=fade;
                for(let particle=0;particle<72;particle++){const angle=particle/72*Math.PI*2+(effect.seed||0),distance=15+progress*(50+(particle%9)*15);ctx.fillStyle=['#050109','#8a44e8','#d7a8ff','#82e5ff'][particle%4];ctx.beginPath();ctx.arc(x+Math.cos(angle)*distance,y+Math.sin(angle)*distance,2+particle%4,0,Math.PI*2);ctx.fill();}
                ctx.strokeStyle='#dcb7ff';ctx.lineWidth=7*(1-progress)+2;ctx.shadowColor='#a96cff';ctx.shadowBlur=24;ctx.beginPath();ctx.arc(x,y,18+progress*230,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff';ctx.font='900 14px Arial';ctx.textAlign='center';ctx.fillText(`${effect.count||0} ERASED`,x,y-34-progress*42);
            } else if (effect.type === 'toy-workshop') {
                const x=effect.x??width/2,y=effect.y??height/2,gold=Boolean(effect.golden),red=gold?'#d8a817':'#d93d4e',blue=gold?'#ffdf62':'#3b86c8',trim=gold?'#fff0a1':'#ffd66e';ctx.globalAlpha=fade;ctx.save();ctx.translate(x,y);
                if(effect.toy===0){const pop=Math.sin(Math.min(1,progress*2.2)*Math.PI*.5);ctx.fillStyle=red;ctx.fillRect(-20,-5,40,27);ctx.fillStyle=blue;ctx.fillRect(-16,-2,12,20);ctx.fillRect(6,-2,10,20);ctx.strokeStyle=trim;ctx.lineWidth=3;ctx.strokeRect(-19,-4,38,25);ctx.strokeStyle=gold?'#ffe76c':'#c7d7df';ctx.beginPath();for(let coil=0;coil<=12;coil++){const ratio=coil/12,px=Math.sin(coil*Math.PI)*7,py=-5-pop*36*ratio;if(!coil)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.stroke();ctx.translate(0,-9-pop*36);ctx.fillStyle=gold?'#ffe995':'#f1bd8d';ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.fillStyle=red;ctx.beginPath();ctx.moveTo(-11,-7);ctx.lineTo(-4,-17);ctx.lineTo(0,-8);ctx.lineTo(9,-17);ctx.lineTo(11,-5);ctx.closePath();ctx.fill();}
                else if(effect.toy===1){const travel=-52+progress*94;ctx.translate(travel,4-Math.sin(progress*Math.PI)*8);ctx.fillStyle=red;ctx.fillRect(-24,-10,48,19);ctx.fillStyle=blue;ctx.fillRect(-7,-19,21,14);ctx.fillStyle='#bfeaff';ctx.fillRect(-3,-16,12,8);ctx.fillStyle='#20202b';[-15,15].forEach((wheel)=>{ctx.beginPath();ctx.arc(wheel,10,7,0,Math.PI*2);ctx.fill();ctx.fillStyle=trim;ctx.beginPath();ctx.arc(wheel,10,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#20202b';});ctx.strokeStyle=trim;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-24,-2);ctx.lineTo(-34,-2);ctx.lineTo(-34,-12);ctx.moveTo(-39,-17);ctx.lineTo(-29,-7);ctx.moveTo(-29,-17);ctx.lineTo(-39,-7);ctx.stroke();}
                else{const snap=Math.abs(Math.sin(progress*Math.PI*8));ctx.translate(0,-8-Math.sin(progress*Math.PI)*8);ctx.fillStyle=red;ctx.fillRect(-14,-14,28,35);ctx.fillStyle=blue;ctx.fillRect(-12,-8,24,11);ctx.fillStyle=trim;ctx.fillRect(-3,-14,6,35);ctx.fillStyle=gold?'#ffe79a':'#efbc8c';ctx.beginPath();ctx.arc(0,-24,14,0,Math.PI*2);ctx.fill();ctx.fillStyle=red;ctx.beginPath();ctx.moveTo(-15,-31);ctx.lineTo(-10,-45);ctx.lineTo(-4,-38);ctx.lineTo(0,-48);ctx.lineTo(6,-38);ctx.lineTo(12,-45);ctx.lineTo(15,-31);ctx.closePath();ctx.fill();ctx.fillStyle='#202132';ctx.beginPath();ctx.arc(-5,-25,2,0,Math.PI*2);ctx.arc(5,-25,2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#773c2b';ctx.fillRect(-8,-15+snap*3,16,9);}
                ctx.restore();
            } else if (effect.type === 'boss-slayer') {
                const source=effect.sourceTower||{x:width/2,y:height/2},target=effect.target?.hp>0?onlineDefensePathPoint(effect.target.distance):{x:effect.x??width/2,y:effect.y??height/2},tx=target.x,ty=target.y,pulse=.5+.5*Math.sin(now/95);ctx.globalAlpha=fade;const focus=ctx.createRadialGradient(tx,ty,4,tx,ty,105);focus.addColorStop(0,'rgba(255,234,139,.13)');focus.addColorStop(.46,'rgba(255,84,51,.08)');focus.addColorStop(1,'rgba(255,65,35,0)');ctx.fillStyle=focus;ctx.beginPath();ctx.arc(tx,ty,105,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(73,18,16,.8)';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(source.x,source.y);ctx.lineTo(tx,ty);ctx.stroke();ctx.strokeStyle='#ff6c43';ctx.lineWidth=3;ctx.setLineDash([18,10,4,10]);ctx.lineDashOffset=-now/28;ctx.shadowColor='#ff663f';ctx.shadowBlur=12;ctx.stroke();ctx.setLineDash([]);ctx.shadowBlur=0;ctx.save();ctx.translate(tx,ty);ctx.rotate(-now/650);ctx.strokeStyle='#ffd46b';ctx.lineWidth=3;ctx.setLineDash([18,8]);ctx.beginPath();ctx.arc(0,0,45+pulse*5,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#ff5f43';ctx.lineWidth=4;for(let bracket=0;bracket<4;bracket++){ctx.save();ctx.rotate(bracket*Math.PI/2);ctx.beginPath();ctx.moveTo(32,-16);ctx.lineTo(48,-16);ctx.lineTo(48,0);ctx.stroke();ctx.restore();}ctx.restore();ctx.fillStyle='#fff4b0';ctx.shadowColor='#ff553c';ctx.shadowBlur=15;ctx.beginPath();ctx.arc(tx,ty,5+pulse*3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#ffe183';ctx.font='900 11px Arial';ctx.textAlign='center';ctx.fillText('WEAK POINT LOCKED',tx,ty-62);
            } else if (['firework-burst','present-explosion','fizz-burst','popcorn-burst','enemy-crash','golden-shot','ornament-present','movie-night','spring-bloom','thorn-garden','santa-workshop','christmas-morning','giant-present','high-noon','honey-jar'].includes(effect.type)) {
                const palette={
                    'firework-burst':[effect.color||'#ff5ab5','#ffe56b','#72ddff'],'present-explosion':['#ff5572','#ffe069','#7c73ff'],
                    'fizz-burst':['#6b341c','#c6813c','#f3d29c'],'popcorn-burst':['#fff2a3','#ffd34f','#fff'],
                    'enemy-crash':['#4effc5','#d05cff','#fff'],'golden-shot':['#ffd542','#fff1a0','#ff9c32'],
                    'ornament-present':[effect.color||'#ff5361','#ffe25d','#fff'],'movie-night':['#fff0a0','#ffd252','#fff'],
                    'spring-bloom':['#ff72ae','#7ce873','#ffe56a'],
                    'thorn-garden':['#ef416e','#79d35b','#437f35'],'santa-workshop':['#ffd542','#ef4e59','#72df72'],
                    'christmas-morning':['#ef4e59','#72df72','#73dcff','#ffe45a'],'giant-present':['#ff5572','#ffe069','#7c73ff'],
                    'high-noon':['#ffd54d','#fff1a0','#ff8b32'],
                    'honey-jar':['#e9ad22','#fff0a1','#a66a17']
                }[effect.type];
                const points=effect.points?.length?effect.points:[{x:effect.x??width/2,y:effect.y??height/2}];
                ctx.globalAlpha=fade;
                for(let index=0;index<44;index+=1){const point=points[index%points.length],angle=index*2.399;const distance=(15+index%8*8)*Math.sin(progress*Math.PI);ctx.fillStyle=palette[index%palette.length];ctx.beginPath();ctx.arc(point.x+Math.cos(angle)*distance,point.y+Math.sin(angle)*distance,2+index%4,0,Math.PI*2);ctx.fill();}
            } else if (effect.type === 'egg-burst') {
                const eggColors = ['#ff8fbd','#88ddff','#a8f47c','#ffd966','#b88cff'];
                const radius = 18 + progress * 92;
                ctx.globalAlpha = fade;
                ctx.strokeStyle = effect.color || '#ff9ed8';
                ctx.lineWidth = 7 * (1 - progress) + 2;
                ctx.shadowColor = ctx.strokeStyle;
                ctx.shadowBlur = 20;
                ctx.beginPath();
                ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                for (let shard = 0; shard < 18; shard += 1) {
                    const angle = shard * Math.PI * 2 / 18 + (effect.seed || 0);
                    const distance = 8 + progress * (58 + shard % 5 * 9);
                    const x = effect.x + Math.cos(angle) * distance;
                    const y = effect.y + Math.sin(angle) * distance + progress * progress * 20;
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(angle + progress * (5 + shard % 4));
                    ctx.fillStyle = eggColors[shard % eggColors.length];
                    ctx.strokeStyle = 'rgba(255,250,225,.9)';
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(-5, -4);
                    ctx.lineTo(6, -2);
                    ctx.lineTo(1, 7);
                    ctx.lineTo(-4, 3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                    if (shard < 14) {
                        drawOnlineDefenseStar(ctx, x, y - 5, 3 + shard % 4, angle, eggColors[(shard + 2) % eggColors.length], fade);
                    }
                }
            } else if (effect.type === 'gold-rain') {
                for (let index = 0; index < 36; index += 1) {
                    const fall = (progress * 1.45 + (index * 17 % 61) / 61) % 1;
                    const x = (index * 79 + 33) % width;
                    const y = -20 + fall * (height + 40);
                    ctx.globalAlpha = fade * Math.min(1, fall * 5, (1 - fall) * 5);
                    ctx.fillStyle = '#ffe05b'; ctx.shadowColor = '#ffc42d'; ctx.shadowBlur = 10;
                    ctx.beginPath(); ctx.ellipse(x, y, 7, 4, progress * 9 + index, 0, Math.PI * 2); ctx.fill();
                }
            } else if (effect.type === 'tidal-wave') {
                const x = -180 + progress * (width + 360);
                const wave = ctx.createLinearGradient(x - 140, 0, x + 140, 0);
                wave.addColorStop(0, 'rgba(41,184,235,0)');
                wave.addColorStop(.4, 'rgba(65,221,255,.65)');
                wave.addColorStop(.55, 'rgba(225,252,255,.9)');
                wave.addColorStop(1, 'rgba(42,153,225,0)');
                ctx.globalAlpha = fade; ctx.fillStyle = wave; ctx.fillRect(x - 160, 0, 320, height);
            }
            ctx.restore();
        }
    }

    function drawOnlinePremiumDiscoBall(ctx, now, width, height) {
        const ballX=width/2,ballY=82,radius=38;
        ctx.save();ctx.strokeStyle='rgba(220,226,255,.78)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ballX,0);ctx.lineTo(ballX,ballY-radius+2);ctx.stroke();
        for(let light=0;light<9;light++){const angle=now/1250+light/9*Math.PI*2,endX=ballX+Math.cos(angle)*760,endY=ballY+Math.sin(angle)*760,px=Math.cos(angle+Math.PI/2),py=Math.sin(angle+Math.PI/2),hue=(light*44+now/22)%360,cone=ctx.createLinearGradient(ballX,ballY,endX,endY);cone.addColorStop(0,`hsla(${hue},100%,76%,.24)`);cone.addColorStop(.38,`hsla(${hue},100%,64%,.11)`);cone.addColorStop(1,`hsla(${hue},100%,55%,0)`);ctx.fillStyle=cone;ctx.beginPath();ctx.moveTo(ballX+px*5,ballY+py*5);ctx.lineTo(endX+px*55,endY+py*55);ctx.lineTo(endX-px*55,endY-py*55);ctx.closePath();ctx.fill();ctx.strokeStyle=`hsla(${hue},100%,78%,.3)`;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(ballX,ballY);ctx.lineTo(endX,endY);ctx.stroke();}
        ctx.save();ctx.beginPath();ctx.arc(ballX,ballY,radius,0,Math.PI*2);ctx.clip();const sphere=ctx.createRadialGradient(ballX-13,ballY-16,4,ballX,ballY,radius);sphere.addColorStop(0,'#fff');sphere.addColorStop(.22,'#dff5ff');sphere.addColorStop(.55,'#9c9acf');sphere.addColorStop(.82,'#4e477c');sphere.addColorStop(1,'#211b45');ctx.fillStyle=sphere;ctx.fillRect(ballX-radius,ballY-radius,radius*2,radius*2);
        for(let row=-4;row<=4;row++)for(let column=-4;column<=4;column++){const fx=ballX+column*11+(row%2)*2,fy=ballY+row*11;if(Math.hypot(fx-ballX,fy-ballY)>radius+5)continue;const hue=(column*42+row*27+now/18)%360;ctx.fillStyle=`hsla(${hue},85%,${58+((row+column+20)%3)*10}%,${.32+((row-column+20)%4)*.11})`;ctx.strokeStyle='rgba(255,255,255,.42)';ctx.lineWidth=1;ctx.fillRect(fx-4.8,fy-4.8,9.6,9.6);ctx.strokeRect(fx-4.8,fy-4.8,9.6,9.6);}ctx.restore();
        ctx.strokeStyle='rgba(239,243,255,.95)';ctx.lineWidth=3;ctx.shadowColor='#d8c8ff';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(ballX,ballY,radius,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
        for(let sparkle=0;sparkle<12;sparkle++){const angle=now/800+sparkle/12*Math.PI*2,distance=radius+8+(sparkle%3)*8,x=ballX+Math.cos(angle)*distance,y=ballY+Math.sin(angle)*distance;ctx.fillStyle='#fff';ctx.globalAlpha=.35+.6*Math.abs(Math.sin(now/190+sparkle));ctx.fillRect(x-1,y-5,2,10);ctx.fillRect(x-5,y-1,10,2);}ctx.restore();
    }

    function drawOnlineCandyCane(ctx, x, y, size, rotation, alpha = 1) {
        ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha*=alpha;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='#ff6b78';ctx.shadowBlur=Math.max(5,size*.65);
        ctx.strokeStyle='#fff8ed';ctx.lineWidth=Math.max(4,size*.34);ctx.beginPath();ctx.moveTo(0,size*.76);ctx.lineTo(0,-size*.25);ctx.bezierCurveTo(0,-size*.78,size*.72,-size*.8,size*.72,-size*.27);ctx.stroke();
        ctx.shadowBlur=0;ctx.strokeStyle='#ee4056';ctx.lineWidth=Math.max(2,size*.13);ctx.setLineDash([Math.max(3,size*.23),Math.max(3,size*.22)]);ctx.lineDashOffset=-Date.now()/75;ctx.stroke();ctx.setLineDash([]);
        ctx.strokeStyle='rgba(255,255,255,.94)';ctx.lineWidth=Math.max(1,size*.065);ctx.beginPath();ctx.moveTo(-size*.09,size*.65);ctx.lineTo(-size*.09,-size*.2);ctx.bezierCurveTo(-size*.08,-size*.55,size*.38,-size*.67,size*.56,-size*.38);ctx.stroke();ctx.restore();
    }

    function traceOnlineEgg(ctx,width,height){ctx.beginPath();ctx.moveTo(0,-height*.56);ctx.bezierCurveTo(width*.43,-height*.48,width*.58,-height*.09,width*.5,height*.23);ctx.bezierCurveTo(width*.4,height*.58,-width*.4,height*.58,-width*.5,height*.23);ctx.bezierCurveTo(-width*.58,-height*.09,-width*.43,-height*.48,0,-height*.56);ctx.closePath();}
    function drawOnlinePatternedEgg(ctx,x,y,width,height,color,rotation=0,variant=0){
        ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.shadowColor=color;ctx.shadowBlur=11;traceOnlineEgg(ctx,width,height);const shell=ctx.createLinearGradient(-width*.55,-height*.5,width*.55,height*.5);shell.addColorStop(0,'rgba(255,255,255,.96)');shell.addColorStop(.18,color);shell.addColorStop(.68,color);shell.addColorStop(1,'rgba(75,31,93,.82)');ctx.fillStyle=shell;ctx.fill();ctx.shadowBlur=0;ctx.save();traceOnlineEgg(ctx,width,height);ctx.clip();ctx.strokeStyle='rgba(255,250,216,.92)';ctx.lineWidth=Math.max(1.5,width*.12);const bandY=-height*.05+(variant%3-1)*height*.08;ctx.beginPath();ctx.moveTo(-width,bandY);for(let step=0;step<=8;step++){const px=-width+step*(width*2/8),py=bandY+(step%2?height*.09:-height*.09);ctx.lineTo(px,py);}ctx.stroke();ctx.strokeStyle='rgba(255,113,176,.78)';ctx.lineWidth=Math.max(1,width*.08);ctx.beginPath();ctx.moveTo(-width,height*.22);ctx.bezierCurveTo(-width*.35,height*.1,width*.2,height*.38,width,height*.19);ctx.stroke();ctx.fillStyle='rgba(255,238,111,.9)';for(let dot=0;dot<5;dot++){const angle=dot/5*Math.PI*2+variant;ctx.beginPath();ctx.arc(Math.cos(angle)*width*.28,Math.sin(angle)*height*.28-height*.12,Math.max(1,width*.08),0,Math.PI*2);ctx.fill();}ctx.restore();traceOnlineEgg(ctx,width,height);ctx.strokeStyle='rgba(255,252,226,.96)';ctx.lineWidth=Math.max(1.5,width*.09);ctx.stroke();ctx.fillStyle='rgba(255,255,255,.9)';ctx.beginPath();ctx.ellipse(-width*.18,-height*.26,width*.09,height*.15,-.55,0,Math.PI*2);ctx.fill();ctx.restore();
    }

    function drawOnlineTreeOrnament(ctx, tower, ornament, index, brightlyLit = false) {
        const colors={red:'#ff4059',blue:'#53cfff',green:'#5dde73',gold:'#ffd84c'};
        const positions=[[-14,-17],[13,-15],[-20,-1],[20,0],[-13,14],[12,15],[0,-25],[0,22]];
        const [offsetX,offsetY]=positions[index%positions.length],color=colors[ornament.type]||'#fff';
        ctx.save();ctx.translate(tower.x+offsetX,tower.y+offsetY);ctx.shadowColor=color;ctx.shadowBlur=brightlyLit?22:13;
        const glass=ctx.createRadialGradient(-2.5,-3,1,0,1,8);glass.addColorStop(0,'rgba(255,255,255,.98)');glass.addColorStop(.22,color);glass.addColorStop(1,'rgba(25,30,42,.86)');ctx.fillStyle=glass;ctx.strokeStyle='rgba(255,246,210,.9)';ctx.lineWidth=1.2;ctx.beginPath();
        if(ornament.type==='blue'){ctx.moveTo(0,-7);ctx.bezierCurveTo(8,-2,7,7,0,9);ctx.bezierCurveTo(-7,7,-8,-2,0,-7);}
        else if(ornament.type==='green'){ctx.moveTo(0,-8);ctx.lineTo(7,1);ctx.lineTo(0,9);ctx.lineTo(-7,1);ctx.closePath();}
        else if(ornament.type==='gold'){for(let point=0;point<10;point++){const angle=-Math.PI/2+point*Math.PI/5,length=point%2?3.5:8;if(!point)ctx.moveTo(Math.cos(angle)*length,Math.sin(angle)*length);else ctx.lineTo(Math.cos(angle)*length,Math.sin(angle)*length);}ctx.closePath();}
        else ctx.arc(0,1,7,0,Math.PI*2);
        ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#e9c66b';ctx.fillRect(-3,-10,6,4);ctx.strokeStyle='rgba(255,250,224,.95)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,-10,3.5,Math.PI,0);ctx.stroke();ctx.fillStyle='rgba(255,255,255,.9)';ctx.beginPath();ctx.ellipse(-2.5,-2,1.5,3,-.5,0,Math.PI*2);ctx.fill();ctx.restore();
    }

    function drawDefenseScene(now = Date.now()) {
        const ctx = defenseContext;
        const width = elements.onlineDefenseCanvas.width;
        const height = elements.onlineDefenseCanvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        if (now < onlineDefense.screenShakeUntil) ctx.translate((Math.random() - .5) * 10, (Math.random() - .5) * 8);
        const sky = ctx.createLinearGradient(0, 0, 0, height);
        sky.addColorStop(0, ONLINE_DEFENSE_MAP.theme.top);
        sky.addColorStop(1, ONLINE_DEFENSE_MAP.theme.bottom);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = .17;
        for (let x = 18; x < width; x += 39) for (let y = (x % 3) * 17; y < height; y += 46) {
            ctx.fillStyle = ((x + y) / 7 | 0) % 2 ? ONLINE_DEFENSE_MAP.theme.dotA : ONLINE_DEFENSE_MAP.theme.dotB;
            ctx.beginPath(); ctx.arc(x, y, 3 + ((x + y) % 5), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ONLINE_DEFENSE_MAP.path[0].x, ONLINE_DEFENSE_MAP.path[0].y);
        ONLINE_DEFENSE_MAP.path.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.strokeStyle = ONLINE_DEFENSE_MAP.theme.edge;
        ctx.lineWidth = 56;
        ctx.stroke();
        ctx.strokeStyle = ONLINE_DEFENSE_MAP.theme.path;
        ctx.lineWidth = 43;
        ctx.stroke();
        ctx.globalAlpha = .32;
        ctx.strokeStyle = '#ffdf93';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 13]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if(now<Number(onlineDefense.timedBuffs.sharkFlood||0)||now<Number(onlineDefense.timedBuffs.deepDive||0)){
            const water=ctx.createLinearGradient(0,0,0,height);water.addColorStop(0,'rgba(58,186,235,.13)');water.addColorStop(1,'rgba(10,91,171,.3)');ctx.fillStyle=water;ctx.fillRect(0,0,width,height);
        }
        if(now<Number(onlineDefense.timedBuffs.sodaFlood||0)){
            const cola=ctx.createLinearGradient(0,0,0,height);cola.addColorStop(0,'rgba(75,31,12,.36)');cola.addColorStop(.5,'rgba(96,40,13,.46)');cola.addColorStop(1,'rgba(47,18,7,.58)');ctx.fillStyle=cola;ctx.fillRect(0,0,width,height);
        }
        if(now<Number(onlineDefense.timedBuffs.dance||0)){
            ctx.fillStyle='rgba(18,10,42,.19)';ctx.fillRect(0,0,width,height);
            for(let x=0;x<width;x+=54)for(let y=0;y<height;y+=54){const pulse=.035+Math.max(0,Math.sin(now/320+(x+y)/75))*.09;ctx.fillStyle=`hsla(${(x*1.7+y+now/18)%360},88%,58%,${pulse})`;ctx.fillRect(x+2,y+2,49,49);}
        }

        const room = onlineDefense.room;
        const placements = (room?.placements || []).filter((tower) => room.mode === 'coop' || tower.ownerId === state.playerId);
        for (const trap of onlineDefense.traps) {
            const remaining = Math.max(0, Math.min(1, (trap.until - now) / Math.max(1, trap.until - trap.startedAt)));
            ctx.save();
            if (trap.type === 'giant-present') {
                const time=now/180,scale=1+Math.sin(time)*.045;ctx.translate(trap.x,trap.y);ctx.scale(scale,scale);ctx.shadowColor='#bba2ff';ctx.shadowBlur=26+Math.sin(time)*6;const box=ctx.createLinearGradient(-36,-30,36,30);box.addColorStop(0,'#5b47d9');box.addColorStop(.48,'#8e65ff');box.addColorStop(1,'#d552b5');ctx.fillStyle=box;ctx.fillRect(-38,-28,76,58);ctx.strokeStyle='rgba(255,244,196,.9)';ctx.lineWidth=3;ctx.strokeRect(-38,-28,76,58);ctx.fillStyle='#ffe15c';ctx.fillRect(-6,-28,12,58);ctx.fillRect(-38,-6,76,12);ctx.strokeStyle='#fff0a1';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(0,-28);ctx.bezierCurveTo(-35,-52,-48,-12,0,-15);ctx.bezierCurveTo(35,-52,48,-12,0,-15);ctx.stroke();ctx.shadowBlur=0;for(let sparkle=0;sparkle<14;sparkle++){const angle=time*.35+sparkle/14*Math.PI*2,distance=48+(sparkle%3)*8;ctx.fillStyle=sparkle%2?'#fff':'#ffe36c';ctx.save();ctx.translate(Math.cos(angle)*distance,Math.sin(angle)*distance*.65);ctx.rotate(angle);ctx.fillRect(-2,-6,4,12);ctx.fillRect(-6,-2,12,4);ctx.restore();}ctx.fillStyle='#fff';ctx.font='900 13px Arial';ctx.textAlign='center';ctx.shadowColor='#3a206b';ctx.shadowBlur=5;ctx.fillText('CLICK TO OPEN',0,52);ctx.shadowBlur=0;
            } else if (trap.type === 'party-present') {
                const time=now/210,scale=1+Math.sin(time)*.05;ctx.translate(trap.x,trap.y);ctx.scale(scale,scale);ctx.shadowColor='#ff78bc';ctx.shadowBlur=20+Math.sin(time)*5;const wrapping=ctx.createLinearGradient(-25,-20,25,20);wrapping.addColorStop(0,'#ff4e88');wrapping.addColorStop(.5,'#f25dc5');wrapping.addColorStop(1,'#8b63ed');ctx.fillStyle=wrapping;ctx.fillRect(-25,-19,50,39);ctx.strokeStyle='rgba(255,240,250,.88)';ctx.lineWidth=2.2;ctx.strokeRect(-25,-19,50,39);ctx.fillStyle='#ffe36d';ctx.fillRect(-4,-19,8,39);ctx.fillRect(-25,-4,50,8);ctx.strokeStyle='#fff1a2';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,-19);ctx.bezierCurveTo(-22,-36,-31,-8,0,-10);ctx.bezierCurveTo(22,-36,31,-8,0,-10);ctx.stroke();ctx.shadowBlur=0;for(let sparkle=0;sparkle<8;sparkle++){const angle=time*.3+sparkle/8*Math.PI*2,distance=31+(sparkle%2)*7;ctx.fillStyle=sparkle%2?'#fff':'#ffe878';ctx.fillRect(Math.cos(angle)*distance-1.5,Math.sin(angle)*distance*.65-1.5,3,3);}ctx.fillStyle='#fff';ctx.font='900 10px Arial';ctx.textAlign='center';ctx.shadowColor='#5c225b';ctx.shadowBlur=5;ctx.fillText('CLICK TO OPEN',0,-31);ctx.shadowBlur=0;
                const presentArt=imageForSkin('Birthday Bash Present.png');if(presentArt.complete&&presentArt.naturalWidth){ctx.drawImage(presentArt,-43,-43,86,86);ctx.fillStyle='rgba(47,18,70,.9)';ctx.fillRect(-42,-55,84,19);ctx.strokeStyle='rgba(255,232,139,.82)';ctx.lineWidth=1.5;ctx.strokeRect(-42,-55,84,19);ctx.fillStyle='#fff8d9';ctx.font='900 9px Arial';ctx.textAlign='center';ctx.fillText('CLICK TO OPEN',0,-42);}
            } else if (trap.type === 'bbq') {
                const glow = ctx.createRadialGradient(trap.x, trap.y, 3, trap.x, trap.y, 39);
                glow.addColorStop(0, 'rgba(255,202,78,.72)');
                glow.addColorStop(.38, 'rgba(200,75,24,.58)');
                glow.addColorStop(1, 'rgba(81,28,13,0)');
                ctx.globalAlpha = Math.min(1, remaining * 4);
                ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(trap.x, trap.y, 43, 25, 0, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#ffca4f'; ctx.lineWidth = 3; ctx.setLineDash([4,6]); ctx.stroke(); ctx.setLineDash([]);
                for (let ember = 0; ember < 9; ember += 1) {
                    const angle = ember * .7 + now / 430;
                    ctx.fillStyle = ember % 2 ? '#ffea73' : '#ff7b35';
                    ctx.beginPath(); ctx.arc(trap.x + Math.cos(angle) * (7 + ember * 2), trap.y + Math.sin(angle * 1.3) * 13, 2 + ember % 3, 0, Math.PI * 2); ctx.fill();
                }
            } else if (trap.type === 'egg') {
                const time=now/650;ctx.globalAlpha=Math.min(1,remaining*5);ctx.strokeStyle='#b68838';ctx.lineWidth=3;ctx.lineCap='round';for(let straw=0;straw<13;straw++){const angle=straw/13*Math.PI*2+(straw%3-.5)*.13,length=16+straw%4*3;ctx.beginPath();ctx.moveTo(trap.x+Math.cos(angle)*4,trap.y+9+Math.sin(angle)*3);ctx.lineTo(trap.x+Math.cos(angle)*length,trap.y+9+Math.sin(angle)*length*.4);ctx.stroke();}ctx.fillStyle='rgba(91,51,23,.5)';ctx.beginPath();ctx.ellipse(trap.x,trap.y+10,20,7,0,0,Math.PI*2);ctx.fill();drawOnlinePatternedEgg(ctx,trap.x,trap.y-2,20,29,trap.color,Math.sin(time)*.045,Math.floor(trap.distance||0)%7);for(let sparkle=0;sparkle<5;sparkle++){const angle=time+sparkle/5*Math.PI*2;ctx.fillStyle=sparkle%2?'#fff':'#ffe776';ctx.fillRect(trap.x+Math.cos(angle)*24-1,trap.y+Math.sin(angle)*13-6,2.5,2.5);}
            } else if (trap.type === 'flower') {
                ctx.strokeStyle='#67bd50';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(trap.x,trap.y+14);ctx.lineTo(trap.x,trap.y-8);ctx.stroke();['#ff72ae','#ffe064','#72e8ff','#c287ff'].forEach((color,index)=>{const angle=index/4*Math.PI*2;ctx.fillStyle=color;ctx.beginPath();ctx.arc(trap.x+Math.cos(angle)*9,trap.y-8+Math.sin(angle)*9,6,0,Math.PI*2);ctx.fill();});
            } else if (trap.type === 'peppermint') {
                const time=now/650,aura=ctx.createRadialGradient(trap.x,trap.y,4,trap.x,trap.y,40);aura.addColorStop(0,'rgba(236,255,241,.23)');aura.addColorStop(.55,'rgba(155,255,209,.12)');aura.addColorStop(1,'rgba(107,240,174,0)');ctx.fillStyle=aura;ctx.beginPath();ctx.arc(trap.x,trap.y,40,0,Math.PI*2);ctx.fill();
                ctx.strokeStyle='rgba(189,255,220,.48)';ctx.lineWidth=1.5;ctx.setLineDash([5,7]);ctx.beginPath();ctx.arc(trap.x,trap.y,34+Math.sin(time)*2,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
                [[-20,-3,8],[0,2,10],[21,-2,8]].forEach(([offsetX,offsetY,size],index)=>{ctx.save();ctx.translate(trap.x+offsetX,trap.y+offsetY);ctx.rotate(time*(index%2?1:-1));ctx.fillStyle='rgba(255,250,240,.88)';ctx.shadowColor='#ff6b78';ctx.shadowBlur=9;ctx.beginPath();ctx.arc(0,0,size,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(238,64,86,.95)';ctx.lineWidth=2.4;ctx.beginPath();for(let step=0;step<20;step++){const ratio=step/19,angle=ratio*Math.PI*4,radius=ratio*size*.82,px=Math.cos(angle)*radius,py=Math.sin(angle)*radius;if(!step)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.stroke();ctx.restore();});
            } else if (trap.type === 'gravity-well') {
                const time=now/520,well=ctx.createRadialGradient(trap.x,trap.y,2,trap.x,trap.y,38);well.addColorStop(0,'rgba(0,0,3,.98)');well.addColorStop(.26,'rgba(18,5,31,.95)');well.addColorStop(.58,'rgba(116,52,203,.67)');well.addColorStop(1,'rgba(110,56,205,0)');ctx.fillStyle=well;ctx.beginPath();ctx.ellipse(trap.x,trap.y,39,24,0,0,Math.PI*2);ctx.fill();
                ctx.save();ctx.translate(trap.x,trap.y);ctx.rotate(-.18);ctx.shadowColor='#aa71ff';ctx.shadowBlur=14;for(let ring=0;ring<3;ring++){ctx.strokeStyle=ring===1?'rgba(113,221,255,.72)':'rgba(226,188,255,.76)';ctx.lineWidth=3-ring*.55;ctx.beginPath();ctx.ellipse(0,0,21+ring*7,5+ring*2.4,time*(ring%2?-.7:.5)+ring*.15,0,Math.PI*2);ctx.stroke();}ctx.restore();ctx.fillStyle='#010104';ctx.beginPath();ctx.ellipse(trap.x,trap.y,10,6,0,0,Math.PI*2);ctx.fill();
            } else if (shot.style === 'easter-egg') {
                const dx = shot.x2 - shot.x1;
                const dy = shot.y2 - shot.y1;
                const distance = Math.hypot(dx, dy) || 1;
                const steps = Math.max(4, Math.min(11, Math.floor(distance / 24)));
                for (let sparkle = 1; sparkle < steps; sparkle += 1) {
                    const ratio = sparkle / steps;
                    const alpha = shotLife * ratio * .7;
                    drawOnlineDefenseStar(
                        ctx,
                        shot.x1 + dx * ratio,
                        shot.y1 + dy * ratio + Math.sin((shot.seed || 0) + sparkle * 2.1) * 4,
                        2.5 + sparkle % 3,
                        now / 260 + sparkle,
                        sparkle % 2 ? '#fff2a0' : '#b9f8ff',
                        alpha
                    );
                }
                const hue = ((shot.seed || 0) * 37) % 360;
                drawOnlinePatternedEgg(
                    ctx,
                    shot.x2,
                    shot.y2,
                    16,
                    23,
                    `hsl(${hue},88%,66%)`,
                    now / 170,
                    Math.floor((shot.seed || 0) % 7)
                );
            } else {
                const color={honey:'#e9ad22',frosting:'#ff9ed8',soda:'#6b341c',snowpile:'#eefeff',peppermint:'#ff5568','gravity-well':'#7f4dd3'}[trap.type]||'#fff';
                ctx.globalAlpha=Math.min(.82,remaining*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=13;ctx.beginPath();ctx.ellipse(trap.x,trap.y,trap.type==='gravity-well'?33:30,trap.type==='snowpile'?18:13,0,0,Math.PI*2);ctx.fill();
            }
            ctx.restore();
        }
        const hover = onlineDefense.hoverPoint;
        if (hover && onlineDefense.active && !onlineDefense.selectedPlacementId) {
            const config = DEFENSE_TOWERS[onlineDefense.selectedTower];
            const valid = distanceFromOnlineDefensePath(hover.x, hover.y) > 52 && !placements.some((tower) => Math.hypot(tower.x - hover.x, tower.y - hover.y) < 54);
            const affordable = Number(defenseMe()?.bananas || 0) >= Number(config?.cost || Infinity);
            const color = valid && affordable ? '#67f08a' : '#ff5f62';
            const label = !affordable ? 'NEED BANANAS' : valid ? 'PLACE HERE' : 'BLOCKED';
            ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(hover.x, hover.y, config?.passive === 'weather-luck' ? 48 : (config?.range || 100), 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = .9; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.setLineDash([10, 7]); ctx.stroke(); ctx.setLineDash([]);
            ctx.globalAlpha = .34; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(hover.x, hover.y, 32, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(hover.x, hover.y, 32, 0, Math.PI * 2); ctx.stroke();
            const preview = config ? imageForSkin(config.file) : null;
            if (preview?.complete && preview.naturalWidth) { ctx.globalAlpha = .8; ctx.drawImage(preview, hover.x - 27, hover.y - 27, 54, 54); }
            ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = '900 14px Arial'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(4,30,18,.9)'; ctx.strokeText(label, hover.x, hover.y - 36); ctx.fillStyle = color; ctx.fillText(label, hover.x, hover.y - 36);
            ctx.restore();
        }
        for (const tower of placements) {
            const config = DEFENSE_TOWERS[tower.towerType] || DEFENSE_TOWERS.torn;
            const stats = onlineDefenseTowerStats(tower);
            const selected = tower.id === onlineDefense.selectedPlacementId;
            const level = Math.max(1, Number(tower.level) || 1);
            if (selected) { ctx.globalAlpha = .16; ctx.fillStyle = config.color; ctx.beginPath(); ctx.arc(tower.x, tower.y, config.passive === 'weather-luck' ? 48 : stats.range, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
            ctx.fillStyle = '#2a241b'; ctx.beginPath(); ctx.arc(tower.x, tower.y, 22, 0, Math.PI * 2); ctx.fill();
            const image = imageForSkin(config.file);
            if (image.complete && image.naturalWidth) ctx.drawImage(image, tower.x - 29, tower.y - 29, 58, 58);
            else { ctx.fillStyle = config.color; ctx.beginPath(); ctx.arc(tower.x, tower.y, 23, 0, Math.PI * 2); ctx.fill(); }
            if (tower.towerType === 'christmastree') {
                const ornaments=(onlineDefense.towerOrnaments.get(tower.id)||[]).filter((ornament)=>Number(ornament.expiresAfterWave||0)>=onlineDefense.wave);
                if(ornaments.length){ctx.strokeStyle='rgba(255,223,112,.68)';ctx.lineWidth=1.7;ctx.shadowColor='#ffe27a';ctx.shadowBlur=now<Number(onlineDefense.timedBuffs.christmas||0)?15:7;ctx.beginPath();ctx.moveTo(tower.x-21,tower.y-13);ctx.bezierCurveTo(tower.x+18,tower.y-8,tower.x-20,tower.y+7,tower.x+19,tower.y+15);ctx.stroke();ctx.shadowBlur=0;}
                ornaments.forEach((ornament,index)=>drawOnlineTreeOrnament(ctx,tower,ornament,index,now<Number(onlineDefense.timedBuffs.christmas||0)));
            }
            ctx.strokeStyle = selected ? '#fff4a0' : config.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tower.x, tower.y, 24, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#fff7c5'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillText(`Lv ${level}`, tower.x, tower.y + 39);
            if(tower.towerType==='birthdaybash'){const partyTarget=Number(DEFENSE_TOWERS.birthdaybash?.partyTarget||28),meter=Math.min(partyTarget,Number(onlineDefense.towerPartyMeters.get(tower.id)||0)),readyAt=Number(onlineDefense.towerAbilityCooldowns.get(tower.id)||0),queued=meter>=partyTarget&&readyAt>now?` · READY IN ${Math.ceil((readyAt-now)/1000)}s`:'';ctx.fillStyle=meter>=partyTarget?'#ffe66b':'#ff9bcf';ctx.font='bold 9px Arial';ctx.fillText(`PARTY ${meter}/${partyTarget}${queued}`,tower.x,tower.y+50);}
        }
        onlineDefense.shots = onlineDefense.shots.filter((shot) => shot.until > now);
        for (const shot of onlineDefense.shots) {
            const shotLife = Math.max(0, (shot.until - now) / Math.max(1, shot.duration || 180));
            ctx.save(); ctx.globalAlpha = shotLife; ctx.lineCap = 'round';
            if (shot.electric) {
                const dx = shot.x2 - shot.x1, dy = shot.y2 - shot.y1;
                const length = Math.hypot(dx, dy) || 1, px = -dy / length, py = dx / length;
                const points = [{ x:shot.x1, y:shot.y1 }];
                for (let segment = 1; segment < 9; segment += 1) {
                    const ratio = segment / 9;
                    const jitter = Math.sin((shot.seed || 0) + segment * 5.7) * (5 + segment % 3 * 2);
                    points.push({ x:shot.x1 + dx * ratio + px * jitter, y:shot.y1 + dy * ratio + py * jitter });
                }
                points.push({ x:shot.x2,y:shot.y2 });
                ctx.strokeStyle = '#43c9ff'; ctx.lineWidth = 11; ctx.shadowColor = '#58eaff'; ctx.shadowBlur = 25;
                ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
                ctx.strokeStyle = '#f4fdff'; ctx.lineWidth = 3; ctx.shadowBlur = 6; ctx.stroke();
                ctx.fillStyle = '#ecffff'; ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 5 + (1 - shotLife) * 10, 0, Math.PI * 2); ctx.fill();
            } else {
                ctx.strokeStyle = '#fff'; ctx.lineWidth = shot.neon ? 9 : 5; ctx.shadowColor = shot.color; ctx.shadowBlur = shot.neon ? 24 : 12;
                ctx.beginPath(); ctx.moveTo(shot.x1, shot.y1); ctx.lineTo(shot.x2, shot.y2); ctx.stroke();
                ctx.strokeStyle = shot.color; ctx.lineWidth = shot.neon ? 4 : 2; ctx.shadowBlur = 0; ctx.stroke();
                if (shot.neon) {
                    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 5 + (1 - shotLife) * 5, 0, Math.PI * 2); ctx.fill();
                }
                if (shot.style === 'candy-cane') {
                    drawOnlineCandyCane(ctx,shot.x2,shot.y2,13,now/115,shotLife);
                } else if (shot.style === 'dark-matter') {
                    const aura=ctx.createRadialGradient(shot.x2,shot.y2,2,shot.x2,shot.y2,17);aura.addColorStop(0,'#000');aura.addColorStop(.32,'#170524');aura.addColorStop(.63,'rgba(138,68,240,.86)');aura.addColorStop(1,'rgba(95,34,190,0)');ctx.fillStyle=aura;ctx.beginPath();ctx.arc(shot.x2,shot.y2,17,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e3b8ff';ctx.lineWidth=2.5;ctx.beginPath();ctx.ellipse(shot.x2,shot.y2,15,5,now/120,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#010104';ctx.beginPath();ctx.arc(shot.x2,shot.y2,6,0,Math.PI*2);ctx.fill();
                } else if (shot.style === 'soda-can') {
                    ctx.save();ctx.translate(shot.x2,shot.y2);ctx.rotate(Math.atan2(shot.y2-shot.y1,shot.x2-shot.x1));ctx.fillStyle='#6b341b';ctx.shadowColor='#d7934e';ctx.shadowBlur=12;ctx.fillRect(-10,-6,20,12);ctx.fillStyle='#d9c3a4';ctx.fillRect(-9,-6,3,12);ctx.fillRect(6,-6,3,12);ctx.fillStyle='#f1d49a';ctx.font='bold 6px Arial';ctx.textAlign='center';ctx.fillText('COLA',0,2);ctx.restore();
                }
            }
            ctx.restore();
        }
        for (const enemy of onlineDefense.enemies) {
            const pathPoint = onlineDefensePathPoint(enemy.distance);
            const point = enemy.singularityCapturedUntil > now
                ? { x:Number(enemy.singularityDisplayX ?? pathPoint.x), y:Number(enemy.singularityDisplayY ?? pathPoint.y) }
                : pathPoint;
            enemy.x = point.x; enemy.y = point.y;
            const airborneDuration=Math.max(1,Number(enemy.airborneUntil||0)-Number(enemy.airborneStartedAt||0));
            const airborneProgress=enemy.airborneUntil>now?Math.max(0,Math.min(1,(now-enemy.airborneStartedAt)/airborneDuration)):0;
            const displayY=point.y-(enemy.airborneUntil>now?Math.sin(airborneProgress*Math.PI)*64:0);
            const radius = enemy.boss ? 29 : enemy.treasure ? 18 : enemy.pest?.kind === 'elite' ? 20 : enemy.pest?.kind === 'armored' ? 17 : enemy.pest?.kind === 'runner' ? 11 : 14;
            ctx.save();
            ctx.translate(point.x, displayY);
            if(enemy.singularityCapturedUntil>now)ctx.scale(Number(enemy.singularityScale||1),Number(enemy.singularityScale||1));
            if(enemy.flickerUntil>now&&Math.floor(now/55+enemy.distance)%3===0)ctx.globalAlpha=.28;
            ctx.shadowColor = enemy.boss || enemy.treasure ? '#ffca45' : 'transparent';
            ctx.shadowBlur = enemy.boss ? 18 : enemy.treasure ? 13 : 0;
            ctx.fillStyle = enemy.jamUntil > now ? '#ffad4d' : enemy.poisonUntil > now ? '#85e35e' : enemy.slowUntil > now ? '#7bdcff' : enemy.boss ? '#8d3154' : enemy.treasure ? '#ffd84f' : (enemy.pest?.color || '#c64758');
            ctx.beginPath(); ctx.arc(0, 0, radius + 2, 0, Math.PI * 2); ctx.fill();
            const pestImage = imageForSkin(enemy.pest?.file || 'Zombie Monkey.png');
            if (pestImage.complete && pestImage.naturalWidth) { const size = radius * 2.55; ctx.drawImage(pestImage, -size / 2, -size / 2, size, size); }
            if (enemy.boss) {
                ctx.fillStyle = '#ffe16a';
                ctx.font = '900 15px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('BOSS', 0, -radius - 12);
            } else if (enemy.treasure) {
                ctx.fillStyle = '#fff3a0';
                ctx.font = '900 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('TREASURE', 0, -radius - 10);
            }
            if(enemy.corruptionUntil>now){ctx.globalAlpha=.72;for(let pixel=0;pixel<9;pixel++){ctx.fillStyle=pixel%2?'#55ffd1':'#ce58ff';ctx.fillRect(((pixel*17+Math.floor(now/70))%36)-18,((pixel*23+Math.floor(now/90))%36)-18,4+pixel%3,4+(pixel+1)%3);}}
            if(enemy.weakPoint>=3){const angle=now/420+enemy.weakPoint,wx=Math.cos(angle)*radius*.72,wy=Math.sin(angle)*radius*.55;ctx.globalAlpha=1;ctx.fillStyle='#fff2a1';ctx.strokeStyle='#ff563f';ctx.lineWidth=3;ctx.beginPath();ctx.arc(wx,wy,7+Math.sin(now/120)*2,0,Math.PI*2);ctx.fill();ctx.stroke();}
            ctx.restore();
            const barWidth = enemy.boss ? 62 : 38;
            ctx.fillStyle = '#35121a'; ctx.fillRect(point.x - barWidth / 2, displayY - radius - 10, barWidth, 6);
            ctx.fillStyle = enemy.boss ? '#ffe16a' : '#69e97b'; ctx.fillRect(point.x - barWidth / 2, displayY - radius - 10, barWidth * Math.max(0, enemy.hp / enemy.maxHp), 6);
        }
        drawOnlineDefenseEffects(ctx, now);
        drawOnlineDefenseWeather(ctx, now);
        if(now<Number(onlineDefense.timedBuffs.sharkFlood||0)||now<Number(onlineDefense.timedBuffs.deepDive||0)){
            ctx.strokeStyle='rgba(190,249,255,.5)';ctx.lineWidth=2;for(let i=0;i<45;i++){const x=(i*91)%width,y=(i*57-now/14)%height;ctx.beginPath();ctx.arc(x,(y+height)%height,3+i%5,0,Math.PI*2);ctx.stroke();}
        }
        if(now<Number(onlineDefense.timedBuffs.snowstorm||0)||now<Number(onlineDefense.timedBuffs.christmas||0)){const storm=now<Number(onlineDefense.timedBuffs.snowstorm||0);ctx.fillStyle='#fff';for(let i=0;i<(storm?105:62);i++){ctx.beginPath();ctx.arc((i*79+Math.sin(now/250+i)*35)%width,(i*53+now/(storm?12:18))%height,storm?2+i%4:1+i%3,0,Math.PI*2);ctx.fill();}}
        if(now<Number(onlineDefense.timedBuffs.sodaFlood||0)){ctx.strokeStyle='rgba(255,224,174,.68)';ctx.lineWidth=1.5;for(let i=0;i<82;i++){const x=(i*83+Math.sin(now/420+i)*18)%width,y=(i*47-now/(8+i%5)+height)%height;ctx.beginPath();ctx.arc(x,y,2+i%7,0,Math.PI*2);ctx.stroke();}}
        if(now<Number(onlineDefense.timedBuffs.dance||0))drawOnlinePremiumDiscoBall(ctx,now,width,height);
        if(now<Number(onlineDefense.timedBuffs.blueScreen||0)){
            const reduced=Boolean(window.gameAccessibility?.reducedFlashing);ctx.fillStyle=reduced?'rgba(16,14,45,.08)':'rgba(7,10,35,.15)';ctx.fillRect(0,0,width,height);
            ctx.save();for(let tear=0;tear<(reduced?4:9);tear++){const y=(tear*83+Math.floor(now/85)*37)%height,tearHeight=3+(tear*7)%14,offset=Math.sin(now/75+tear*4.7)*(8+tear%4*5);ctx.globalAlpha=.16;ctx.drawImage(elements.onlineDefenseCanvas,0,y,width,tearHeight,offset,y,width,tearHeight);ctx.fillStyle=tear%2?'rgba(72,255,207,.2)':'rgba(229,63,255,.17)';ctx.fillRect(offset,y,width,tearHeight);}ctx.restore();
            for(let block=0;block<(reduced?20:46);block++){const cell=Math.floor(now/(110+block%4*24)),x=(block*137+cell*61)%width,y=(block*73+cell*29)%height,size=3+(block*5)%13;ctx.fillStyle=block%3===0?'rgba(226,65,255,.34)':block%3===1?'rgba(64,255,202,.32)':'rgba(107,112,255,.25)';ctx.fillRect(x,y,size*1.8,size);}
            ctx.fillStyle='rgba(78,255,211,.05)';for(let y=0;y<height;y+=5)ctx.fillRect(0,y,width,1);ctx.strokeStyle='rgba(84,255,208,.28)';ctx.lineWidth=3;ctx.setLineDash([18,9,4,13]);ctx.strokeRect(7,7,width-14,height-14);ctx.setLineDash([]);
        }
        ctx.fillStyle = 'rgba(9,40,23,.85)'; ctx.beginPath(); ctx.roundRect(15, 15, 310, 58, 11); ctx.fill();
        ctx.textAlign = 'left'; ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#ffef91';
        ctx.fillText(onlineDefense.awaitingWaveStart ? 'Build phase — ready the grove' : `Wave ${onlineDefense.wave}: ${onlineDefense.enemies.length + onlineDefense.spawnRemaining} Invaders`, 28, 41);
        ctx.font = 'bold 11px Arial'; ctx.fillStyle = '#cce7c1'; ctx.fillText(`${room?.ranked ? 'Ranked' : 'Private'} ${room?.mode === 'coop' ? 'Co-op' : 'Versus'} · Every fifth wave brings a boss`, 28, 61);
        if (onlineDefense.active && now < onlineDefense.localStartAt) {
            const seconds = Math.max(1, Math.ceil((onlineDefense.localStartAt - now) / 1000));
            ctx.fillStyle = 'rgba(0,20,14,.72)'; ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#ffe36b'; ctx.textAlign = 'center'; ctx.font = '1000 72px sans-serif'; ctx.fillText(String(seconds), width / 2, height / 2);
            ctx.font = '900 20px sans-serif'; ctx.fillText('GET YOUR DEFENDERS READY', width / 2, height / 2 + 42); ctx.textAlign = 'left';
        }
        ctx.restore();
    }

    function reportDefenseProgress(force = false) {
        const room = onlineDefense.room;
        if (!room || !onlineDefense.active) return;
        if (room.mode === 'coop' && room.simulationOwnerId !== state.playerId) return;
        const now = Date.now();
        if (!force && now - onlineDefense.lastProgressAt < 500) return;
        onlineDefense.lastProgressAt = now;
        send({
            type: 'defense_progress',
            wave: onlineDefense.wave,
            clearedWave: onlineDefense.clearedWave,
            bananasEarned: onlineDefense.bananaRewardsEarned,
            lives: onlineDefense.lives,
            score: onlineDefense.score,
            defeated: onlineDefense.lives <= 0,
            victory: onlineDefense.completed
        });
    }

    function useOnlineDefensePower(id) {
        const power = onlineDefense.powers[id];
        if (!onlineDefense.active || !power || power.uses <= 0 || onlineDefense.wave < power.readyWave) return;
        const now = Date.now();
        if (id === 'repair') {
            if (onlineDefense.lives >= 20) { elements.odGameError.textContent = 'Grove Hearts are already full. No ability use was spent.'; return; }
            onlineDefense.lives = Math.min(20, onlineDefense.lives + 4);
            power.readyWave = onlineDefense.wave + 3;
            elements.odDefenseStatus.textContent = 'Grove Repair restored 4 hearts.';
        } else if (id === 'freeze') {
            if (onlineDefense.awaitingWaveStart || !onlineDefense.enemies.length) { elements.odGameError.textContent = 'Track Freeze needs an active wave with Monkey Invaders on the map.'; return; }
            onlineDefense.globalFreezeUntil = now + 2000 / Math.max(1, onlineDefense.simulationSpeed);
            power.readyWave = onlineDefense.wave + 4;
            elements.odDefenseStatus.textContent = 'Track Freeze activated for 2 seconds!';
        } else if (id === 'bomb') {
            if (onlineDefense.awaitingWaveStart || !onlineDefense.enemies.length) { elements.odGameError.textContent = 'Banana Bomb needs active Monkey Invaders on the map.'; return; }
            const damage = Math.min(160, 24 + onlineDefense.wave * 1.8);
            for (const enemy of onlineDefense.enemies) enemy.hp -= damage * (enemy.boss ? .45 : 1);
            power.readyWave = onlineDefense.wave + 5;
            elements.odDefenseStatus.textContent = `Banana Bomb hit every active Monkey Invader for up to ${Math.round(damage)} damage.`;
        } else if (id === 'rally') {
            const placements = onlineDefense.room?.placements || [];
            if (onlineDefense.awaitingWaveStart || !placements.length) { elements.odGameError.textContent = 'Tower Rally needs an active wave and at least one defender.'; return; }
            onlineDefense.rallyUntil = now + 8000 / Math.max(1, onlineDefense.simulationSpeed);
            power.readyWave = onlineDefense.wave + 5;
            elements.odDefenseStatus.textContent = 'Tower Rally activated: +35% damage and faster attacks for 8 seconds!';
        } else return;
        power.uses -= 1;
        elements.odGameError.textContent = '';
        updateDefenseHud();
        reportDefenseProgress(true);
    }

    function rollOnlineDefenseWeather(wave, now) {
        const placements = (onlineDefense.room?.placements || []).filter((tower) => onlineDefense.room?.mode === 'coop' || tower.ownerId === state.playerId);
        const clovers = placements.filter((tower) => DEFENSE_TOWERS[tower.towerType]?.passive === 'weather-luck');
        const luck = clovers.reduce((total, tower) => total + Number(onlineDefenseTowerStats(tower).weatherLuck || 0), 0);
        const gapReduction = clovers.reduce((total, tower) => total + Number(onlineDefenseTowerStats(tower).weatherGapReduction || 0), 0);
        const minimumGap = Math.max(1, 4 - Math.min(3, gapReduction));
        const baseChance = .12;
        const chance = Math.min(.62, baseChance + luck);
        const roll = Math.random();
        const allowed = wave - onlineDefense.lastWeatherWave >= minimumGap;
        if (!allowed || roll >= chance) {
            onlineDefense.weather = null;
            return;
        }
        const weatherOptions = [
            { id:'rain', name:'Tropical Rain', description:'Water, Electric, and Lightning gain power; Firework, BBQ, and Sun are weakened.' },
            { id:'snow', name:'Frost Front', description:'Snow, Ice, Rock, and Cracked gain power; Molten, BBQ, and Sun are weakened.' },
            { id:'heat', name:'Heatwave', description:'Molten, Firework, BBQ, and Sun gain power; Water, Honey, Neon, and Electric weaken.' },
            { id:'thunder', name:'Thunderstorm', description:'Cyborg, Soldier, Neon, Electric, and Lightning gain power but all ranges tighten.' },
            { id:'fog', name:'Rolling Fog', description:'Ranges shrink while Boxer, Shark, Rock, Cracked, and BBQ gain close-range damage.' },
            { id:'wind', name:'Trade Winds', description:'Cupid, Ninja, and Neon speed up while launched projectiles slow down.' },
            { id:'rainbow', name:'Rainbow Sky', description:"Pot O' Gold, Leprechaun, Egg Hunt, and Easter gain power." }
        ];
        onlineDefense.weather = weatherOptions[(wave * 7 + Math.floor(roll * 1000)) % weatherOptions.length];
        onlineDefense.lastWeatherWave = wave;
        const cloverTriggered = clovers.length > 0 && roll >= baseChance;
        if (cloverTriggered) {
            onlineDefense.effects.push({ type:'clover-luck', startedAt:now, until:now + 3600 });
            elements.odDefenseStatus.textContent = `Four Leaf Clover luck triggered ${onlineDefense.weather.name}! ${onlineDefense.weather.description}`;
        } else {
            elements.odDefenseStatus.textContent = `${onlineDefense.weather.name} weather event! ${onlineDefense.weather.description}`;
        }
    }

    function onlineDefenseWaveBaseHealth(wave) {
        const balancedWave = Math.max(1, Number(wave) || 1);
        const earlyWave = Math.min(balancedWave, 25);
        const middleWaves = Math.min(25, Math.max(0, balancedWave - 25));
        const lateWaves = Math.max(0, balancedWave - 50);
        const earlyHealth = 22 * Math.pow(1.075, earlyWave - 1) + earlyWave * 9;
        const middleHealth = earlyHealth * Math.pow(1.025, middleWaves) + middleWaves * 4;
        return Math.round(middleHealth * Math.pow(1.011, lateWaves) + lateWaves * 3);
    }

    function onlineDefenseBossHealthMultiplier(wave) {
        const balancedWave = Math.max(1, Number(wave) || 1);
        return 3.45
            + Math.min(balancedWave, 25) * .07
            + Math.min(75, Math.max(0, balancedWave - 25)) * .035
            + Math.max(0, balancedWave - 100) * .012;
    }

    function beginOnlineDefenseWave(wave, startedAt = Date.now()) {
        const targetWave = Number(onlineDefense.room?.targetWave || 100);
        const nextWave = Math.max(1, Math.min(targetWave, Math.floor(Number(wave) || onlineDefense.wave + 1)));
        if (!onlineDefense.awaitingWaveStart && nextWave <= onlineDefense.wave) return;
        onlineDefense.wave = nextWave;
        onlineDefense.spawnRemaining = Math.min(360, 7 + nextWave * 3 + Math.floor(nextWave / 3) + (nextWave % 5 === 0 ? 1 : 0));
        onlineDefense.spawnedThisWave = 0;
        onlineDefense.treasureIndex = nextWave >= 5 && Math.random() < .035
            ? Math.floor(Math.random() * Math.max(1, onlineDefense.spawnRemaining - 1))
            : -1;
        onlineDefense.nextSpawnAt = Math.max(Date.now(), Number(startedAt) || Date.now());
        onlineDefense.awaitingWaveStart = false;
        rollOnlineDefenseWeather(nextWave, Number(startedAt) || Date.now());
        if (!onlineDefense.weather) elements.odDefenseStatus.textContent = nextWave % 5 === 0 ? `Boss wave ${nextWave} has started!` : `Wave ${nextWave} is underway.`;
    }

    function damageOnlineDefenseEnemy(enemy, damage, towerType) {
        if (!enemy || enemy.hp <= 0) return;
        enemy.hp -= Math.max(0, Number(damage) || 0);
        if (towerType) enemy.lastHitTowerType = towerType;
    }

    function applyOnlineControlledGravityPull(enemy, requestedDistance, now, immunityMs = 1400, forcePulse = false) {
        if (!enemy || enemy.hp <= 0 || (!forcePulse && Number(enemy.gravityPullImmuneUntil || 0) > now)) return 0;
        if (Number(enemy.gravityPullWindowUntil || 0) <= now) {
            enemy.gravityPullWindowUntil = now + 5000;
            enemy.gravityPulledDistance = 0;
        }
        const windowCap = enemy.boss ? 14 : 44;
        const resistance = enemy.boss ? .32 : 1;
        const amount = Math.max(0, Math.min(
            Number(requestedDistance || 0) * resistance,
            Math.max(0, windowCap - Number(enemy.gravityPulledDistance || 0)),
            Number(enemy.distance || 0)
        ));
        enemy.gravityPullImmuneUntil = Math.max(Number(enemy.gravityPullImmuneUntil || 0), now + immunityMs * (enemy.boss ? 1.45 : 1));
        if (amount <= 0) return 0;
        enemy.gravityPulledDistance = Number(enemy.gravityPulledDistance || 0) + amount;
        enemy.distance = Math.max(0, Number(enemy.distance || 0) - amount);
        return amount;
    }

    function addOnlineDefenseEffect(type, now, duration, details = {}) {
        onlineDefense.effects.push({ type, startedAt:now, until:now + duration, ...details });
        if (onlineDefense.effects.length > 24) onlineDefense.effects.splice(0, onlineDefense.effects.length - 24);
    }

    function findOpenOnlineDefensePickupPoint(preferred = null) {
        const towers = onlineDefense.room?.placements || [];
        const pickups = onlineDefense.traps.filter((trap) => ['party-present','giant-present'].includes(trap.type) && trap.until > Date.now());
        const pathClearance = (point) => {
            let nearest = Infinity;
            for (let step = 0; step <= 80; step += 1) {
                const pathPoint = onlineDefensePathPoint(onlineDefensePathLength * step / 80);
                nearest = Math.min(nearest, Math.hypot(point.x - pathPoint.x, point.y - pathPoint.y));
            }
            return nearest;
        };
        const candidates = [
            ...(preferred ? [preferred] : []),
            ...Array.from({ length:90 }, () => ({ x:72 + Math.random() * 756, y:72 + Math.random() * 456 }))
        ];
        return candidates
            .map((point) => {
                const towerGap = towers.length ? Math.min(...towers.map((tower) => Math.hypot(point.x - tower.x, point.y - tower.y))) : 999;
                const pickupGap = pickups.length ? Math.min(...pickups.map((pickup) => Math.hypot(point.x - pickup.x, point.y - pickup.y))) : 999;
                const pathGap = pathClearance(point);
                const edgeGap = Math.min(point.x, 900 - point.x, point.y, 600 - point.y);
                const valid = towerGap >= 92 && pickupGap >= 70 && pathGap >= 52 && edgeGap >= 55;
                return { point, valid, score:Math.min(towerGap, pickupGap) + pathGap * .55 + edgeGap * .2 };
            })
            .sort((left, right) => Number(right.valid) - Number(left.valid) || right.score - left.score)[0]?.point
            || { x:450, y:300 };
    }

    function activateOnlineDefenseSpecial(tower, stats, target, now) {
        const towerType = tower.towerType;
        if (stats.special === 'honey-patch') {
            const distance = Math.max(0, Math.min(onlineDefensePathLength, target.distance + (Math.random() - .5) * 34));
            const point = onlineDefensePathPoint(distance);
            onlineDefense.traps.push({ type:'honey', distance, x:point.x, y:point.y, damage:stats.damage, towerType, startedAt:now, until:now + 6000 });
            addOnlineDefenseEffect('honey-jar', now, 900, { x:point.x, y:point.y });
            elements.odDefenseStatus.textContent = 'Honey Monkey smashed a honey jar onto the trail!';
        } else if (stats.special === 'bbq-patch') {
            const distance = Math.max(0, Math.min(onlineDefensePathLength, target.distance + (Math.random() - .5) * 50));
            const point = onlineDefensePathPoint(distance);
            onlineDefense.traps.push({ type:'bbq', distance, x:point.x, y:point.y, damage:stats.damage, towerType, startedAt:now, until:now + 7000 });
            elements.odDefenseStatus.textContent = 'BBQ Monkey tossed a sizzling patch onto the Invader trail!';
        } else if (stats.special === 'egg-trap') {
            const distance = Math.random() * onlineDefensePathLength;
            const point = onlineDefensePathPoint(distance);
            const roll = Math.random();
            const eggEffect = roll < .05 ? 'heart' : roll < .25 ? 'nothing' : roll < .5 ? 'slow' : roll < .75 ? 'freeze' : 'explosion';
            const colors = ['#ff8fb8','#88ddff','#a8f47c','#ffd966','#bd91ff'];
            onlineDefense.traps.push({ type:'egg', distance, x:point.x, y:point.y, damage:stats.damage, towerType, eggEffect, color:colors[Math.floor(Math.random() * colors.length)], startedAt:now, until:now + 15000 });
            elements.odDefenseStatus.textContent = 'Easter Monkey hid a mystery egg somewhere along the trail!';
        } else if (stats.special === 'sun-rays') {
            const targets = onlineDefense.enemies.filter((enemy) => enemy.hp > 0).sort((a, b) => b.distance - a.distance).slice(0, 5);
            targets.forEach((enemy) => damageOnlineDefenseEnemy(enemy, stats.damage, towerType));
            addOnlineDefenseEffect('sun-rays', now, 2500, { points:targets.map((enemy) => onlineDefensePathPoint(enemy.distance)) });
            elements.odDefenseStatus.textContent = `Sun Monkey scorched ${targets.length} leading Invader${targets.length === 1 ? '' : 's'} with heat rays!`;
        } else if (stats.special === 'rainbow-stars') {
            const targets = onlineDefense.enemies.filter((enemy) => enemy.hp > 0).sort((a, b) => b.distance - a.distance).slice(0, 6);
            const points = targets.map((enemy) => onlineDefensePathPoint(enemy.distance));
            addOnlineDefenseEffect('rainbow-stars', now, 4300, {
                points,
                targets,
                damage:stats.damage,
                towerType,
                landed:false,
                stars:Array.from({ length:24 }, (_, index) => {
                    const point = points[index % Math.max(1, points.length)] || { x:(index * 71) % 900, y:360 };
                    return { x:Math.max(20, Math.min(880, point.x + ((index * 47) % 75) - 37)), y:point.y, delay:((index * 17) % 105) / 260, size:7 + index % 5, sway:((index * 29) % 23) - 11 };
                })
            });
            elements.odDefenseStatus.textContent = `Leprechaun Monkey rained rainbow stars onto ${targets.length} Invader${targets.length === 1 ? '' : 's'}!`;
        } else if (stats.special === 'lightning-storm') {
            const targets = onlineDefense.enemies.filter((enemy) => enemy.hp > 0).sort((a, b) => b.distance - a.distance).slice(0, 4);
            targets.forEach((enemy, index) => {
                damageOnlineDefenseEnemy(enemy, stats.damage * Math.pow(.84, index), towerType);
                enemy.slowFactor = Math.min(Number(enemy.slowFactor || 1), .82);
                enemy.slowUntil = Math.max(enemy.slowUntil, now + 900);
            });
            addOnlineDefenseEffect('lightning-storm', now, 2700, { points:targets.map((enemy) => onlineDefensePathPoint(enemy.distance)), seed:Math.random() * 1000 });
            elements.odDefenseStatus.textContent = `Lightning Monkey called a storm and chained through ${targets.length} Invader${targets.length === 1 ? '' : 's'}!`;
        } else if (stats.special === 'earthquake') {
            const targets = onlineDefense.enemies.filter((enemy) => enemy.hp > 0);
            targets.forEach((enemy) => {
                damageOnlineDefenseEnemy(enemy, stats.damage * (enemy.boss ? .65 : 1), towerType);
                enemy.slowFactor = Math.min(Number(enemy.slowFactor || 1), .72);
                enemy.slowUntil = Math.max(enemy.slowUntil, now + 1200);
            });
            onlineDefense.screenShakeUntil = Math.max(onlineDefense.screenShakeUntil, now + 700);
            addOnlineDefenseEffect('earthquake', now, 2600, { points:targets.slice(0, 5).map((enemy) => onlineDefensePathPoint(enemy.distance)), seed:Math.random() * 10 });
            elements.odDefenseStatus.textContent = `Cracked Monkey shook the map and hit ${targets.length} Invader${targets.length === 1 ? '' : 's'}!`;
        } else if (stats.special === 'gold-rain' || stats.special === 'tidal-wave') {
            onlineDefense.enemies.forEach((enemy) => damageOnlineDefenseEnemy(enemy, stats.damage * (enemy.boss ? .72 : 1), towerType));
            addOnlineDefenseEffect(stats.special, now, stats.special === 'gold-rain' ? 2200 : 1900);
            elements.odDefenseStatus.textContent = stats.special === 'gold-rain' ? "Pot O' Gold Monkey activated Gold Rain!" : 'Sea Shore Monkey summoned a tidal wave!';
        }
        if (onlineDefense.traps.length > 36) onlineDefense.traps.splice(0, onlineDefense.traps.length - 36);
    }

    function activateOnlineDefenseAbility(tower, stats, target, now) {
        const living = onlineDefense.enemies.filter((enemy) => enemy.hp > 0);
        if (!living.length) return false;
        const type = stats.ability;
        const effect = (duration = 3000, details = {}) => addOnlineDefenseEffect(type, now, duration, {
            points:living.slice(0, 14).map((enemy) => onlineDefensePathPoint(enemy.distance)), ...details
        });
        if (type === 'shark-attack') {
            onlineDefense.timedBuffs.sharkFlood = now + 7500;
            const count = 1 + Math.floor(Math.random() * 4);
            living.sort(() => Math.random() - .5).slice(0, count).forEach((enemy) => {
                damageOnlineDefenseEnemy(enemy, stats.damage * 1.75, tower.towerType);
                enemy.slowFactor = Math.min(enemy.slowFactor, .72); enemy.slowUntil = Math.max(enemy.slowUntil, now + 7500);
                enemy.drownAt = now + 3500; enemy.drownUntil = now + 7500; enemy.drownDamagePerSecond = stats.damage * .18; enemy.drownTowerType = tower.towerType;
            });
            effect(7500); elements.odDefenseStatus.textContent = `SHARK ATTACK flooded the map and bit ${count} Invaders!`;
        } else if (type === 'snowstorm') {
            onlineDefense.timedBuffs.snowstorm = now + 7500;
            for (let index=0;index<8;index+=1){const distance=onlineDefensePathLength*(.08+index*.115),point=onlineDefensePathPoint(distance);onlineDefense.traps.push({type:'snowpile',distance,...point,damage:stats.damage*.035,towerType:tower.towerType,startedAt:now,until:now+7500});}
            effect(7500); elements.odDefenseStatus.textContent = 'Snow Monkey started a 7.5-second freezing snowstorm!';
        } else if (type === 'birthday-party') {
            onlineDefense.towerPartyMeters.set(tower.id, 0);
            onlineDefense.timedBuffs.birthday = now + 5000; effect(5000);
            if(Math.random()<.22){const point=findOpenOnlineDefensePickupPoint();onlineDefense.traps.push({type:'party-present',...point,startedAt:now,until:now+9000});}
            elements.odDefenseStatus.textContent = 'Birthday Party! Every defender attacks 22% faster.';
        } else if (type === 'movie-night') {
            living.forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage*.55,tower.towerType));effect(4500);elements.odDefenseStatus.textContent='Movie Night filled the map with controlled popping damage!';
        } else if (type === 'spring-bloom') {
            living.slice(0,12).forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage*.8,tower.towerType));effect(2500);elements.odDefenseStatus.textContent='Spring Bloom erupted nearby flowers into thorns!';
        } else if (type === 'giant-present') {
            const preferred={x:Math.max(85,Math.min(815,tower.x+(Math.random()-.5)*300)),y:Math.max(95,Math.min(505,tower.y+(Math.random()-.5)*240))},point=findOpenOnlineDefensePickupPoint(preferred);onlineDefense.traps.push({type:'giant-present',...point,damage:stats.damage,towerType:tower.towerType,startedAt:now,until:now+10000});effect(1800,point);elements.odDefenseStatus.textContent='GIANT PRESENT! Click the enormous gift within 10 seconds for several rewards and buffs.';
        } else if (type === 'deep-dive') {
            onlineDefense.timedBuffs.deepDive=now+5000;effect(5000);elements.odDefenseStatus.textContent='Deep Dive flooded the map and briefly boosted water defenders!';
        } else if (type === 'soda-geyser') {
            onlineDefense.timedBuffs.sodaFlood=now+5000;living.forEach((enemy)=>{enemy.jamUntil=Math.max(enemy.jamUntil,now+500);enemy.airborneStartedAt=now;enemy.airborneUntil=now+1200;damageOnlineDefenseEnemy(enemy,stats.damage*.4,tower.towerType);});effect(5000);elements.odDefenseStatus.textContent='Soda Geyser briefly flooded the battlefield and launched the Invaders!';
        } else if (type === 'peppermint-storm') {
            living.forEach((enemy,index)=>damageOnlineDefenseEnemy(enemy,stats.damage*(index < 6 ? .75 : .35),tower.towerType));addOnlineDefenseEffect('peppermint-shockwave',now,1800,{x:tower.x,y:tower.y,seed:Math.random()*1000});effect(4000,{x:tower.x,y:tower.y,seed:Math.random()*1000});elements.odDefenseStatus.textContent='Peppermint Storm rained candy canes across the map!';
        } else if (type === 'thorn-garden') {
            living.forEach((enemy)=>{enemy.jamUntil=Math.max(enemy.jamUntil,now+1500);enemy.roseUntil=now+4000;enemy.roseDamagePerSecond=Math.max(Number(enemy.roseDamagePerSecond||0),stats.damage*.18);enemy.roseTowerType=tower.towerType;});effect(4000);elements.odDefenseStatus.textContent='Thorn Garden briefly trapped and damaged the invasion!';
        } else if (type === 'santa-workshop') {
            onlineDefense.timedBuffs.workshop=now+5000;living.slice(0,6).forEach((enemy,index)=>{damageOnlineDefenseEnemy(enemy,stats.damage*(1.15+index%3*.25),tower.towerType);if(index%3===0)enemy.jamUntil=Math.max(enemy.jamUntil,now+900);});effect(5000);elements.odDefenseStatus.textContent="Santa's Workshop released a short wave of golden toys!";
        } else if (type === 'christmas-morning') {
            onlineDefense.timedBuffs.christmas=now+5000;living.forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage*.35,tower.towerType));effect(5000);elements.odDefenseStatus.textContent='Christmas Morning lit the tree and gave each defender one modest festive buff!';
        } else if (type === 'dance-floor') {
            onlineDefense.timedBuffs.dance=now+5000;living.forEach((enemy)=>enemy.jamUntil=Math.max(enemy.jamUntil,now+400));effect(5000);elements.odDefenseStatus.textContent='Dance Floor briefly synchronized every defender!';
        } else if (type === 'high-noon') {
            living.forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage,tower.towerType));effect(1800);elements.odDefenseStatus.textContent=`HIGH NOON fired once at all ${living.length} Invaders!`;
        } else if (type === 'screen-punch') {
            effect(3000,{x:468,y:286,targets:living.slice(),damage:stats.damage*2.35,towerType:tower.towerType,seed:Math.random()*1000});elements.odDefenseStatus.textContent=`SCREEN PUNCH is winding up against all ${living.length} on-screen Invaders!`;
        } else if (type === 'boss-slayer') {
            const boss=living.filter((enemy)=>enemy.boss).sort((a,b)=>b.hp-a.hp)[0]||living.sort((a,b)=>b.hp-a.hp)[0];onlineDefense.towerBossSlayerUntil.set(tower.id,now+5000);damageOnlineDefenseEnemy(boss,stats.damage*(boss.boss?1.6:.8),tower.towerType);effect(5000,{x:onlineDefensePathPoint(boss.distance).x,y:onlineDefensePathPoint(boss.distance).y,target:boss,sourceTower:tower});elements.odDefenseStatus.textContent='Boss Slayer locked onto the strongest boss for 5 seconds!';
        } else if (type === 'blue-screen') {
            onlineDefense.timedBuffs.blueScreen=now+5000;living.forEach((enemy)=>enemy.glitchMeter=Math.min(100,Number(enemy.glitchMeter||0)+25));effect(5000);elements.odDefenseStatus.textContent='BLUE SCREEN glitched the battlefield for 5 seconds!';
        } else if (type === 'singularity') {
            const duration=4500,center={x:450,y:300},captured=living.slice().sort((left,right)=>right.distance-left.distance).slice(0,12);captured.forEach((enemy)=>{const point=onlineDefensePathPoint(enemy.distance);enemy.singularityCapturedUntil=now+duration;enemy.singularityCaptureStartedAt=now;enemy.singularityOriginX=point.x;enemy.singularityOriginY=point.y;enemy.singularityOriginAngle=Math.atan2(point.y-center.y,point.x-center.x);enemy.singularityOriginRadius=Math.max(24,Math.hypot(point.x-center.x,point.y-center.y));});onlineDefense.screenShakeUntil=now+350;effect(duration,{...center,seed:Math.random()*1000,captured,towerType:tower.towerType,collapseDamage:stats.damage});elements.odDefenseStatus.textContent=`SINGULARITY is pulling ${captured.length} on-screen Invader${captured.length===1?'':'s'} into the void!`;
        } else return false;
        onlineDefense.towerAbilityCooldowns.set(tower.id, now + Number(stats.abilityCooldown || 1200) * (1000/60));
        return true;
    }

    function updateOnlineDefenseTraps(now, dt) {
        for (const trap of onlineDefense.traps) {
            if (trap.until <= now) continue;
            if (['bbq','honey','frosting','soda','snowpile','flower','gravity-well'].includes(trap.type)) {
                for (const enemy of onlineDefense.enemies) {
                    const radius=trap.type==='flower'?92:trap.type==='gravity-well'?74:42;
                    if (enemy.hp <= 0 || Math.abs(enemy.distance - trap.distance) > radius) continue;
                    damageOnlineDefenseEnemy(enemy, trap.damage * dt * .9, trap.towerType);
                    const slow={honey:.44,frosting:.72,soda:.76,snowpile:.48,'gravity-well':.88}[trap.type]||.78;
                    if(trap.type==='flower')enemy.pollenUntil=Math.max(Number(enemy.pollenUntil||0),now+2500);
                    else enemy.slowFactor = Math.min(Number(enemy.slowFactor || 1), slow);
                    if(trap.type==='gravity-well'&&applyOnlineControlledGravityPull(enemy,2.5,now,1600)>0)addOnlineDefenseEffect('gravity-tug',now,700,{x:onlineDefensePathPoint(enemy.distance).x,y:onlineDefensePathPoint(enemy.distance).y,seed:Math.random()*1000});
                    enemy.slowUntil = Math.max(enemy.slowUntil, now + 220);
                }
                continue;
            }
            if (trap.type === 'party-present' || trap.type === 'peppermint') continue;
            if (trap.type !== 'egg') continue;
            const enemy = onlineDefense.enemies.find((entry) => entry.hp > 0 && Math.abs(entry.distance - trap.distance) <= 24);
            if (!enemy) continue;
            trap.until = now;
            addOnlineDefenseEffect('egg-burst', now, 1200, { x:trap.x, y:trap.y, color:trap.color });
            if (trap.eggEffect === 'heart') {
                onlineDefense.lives = Math.min(20, onlineDefense.lives + 1);
                elements.odDefenseStatus.textContent = 'A lucky Easter egg restored 1 Grove Heart!';
            } else if (trap.eggEffect === 'slow') {
                enemy.slowFactor = .48; enemy.slowUntil = Math.max(enemy.slowUntil, now + 2600);
                elements.odDefenseStatus.textContent = 'An Easter egg covered an Invader in slowing magic!';
            } else if (trap.eggEffect === 'freeze') {
                enemy.jamUntil = Math.max(enemy.jamUntil, now + 1450);
                elements.odDefenseStatus.textContent = 'An Easter egg froze an Invader in place!';
            } else if (trap.eggEffect === 'explosion') {
                for (const nearby of onlineDefense.enemies) if (Math.abs(nearby.distance - enemy.distance) <= 84) damageOnlineDefenseEnemy(nearby, trap.damage * (nearby === enemy ? 1.8 : .9), trap.towerType);
                elements.odDefenseStatus.textContent = 'An Easter egg exploded for splash damage!';
            } else {
                elements.odDefenseStatus.textContent = 'A mystery Easter egg cracked open harmlessly.';
            }
        }
        onlineDefense.traps = onlineDefense.traps.filter((trap) => trap.until > now);
    }

    function fadeOnlineDefenseWaveObjects(now) {
        const shortTrailObjects = new Set(['bbq','honey','frosting','soda','snowpile','flower','gravity-well','peppermint','egg']);
        for (const trap of onlineDefense.traps) {
            if (shortTrailObjects.has(trap.type)) trap.until = Math.min(Number(trap.until || now), now + (trap.type === 'egg' ? 1800 : 1100));
        }
        for (const effect of onlineDefense.effects) {
            if (!['reward-popup','giant-present','birthday-party'].includes(effect.type)) {
                effect.until = Math.min(Number(effect.until || now), now + 900);
            }
        }
    }

    function updateDefenseSimulationStep(now, dt) {
        if (now < onlineDefense.localStartAt || onlineDefense.completed || onlineDefense.lives <= 0) return;
        onlineDefense.effects.forEach((effect) => {
            if (effect.type === 'rainbow-stars' && !effect.landed && now >= effect.startedAt + (effect.until - effect.startedAt) * .72) {
                effect.landed = true;
                (effect.targets || []).forEach((enemy) => damageOnlineDefenseEnemy(enemy, effect.damage, effect.towerType));
            }
            if (effect.type === 'delayed-gift' && !effect.opened && now >= effect.opensAt) {
                effect.opened = true;
                const target = effect.target?.hp > 0 ? effect.target : onlineDefense.enemies.filter((enemy) => enemy.hp > 0).sort((a,b) => Math.abs(a.distance-effect.distance)-Math.abs(b.distance-effect.distance))[0];
                const roll=Math.random();
                if(roll<.07&&onlineDefense.lives<20)onlineDefense.lives=Math.min(20,onlineDefense.lives+1+Math.floor(Math.random()*3));
                else if(roll<.32)onlineDefense.bananaRewardsEarned+=12;
                else if(roll<.58&&target)target.jamUntil=Math.max(target.jamUntil,now+1800);
                else if(target)damageOnlineDefenseEnemy(target,effect.damage*1.45,effect.towerType);
                addOnlineDefenseEffect('present-explosion',now,1200,{x:effect.x,y:effect.y});
            }
            if(effect.type==='singularity'){
                const duration=Math.max(1,effect.until-effect.startedAt),progress=Math.max(0,Math.min(1,(now-effect.startedAt)/duration)),captureProgress=Math.max(0,Math.min(1,progress/.86));
                (effect.captured||[]).forEach((enemy,index)=>{if(!enemy||enemy.hp<=0)return;const angle=Number(enemy.singularityOriginAngle||0)+captureProgress*(7.8+index%4*.55),radius=Math.max(3,Number(enemy.singularityOriginRadius||30)*Math.pow(1-captureProgress,1.35));enemy.singularityDisplayX=effect.x+Math.cos(angle)*radius;enemy.singularityDisplayY=effect.y+Math.sin(angle)*radius*(.66+.1*Math.sin(index));enemy.singularityScale=Math.max(.14,1-captureProgress*.86);});
                if(!effect.collapsed&&progress>=.86){effect.collapsed=true;let defeated=0;(effect.captured||[]).forEach((enemy)=>{if(!enemy||enemy.hp<=0)return;enemy.singularityDisplayX=effect.x;enemy.singularityDisplayY=effect.y;const collapseDamage=enemy.boss?Number(effect.collapseDamage||0)*3:Math.max(Number(effect.collapseDamage||0)*4,enemy.maxHp*.7);damageOnlineDefenseEnemy(enemy,collapseDamage,effect.towerType);if(enemy.hp<=0)defeated+=1;});addOnlineDefenseEffect('singularity-poof',now,1600,{x:effect.x,y:effect.y,count:defeated,seed:effect.seed});onlineDefense.screenShakeUntil=now+650;elements.odDefenseStatus.textContent=`SINGULARITY COLLAPSE! ${defeated} Invader${defeated===1?'':'s'} defeated; survivors were severely damaged.`;}
            }
            if(effect.type==='screen-punch'&&!effect.landed&&now>=effect.startedAt+(effect.until-effect.startedAt)*.46){effect.landed=true;(effect.targets||[]).forEach((enemy)=>{if(enemy&&enemy.hp>0)damageOnlineDefenseEnemy(enemy,Number(effect.damage||0)*(enemy.boss ? .72 : 1),effect.towerType);});onlineDefense.screenShakeUntil=now+650;elements.odDefenseStatus.textContent='SCREEN PUNCH cracked the glass and damaged every captured Invader!';}
        });
        const targetWave = Number(onlineDefense.room?.targetWave || 100);
        if (onlineDefense.spawnRemaining > 0 && now >= onlineDefense.nextSpawnAt) {
            const boss = onlineDefense.wave % 5 === 0 && onlineDefense.spawnRemaining === 1;
            const pest = ONLINE_DEFENSE_PESTS[(onlineDefense.wave * 7 + onlineDefense.spawnRemaining) % ONLINE_DEFENSE_PESTS.length];
            const baseHp = onlineDefenseWaveBaseHealth(onlineDefense.wave);
            const treasure = onlineDefense.spawnedThisWave === onlineDefense.treasureIndex;
            const normalHp = Math.max(1, Math.round(baseHp * Number(pest.hp || 1)));
            const hp = treasure
                ? Math.max(1, Math.round(baseHp * 1.8))
                : Math.max(1, Math.round(normalHp * (boss ? onlineDefenseBossHealthMultiplier(onlineDefense.wave) : 1)));
            const baseReward = Math.max(2, Math.round((2 + Math.floor(onlineDefense.wave / 20)) * Number(pest.reward || 1)));
            const kind = treasure ? 'treasure' : boss ? 'boss' : pest.kind;
            onlineDefense.enemies.push({
                id: `${onlineDefense.wave}_${onlineDefense.spawnRemaining}_${now}`,
                distance: 0,
                hp,
                maxHp: hp,
                speed: (1.05 + Math.min(.78, onlineDefense.wave * .038)) * 60 * Number(pest.speed || 1) * (treasure ? 1.24 : boss ? .68 : 1),
                slowUntil: 0,
                slowFactor: 1,
                jamUntil: 0,
                poisonUntil: 0,
                poisonDamagePerSecond: 0,
                drownAt: 0,
                drownUntil: 0,
                drownDamagePerSecond: 0,
                roseUntil: 0,
                roseDamagePerSecond: 0,
                pollenUntil: 0,
                electricVulnerabilityUntil: 0,
                glitchMeter: 0,
                weakPoint: 0,
                corruptionUntil: 0,
                corruptionDamagePerSecond: 0,
                flickerUntil: 0,
                airborneStartedAt: 0,
                airborneUntil: 0,
                gravityPullImmuneUntil: 0,
                gravityPullWindowUntil: now + 5000,
                gravityPulledDistance: 0,
                singularityCapturedUntil: 0,
                singularityCaptureStartedAt: 0,
                boss,
                treasure,
                kind,
                pest,
                reward: treasure ? Math.round(18 + onlineDefense.wave * .7) : baseReward * (boss ? 4 : 1),
                leak: boss ? 5 : pest.kind === 'elite' ? 3 : pest.kind === 'armored' ? 2 : 1
            });
            onlineDefense.spawnRemaining -= 1;
            onlineDefense.spawnedThisWave += 1;
            onlineDefense.nextSpawnAt = now + Math.max(200, (27 - onlineDefense.wave * .7) * (1000 / 60)) / Math.max(1, onlineDefense.simulationSpeed);
        }
        for (const enemy of onlineDefense.enemies) {
            if (enemy.poisonUntil > now) damageOnlineDefenseEnemy(enemy, enemy.poisonDamagePerSecond * dt, enemy.poisonTowerType);
            if (enemy.drownAt <= now && enemy.drownUntil > now) damageOnlineDefenseEnemy(enemy, Number(enemy.drownDamagePerSecond || 0) * dt, enemy.drownTowerType);
            if (enemy.roseUntil > now) damageOnlineDefenseEnemy(enemy, Number(enemy.roseDamagePerSecond || 0) * dt, enemy.roseTowerType);
            if (enemy.corruptionUntil > now) damageOnlineDefenseEnemy(enemy, Number(enemy.corruptionDamagePerSecond || 0) * dt, enemy.corruptionTowerType);
            if (now < Number(onlineDefense.timedBuffs.blueScreen || 0) && Math.random() < .04 * dt) enemy.jamUntil = Math.max(enemy.jamUntil, now + 450);
            const movement = enemy.singularityCapturedUntil > now ? 0 : enemy.jamUntil > now ? 0 : enemy.slowUntil > now ? Math.max(.2, Number(enemy.slowFactor) || 1) : 1;
            const floodSlow = now < Number(onlineDefense.timedBuffs.sharkFlood || 0) ? .82 : now < Number(onlineDefense.timedBuffs.sodaFlood || 0) ? .9 : 1;
            if (now >= onlineDefense.globalFreezeUntil) enemy.distance += enemy.speed * movement * floodSlow * dt;
        }
        updateOnlineDefenseTraps(now, dt);
        const room = onlineDefense.room;
        const placements = (room?.placements || []).filter((tower) => room.mode === 'coop' || tower.ownerId === state.playerId);
        for (const tower of placements) {
            const config = DEFENSE_TOWERS[tower.towerType] || DEFENSE_TOWERS.torn;
            if (config.passive) continue;
            if (tower.towerType === 'christmastree') {
                const current = (onlineDefense.towerOrnaments.get(tower.id) || [])
                    .filter((ornament) => Number(ornament.expiresAfterWave || 0) >= onlineDefense.wave);
                const nextAt = Number(onlineDefense.towerNextOrnamentAt.get(tower.id) || now + 30000);
                if (!onlineDefense.towerNextOrnamentAt.has(tower.id)) onlineDefense.towerNextOrnamentAt.set(tower.id, nextAt);
                if (now >= nextAt && current.length < 6) {
                    const types = ['red','blue','green','gold'];
                    current.push({ type:types[(current.length + onlineDefense.wave) % types.length], expiresAfterWave:onlineDefense.wave + 3 });
                    onlineDefense.towerNextOrnamentAt.set(tower.id, now + 30000);
                    addOnlineDefenseEffect('ornament-present',now,1200,{x:tower.x,y:tower.y,color:current.at(-1).type});
                }
                onlineDefense.towerOrnaments.set(tower.id, current);
            }
            const stats = onlineDefenseTowerStats(tower);
            const damage = stats.damage;
            const range = stats.range;
            const readyAt = onlineDefense.towerCooldowns.get(tower.id) || 0;
            const partyTarget=Number(stats.partyTarget||config.partyTarget||28);
            const queuedParty=tower.towerType==='birthdaybash'&&Number(onlineDefense.towerPartyMeters.get(tower.id)||0)>=partyTarget;
            if(queuedParty&&now>=Number(onlineDefense.towerAbilityCooldowns.get(tower.id)||0)){
                const partyTarget=onlineDefense.enemies.filter((enemy)=>enemy.hp>0).sort((a,b)=>b.distance-a.distance)[0];
                if(partyTarget&&activateOnlineDefenseAbility(tower,stats,partyTarget,now)){onlineDefense.towerCooldowns.set(tower.id,now+stats.cooldown/Math.max(.1,onlineDefense.simulationSpeed));continue;}
            }
            if (now < readyAt) continue;
            let target = onlineDefense.enemies.filter((enemy) => {
                const point = onlineDefensePathPoint(enemy.distance);
                return Math.hypot(point.x - tower.x, point.y - tower.y) <= range;
            }).sort((a, b) => b.distance - a.distance)[0];
            if (!target) continue;
            const attackCount=(onlineDefense.towerAttackCounts.get(tower.id)||0)+1;
            onlineDefense.towerAttackCounts.set(tower.id,attackCount);
            const partyReady=tower.towerType==='birthdaybash'&&Number(onlineDefense.towerPartyMeters.get(tower.id)||0)>=partyTarget;
            if(stats.ability && now >= Number(onlineDefense.towerAbilityCooldowns.get(tower.id)||0) && (partyReady||Math.random()<Number(stats.abilityChance||0)) && activateOnlineDefenseAbility(tower,stats,target,now)){
                onlineDefense.towerCooldowns.set(tower.id,now+stats.cooldown/Math.max(.1,onlineDefense.simulationSpeed));
                continue;
            }
            if(tower.towerType==='discoball'){
                placements.filter((entry)=>entry.id!==tower.id&&Math.hypot(entry.x-tower.x,entry.y-tower.y)<=155).forEach((entry)=>{
                    const rhythm=onlineDefense.towerRhythm.get(entry.id)||{stacks:0,until:0};
                    onlineDefense.towerRhythm.set(entry.id,{stacks:Math.min(3,rhythm.until>now?rhythm.stacks+1:1),until:now+3500});
                });
            }
            const bossSlayer=now<Number(onlineDefense.towerBossSlayerUntil.get(tower.id)||0);
            if(bossSlayer&&tower.towerType==='bossbreaker'){
                target=onlineDefense.enemies.filter((enemy)=>enemy.hp>0&&enemy.boss).sort((a,b)=>b.hp-a.hp)[0]||onlineDefense.enemies.filter((enemy)=>enemy.hp>0).sort((a,b)=>b.hp-a.hp)[0]||target;
            }
            const golden=tower.towerType==='cowboy'&&attackCount%Number(stats.goldenEvery||7)===0;
            if(golden){
                const strongest=onlineDefense.enemies.filter((enemy)=>{const point=onlineDefensePathPoint(enemy.distance);return Math.hypot(point.x-tower.x,point.y-tower.y)<=range;}).sort((a,b)=>b.hp-a.hp)[0];
                if(strongest)target=strongest;
            }
            const targetPoint = onlineDefensePathPoint(target.distance);
            if (stats.special) activateOnlineDefenseSpecial(tower, stats, target, now);
            else {
                let dealt=stats.effect==='gift'?0:damage*(golden?Number(stats.goldenMultiplier||4):1);
                if(tower.towerType==='bossbreaker')dealt*=target.boss?Number(stats.bossMultiplier||2.4):Number(stats.regularMultiplier||.32);
                if(bossSlayer)dealt*=2;else if(Number(stats.critChance||0)>0&&Math.random()<Number(stats.critChance))dealt*=1.7;
                if(['electric','lightning'].includes(tower.towerType)&&Number(target.electricVulnerabilityUntil||0)>now)dealt*=1.35;
                damageOnlineDefenseEnemy(target,dealt,tower.towerType);
                if(golden){
                    const dx=targetPoint.x-tower.x,dy=targetPoint.y-tower.y,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;
                    onlineDefense.enemies.filter((enemy)=>enemy!==target&&enemy.hp>0).forEach((enemy)=>{const point=onlineDefensePathPoint(enemy.distance),ex=point.x-tower.x,ey=point.y-tower.y,projection=ex*ux+ey*uy,perpendicular=Math.abs(ex*uy-ey*ux);if(projection>=0&&perpendicular<=30)damageOnlineDefenseEnemy(enemy,dealt,tower.towerType);});
                    addOnlineDefenseEffect('golden-shot',now,1200,{x:targetPoint.x,y:targetPoint.y});
                }else if(bossSlayer){
                    onlineDefense.enemies.filter((enemy)=>enemy!==target&&enemy.hp>0).forEach((enemy)=>damageOnlineDefenseEnemy(enemy,dealt*.55,tower.towerType));
                }else if(Number(stats.ricochet||0)>0){
                    onlineDefense.enemies.filter((enemy)=>enemy!==target).sort((a,b)=>Math.abs(a.distance-target.distance)-Math.abs(b.distance-target.distance)).slice(0,Math.min(4,Number(stats.ricochet)))
                        .forEach((enemy,index)=>damageOnlineDefenseEnemy(enemy,dealt*Math.pow(.72,index+1),tower.towerType));
                }
            }
            if (stats.effect === 'honey') {
                target.slowFactor = .52;
                target.slowUntil = Math.max(target.slowUntil, now + Number(stats.effectDuration || 180) * (1000 / 60));
            } else if (stats.effect === 'jam') {
                target.jamUntil = Math.max(target.jamUntil, now + Number(stats.effectDuration || 90) * (1000 / 60));
            } else if (stats.effect === 'poison') {
                target.poisonUntil = Math.max(target.poisonUntil, now + Number(stats.effectDuration || 270) * (1000 / 60));
                target.poisonDamagePerSecond = Math.max(target.poisonDamagePerSecond, Number(stats.poisonDamage || .045) * 60 * (1 + (Number(tower.level || 1) - 1) * .35));
                target.poisonTowerType = tower.towerType;
            } else if (stats.effect === 'frosting') {
                onlineDefense.traps.push({type:'frosting',distance:target.distance,...targetPoint,damage:stats.damage*.015,towerType:tower.towerType,startedAt:now,until:now+4000});
            } else if (stats.effect === 'pollen') {
                target.pollenUntil=Math.max(Number(target.pollenUntil||0),now+4000);
                onlineDefense.traps.push({type:'flower',distance:target.distance,...targetPoint,damage:stats.damage*.025,towerType:tower.towerType,startedAt:now,until:now+7000});
            } else if (stats.effect === 'gift') {
                addOnlineDefenseEffect('delayed-gift',now,2150,{opensAt:now+2000,target,distance:target.distance,damage:stats.damage,towerType:tower.towerType,x:targetPoint.x,y:targetPoint.y});
            } else if (stats.effect === 'bubble') {
                target.slowFactor=Math.min(target.slowFactor,.75);target.slowUntil=Math.max(target.slowUntil,now+2000);target.electricVulnerabilityUntil=Math.max(Number(target.electricVulnerabilityUntil||0),now+4000);
            } else if (stats.effect === 'sticky-soda') {
                onlineDefense.traps.push({type:'soda',distance:target.distance,...targetPoint,damage:stats.damage*.02,towerType:tower.towerType,startedAt:now,until:now+4500});
                if(attackCount%Number(stats.fizzEvery||6)===0){onlineDefense.enemies.filter((enemy)=>Math.abs(enemy.distance-target.distance)<72).forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage*.6,tower.towerType));addOnlineDefenseEffect('fizz-burst',now,1300,{x:targetPoint.x,y:targetPoint.y});}
            } else if (stats.effect === 'peppermint') {
                onlineDefense.traps.push({type:'peppermint',distance:target.distance,...targetPoint,damage:0,towerType:tower.towerType,startedAt:now,until:now+6000});
                addOnlineDefenseEffect('peppermint-impact',now,900,{x:targetPoint.x,y:targetPoint.y,seed:Math.random()*1000});
            } else if (stats.effect === 'rose-dot') {
                target.roseUntil=Math.max(Number(target.roseUntil||0),now+4000);target.roseDamagePerSecond=Math.max(Number(target.roseDamagePerSecond||0),stats.damage*.18);target.roseTowerType=tower.towerType;
            } else if (stats.effect === 'santa-present') {
                const roll=Math.random();if(roll<.012&&onlineDefense.lives<20)onlineDefense.lives=Math.min(20,onlineDefense.lives+1+Math.floor(Math.random()*2));else if(roll<.34){target.slowFactor=Math.min(Number(target.slowFactor||1),.68);target.slowUntil=Math.max(target.slowUntil,now+2000);}else damageOnlineDefenseEnemy(target,stats.damage*(roll<.7?1:1.25),tower.towerType);
                addOnlineDefenseEffect('present-explosion',now,1200,{x:targetPoint.x,y:targetPoint.y});
            } else if (stats.effect === 'groovy') {
                target.jamUntil=Math.max(target.jamUntil,now+300);
            } else if (stats.effect === 'glitch') {
                target.glitchMeter=Math.min(100,Number(target.glitchMeter||0)+16);const roll=Math.random();if(roll<.24)target.jamUntil=Math.max(target.jamUntil,now+400);else if(roll<.48)target.distance=Math.max(0,target.distance-22);else if(roll<.72)target.slowUntil=Math.max(target.slowUntil,now+800);else target.flickerUntil=Math.max(target.flickerUntil,now+1000);if(target.glitchMeter>=100){target.glitchMeter=0;target.jamUntil=Math.max(target.jamUntil,now+1000);damageOnlineDefenseEnemy(target,stats.damage*1.3,tower.towerType);onlineDefense.enemies.filter((enemy)=>enemy.hp>0&&Math.abs(enemy.distance-target.distance)<76).forEach((enemy)=>{enemy.corruptionUntil=Math.max(enemy.corruptionUntil,now+2500);enemy.corruptionDamagePerSecond=Math.max(enemy.corruptionDamagePerSecond,stats.damage*.12);enemy.corruptionTowerType=tower.towerType;});addOnlineDefenseEffect('enemy-crash',now,1500,{x:targetPoint.x,y:targetPoint.y});}
            } else if (stats.effect === 'gravity') {
                const pulled=applyOnlineControlledGravityPull(target,6,now,1300);onlineDefense.enemies.filter((enemy)=>enemy!==target&&Math.abs(enemy.distance-target.distance)<74).forEach((enemy)=>applyOnlineControlledGravityPull(enemy,2.5,now,1600));if(pulled>0)addOnlineDefenseEffect('gravity-tug',now,750,{x:targetPoint.x,y:targetPoint.y,seed:Math.random()*1000});
            } else if (stats.slow < 1) {
                target.slowFactor = stats.slow;
                target.slowUntil = Math.max(target.slowUntil, now + 950);
            }
            const eggBurst = !stats.special && Number(stats.explodeChance || 0) > 0 && Math.random() < Number(stats.explodeChance);
            if (eggBurst) {
                damageOnlineDefenseEnemy(target, damage * .35, tower.towerType);
                addOnlineDefenseEffect('egg-burst', now, 1050, { x:targetPoint.x, y:targetPoint.y, color:'#ff9ed8' });
            }
            if(stats.projectile==='popcorn'){const critical=Math.random()<Number(stats.critChance||.12);onlineDefense.enemies.filter((enemy)=>Math.abs(enemy.distance-target.distance)<(critical?70:38)).forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage*(critical ? .55 : .2),tower.towerType));addOnlineDefenseEffect('popcorn-burst',now,1000,{x:targetPoint.x,y:targetPoint.y});}
            if(stats.projectile==='firework')addOnlineDefenseEffect('firework-burst',now,1200,{x:targetPoint.x,y:targetPoint.y,color:`hsl(${Math.floor(Math.random()*360)},90%,65%)`});
            if(stats.projectile==='toy-bolt'&&attackCount%(now<Number(onlineDefense.timedBuffs.workshop||0)?5:10)===0){
                const goldenToy=now<Number(onlineDefense.timedBuffs.workshop||0),toy=attackCount%3;
                if(toy===0)target.jamUntil=Math.max(target.jamUntil,now+(goldenToy?1200:800));
                else if(toy===1)onlineDefense.enemies.filter((enemy)=>enemy.hp>0&&Math.abs(enemy.distance-target.distance)<(goldenToy?90:66)).forEach((enemy)=>damageOnlineDefenseEnemy(enemy,stats.damage*(goldenToy?1.25:.7),tower.towerType));
                else damageOnlineDefenseEnemy(target,stats.damage*(goldenToy?2.8:2));
                addOnlineDefenseEffect('toy-workshop',now,1500,{x:targetPoint.x,y:targetPoint.y,toy,golden:goldenToy});
            }
            if(stats.projectile==='heavy-cannon'&&target.boss){target.weakPoint=Math.min(5,Number(target.weakPoint||0)+1);if(target.weakPoint>=4)damageOnlineDefenseEnemy(target,stats.damage*.12*target.weakPoint,tower.towerType);}
            const splashRange = eggBurst ? 72 : Number(stats.splash || 0);
            if (!stats.special && splashRange) {
                for (const enemy of onlineDefense.enemies) if (enemy !== target && Math.abs(enemy.distance - target.distance) <= splashRange) damageOnlineDefenseEnemy(enemy, damage * (eggBurst ? .62 : .42), tower.towerType);
            }
            if (!stats.special) {
                const electric = stats.projectile === 'electric-pulse';
                const neon = stats.projectile === 'neon-beam';
                const duration = electric ? 450 : neon ? 210 : 180;
                onlineDefense.shots.push({
                    x1:tower.x, y1:tower.y, x2:targetPoint.x, y2:targetPoint.y,
                    color:neon ? `hsl(${Math.floor(Math.random() * 360)},100%,65%)` : config.color,
                    style:stats.projectile, electric, neon, seed:Math.random() * 1000, duration, until:now + duration
                });
            }
            onlineDefense.towerCooldowns.set(tower.id, now + stats.cooldown / Math.max(.1, onlineDefense.simulationSpeed));
        }
        const remaining = [];
        for (const enemy of onlineDefense.enemies) {
            if (enemy.hp <= 0) {
                onlineDefense.kills += 1;
                onlineDefense.score += (10 + onlineDefense.wave * 2) * (enemy.boss ? 5 : 1);
                onlineDefense.bananaRewardsEarned += Math.max(0, Number(enemy.reward) || 0) * ONLINE_DEFENSE_KILL_BANANA_MULTIPLIER;
                if (enemy.lastHitTowerType === 'cowboy') onlineDefense.bananaRewardsEarned += 2;
                if (enemy.lastHitTowerType === 'darkmatter') {
                    const point=onlineDefensePathPoint(enemy.distance);
                    onlineDefense.traps.push({type:'gravity-well',distance:enemy.distance,...point,damage:1.2,towerType:'darkmatter',startedAt:now,until:now+3000});
                }
                if (enemy.lastHitTowerType) window.recordDefenseDefenderKill?.(enemy.lastHitTowerType, 1);
                placements.filter((tower)=>tower.towerType==='birthdaybash').forEach((tower)=>{const target=Number(DEFENSE_TOWERS.birthdaybash?.partyTarget||28);onlineDefense.towerPartyMeters.set(tower.id,Math.min(target,Number(onlineDefense.towerPartyMeters.get(tower.id)||0)+1));});
            }
            else if (enemy.distance >= onlineDefensePathLength) {
                const leak = Math.max(1, Math.ceil((Number(enemy.leak) || 1) * (Number(enemy.pollenUntil || 0) > now ? .55 : 1)));
                onlineDefense.lives = Math.max(0, onlineDefense.lives - leak);
            }
            else remaining.push(enemy);
        }
        onlineDefense.enemies = remaining;
        if (!onlineDefense.spawnRemaining && !onlineDefense.enemies.length && !onlineDefense.awaitingWaveStart) {
            onlineDefense.clearedWave = Math.max(onlineDefense.clearedWave, onlineDefense.wave);
            fadeOnlineDefenseWaveObjects(now);
            if (onlineDefense.wave >= targetWave) onlineDefense.completed = true;
            else {
                onlineDefense.awaitingWaveStart = true;
                elements.odDefenseStatus.textContent = `Wave ${onlineDefense.wave} cleared. Build, upgrade, then start wave ${onlineDefense.wave + 1}.`;
            }
            reportDefenseProgress(true);
        }
    }

    function advanceDefenseSimulation(now = Date.now()) {
        if (!onlineDefense.active) return;
        if (!onlineDefense.lastSimulationAt) onlineDefense.lastSimulationAt = now;
        if (now <= onlineDefense.localStartAt) {
            onlineDefense.lastSimulationAt = now;
            return;
        }
        // A build phase has no moving state, so it can jump straight to the
        // current wall clock. During a wave, process every elapsed slice. This
        // keeps enemies and defenders running when requestAnimationFrame is
        // suspended by tabbing out, minimizing, or an OS focus change.
        if (onlineDefense.awaitingWaveStart && !onlineDefense.spawnRemaining && !onlineDefense.enemies.length) {
            onlineDefense.lastSimulationAt = now;
            return;
        }
        let cursor = Math.max(onlineDefense.localStartAt, onlineDefense.lastSimulationAt);
        while (cursor < now && onlineDefense.active && !onlineDefense.completed && onlineDefense.lives > 0) {
            const backlog = now - cursor;
            const stepMs = Math.min(backlog, backlog > 5000 ? 200 : 50);
            cursor += stepMs;
            updateDefenseSimulationStep(cursor, stepMs / 1000 * onlineDefense.simulationSpeed);
        }
        onlineDefense.lastSimulationAt = now;
    }

    function defenseFrame() {
        if (!onlineDefense.active) return;
        if (document.hidden || window.flappyAppSuspended) {
            onlineDefense.lastFrameAt = Date.now();
            onlineDefense.lastSimulationAt = Date.now();
            onlineDefense.animationFrame = requestAnimationFrame(defenseFrame);
            return;
        }
        const now = Date.now();
        if (!onlineDefense.readySent && now >= onlineDefense.localStartAt - 450) {
            onlineDefense.readySent = true;
            send({ type: 'defense_ready' });
        }
        advanceDefenseSimulation(now);
        drawDefenseScene(now);
        updateDefenseHud();
        reportDefenseProgress();
        onlineDefense.lastFrameAt = now;
        onlineDefense.animationFrame = requestAnimationFrame(defenseFrame);
    }

    function stopDefenseLoop() {
        onlineDefense.active = false;
        if (onlineDefense.animationFrame) cancelAnimationFrame(onlineDefense.animationFrame);
        onlineDefense.animationFrame = null;
        if (onlineDefense.simulationTimer) clearInterval(onlineDefense.simulationTimer);
        onlineDefense.simulationTimer = null;
    }

    function startDefenseMatch(room) {
        onlineDefense.room = room;
        onlineDefense.active = true;
        onlineDefense.resultOpen = false;
        onlineDefense.completed = false;
        onlineDefense.readySent = false;
        onlineDefense.enemies = [];
        onlineDefense.shots = [];
        onlineDefense.effects = [];
        onlineDefense.traps = [];
        onlineDefense.weather = null;
        onlineDefense.lastWeatherWave = -10;
        onlineDefense.screenShakeUntil = 0;
        onlineDefense.wave = 0;
        onlineDefense.lives = Math.max(1, Number(room.players?.find((player) => player.id === state.playerId)?.lives) || 20);
        onlineDefense.score = 0;
        onlineDefense.kills = 0;
        onlineDefense.bananaRewardsEarned = 0;
        onlineDefense.clearedWave = 0;
        onlineDefense.treasureIndex = -1;
        onlineDefense.spawnedThisWave = 0;
        onlineDefense.globalFreezeUntil = 0;
        onlineDefense.rallyUntil = 0;
        onlineDefense.powers = {
            repair: { uses: 2, readyWave: 0 },
            freeze: { uses: 2, readyWave: 0 },
            bomb: { uses: 2, readyWave: 0 },
            rally: { uses: 2, readyWave: 0 }
        };
        onlineDefense.spawnRemaining = 0;
        onlineDefense.awaitingWaveStart = true;
        onlineDefense.simulationSpeed = 1;
        onlineDefense.selectedPlacementId = null;
        onlineDefense.hoverPoint = null;
        onlineDefense.localStartAt = Number(room.startAt || Date.now()) - state.serverOffset;
        onlineDefense.nextWaveAt = Number.POSITIVE_INFINITY;
        onlineDefense.lastFrameAt = Date.now();
        onlineDefense.lastSimulationAt = Date.now();
        onlineDefense.lastProgressAt = 0;
        onlineDefense.towerCooldowns.clear();
        onlineDefense.towerAbilityCooldowns.clear();
        onlineDefense.towerAttackCounts.clear();
        onlineDefense.towerPartyMeters.clear();
        onlineDefense.towerRhythm.clear();
        onlineDefense.towerBossSlayerUntil.clear();
        onlineDefense.towerOrnaments.clear();
        onlineDefense.towerNextOrnamentAt.clear();
        onlineDefense.timedBuffs = {};
        elements.odFastForward.textContent = 'Fast Forward: 1x';
        elements.odDefenseStatus.textContent = 'Pick a defender, prepare the grove, then start the first wave.';
        elements.odGameError.textContent = '';
        elements.odResult.classList.remove('open');
        elements.odResult.setAttribute('aria-hidden', 'true');
        setDefenseView(elements.odGame);
        if (onlineDefense.animationFrame) cancelAnimationFrame(onlineDefense.animationFrame);
        if (onlineDefense.simulationTimer) clearInterval(onlineDefense.simulationTimer);
        onlineDefense.simulationTimer = setInterval(() => {
            if (!onlineDefense.active || document.hidden || window.flappyAppSuspended) {
                onlineDefense.lastSimulationAt = Date.now();
                return;
            }
            advanceDefenseSimulation(Date.now());
            reportDefenseProgress();
        }, 50);
        defenseFrame();
    }

    function showDefenseResult(message) {
        stopDefenseLoop();
        onlineDefense.room = message.room || onlineDefense.room;
        onlineDefense.resultOpen = true;
        const won = (message.winners || []).includes(state.playerId);
        const change = (message.rankedChanges || []).find((entry) => entry.accountId === state.account?.id);
        elements.odResultTitle.textContent = message.room?.mode === 'coop' ? (message.success ? 'Banana Coast Defended!' : 'Defense Overrun') : (won ? 'Defense Victory!' : 'Defense Defeat');
        elements.odResultBody.innerHTML = `<p>${escapeHtml(message.reason || 'The defense match is complete.')}</p><p><strong>Wave ${Number(defenseMe()?.wave || onlineDefense.wave)} - ${onlineDefense.score.toLocaleString()} score</strong></p>${change ? `<p class="${change.delta >= 0 ? 'mp-success' : 'mp-error'}">Defense Rank ${change.delta >= 0 ? '+' : ''}${Number(change.delta)} RP - ${escapeHtml(change.after)}</p>` : '<p>Private match: rank was not changed.</p>'}`;
        elements.odResult.classList.add('open');
        elements.odResult.setAttribute('aria-hidden', 'false');
    }

    function openOnlineHub() {
        elements.onlineModesScreen.classList.add('open');
        elements.onlineModesScreen.setAttribute('aria-hidden', 'false');
        if (typeof applyProfileTheme === 'function') applyProfileTheme();
    }

    function closeOnlineHub({ restoreWorld = true } = {}) {
        elements.onlineModesScreen.classList.remove('open');
        elements.onlineModesScreen.setAttribute('aria-hidden', 'true');
        if (restoreWorld && monkeyWorld.onlineHubReturn) {
            monkeyWorld.onlineHubReturn = false;
            restoreWorldAfterMenu();
        }
    }

    function openOnlineHubFromWorld() {
        closeWorldBuilding();
        monkeyWorld.onlineHubReturn = true;
        monkeyWorld.pausedForMenu = true;
        monkeyWorld.keys.clear();
        elements.monkeyWorldScreen.classList.add('menu-underlay');
        openOnlineHub();
    }

    function showOnlineActivity(mode) {
        elements.onlineModesScreen.classList.remove('open');
        elements.onlineModesScreen.setAttribute('aria-hidden', 'true');
        const screens = { race: elements.multiplayerScreen, defense: elements.onlineDefenseScreen, world: elements.monkeyWorldScreen };
        for (const [name, screen] of Object.entries(screens)) {
            screen.classList.toggle('open', name === mode);
            screen.setAttribute('aria-hidden', name === mode ? 'false' : 'true');
        }
        // Full roster refreshes arrive when any other Monkey World player
        // changes cosmetics, joins, chats, or requests recovery state. Keep
        // this client's open menu above the world instead of covering it and
        // leaving movement paused behind an apparently closed menu.
        if (mode === 'world' && monkeyWorld.pausedForMenu) {
            elements.monkeyWorldScreen.classList.add('open', 'menu-underlay');
            elements.monkeyWorldScreen.setAttribute('aria-hidden', 'false');
        }
    }

    async function openOnlineDefense() {
        const allowed = await requestOnlineAccess('Online Monkey Defense');
        if (!allowed) return;
        elements.onlineDefenseScreen.classList.add('open');
        elements.onlineDefenseScreen.setAttribute('aria-hidden', 'false');
        elements.odMenuError.textContent = '';
        setDefenseView(elements.odMenu);
        try {
            await connect();
            await waitForAuthenticatedAccount();
            elements.odConnection.textContent = 'Online';
            if (state.serverProtocolVersion && !state.serverCapabilities.includes('online_defense')) {
                elements.odMenuError.textContent = 'This multiplayer server is an older version and does not support Online Monkey Defense yet. Update/restart multiplayer-server.js.';
                elements.odRankCard.innerHTML = '<strong>Online Rank Unavailable</strong><span>The multiplayer server needs the Online Defense update.</span>';
                return;
            }
            send({ type: 'defense_get_rank' });
        } catch (error) {
            elements.odConnection.textContent = 'Offline';
            elements.odMenuError.textContent = error.message;
            elements.odRankCard.innerHTML = '<strong>Online Rank Offline</strong><span>Reconnect to load your shared rank and leaderboard.</span>';
        }
        if (typeof applyProfileTheme === 'function') applyProfileTheme();
    }

    function closeOnlineDefense({ leave = true } = {}) {
        if (leave && (onlineDefense.room || onlineDefense.active)) send({ type: 'defense_leave' });
        if (leave) send({ type: 'defense_cancel_queue' });
        if (leave && state.party) send({ type: 'leave_party' });
        stopDefenseLoop();
        onlineDefense.room = null;
        elements.odResult.classList.remove('open');
        elements.odResult.setAttribute('aria-hidden', 'true');
        elements.onlineDefenseScreen.classList.remove('open');
        elements.onlineDefenseScreen.setAttribute('aria-hidden', 'true');
    }

    elements.mpLoginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMultiplayerErrors();
        try {
            await connect(elements.mpServerUrl.value);
            send({ type: 'login', username: elements.mpLoginUsername.value, password: elements.mpLoginPassword.value });
        } catch (error) { elements.mpAuthError.textContent = error.message; }
    });
    elements.mpRegisterForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMultiplayerErrors();
        if (elements.mpRegisterPassword.value !== elements.mpRegisterConfirm.value) {
            elements.mpAuthError.textContent = 'The confirmation password does not match.';
            return;
        }
        try {
            await connect(elements.mpServerUrl.value);
            send({
                type: 'register_request',
                username: elements.mpRegisterUsername.value,
                email: elements.mpRegisterEmail.value,
                password: elements.mpRegisterPassword.value,
                skin: 'Default Monkey.png'
            });
        } catch (error) { elements.mpAuthError.textContent = error.message; }
    });
    elements.mpLogoutBtn.addEventListener('click', logoutAccount);

    elements.startupLoginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMultiplayerErrors();
        try {
            await connect(elements.startupServerUrl.value);
            send({ type: 'login', username: elements.startupLoginUsername.value, password: elements.startupLoginPassword.value });
        } catch (error) { elements.startupAuthError.textContent = error.message; }
    });
    elements.startupRegisterForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMultiplayerErrors();
        if (elements.startupRegisterPassword.value !== elements.startupRegisterConfirm.value) {
            elements.startupAuthError.textContent = 'The confirmation password does not match.';
            return;
        }
        setStartupRegistrationBusy(true);
        try {
            await connect(elements.startupServerUrl.value);
            send({
                type: 'register_request',
                username: elements.startupRegisterUsername.value,
                email: elements.startupRegisterEmail.value,
                password: elements.startupRegisterPassword.value,
                skin: 'Default Monkey.png'
            });
        } catch (error) {
            setStartupRegistrationBusy(false);
            elements.startupAuthError.textContent = error.message;
        }
    });
    elements.startupVerify.addEventListener('submit', (event) => {
        event.preventDefault();
        elements.startupVerifyError.textContent = '';
        if (!pendingRegistration?.id) {
            showStartupAuth('That verification request expired. Create the account again.');
            return;
        }
        const code = elements.startupVerifyCode.value.replace(/\D/g, '').slice(0, 6);
        if (code.length !== 6) {
            elements.startupVerifyError.textContent = 'Enter the complete six-digit code.';
            return;
        }
        send({ type: 'verify_email', pendingId: pendingRegistration.id, code });
    });
    elements.startupVerifyCode.addEventListener('input', () => {
        elements.startupVerifyCode.value = elements.startupVerifyCode.value.replace(/\D/g, '').slice(0, 6);
    });
    elements.startupResendCode.addEventListener('click', () => {
        if (!pendingRegistration?.id) {
            showStartupAuth('That verification request expired. Create the account again.');
            return;
        }
        elements.startupVerifyError.textContent = '';
        send({ type: 'resend_verification', pendingId: pendingRegistration.id });
    });
    elements.startupCancelVerify.addEventListener('click', () => {
        pendingRegistration = null;
        elements.startupVerifyCode.value = '';
        showStartupAuth('Account creation cancelled. You can start again below.');
    });
    elements.startupReconnect.addEventListener('click', async () => {
        elements.startupAuthError.textContent = '';
        try {
            await connect(elements.startupServerUrl.value);
            const token = localStorage.getItem(sessionKey());
            if (token) send({ type: 'resume_session', token });
            else elements.startupAuthError.textContent = 'Connected. Log in or create an account below.';
        } catch (error) { elements.startupAuthError.textContent = error.message; }
    });
    elements.startupStayOffline.addEventListener('click', startGuestSession);
    elements.startupSplashOffline.addEventListener('click', () => goOffline('Online is unavailable right now. Your saved login was kept and the base game is ready offline.'));

    // Electron can leave the document focused while its text-editing host is
    // not after a native dialog, logout, or taskbar switch. Reassert focus on
    // the exact auth field the player clicked, without selecting/replacing any
    // text. Capturing pointerdown also keeps gameplay key handlers from stealing
    // the first keystroke after the account screen reopens.
    const authTextFieldSelector = [
        '#onlineStartupGate input',
        '#mpAuthView input',
        '#mpAccountDangerModal input'
    ].join(',');
    document.addEventListener('pointerdown', (event) => {
        const input = event.target?.closest?.(authTextFieldSelector);
        if (!input || input.disabled || input.readOnly) return;
        event.stopPropagation();
        requestAnimationFrame(() => {
            window.focus();
            input.focus({ preventScroll: true });
        });
    }, true);
    window.addEventListener('focus', () => {
        if (elements.onlineStartupGate.classList.contains('unlocked')) return;
        const active = document.activeElement;
        if (active?.matches?.(authTextFieldSelector)) return;
        const target = elements.startupVerify.classList.contains('open')
            ? elements.startupVerifyCode
            : elements.startupLoginUsername;
        requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    });

    elements.onlineConsentYes.addEventListener('click', () => finishOnlineConsent(true));
    elements.onlineConsentNo.addEventListener('click', () => finishOnlineConsent(false));
    elements.onlineConsentModal.addEventListener('click', (event) => {
        if (event.target === elements.onlineConsentModal) finishOnlineConsent(false);
    });
    elements.mpCreateRoomBtn.addEventListener('click', () => { elements.mpHomeError.textContent = ''; syncAccountCosmetics(); send({ type: 'create_room', skin: currentSkin(), equippedTitle: currentTitle(), titleStyle: currentTitleStyle(), settings: { victory: 'last_alive', targetScore: 25, durationSeconds: 120, lives: 1, pipeGap: 'normal', movingPipes: false, friendlyPractice: false } }); });
    elements.mpJoinRoomBtn.addEventListener('click', () => { elements.mpHomeError.textContent = ''; syncAccountCosmetics(); send({ type: 'join_room', code: elements.mpJoinCode.value, skin: currentSkin(), equippedTitle: currentTitle(), titleStyle: currentTitleStyle() }); });
    elements.mpJoinCode.addEventListener('input', () => { elements.mpJoinCode.value = elements.mpJoinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    elements.mpCopyRoomBtn.addEventListener('click', () => state.room && copyText(state.room.code, elements.mpCopyRoomBtn));
    elements.mpVictorySelect.addEventListener('change', sendSettings);
    elements.mpTargetScore.addEventListener('change', sendSettings);
    elements.mpDuration.addEventListener('change', sendSettings);
    elements.mpLivesSelect.addEventListener('change', sendSettings);
    elements.mpGapSelect.addEventListener('change', sendSettings);
    elements.mpMovingPipes.addEventListener('change', sendSettings);
    elements.mpFriendlyPractice.addEventListener('change', sendSettings);
    elements.mpReadyBtn.addEventListener('click', () => {
        const me = state.room?.players.find((player) => player.id === state.playerId);
        send({ type: 'set_ready', ready: !me?.ready });
    });
    elements.mpStartMatchBtn.addEventListener('click', () => {
        const pending = state.pendingRoomSettings;
        send({
            type: 'start_match',
            settings: pending?.settings || collectRoomSettings(),
            settingsRevision: pending?.revision || state.roomSettingsRevision
        });
    });
    elements.mpLeaveRoomBtn.addEventListener('click', () => {
        send({ type: 'leave_room' });
        if (state.party) send({ type: 'leave_party' });
        state.room = null;
        setView(elements.mpHomeView);
    });
    elements.mpReturnLobbyBtn.addEventListener('click', () => {
        closeResult();
        if (state.room?.ranked) {
            send({ type: 'leave_room' });
            state.room = null;
            send({ type: 'get_ranked' });
            setView(elements.mpHomeView);
        } else setView(elements.mpLobbyView);
    });
    elements.multiplayerCanvas.addEventListener('pointerdown', (event) => { event.preventDefault(); flapRace(); });
    multiplayerButton.addEventListener('click', openMultiplayer);
    monkeyWorldButton.addEventListener('click', openMonkeyWorld);
    onlineDefenseButton.addEventListener('click', openOnlineDefense);
    onlineHubButton.addEventListener('click', openOnlineHub);
    elements.onlineHubClose.addEventListener('click', () => closeOnlineHub());
    elements.onlineHubSocial.addEventListener('click', openSharedSocial);
    elements.onlineHubWorld.addEventListener('click', () => {
        if (monkeyWorld.onlineHubReturn) { closeOnlineHub(); return; }
        closeOnlineHub({ restoreWorld:false }); openMonkeyWorld();
    });
    elements.onlineHubDefense.addEventListener('click', () => { const fromWorld = monkeyWorld.onlineHubReturn; monkeyWorld.onlineHubReturn = false; closeOnlineHub({ restoreWorld:false }); if (fromWorld) closeMonkeyWorld(); openOnlineDefense(); });
    elements.onlineHubRace.addEventListener('click', () => { const fromWorld = monkeyWorld.onlineHubReturn; monkeyWorld.onlineHubReturn = false; closeOnlineHub({ restoreWorld:false }); if (fromWorld) closeMonkeyWorld(); openMultiplayer(); });
    elements.odLeave.addEventListener('click', async () => {
        if (onlineDefense.active && !onlineDefense.completed && !await gameConfirm(
            'Leave this Online Defense match? Public ranked matches count as a loss when you leave early.',
            { title:'Leave Active Match?', confirmLabel:'Leave Match', cancelLabel:'Keep Playing', danger:true }
        )) return;
        closeOnlineDefense();
    });
    elements.odSocial.addEventListener('click', openSharedSocial);
    elements.odQueueVersus.addEventListener('click', () => { elements.odMenuError.textContent = ''; send({ type: 'defense_queue', mode: 'versus' }); });
    elements.odQueueCoop.addEventListener('click', () => { elements.odMenuError.textContent = ''; send({ type: 'defense_queue', mode: 'coop' }); });
    elements.odCancelQueue.addEventListener('click', () => send({ type: 'defense_cancel_queue' }));
    elements.odCreateVersus.addEventListener('click', () => { elements.odMenuError.textContent = ''; send({ type: 'defense_create_room', mode: 'versus' }); });
    elements.odCreateCoop.addEventListener('click', () => { elements.odMenuError.textContent = ''; send({ type: 'defense_create_room', mode: 'coop' }); });
    elements.odJoinForm.addEventListener('submit', (event) => { event.preventDefault(); elements.odMenuError.textContent = ''; send({ type: 'defense_join_room', code: elements.odJoinCode.value }); });
    elements.odJoinCode.addEventListener('input', () => { elements.odJoinCode.value = elements.odJoinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    elements.odCopyCode.addEventListener('click', () => onlineDefense.room?.code && copyText(onlineDefense.room.code, elements.odCopyCode));
    elements.odStartPrivate.addEventListener('click', () => send({ type: 'defense_start_room' }));
    elements.odLeaveRoom.addEventListener('click', () => {
        send({ type: 'defense_leave' });
        if (state.party) send({ type: 'leave_party' });
    });
    elements.odForfeit.addEventListener('click', async () => {
        if (!await gameConfirm('Leave this Online Defense match? This counts as a loss in public ranked play.', { title:'Forfeit Match?', confirmLabel:'Leave Match', danger:true })) return;
        send({ type: 'defense_leave' });
        if (state.party) send({ type: 'leave_party' });
    });
    elements.odResultReturn.addEventListener('click', () => {
        elements.odResult.classList.remove('open');
        elements.odResult.setAttribute('aria-hidden', 'true');
        onlineDefense.resultOpen = false;
        send({ type: 'defense_leave' });
        onlineDefense.room = null;
        setDefenseView(elements.odMenu);
        send({ type: 'defense_get_rank' });
    });
    elements.onlineDefenseCanvas.addEventListener('pointerdown', (event) => {
        if (!onlineDefense.active || Date.now() < onlineDefense.localStartAt) return;
        const bounds = elements.onlineDefenseCanvas.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width * elements.onlineDefenseCanvas.width;
        const y = (event.clientY - bounds.top) / bounds.height * elements.onlineDefenseCanvas.height;
        const giantPresent=onlineDefense.traps.find((trap)=>trap.type==='giant-present'&&!trap.opened&&trap.until>Date.now()&&Math.hypot(trap.x-x,trap.y-y)<=60);
        if(giantPresent){
            const openedAt=Date.now(),summaries=[];giantPresent.opened=true;giantPresent.until=openedAt;onlineDefense.traps=onlineDefense.traps.filter((trap)=>trap!==giantPresent);
            addOnlineDefenseEffect('reward-popup',openedAt,3500,{title:'GIANT PRESENT OPENED!',entries:summaries,color:'#bba2ff'});
            for(let rewardIndex=0;rewardIndex<4;rewardIndex+=1){const roll=Math.random();if(roll<.34){const bananas=35+Math.floor(Math.random()*36);onlineDefense.bananaRewardsEarned+=bananas;summaries.push(`+${bananas} bananas`);}else if(roll<.54&&onlineDefense.lives<20){const hearts=Math.min(20-onlineDefense.lives,1+Math.floor(Math.random()*3));onlineDefense.lives+=hearts;summaries.push(`+${hearts} Grove Heart${hearts===1?'':'s'}`);}else if(roll<.78){onlineDefense.rallyUntil=Math.max(onlineDefense.rallyUntil,openedAt+5000);summaries.push('5-second Tower Rally');}else{const targets=onlineDefense.enemies.filter((enemy)=>enemy.hp>0).sort((a,b)=>b.hp-a.hp).slice(0,5);targets.forEach((enemy)=>damageOnlineDefenseEnemy(enemy,Number(giantPresent.damage||28)*1.8,giantPresent.towerType));summaries.push(`gift blast hit ${targets.length}`);}}
            addOnlineDefenseEffect('present-explosion',openedAt,1600,{x:giantPresent.x,y:giantPresent.y});onlineDefense.screenShakeUntil=openedAt+250;elements.odDefenseStatus.textContent=`GIANT PRESENT OPENED: ${summaries.join(' · ')}!`;reportDefenseProgress(true);return;
        }
        const partyPresent=onlineDefense.traps.find((trap)=>trap.type==='party-present'&&!trap.opened&&trap.until>Date.now()&&Math.hypot(trap.x-x,trap.y-y)<=43);
        if(partyPresent){
            const openedAt=Date.now();let rewardText='';partyPresent.opened=true;partyPresent.until=openedAt;onlineDefense.traps=onlineDefense.traps.filter((trap)=>trap!==partyPresent);
            if(Math.random()<.55){const reward=20+Math.floor(Math.random()*31);onlineDefense.bananaRewardsEarned+=reward;rewardText=`+${reward} build bananas`;elements.odDefenseStatus.textContent=`Birthday present opened: +${reward} build bananas!`;}
            else{onlineDefense.rallyUntil=Math.max(onlineDefense.rallyUntil,openedAt+5000);rewardText='5-second Tower Rally';elements.odDefenseStatus.textContent='Birthday present opened: 5-second Tower Rally!';}
            addOnlineDefenseEffect('present-explosion',openedAt,1300,{x:partyPresent.x,y:partyPresent.y});addOnlineDefenseEffect('reward-popup',openedAt,3000,{title:'BIRTHDAY PRESENT!',entries:[rewardText||'Reward collected'],color:'#ff77bc'});
            reportDefenseProgress(true);return;
        }
        const placements = (onlineDefense.room?.placements || []).filter((tower) => onlineDefense.room?.mode === 'coop' || tower.ownerId === state.playerId);
        const clickedTower = placements
            .filter((tower) => Math.hypot(tower.x - x, tower.y - y) <= 35)
            .sort((first, second) => Math.hypot(first.x - x, first.y - y) - Math.hypot(second.x - x, second.y - y))[0];
        if (clickedTower) {
            onlineDefense.selectedPlacementId = clickedTower.id;
            onlineDefense.hoverPoint = null;
            elements.odGameError.textContent = '';
            updateDefenseHud();
            return;
        }
        onlineDefense.selectedPlacementId = null;
        if (distanceFromOnlineDefensePath(x, y) < 52) { elements.odGameError.textContent = 'Place Monkey Defenders away from the Monkey Invader path.'; updateDefenseHud(); return; }
        if (placements.some((tower) => Math.hypot(tower.x - x, tower.y - y) < 54)) { elements.odGameError.textContent = 'Leave more room between Monkey Defenders.'; updateDefenseHud(); return; }
        elements.odGameError.textContent = '';
        send({ type: 'defense_place', towerType: onlineDefense.selectedTower, x, y });
        updateDefenseHud();
    });
    elements.onlineDefenseCanvas.addEventListener('pointermove', (event) => {
        if (!onlineDefense.active) return;
        const bounds = elements.onlineDefenseCanvas.getBoundingClientRect();
        onlineDefense.hoverPoint = {
            x: (event.clientX - bounds.left) / bounds.width * elements.onlineDefenseCanvas.width,
            y: (event.clientY - bounds.top) / bounds.height * elements.onlineDefenseCanvas.height
        };
    });
    elements.onlineDefenseCanvas.addEventListener('pointerleave', () => { onlineDefense.hoverPoint = null; });
    [['odUpgradePower', 'power'], ['odUpgradeTactical', 'tactical']].forEach(([buttonId, path]) => {
        elements[buttonId].addEventListener('click', () => {
            if (!onlineDefense.selectedPlacementId) return;
            elements.odGameError.textContent = '';
            send({ type: 'defense_upgrade', towerId: onlineDefense.selectedPlacementId, path });
        });
    });
    elements.odSell.addEventListener('click', () => {
        if (!onlineDefense.selectedPlacementId) return;
        elements.odGameError.textContent = '';
        send({ type: 'defense_sell', towerId: onlineDefense.selectedPlacementId });
        onlineDefense.selectedPlacementId = null;
    });
    elements.odPowerRepair.addEventListener('click', () => useOnlineDefensePower('repair'));
    elements.odPowerFreeze.addEventListener('click', () => useOnlineDefensePower('freeze'));
    elements.odPowerBomb.addEventListener('click', () => useOnlineDefensePower('bomb'));
    elements.odPowerRally.addEventListener('click', () => useOnlineDefensePower('rally'));
    elements.odStartWave.addEventListener('click', () => {
        if (!onlineDefense.awaitingWaveStart || onlineDefense.completed) return;
        elements.odGameError.textContent = '';
        send({ type: 'defense_start_wave', wave: onlineDefense.wave + 1 });
    });
    elements.odFastForward.addEventListener('click', () => {
        const speeds = [1, 2, 3];
        const current = speeds.indexOf(onlineDefense.simulationSpeed);
        onlineDefense.simulationSpeed = speeds[(current + 1) % speeds.length];
        elements.odFastForward.textContent = `Fast Forward: ${onlineDefense.simulationSpeed}x`;
        elements.odDefenseStatus.textContent = onlineDefense.simulationSpeed === 1 ? 'Normal defense speed.' : `Defense simulation running at ${onlineDefense.simulationSpeed}x speed.`;
    });
    elements.onlineDefenseScreen.addEventListener('click', (event) => {
        const tower = event.target.closest('[data-od-tower]');
        if (!tower) return;
        onlineDefense.selectedTower = tower.dataset.odTower;
        onlineDefense.selectedPlacementId = null;
        elements.odGameError.textContent = '';
        elements.onlineDefenseScreen.querySelectorAll('[data-od-tower]').forEach((button) => button.classList.toggle('active', button === tower));
        updateDefenseHud();
    });
    elements.mwLeave.addEventListener('click', async () => {
        if (monkeyWorld.joined && !await gameConfirm(
            'Leave Monkey World and return to the game lobby?',
            { title:'Leave Monkey World?', confirmLabel:'Leave World', cancelLabel:'Stay Here' }
        )) return;
        closeMonkeyWorld();
    });
    elements.mwSocial.addEventListener('click', openSharedSocial);
    elements.mpCloseSocialCenter.addEventListener('click', closeSharedSocial);
    elements.mwJoinPublic.addEventListener('click', () => { elements.mwJoinError.textContent = ''; send({ type: 'join_public_monkey_world' }); });
    elements.mwCreatePrivate.addEventListener('click', () => { elements.mwJoinError.textContent = ''; send({ type: 'create_private_monkey_world' }); });
    elements.mwJoinPrivate.addEventListener('submit', (event) => { event.preventDefault(); elements.mwJoinError.textContent = ''; send({ type: 'join_private_monkey_world', code: elements.mwPrivateCode.value }); });
    elements.mwPrivateCode.addEventListener('input', () => { elements.mwPrivateCode.value = elements.mwPrivateCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    elements.mwChatForm.addEventListener('submit', (event) => { event.preventDefault(); const text = sanitizeOutgoingMessage(elements.mwChatInput.value); if (text && sendMonkeyWorldChat(text)) elements.mwChatInput.value = ''; });
    elements.mwChatToggle.addEventListener('click', () => elements.mwGame.classList.toggle('chat-collapsed'));
    elements.mwChatClose.addEventListener('click', () => elements.mwGame.classList.add('chat-collapsed'));
    elements.mwChatMessages.addEventListener('click', async (event) => {
        const profile = event.target.closest('[data-chat-profile]');
        if (profile) { send({ type: 'get_public_profile', userId: profile.dataset.chatProfile }); return; }
        const button = event.target.closest('[data-delete-world-message]');
        if (button && await gameConfirm('Delete this message from the world chat?', { title:'Delete Message?', confirmLabel:'Delete', danger:true })) send({ type: 'delete_monkey_world_message', messageId: button.dataset.deleteWorldMessage });
    });
    const resetWorldTouchStick = (event) => {
        if (event && monkeyWorld.touchPointerId !== null && event.pointerId !== monkeyWorld.touchPointerId) return;
        monkeyWorld.touchX = 0;
        monkeyWorld.touchY = 0;
        monkeyWorld.touchPointerId = null;
        elements.mwTouchKnob.style.transform = 'translate(0px, 0px)';
    };
    const updateWorldTouchStick = (event) => {
        if (monkeyWorld.touchPointerId !== null && event.pointerId !== monkeyWorld.touchPointerId) return;
        const rect = elements.mwTouchStick.getBoundingClientRect();
        const radius = Math.max(24, Math.min(rect.width, rect.height) * .34);
        let x = event.clientX - (rect.left + rect.width / 2);
        let y = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(x, y);
        if (distance > radius) { x = x / distance * radius; y = y / distance * radius; }
        const normalizedX = x / radius;
        const normalizedY = y / radius;
        monkeyWorld.touchX = Math.abs(normalizedX) < .08 ? 0 : normalizedX;
        monkeyWorld.touchY = Math.abs(normalizedY) < .08 ? 0 : normalizedY;
        elements.mwTouchKnob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    };
    elements.mwTouchStick.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        monkeyWorld.touchPointerId = event.pointerId;
        elements.mwTouchStick.setPointerCapture?.(event.pointerId);
        updateWorldTouchStick(event);
    });
    elements.mwTouchStick.addEventListener('pointermove', (event) => {
        if (event.pointerId !== monkeyWorld.touchPointerId) return;
        event.preventDefault();
        updateWorldTouchStick(event);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((eventName) => {
        elements.mwTouchStick.addEventListener(eventName, resetWorldTouchStick);
    });
    elements.mwInteract.addEventListener('click', () => openWorldBuilding(monkeyWorld.nearbyBuilding));
    elements.mwCloseBuilding.addEventListener('click', closeWorldBuilding);
    elements.mwBuildingModal.addEventListener('click', (event) => { if (event.target === elements.mwBuildingModal) closeWorldBuilding(); });
    elements.mwBuildingContent.addEventListener('click', (event) => {
        if (event.target.closest('[data-world-exit]')) { closeWorldBuilding(); return; }
        const shop = event.target.closest('[data-world-shop]');
        if (shop) {
            const tab = shop.dataset.worldShop;
            pauseWorldForExistingMenu('shopBtn', () => document.querySelector(`.shop-tab[data-tab="${tab}"]`)?.click());
            return;
        }
        const wardrobe = event.target.closest('[data-world-wardrobe]');
        if (wardrobe) { pauseWorldForExistingMenu(wardrobe.dataset.worldWardrobe === 'skins' ? 'skinBtn' : 'titlesBtn'); return; }
        if (event.target.closest('#mwOpenClanHall')) {
            closeWorldBuilding();
            monkeyWorld.pausedForMenu = true;
            monkeyWorld.keys.clear();
            elements.monkeyWorldScreen.classList.add('menu-underlay');
            openClanModal();
            return;
        }
        if (event.target.closest('[data-world-social]')) { closeWorldBuilding(); openSharedSocial(); return; }
        if (event.target.closest('[data-world-online]')) { openOnlineHubFromWorld(); return; }
        if (event.target.closest('[data-world-activity="smoothie"]')) showToast('Banana smoothie enjoyed! You feel ready to explore.');
    });
    for (const closeId of ['closeShopMenu', 'closeSkinMenu', 'closeTitlesMenu']) {
        document.getElementById(closeId)?.addEventListener('click', () => restoreWorldAfterMenu(true));
    }
    window.addEventListener('keydown', (event) => {
        if (!monkeyWorld.joined || event.code !== 'Escape') return;
        if (elements.mwBuildingModal.classList.contains('open')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeWorldBuilding();
            return;
        }
        if (monkeyWorld.pausedForMenu) {
            const overlayClosers = [
                ['mpRewardModal', 'mpCloseRewardModal'],
                ['mpGiftModal', 'mpCancelGift'],
                ['mpPublicProfileModal', 'mpClosePublicProfile'],
                ['mpGroupModal', 'mpCloseGroupModal'],
                ['mpClanModal', 'mpCloseClan'],
                ['crateOpeningPopup', 'closeCrateBtn'],
                ['unlockPopup', 'unlockOkBtn'],
                ['powerupsInfoPopup', 'closePowerupsInfo'],
                ['customTitleColorPopup', 'closeTitleColorBtn'],
                ['mpSocialCenter', 'mpCloseSocialCenter'],
                ['onlineModesScreen', 'onlineHubClose']
            ];
            for (const [overlayId, closeId] of overlayClosers) {
                const overlay = document.getElementById(overlayId);
                if (!elementIsVisible(overlay)) continue;
                event.preventDefault();
                event.stopImmediatePropagation();
                const closeButton = document.getElementById(closeId);
                // Protected crate reveals deliberately keep their button
                // disabled. Do not let Escape fall through and close the shop
                // or Monkey World underneath the running reveal.
                if (closeButton && !closeButton.disabled) closeButton.click();
                return;
            }
            const menuClosers = [
                ['shopMenu', 'closeShopMenu'],
                ['skinMenu', 'closeSkinMenu'],
                ['titlesMenu', 'closeTitlesMenu']
            ];
            for (const [menuId, closeId] of menuClosers) {
                const menu = document.getElementById(menuId);
                if (!menu || getComputedStyle(menu).display === 'none') continue;
                event.preventDefault();
                event.stopImmediatePropagation();
                document.getElementById(closeId)?.click();
                restoreWorldAfterMenu(true);
                return;
            }
        }
    }, true);
    window.addEventListener('keydown', (event) => {
        if (!monkeyWorld.joined || !elements.monkeyWorldScreen.classList.contains('open')) return;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) { monkeyWorld.keys.add(event.code); event.preventDefault(); }
        if (event.code === 'KeyE' && !elements.mwBuildingModal.classList.contains('open') && monkeyWorld.nearbyBuilding) { openWorldBuilding(monkeyWorld.nearbyBuilding); event.preventDefault(); }
    });
    window.addEventListener('keyup', (event) => monkeyWorld.keys.delete(event.code));
    elements.mpBackBtn.addEventListener('click', async () => {
        if (race.active && !await gameConfirm(
            'Leave this Online Race before it ends? Public ranked matches count as a loss when you leave early.',
            { title:'Leave Active Race?', confirmLabel:'Leave Race', cancelLabel:'Keep Racing', danger:true }
        )) return;
        closeMultiplayer();
    });
    const sendSocialAction = (message) => {
        state.pendingSocialAction = true;
        elements.mpSocialError.textContent = '';
        if (!send(message)) {
            state.pendingSocialAction = false;
            return false;
        }
        return true;
    };
    elements.mpAddFriendBtn.addEventListener('click', () => {
        const targetUserId = elements.mpFriendUserId.value.trim().toUpperCase();
        if (!targetUserId) { elements.mpSocialError.textContent = 'Paste a User ID first.'; return; }
        sendSocialAction({ type: 'send_friend_request', targetUserId });
        elements.mpFriendUserId.value = '';
    });
    elements.mpFriendUserId.addEventListener('input', () => {
        elements.mpFriendUserId.value = elements.mpFriendUserId.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 60);
    });
    elements.mpSocialPanel.addEventListener('click', async (event) => {
        const clanButton = event.target.closest('[data-clan-action]');
        if (clanButton) {
            const action = clanButton.dataset.clanAction;
            const clanId = clanButton.dataset.clanId;
            if (action === 'accept') sendSocialAction({ type: 'accept_clan_invite', clanId });
            else if (action === 'decline') sendSocialAction({ type: 'decline_clan_invite', clanId });
            return;
        }
        const partyButton = event.target.closest('[data-party-action]');
        if (partyButton) {
            const action = partyButton.dataset.partyAction;
            const partyId = partyButton.dataset.partyId;
            const userId = partyButton.dataset.userId;
            const messages = {
                accept: { type: 'accept_party_invite', partyId },
                decline: { type: 'decline_party_invite', partyId },
                leave: { type: 'leave_party' },
                kick: { type: 'kick_party_member', userId },
                promote: { type: 'promote_party_leader', userId }
            };
            if (action === 'kick' && !await gameConfirm('Remove this player from the party?', { title:'Remove Party Member?', confirmLabel:'Remove', danger:true })) return;
            if (action === 'promote' && !await gameConfirm('Make this player the new party leader?', { title:'Promote Party Leader?', confirmLabel:'Promote' })) return;
            if (action === 'leave' && !await gameConfirm('Leave or disband this party?', { title:'Leave Party?', confirmLabel:'Leave Party', danger:true })) return;
            if (messages[action]) sendSocialAction(messages[action]);
            return;
        }
        const groupButton = event.target.closest('[data-group-id]');
        if (groupButton) { selectGroup(groupButton.dataset.groupId); return; }
        const button = event.target.closest('[data-social-action]');
        if (!button) return;
        const userId = button.dataset.userId;
        const action = button.dataset.socialAction;
        if (action === 'profile') { sendSocialAction({ type: 'get_public_profile', userId }); return; }
        if (action === 'party-invite') { sendSocialAction({ type: 'invite_to_party', userId }); return; }
        if (action === 'lobby-invite') { sendSocialAction({ type: 'invite_to_lobby', userId }); return; }
        if (action === 'world-invite') { sendSocialAction({ type: 'invite_to_monkey_world', userId }); return; }
        if (action === 'defense-invite') { sendSocialAction({ type: 'defense_invite', userId }); return; }
        if (action === 'clan-invite') { sendSocialAction({ type: 'invite_to_clan', userId }); return; }
        if (action === 'message') { selectFriend(userId); return; }
        if (action === 'gift') { openGiftModal(userId); return; }
        if (action === 'remove' && !await gameConfirm('Remove this player from your friends list?', { title:'Remove Friend?', confirmLabel:'Remove', danger:true })) return;
        if (action === 'block' && !await gameConfirm('Block this player? This removes any friendship and stops requests and messages.', { title:'Block Player?', confirmLabel:'Block', danger:true })) return;
        const messageTypes = {
            accept: 'accept_friend_request',
            decline: 'decline_friend_request',
            cancel: 'cancel_friend_request',
            remove: 'remove_friend',
            block: 'block_user',
            unblock: 'unblock_user'
        };
        if (messageTypes[action]) sendSocialAction({ type: messageTypes[action], userId });
    });
    elements.mpCreateParty.addEventListener('click', () => sendSocialAction({ type: 'create_party' }));
    elements.mpOpenClan.addEventListener('click', openClanModal);
    elements.mpCloseClan.addEventListener('click', closeClanModal);
    elements.mpClanModal.addEventListener('click', (event) => { if (event.target === elements.mpClanModal) closeClanModal(); });
    elements.mpClanContent.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-clan-action]');
        if (actionButton) {
            const action = actionButton.dataset.clanAction;
            const clanId = actionButton.dataset.clanId;
            const userId = actionButton.dataset.userId;
            if (['leave', 'kick', 'officer', 'owner'].includes(action) && !await gameConfirm(
                action === 'leave' ? 'Leave or disband this clan?'
                    : action === 'kick' ? 'Remove this player from the clan?'
                        : action === 'owner' ? 'Transfer clan ownership to this player?'
                            : 'Change this member\'s officer role?'
            , { title:'Confirm Clan Change', confirmLabel:'Confirm', danger:action !== 'officer' })) return;
            const messages = {
                accept: { type: 'accept_clan_invite', clanId },
                decline: { type: 'decline_clan_invite', clanId },
                leave: { type: 'leave_clan' },
                kick: { type: 'manage_clan_member', userId, action: 'kick' },
                officer: { type: 'manage_clan_member', userId, action: 'officer' },
                owner: { type: 'manage_clan_member', userId, action: 'owner' }
            };
            if (messages[action]) send(messages[action]);
            return;
        }
        if (event.target.closest('#mpChooseClanIcon')) document.getElementById('mpClanIconFile')?.click();
        if (event.target.closest('#mpChooseClanBanner')) document.getElementById('mpClanBannerFile')?.click();
    });
    elements.mpClanContent.addEventListener('change', (event) => {
        const input = event.target;
        if (!['mpClanIconFile', 'mpClanBannerFile'].includes(input.id)) return;
        const file = input.files?.[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 1.5 * 1024 * 1024) {
            elements.mpClanError.textContent = 'Choose a PNG, JPEG, WebP, or GIF no larger than 1.5 MB.';
            input.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (input.id === 'mpClanIconFile') state.pendingClanIcon = String(reader.result || '');
            else state.pendingClanBanner = String(reader.result || '');
            elements.mpClanError.textContent = `${file.name} is ready. Choose Save Branding to apply it.`;
        };
        reader.onerror = () => { elements.mpClanError.textContent = 'That clan image could not be read.'; };
        reader.readAsDataURL(file);
    });
    elements.mpClanContent.addEventListener('submit', (event) => {
        event.preventDefault();
        if (event.target.id === 'mpCreateClanForm') {
            send({ type: 'create_clan', name: document.getElementById('mpClanName')?.value, tag: document.getElementById('mpClanTag')?.value });
            return;
        }
        if (event.target.id === 'mpClanBrandingForm') {
            const message = { type: 'update_clan_branding' };
            if (state.pendingClanIcon) message.iconData = state.pendingClanIcon;
            if (state.pendingClanBanner) message.bannerData = state.pendingClanBanner;
            const color = document.getElementById('mpClanColor');
            const tagColor = document.getElementById('mpClanTagColor');
            if (color && !color.disabled) message.color = color.value;
            if (tagColor && !tagColor.disabled) message.tagColor = tagColor.value;
            if (send(message)) {
                state.pendingClanIcon = null;
                state.pendingClanBanner = null;
                elements.mpClanError.textContent = 'Saving clan branding…';
            }
        }
    });
    elements.mpRankedQueue.addEventListener('click', () => send({ type: state.rankedQueued ? 'leave_ranked_queue' : 'join_ranked_queue' }));
    elements.mpOpenRanked.addEventListener('click', openRankedModal);
    elements.mpCloseRanked.addEventListener('click', closeRankedModal);
    elements.mpRankedModal.addEventListener('click', (event) => { if (event.target === elements.mpRankedModal) closeRankedModal(); });
    elements.mpRankedContent.addEventListener('click', async (event) => {
        const profile = event.target.closest('[data-ranked-profile]');
        if (profile) { send({ type: 'get_public_profile', userId: profile.dataset.rankedProfile }); return; }
        if (event.target.closest('#mpOwnerRemoveRank')) {
            const userId = document.getElementById('mpOwnerRankUser')?.value.trim().toUpperCase();
            if (!userId) { elements.mpRankedError.textContent = 'Enter a User ID first.'; return; }
            if (await gameConfirm('Remove this player from the active ranked leaderboard and reset their current RP?', { title:'Reset Player Rank?', confirmLabel:'Reset Rank', danger:true })) send({ type: 'owner_remove_rank', userId });
        }
        if (event.target.closest('#mpOwnerResetRanks') && await gameConfirm('Archive and reset EVERY account rank? This affects the entire game.', { title:'Reset All Ranks?', confirmLabel:'Reset Every Rank', danger:true })) {
            send({ type: 'owner_reset_all_ranks' });
        }
    });
    elements.mpRankedContent.addEventListener('submit', (event) => {
        if (event.target.id !== 'mpOwnerRankForm') return;
        event.preventDefault();
        const userId = document.getElementById('mpOwnerRankUser')?.value.trim().toUpperCase();
        const rank = document.getElementById('mpOwnerRankSelect')?.value;
        if (!userId) { elements.mpRankedError.textContent = 'Enter a User ID first.'; return; }
        send({ type: 'owner_set_rank', userId, rank });
    });
    elements.mpMessageForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = sanitizeOutgoingMessage(elements.mpMessageInput.value);
        const attachment = state.pendingMessageAttachment;
        if ((!state.activeFriendId && !state.activeGroupId) || (!text && !attachment?.data)) return;
        const sent = sendSocialAction(state.activeGroupId
            ? { type: 'send_group_message', groupId: state.activeGroupId, text, mediaData: attachment?.data || '', mediaName: attachment?.name || '' }
            : { type: 'send_friend_message', userId: state.activeFriendId, text, mediaData: attachment?.data || '', mediaName: attachment?.name || '' });
        if (!sent) return;
        state.pendingMessageDraft = { text, attachment };
        elements.mpMessageInput.value = '';
        clearPendingMessageAttachment();
    });
    elements.mpMessageAttach.addEventListener('click', () => elements.mpMessageFile.click());
    elements.mpMessageFile.addEventListener('change', async () => {
        const file = elements.mpMessageFile.files?.[0];
        if (!file) return clearPendingMessageAttachment();
        elements.mpMessageAttach.disabled = true;
        elements.mpSocialError.textContent = 'Preparing image for chat…';
        try {
            const prepared = await prepareChatAttachment(file);
            state.pendingMessageAttachment = prepared;
            showPendingMessageAttachment(prepared);
            elements.mpSocialError.textContent = '';
        } catch (error) {
            clearPendingMessageAttachment();
            elements.mpSocialError.textContent = error.message;
        } finally {
            elements.mpMessageAttach.disabled = false;
        }
    });
    elements.mpMessageAttachment.addEventListener('click', (event) => {
        if (event.target.closest('[data-remove-attachment]')) clearPendingMessageAttachment();
    });
    elements.mpMessages.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-delete-message]');
        if (!button || !await gameConfirm('Delete this message for everyone in this conversation?', { title:'Delete Message?', confirmLabel:'Delete', danger:true })) return;
        const messageId = button.dataset.deleteMessage;
        if (!sendSocialAction(state.activeGroupId
            ? { type: 'delete_group_message', groupId: state.activeGroupId, messageId: button.dataset.deleteMessage }
            : { type: 'delete_friend_message', messageId: button.dataset.deleteMessage })) return;
        state.deletedSocialMessageIds.add(messageId);
        state.pendingChatAction = { type: 'delete', messageId };
        if (state.activeGroupId) {
            const group = state.social.groups?.find((entry) => entry.id === state.activeGroupId);
            if (group) group.messages = (group.messages || []).filter((entry) => entry.id !== messageId);
        } else {
            state.social.messages = (state.social.messages || []).filter((entry) => entry.id !== messageId);
        }
        renderSocial();
    });
    elements.mpClearConversation.addEventListener('click', async () => {
        if (!state.activeFriendId || !await gameConfirm('Clear all messages in this conversation for both players?', { title:'Clear Conversation?', confirmLabel:'Clear Chat', danger:true })) return;
        const friendId = state.activeFriendId;
        if (!sendSocialAction({ type: 'clear_friend_conversation', userId: friendId })) return;
        state.clearedFriendConversations.set(friendId, Date.now() + state.serverOffset);
        state.pendingChatAction = { type: 'clear', friendId };
        state.social.messages = (state.social.messages || []).filter((entry) => entry.fromId !== friendId && entry.toId !== friendId);
        renderSocial();
    });
    elements.mpCreateGroup.addEventListener('click', () => openGroupModal());
    elements.mpGroupSettings.addEventListener('click', () => {
        const group = state.social.groups?.find((entry) => entry.id === state.activeGroupId);
        if (group) openGroupModal(group);
    });
    elements.mpCloseGroupModal.addEventListener('click', closeGroupModal);
    elements.mpGroupModal.addEventListener('click', (event) => { if (event.target === elements.mpGroupModal) closeGroupModal(); });
    elements.mpChooseGroupIcon.addEventListener('click', () => elements.mpGroupIconFile.click());
    elements.mpClearGroupIcon.addEventListener('click', () => {
        state.pendingGroupIcon = '';
        elements.mpGroupIconPreview.src = 'Default Monkey.png';
    });
    elements.mpGroupIconFile.addEventListener('change', () => {
        const file = elements.mpGroupIconFile.files?.[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 1.5 * 1024 * 1024) {
            elements.mpGroupError.textContent = 'Choose a PNG, JPEG, WebP, or GIF no larger than 1.5 MB.';
            elements.mpGroupIconFile.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            state.pendingGroupIcon = String(reader.result || '');
            elements.mpGroupIconPreview.src = state.pendingGroupIcon;
            elements.mpGroupError.textContent = '';
        };
        reader.onerror = () => { elements.mpGroupError.textContent = 'That group icon could not be read.'; };
        reader.readAsDataURL(file);
    });
    elements.mpGroupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const memberIds = [...elements.mpGroupMembers.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
        if (!memberIds.length) { elements.mpGroupError.textContent = 'Choose at least one friend.'; return; }
        const message = {
            type: state.editingGroupId ? 'update_group_chat' : 'create_group_chat',
            groupId: state.editingGroupId,
            name: elements.mpGroupName.value,
            memberIds
        };
        if (state.pendingGroupIcon === '') message.clearIcon = true;
        else if (state.pendingGroupIcon) message.iconData = state.pendingGroupIcon;
        state.pendingGroupAction = true;
        elements.mpGroupError.textContent = 'Saving group with the online server…';
        elements.mpSaveGroup.disabled = true;
        elements.mpSaveGroup.textContent = state.editingGroupId ? 'Saving…' : 'Creating…';
        if (!send(message)) {
            state.pendingGroupAction = false;
            elements.mpSaveGroup.disabled = false;
            elements.mpSaveGroup.textContent = state.editingGroupId ? 'Save Group' : 'Create Group';
            elements.mpGroupError.textContent = 'Not connected. Reconnect to the online server and try again.';
        }
    });
    elements.mpLeaveGroup.addEventListener('click', async () => {
        if (!state.editingGroupId || !await gameConfirm('Leave this group chat?', { title:'Leave Group?', confirmLabel:'Leave Group', danger:true })) return;
        sendSocialAction({ type: 'leave_group_chat', groupId: state.editingGroupId });
        state.activeGroupId = null;
        closeGroupModal();
    });
    elements.mpDeleteGroup.addEventListener('click', async () => {
        if (!state.editingGroupId || !await gameConfirm('Permanently delete this group chat for every member?', { title:'Delete Group Chat?', confirmLabel:'Delete Group', danger:true })) return;
        sendSocialAction({ type: 'delete_group_chat', groupId: state.editingGroupId });
        state.activeGroupId = null;
        closeGroupModal();
    });
    elements.mpInboxButton.addEventListener('click', () => openInbox('gifts'));
    elements.mpActivityButton.addEventListener('click', openActivityFeed);
    elements.mpConnectShortcut.addEventListener('click', async () => {
        if (!await requestOnlineAccess('Online features')) return;
        try {
            if (hasSavedLogin()) showStartupReconnect(`Connecting ${state.account?.username || 'your saved account'}…`);
            else lockAccountGate('Connect your Online Account, or close this window to keep playing offline.');
            await connect();
        } catch (error) {
            if (hasSavedLogin()) {
                showStartupReconnect(`${error.message} Reconnecting automatically…`);
                scheduleReconnect();
            } else showStartupAuth(error.message);
        }
    });
    elements.mpGoOfflineShortcut.addEventListener('click', async () => {
        if (await gameConfirm('Disconnect from online features and keep playing offline? Your saved login will be kept.', { title:'Go Offline?', confirmLabel:'Go Offline' })) {
            goOffline('You are offline now. Your saved login is still ready whenever you reconnect.');
            updateActivityButton();
        }
    });
    elements.mpFriendsShortcut.addEventListener('click', () => {
        if (!state.authenticated || state.socket?.readyState !== WebSocket.OPEN) return;
        openSharedSocial();
    });
    elements.mpCloseActivity.addEventListener('click', closeActivityFeed);
    elements.mpActivityModal.addEventListener('click', (event) => { if (event.target === elements.mpActivityModal) closeActivityFeed(); });
    elements.mpActivityForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = sanitizeOutgoingMessage(elements.mpActivityInput.value);
        if (!text) return;
        elements.mpActivityError.textContent = '';
        if (send({ type: 'send_activity_message', text })) elements.mpActivityInput.value = '';
    });
    elements.mpActivityList.addEventListener('click', async (event) => {
        const profile = event.target.closest('[data-chat-profile]');
        if (profile) { send({ type: 'get_public_profile', userId: profile.dataset.chatProfile }); return; }
        const button = event.target.closest('[data-delete-activity]');
        if (button && await gameConfirm('Delete this entry from the global activity feed?', { title:'Delete Feed Entry?', confirmLabel:'Delete', danger:true })) {
            const entryId = button.dataset.deleteActivity;
            if (send({ type: 'delete_activity_entry', entryId })) {
                state.activityFeed = state.activityFeed.filter((entry) => entry.id !== entryId);
                renderActivityFeed();
            }
        }
    });
    elements.mpClosePublicProfile.addEventListener('click', closePublicProfile);
    elements.mpPublicProfileModal.addEventListener('click', (event) => { if (event.target === elements.mpPublicProfileModal) closePublicProfile(); });
    elements.mpCloseInbox.addEventListener('click', closeInbox);
    elements.mpShowGifts.addEventListener('click', () => renderInbox('gifts'));
    elements.mpShowAnnouncements.addEventListener('click', () => renderInbox('announcements'));
    elements.mpInboxModal.addEventListener('click', (event) => { if (event.target === elements.mpInboxModal) closeInbox(); });
    elements.mpInboxList.addEventListener('click', async (event) => {
        const deleteAnnouncement = event.target.closest('[data-delete-announcement]');
        if (deleteAnnouncement) {
            if (await gameConfirm('Delete this global announcement from every player inbox?', { title:'Delete Announcement?', confirmLabel:'Delete for Everyone', danger:true })) send({ type: 'delete_global_announcement', announcementId: deleteAnnouncement.dataset.deleteAnnouncement });
            return;
        }
        const button = event.target.closest('[data-claim-gift]');
        if (button) claimGift(button.dataset.claimGift);
    });

    // The inbox belongs to the main lobby only. Re-check after any menu/game interaction
    // and whenever a screen opens or closes programmatically.
    ['click', 'keydown', 'pointerup', 'transitionend'].forEach((eventName) => {
        document.addEventListener(eventName, () => setTimeout(() => { updateInboxButton(); updateActivityButton(); }, 0), true);
    });
    new MutationObserver(() => { updateInboxButton(); updateActivityButton(); }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });
    updateInboxButton();
    updateActivityButton();
    elements.mpGiftItem.addEventListener('change', updateGiftCost);
    elements.mpCancelGift.addEventListener('click', closeGiftModal);
    elements.mpGiftModal.addEventListener('click', (event) => { if (event.target === elements.mpGiftModal) closeGiftModal(); });
    elements.mpGiftForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const item = giftCatalog()[Number(elements.mpGiftItem.value) || 0];
        const balance = Number.parseInt(localStorage.getItem('monkeyCoins') || '0', 10);
        if (!item || !state.giftFriendId) return;
        if (balance < item.price) {
            elements.mpGiftError.textContent = `You need ${(item.price - balance).toLocaleString()} more Bananas for this gift.`;
            return;
        }
        const requestId = `GIFTREQ_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        state.pendingGift = { requestId, item };
        elements.mpGiftError.textContent = 'Wrapping your gift…';
        send({
            type: 'send_gift',
            requestId,
            userId: state.giftFriendId,
            giftType: item.giftType,
            itemId: item.itemId,
            label: item.label,
            price: item.price,
            amount: item.amount || 1,
            message: elements.mpGiftMessage.value
        });
    });
    elements.mpDangerForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!state.dangerAction) return;
        const confirmation = elements.mpDangerPhrase.value.trim().toUpperCase();
        const requiredPhrase = state.dangerAction === 'delete' ? 'DELETE' : 'RESET';
        if (confirmation !== requiredPhrase) {
            elements.mpDangerError.textContent = `Type ${requiredPhrase} exactly to continue.`;
            return;
        }
        elements.mpDangerError.textContent = '';
        if (state.dangerAction === 'reset') {
            const activeIdentity = accountStorage.readActiveAccount(localStorage);
            const cachedAccount = state.account || readBestCachedProfile(state.socketUrl) || (activeIdentity?.accountId ? {
                id: activeIdentity.accountId,
                username: localStorage.getItem('customUsername') || '',
                profilePicture: localStorage.getItem('profilePic') || ''
            } : null);
            const resetAccount = resetAccountSnapshot(cachedAccount);
            const keepSession = Boolean(localStorage.getItem(sessionKey()));
            const activeAccountId = resetAccount?.id || activeIdentity?.accountId || '';
            const queueReset = Boolean(activeAccountId);
            if (queueReset) localStorage.setItem(pendingOfflineResetKey(activeAccountId, state.socketUrl), 'yes');

            const clearNow = () => clearLocalProgress({
                account: resetAccount,
                // A progress reset must never silently log out a saved account.
                keepSession,
                // The server reset is durable and will finish after reconnecting,
                // while the local game remains completely reset immediately.
                pendingOfflineReset: queueReset
            });

            const canResetOnline = state.authenticated
                && state.socket?.readyState === WebSocket.OPEN
                && state.serverCapabilities.includes('account_reset_v2');
            if (canResetOnline && send({
                type: 'reset_account_progress',
                password: elements.mpDangerPassword.value,
                confirmation
            })) {
                // A socket can report OPEN while its server is unavailable or
                // mid-restart. Never let that half-open state block the local
                // reset: a successful reply cancels this naturally by reloading.
                setTimeout(() => {
                    if (activeAccountId && localStorage.getItem(pendingOfflineResetKey(activeAccountId, state.socketUrl)) !== 'yes') return;
                    clearNow();
                }, 650);
                return;
            }

            clearNow();
            return;
        }
        if (state.dangerAction === 'delete') {
            send({
                type: 'delete_account',
                password: elements.mpDangerPassword.value,
                confirmation
            });
            return;
        }
    });
    elements.mpDangerCancel.addEventListener('click', closeDangerModal);
    elements.mpAccountDangerModal.addEventListener('click', (event) => { if (event.target === elements.mpAccountDangerModal) closeDangerModal(); });
    const resetProgressButton = document.getElementById('resetBtn');
    if (resetProgressButton) {
        resetProgressButton.textContent = '🔃 Reset All Progress';
        const updateResetProgressVisibility = () => {
            const hidden = Boolean(window.flappyGuestSession);
            resetProgressButton.hidden = hidden;
            resetProgressButton.style.display = hidden ? 'none' : '';
            resetProgressButton.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        };
        updateResetProgressVisibility();
        resetProgressButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (window.flappyGuestSession) return;
            openDangerModal('reset');
        }, true);
        document.getElementById('settingsBtn')?.addEventListener('click', updateResetProgressVisibility);
    }
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
        setTimeout(() => {
            ensureOnlineSettingsPanel();
            updateOnlineSettingsPanel();
        }, 0);
    });
    document.getElementById('settingsPopup')?.addEventListener('flappy:settings-close', resetOwnerGrantControls);

    window.addEventListener('keydown', (event) => {
        if (elements.mpAccountDangerModal.classList.contains('open') && event.code === 'Escape') {
            event.preventDefault();
            closeDangerModal();
            return;
        }
        if (!elements.multiplayerScreen.classList.contains('open')) return;
        const typing = event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
        if (typing) return;
        if (race.active && (event.code === (window.gameControls?.flap || 'Space') || event.code === 'Space')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            flapRace();
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if (elements.onlineStartupGate.classList.contains('unlocked')) return;
        if (event.target?.closest?.('input,textarea,select,button,[contenteditable="true"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    window.isMultiplayerRaceActive = () => race.active;
    window.multiplayerControllerFlap = flapRace;
    window.openMultiplayer = openMultiplayer;
    window.requireFlappyOnline = async (featureName = 'Online Features') => {
        const allowed = await requestOnlineAccess(featureName);
        if (!allowed) return false;
        try {
            await connect();
            return true;
        } catch (error) {
            if (hasSavedLogin()) scheduleReconnect();
            showToast(error.message, true);
            return false;
        }
    };
    async function waitForAuthenticatedAccount(timeoutMs = 8000) {
        const startedAt = Date.now();
        while (!state.authenticated) {
            if (Date.now() - startedAt >= timeoutMs) throw new Error('Your online account did not finish reconnecting. Open Online Race and log in again.');
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return state.account;
    }

    async function prepareOnlineProfileChange() {
        if (!await requestOnlineAccess('Online Profile')) throw new Error('Username and profile-picture changes require an online connection.');
        await connect();
        await waitForAuthenticatedAccount();
    }

    window.flappySaveOfflineProfileIdentity = (username, profilePicture = '') => {
        const safeUsername = String(username || '').trim().substring(0, 18);
        const activeIdentity = accountStorage.readActiveAccount(localStorage);
        const cached = state.account || readBestCachedProfile(state.socketUrl) || {};
        const accountId = String(cached.id || activeIdentity?.accountId || '').trim();
        if (!accountId) {
            showToast('Guest profiles are temporary. Create an account before changing your name or profile picture.', true);
            return null;
        }
        const updated = {
            ...cached,
            ...(accountId ? { id: accountId } : {}),
            username: safeUsername,
            profilePicture: String(profilePicture || cached.profilePicture || localStorage.getItem('profilePic') || '')
        };
        localStorage.setItem('customUsername', safeUsername);
        if (updated.profilePicture) localStorage.setItem('profilePic', updated.profilePicture);
        if (accountId) {
            const identity = {
                serverUrl: activeIdentity?.serverUrl || state.socketUrl,
                accountId
            };
            accountStorage.writeCachedIdentity(localStorage, identity, updated);
            localStorage.setItem(PROFILE_PREFIX + identity.serverUrl, JSON.stringify(updated));
            state.account = updated;
            window.flappyActiveOnlineAccount = { ...updated };
            window.dispatchEvent(new CustomEvent('flappy-online-profile', { detail: updated }));
        }
        return { ...updated };
    };

    window.flappyUpdateOnlineUsername = async (username) => {
        await prepareOnlineProfileChange();
        if (state.pendingProfileAction) throw new Error('Another profile change is still saving.');
        return new Promise((resolve, reject) => {
            state.pendingProfileAction = { kind: 'username', resolve, reject };
            if (!send({ type: 'change_username', username })) {
                state.pendingProfileAction = null;
                reject(new Error('Not connected to the online account server.'));
            }
        });
    };

    window.flappyUpdateOnlineProfilePicture = async (mediaData) => {
        await prepareOnlineProfileChange();
        if (state.pendingProfileAction) throw new Error('Another profile change is still saving.');
        return new Promise((resolve, reject) => {
            state.pendingProfileAction = { kind: 'picture', resolve, reject };
            if (!send({ type: 'update_profile_picture', mediaData })) {
                state.pendingProfileAction = null;
                reject(new Error('Not connected to the online account server.'));
            }
        });
    };
    window.flappyGoOffline = goOffline;
    window.isFlappyOnline = () => Boolean(state.onlineOptIn && state.authenticated && state.socket?.readyState === WebSocket.OPEN);
    window.reportFlappyClanScore = (score) => {
        const safeScore = Math.max(0, Math.floor(Number(score) || 0));
        return safeScore > 0 && state.clan ? send({ type: 'report_clan_score', score: safeScore }) : false;
    };
    window.flappyReportMobileScore = (score) => {
        const safeScore = Math.max(0, Math.floor(Number(score) || 0));
        if (!LOCAL_MOBILE_DEVICE || safeScore < 25) return false;
        const previous = Math.max(0, Math.floor(Number(localStorage.getItem(PENDING_MOBILE_SCORE_KEY)) || 0));
        localStorage.setItem(PENDING_MOBILE_SCORE_KEY, String(Math.max(previous, safeScore)));
        if (state.authenticated && state.socket?.readyState === WebSocket.OPEN) {
            return send({ type:'claim_mobile_score_skin', score:safeScore });
        }
        showToast('Score 25+ reached on mobile! Sign in or reconnect Online so Mobile Monkey can be saved to your account.');
        return false;
    };
    window.reportFlappyGameStarted = (mode) => state.authenticated && send({ type: 'report_game_started', mode });

    window.addEventListener('blur', () => { if (state.authenticated) send({ type: 'set_presence', status: 'away' }); });
    window.addEventListener('focus', () => { if (state.authenticated) send({ type: 'set_presence', status: 'online' }); });
    window.addEventListener('flappy-skins-changed', () => scheduleAccountCosmeticsSync());
    window.addEventListener('flappy-xp-changed', () => scheduleAccountCosmeticsSync());
    window.addEventListener('flappy-title-appearance-changed', () => {
        const liveTitle = localTitleProfile();
        if (state.account) {
            state.account = { ...state.account, ...liveTitle };
            state.activityFeed = state.activityFeed.map((entry) => entry.userId === state.account.id ? { ...entry, ...liveTitle } : entry);
            renderProfile();
            if (state.room) renderLobby();
            if (onlineDefense.room) renderDefenseRoom();
            if (elements.mpActivityModal.classList.contains('open')) renderActivityFeed();
            if (elements.mpSocialCenter.classList.contains('open')) renderSocial();
            if (monkeyWorld.joined) renderMonkeyWorldChat();
            if (state.publicProfile?.id === state.account.id && elements.mpPublicProfileModal.classList.contains('open')) {
                renderPublicProfile({ ...state.publicProfile, ...liveTitle });
            }
        }
        if (state.authenticated && state.socket?.readyState === WebSocket.OPEN && !baseGameIsActivelyRunning()) {
            syncAccountCosmetics(true);
        } else {
            scheduleAccountCosmeticsSync(true);
        }
    });
    window.addEventListener('flappy-collection-changed', () => scheduleAccountCosmeticsSync(true));
    window.addEventListener('flappy-collection-index-claimed', () => scheduleAccountCosmeticsSync(true));
    window.addEventListener('beforeunload', () => accountStorage.snapshotActiveAccount?.(localStorage));
    window.addEventListener('flappy-birthday-claim', () => {
        if (state.authenticated) send({ type: 'claim_birthday_bash' });
    });
    window.addEventListener('flappy-crate-result', (event) => {
        if (state.authenticated) send({ type: 'report_crate_result', ...(event.detail || {}) });
    });
    installEmojiPicker(elements.mpMessageForm, elements.mpMessageInput);
    installEmojiPicker(elements.mpActivityForm, elements.mpActivityInput);
    installEmojiPicker(elements.mwChatForm, elements.mwChatInput);
    window.addEventListener('flappy-emojis-changed', () => { installedEmojiPickers.forEach(renderEmojiPicker); scheduleAccountCosmeticsSync(true); });
    document.addEventListener('click', (event) => {
        if (event.target.closest('.fm-emoji-picker')) return;
        document.querySelectorAll('.fm-emoji-picker.open').forEach((picker) => picker.classList.remove('open'));
    });
    window.setInterval(renderLiveEvent, 1000);

    // This also carries the durable account cloud snapshot. A few seconds is
    // responsive enough for progress safety without serializing the inventory
    // on every animation beat.
    setInterval(() => scheduleAccountCosmeticsSync(), 15_000);

    setTimeout(() => {
        ensureOnlineSettingsPanel();
        if (state.account) {
            persistProfile(state.account);
        }
        if (sessionStorage.getItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY) === 'yes') {
            state.onlineOptIn = true;
            sessionStorage.setItem('flappyOnlineOptIn', 'yes');
            const notice = sessionStorage.getItem('flappyPostReloadNotice') || 'You logged out. Log in again, create an account, or explicitly choose temporary guest mode.';
            sessionStorage.removeItem('flappyPostReloadNotice');
            lockAccountGate(notice);
            connect(DEFAULT_SERVER).catch((error) => {
                elements.startupAuthError.textContent = `${notice} ${error.message}`;
            });
            return;
        }
        if (state.onlineOptIn) {
            connect(DEFAULT_SERVER).catch((error) => {
                if (hasSavedLogin()) {
                    // Never trap the base game behind an unavailable service.
                    // Keep the session token and allow a manual reconnect later.
                    goOffline(`${error.message} Playing offline for now; your saved login was kept.`);
                } else showStartupAuth(error.message);
            });
        } else {
            elements.onlineStartupGate.classList.add('unlocked');
            elements.onlineStartupGate.setAttribute('aria-hidden', 'true');
            setConnection('Offline');
        }
    }, 0);
})();
