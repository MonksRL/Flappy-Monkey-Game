(function monkeyWorldEventsClient() {
    'use strict';

    let bridge = null;
    let event = null;
    let active = false;
    let lastAutoCollectAt = 0;
    let lastEventId = '';
    let effects = [];
    let images = new Map();
    let slipperyX = 0;
    let slipperyY = 0;
    let rewardModalOpen = false;
    let lastDanceStepAt = 0;
    let lastDancePosition = null;
    const npcDisplayPositions = new Map();

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
    }

    function image(file) {
        if (!images.has(file)) { const entry = new Image(); entry.src = file; images.set(file, entry); }
        return images.get(file);
    }

    function ensureUi() {
        const root = document.getElementById('mwGame');
        if (!root || document.getElementById('mwEventHud')) return;
        root.insertAdjacentHTML('beforeend', `
            <div id="mwEventAtmosphere" class="mw-event-hidden" aria-hidden="true"></div>
            <section id="mwEventHud" class="mw-event-hidden" aria-live="polite"></section>
            <aside id="mwEventLeaderboard" class="mw-event-hidden"></aside>
            <div id="mwEventActions" class="mw-event-hidden"></div>
            <div id="mwEventRespawn" class="mw-event-hidden"></div>
            <div id="mwEventRewardModal" aria-hidden="true"><div class="mw-event-reward-box"><h2>Event Rewards</h2><p></p><div class="mw-event-reward-items"></div><button type="button">Collect & Close</button></div></div>`);
        document.querySelector('#mwEventRewardModal button')?.addEventListener('click', closeRewards);
    }

    function attach(value) { bridge = value; ensureUi(); }

    function localId() { return bridge?.localId?.() || ''; }
    function localPlayer() { return bridge?.localPlayer?.() || null; }
    function localStats() { return event?.localStats || event?.leaderboard?.find((entry) => entry.profileId === localId()) || null; }

    function formatTime(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return 'OBJECTIVE';
        const seconds = Math.max(0, Math.ceil(ms / 1000));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
    }

    function titleMarkup(player) {
        const title = player?.equippedTitle && player.equippedTitle !== 'None' ? player.equippedTitle : '';
        if (!title) return '';
        const style = player.titleStyle || {};
        const flag = value => value === true || value === 1 || value === 'true' || value === '1';
        const rgb = flag(style.rgb);
        const classes = [rgb || style.fx === 'neonpulse' ? 'rgb' : '', flag(style.gradient) && !rgb ? 'gradient' : '', flag(style.glow) ? 'glow' : '', ['fire','sparkle','glitch'].includes(style.fx) ? style.fx : ''].filter(Boolean).join(' ');
        const color = /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : '#ffffff';
        const speed = Math.max(.35, Math.min(8, Number(style.rgbSpeed) || 3));
        return `<span class="mw-event-player-title ${classes}" style="--event-title-color:${color};--event-title-speed:${speed}s">${escapeHtml(title)}</span>`;
    }

    function nameMarkup(player) {
        const style = player?.nameStyle && typeof player.nameStyle === 'object' ? player.nameStyle : {};
        const flag = value => value === true || value === 1 || value === 'true' || value === '1';
        const rgb = flag(style.rgb);
        const color = /^#[0-9a-f]{6}$/i.test(String(style.color || '')) ? String(style.color).toLowerCase() : '#fff3a5';
        const speed = Math.max(.35, Math.min(8, Number(style.rgbSpeed) || 3));
        const classes = ['flappy-name-style', flag(style.glow) ? 'flappy-name-glow' : '', rgb ? 'flappy-name-rgb' : '', flag(style.gradient) && !rgb ? 'flappy-name-gradient' : ''].filter(Boolean).join(' ');
        return `<span class="${classes}" style="--flappy-name-color:${color};--flappy-name-speed:${speed}s">${escapeHtml(player?.username || 'Monkey')}</span>`;
    }

    const EVENT_PRESENTATION = Object.freeze({
        banana_rain:{ label:'COLLECTION EVENT', image:'assets/banners/banner-banana-peel.png' },
        snowstorm:{ label:'WEATHER EVENT' },
        firework_festival:{ label:'NIGHT FESTIVAL', image:'assets/event-vault/firework-festival.png' },
        dance_party:{ label:'SOCIAL EVENT' },
        boss_breaker:{ label:'WORLD BOSS', image:'assets/event-vault/boss-breaker.png' },
        pirate_invasion:{ label:'CO-OP INVASION', image:'assets/event-vault/x-marks-the-spot.png' },
        monkey_pvp:{ label:'PLAYER COMBAT', image:'assets/event-vault/pvp-champion.png' },
        last_monkey_standing:{ label:'ELIMINATION EVENT', image:'assets/event-vault/last-monkey-standing.png' }
    });

    function eventIconMarkup() {
        const presentation = EVENT_PRESENTATION[event?.type] || {};
        return presentation.image
            ? `<img src="${presentation.image}" alt="" draggable="false">`
            : escapeHtml(event?.icon || '✦');
    }

    function renderHud() {
        ensureUi();
        const hud = document.getElementById('mwEventHud');
        const board = document.getElementById('mwEventLeaderboard');
        const actions = document.getElementById('mwEventActions');
        const respawn = document.getElementById('mwEventRespawn');
        const atmosphere = document.getElementById('mwEventAtmosphere');
        const worldScreen = document.getElementById('monkeyWorldScreen');
        const worldGame = document.getElementById('mwGame');
        const inVisibleWorld = Boolean(
            worldScreen?.classList.contains('open')
            && worldScreen.getAttribute('aria-hidden') !== 'true'
            && !worldScreen.classList.contains('menu-underlay')
            && worldGame
            && !worldGame.classList.contains('mp-hidden')
        );
        if (!event || !active || !inVisibleWorld) {
            [hud,board,actions,respawn,atmosphere].forEach((element) => element?.classList.add('mw-event-hidden'));
            return;
        }
        const stats = localStats();
        const remaining = event.endsAt ? event.endsAt - (Date.now() + (bridge?.serverOffset?.() || 0)) : 0;
        const boss = event.boss;
        const wave = event.type === 'pirate_invasion' ? ` · Wave ${event.wave}/${event.totalWaves}` : '';
        const extra = event.type === 'banana_rain' ? ` · ${stats?.bananas || 0} caught` : event.type === 'dance_party' ? ` · Combo ${stats?.combo || 0}` : event.type === 'boss_breaker' ? ` · ${Math.floor(stats?.damage || 0)} damage` : '';
        const presentation = EVENT_PRESENTATION[event.type] || { label:'MONKEY WORLD EVENT' };
        hud.dataset.eventType = event.type;
        atmosphere?.classList.remove('mw-event-hidden');
        hud.classList.remove('mw-event-hidden');
        hud.innerHTML = `<div class="mw-event-hud-head"><span class="mw-event-hud-icon">${eventIconMarkup()}</span><div class="mw-event-hud-copy"><span class="mw-event-hud-kicker">${presentation.label}</span><strong>${escapeHtml(event.name)}${wave}${extra}</strong><span>${escapeHtml(event.description)}</span></div><span class="mw-event-timer">${formatTime(remaining)}</span></div>
            ${event.combat ? `<div class="mw-event-bars"><div class="mw-event-bar mw-event-health"><i style="width:${Math.max(0,stats?.health || 0)}%"></i><span>HEALTH ${Math.ceil(stats?.health || 0)}/100</span></div>${event.shield ? `<div class="mw-event-bar mw-event-shield"><i style="width:${Math.max(0,(stats?.shield || 0) / 50 * 100)}%"></i><span>SHIELD ${Math.ceil(stats?.shield || 0)}/50</span></div>` : '<div></div>'}${boss ? `<div class="mw-event-bar mw-event-boss"><i style="width:${Math.max(0,boss.hp / boss.maxHp * 100)}%"></i><span>${escapeHtml(boss.name)} · ${Math.ceil(boss.hp).toLocaleString()} / ${boss.maxHp.toLocaleString()}</span></div>` : ''}</div>` : ''}`;

        const showBoard = event.type === 'monkey_pvp' || event.type === 'last_monkey_standing';
        board.classList.toggle('mw-event-hidden', !showBoard);
        if (showBoard) {
            const sorted = [...(event.leaderboard || [])].sort((a,b) => event.type === 'monkey_pvp' ? b.kills - a.kills || b.damage - a.damage : Number(b.alive) - Number(a.alive) || b.health - a.health);
            board.innerHTML = `<h3>${event.type === 'monkey_pvp' ? 'PvP Kill Leaderboard' : 'Monkeys Still Standing'}</h3>${sorted.map((player,index) => `<div class="mw-event-leader-row" ${window.FlappyBanners?.attributes?.(player.banner || 'skin-default') || ''}><span class="mw-event-place">#${index + 1}</span><span class="mw-event-player-name">${nameMarkup(player)}${titleMarkup(player)}</span><span class="mw-event-score">${event.type === 'monkey_pvp' ? `${player.kills || 0} K` : player.alive ? 'ALIVE' : 'OUT'}</span></div>`).join('')}`;
        }

        const actionMarkup = event.combat && stats?.alive
            ? '<button type="button" data-mw-event-action="attack">🗡️ Swing Wood Sword · SPACE</button><button type="button" data-mw-event-action="block">🛡️ Guard · RIGHT CLICK</button>'
            : event.type === 'snowstorm'
                ? '<button type="button" data-mw-event-action="throw_snowball">❄️ Throw Snowball</button><button type="button" data-mw-event-action="build_snowman">⛄ Build Snowman</button>'
                : event.type === 'firework_festival'
                    ? '<button type="button" data-mw-event-action="firework">🎆 Launch Nearby Firework</button>'
                    : '';
        actions.classList.toggle('mw-event-hidden', !actionMarkup);
        // Do not replace focused buttons on every server-state paint. Rebuilding
        // this DOM several times per second made hover/click states flicker and
        // caused valid clicks to disappear before their pointer-up event.
        if (actions.dataset.signature !== actionMarkup) {
            actions.dataset.signature = actionMarkup;
            actions.innerHTML = actionMarkup;
            actions.querySelectorAll('[data-mw-event-action]').forEach((button) => {
                button.addEventListener('pointerdown', (input) => {
                    input.preventDefault();
                    input.stopPropagation();
                    bridge?.clearMovement?.();
                });
                button.addEventListener('click', (input) => {
                    input.preventDefault();
                    input.stopPropagation();
                    bridge?.clearMovement?.();
                    button.blur();
                    perform(button.dataset.mwEventAction);
                });
            });
        }
        const guardButton=actions.querySelector('[data-mw-event-action="block"]');
        if(guardButton){
            const guardRemaining=Math.max(0,Number(stats?.blockCooldownUntil||0)-(Date.now()+(bridge?.serverOffset?.()||0)));
            guardButton.disabled=guardRemaining>0;
            guardButton.textContent=guardRemaining>0?`🛡️ Guard recharging · ${(guardRemaining/1000).toFixed(1)}s`:'🛡️ Guard · RIGHT CLICK';
        }

        if (event.combat && stats && !stats.alive) {
            respawn.classList.remove('mw-event-hidden');
            if (event.elimination) respawn.innerHTML = '<div><span class="mw-respawn-kicker">ROUND STATUS</span><strong>ELIMINATED</strong><small>Spectating a living monkey</small></div>';
            else respawn.innerHTML = `<div><span class="mw-respawn-kicker">RETURNING TO THE PLAZA</span><strong>RESPAWNING IN ${Math.max(1,Math.ceil((stats.respawnAt - (Date.now() + (bridge?.serverOffset?.() || 0))) / 1000))}</strong><small>Your health${event.shield ? ' and shield' : ''} will be restored</small><i class="mw-respawn-progress" aria-hidden="true"></i></div>`;
        } else respawn.classList.add('mw-event-hidden');
    }

    function nearestLauncher() {
        const local = localPlayer();
        if (!local) return null;
        return [...(event?.launchers || [])].sort((a,b) => Math.hypot(local.x-a.x,local.y-a.y)-Math.hypot(local.x-b.x,local.y-b.y))[0] || null;
    }

    function perform(action) {
        if (!event || !bridge?.send) return;
        if (event.combat && localStats()?.alive === false) return;
        bridge?.clearMovement?.();
        if (action === 'firework') {
            const launcher = nearestLauncher();
            if (!launcher || Math.hypot(localPlayer().x-launcher.x,localPlayer().y-launcher.y) > 190) { bridge.toast?.('Walk beside a firework launcher first.', true); return; }
            bridge.send({ type:'monkey_world_event_action', action, launcherId:launcher.id });
        } else bridge.send({ type:'monkey_world_event_action', action });
    }

    function syncWorld(world) {
        active = Boolean(world);
        event = world?.event || null;
        const worldGame = document.getElementById('mwGame');
        if (worldGame) {
            worldGame.dataset.eventType = event?.type || '';
            worldGame.classList.toggle('mw-event-active', Boolean(event));
        }
        if (!world && rewardModalOpen) closeRewards();
        if (event?.id && event.id !== lastEventId) {
            lastEventId = event.id;
            npcDisplayPositions.clear();
            if (event.localStats?.spawn && ['monkey_pvp','last_monkey_standing'].includes(event.type)) bridge?.teleport?.(event.localStats.spawn[0], event.localStats.spawn[1]);
            bridge?.toast?.(`${event.icon} ${event.name} started!`);
        }
        if (!event) { lastEventId = ''; npcDisplayPositions.clear(); }
        if (event?.type !== 'dance_party') { lastDanceStepAt = 0; lastDancePosition = null; }
        renderHud();
    }

    function rewardIcon(reward) {
        if (reward.type === 'banana_coins') return 'powerup-banana-doubler.png';
        if (reward.type === 'xp') return 'powerup-xp-boost.png';
        if (reward.type === 'crate_ticket') return `crate-${reward.itemId}.png`;
        if (reward.type === 'skin') return reward.itemId || 'Default Monkey.png';
        if (reward.type === 'profile_background') return ({ 'firework-festival':'assets/event-vault/firework-festival.png', 'boss-breaker':'assets/event-vault/boss-breaker.png', 'x-marks-the-spot':'assets/event-vault/x-marks-the-spot.png' })[reward.itemId] || 'assets/cosmetic-icons/theme-none.png';
        if (reward.type === 'explosion_vfx') return reward.itemId === 'pvp-champion' ? 'assets/event-vault/pvp-champion.png' : `assets/cosmetic-icons/vfx-${reward.itemId}.png`;
        if (reward.type === 'pipe_skin') return reward.itemId === 'last-monkey-standing' ? 'assets/event-vault/last-monkey-standing.png' : `assets/cosmetic-icons/pipe-${reward.itemId}.png`;
        if (reward.type === 'powerup') return ({ extraLifeTokens:'powerup-extra-life.png', reviveTokens:'powerup-revive.png', coinDoublerTickets:'powerup-banana-doubler.png', scoreBoosterTickets:'powerup-score-booster.png', xpBoostTokens:'powerup-xp-boost.png', crateLuckBoostTokens:'powerup-crate-luck.png' })[reward.itemId] || 'powerup-extra-life.png';
        return 'Default Monkey.png';
    }

    function showRewards(message) {
        ensureUi();
        for (const reward of message.rewards || []) if (['profile_background','explosion_vfx','pipe_skin'].includes(reward.type)) window.FlappyAuras?.grantEventCosmetic?.(reward.itemId);
        if (message.account) bridge?.persistProfile?.(message.account);
        const modal = document.getElementById('mwEventRewardModal');
        modal.querySelector('h2').textContent = `${message.eventName || 'Event'} Rewards`;
        modal.querySelector('p').textContent = message.reason || 'Thanks for participating!';
        modal.querySelector('.mw-event-reward-items').innerHTML = (message.rewards || []).map((reward) => `<div class="mw-event-reward-item"><img src="${rewardIcon(reward)}" alt=""><strong>${reward.amount > 1 ? `${reward.amount}× ` : ''}${escapeHtml(reward.label)}</strong></div>`).join('');
        rewardModalOpen = true;
        bridge?.pauseMovement?.(true);
        modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
    }

    function closeRewards() {
        const modal=document.getElementById('mwEventRewardModal');
        rewardModalOpen = false;
        bridge?.pauseMovement?.(false);
        modal?.classList.remove('open');
        modal?.setAttribute('aria-hidden','true');
    }

    function updateCombatLifeState(effect) {
        if (!event?.combat || !effect) return;
        const profileId = String(effect.kind === 'respawn' ? effect.playerId || '' : effect.targetId || '');
        if (!profileId) return;
        const alive = effect.kind === 'respawn';
        const updateStats = (stats) => {
            if (!stats) return;
            stats.alive = alive;
            stats.health = alive ? 100 : 0;
            stats.respawnAt = alive ? 0 : Number(effect.respawnAt || 0);
            if (alive && event.shield) stats.shield = 50;
        };
        updateStats((event.leaderboard || []).find((entry) => String(entry.profileId || '') === profileId));
        if (profileId === String(localId())) updateStats(event.localStats);
    }

    function handleMessage(message) {
        if (message.type === 'monkey_world_event_effect') {
            const effect = message.effect || {};
            if (effect.kind === 'respawn' || effect.kind === 'elimination') updateCombatLifeState(effect);
            effects.push({ ...effect, localAt:performance.now() }); effects = effects.slice(-80);
            window.dispatchEvent(new CustomEvent('flappy-monkey-world-event-effect', { detail:{ ...effect, eventId:message.eventId || '' } }));
            if (effect.kind === 'respawn' && String(effect.playerId || '') === String(localId()) && Number.isFinite(Number(effect.x)) && Number.isFinite(Number(effect.y))) {
                bridge?.teleport?.(Number(effect.x),Number(effect.y));
            }
            if (effect.kind === 'respawn' || effect.kind === 'elimination') renderHud();
            if (['event_start','event_end','wave','dance_combo'].includes(effect.kind) && effect.text) bridge?.toast?.(effect.text);
        } else if (message.type === 'monkey_world_event_reward') showRewards(message);
        else if (message.type === 'owner_monkey_world_event_action') bridge?.toast?.(message.message);
    }

    function tick(now, delta) {
        if (!event || !active) return;
        const local = localPlayer();
        const stats = localStats();
        if (local && stats?.alive && now - lastAutoCollectAt > 170) {
            // Falling bananas were visually inside the monkey before the old
            // 108-unit threshold accepted them. The server independently
            // validates this slightly more forgiving pickup radius.
            const nearby = (event.entities || []).filter((entity) => Math.hypot(local.x-entity.x,local.y-entity.y) < 142).sort((a,b) => Math.hypot(local.x-a.x,local.y-a.y)-Math.hypot(local.x-b.x,local.y-b.y))[0];
            if (nearby) { lastAutoCollectAt = now; bridge.send({ type:'monkey_world_event_action', action:'collect', entityId:nearby.id }); }
        }
        if (event.type === 'dance_party' && local && stats?.alive) {
            const center = event.danceCenter || [1600,1350];
            const onFloor = Math.hypot(local.x-center[0],local.y-center[1]) <= 420;
            const previous = lastDancePosition;
            const moved = previous ? Math.hypot(local.x-previous.x,local.y-previous.y) : 0;
            if (onFloor && moved >= 18 && now-lastDanceStepAt >= 620) {
                lastDanceStepAt = now;
                bridge.send({ type:'monkey_world_event_action', action:'dance' });
                lastDancePosition = { x:local.x, y:local.y };
            }
            if (!previous || !onFloor) lastDancePosition = { x:local.x, y:local.y };
        }
        if (event.elimination && stats && !stats.alive) {
            const alive = (event.leaderboard || []).find((entry) => entry.alive && entry.profileId !== localId());
            if (alive) bridge?.focus?.(alive.x, alive.y);
        }
        effects = effects.filter((effect) => {
            const lifetime=effect.kind==='firework'?4200:effect.kind==='snowman'?12000:effect.kind==='snowball'?1100:1800;
            return now-effect.localAt<lifetime;
        });
        renderHud();
    }

    function modifyMovement(dx, dy, delta) {
        if (rewardModalOpen) return { dx:0, dy:0 };
        if (event?.combat && localStats()?.alive === false) {
            slipperyX = 0; slipperyY = 0;
            bridge?.clearMovement?.();
            return { dx:0, dy:0 };
        }
        // Snow is visual only. Forced drift made precise movement feel broken
        // and could carry a player into a reward modal or building entrance.
        slipperyX = 0; slipperyY = 0;
        return { dx, dy };
    }

    function isMovementLocked() {
        if (rewardModalOpen) return true;
        return Boolean(event?.combat && localStats()?.alive === false);
    }

    function drawPickup(context, entity, now) {
        const fallProgress = entity.type === 'banana' ? Math.min(1, Math.max(0, (Date.now() - Number(entity.createdAt || Date.now())) / 850)) : 1;
        const fallOffset = entity.type === 'banana' ? (1-fallProgress) * 150 : 0;
        context.save(); context.translate(entity.x,entity.y-fallOffset); const bob=Math.sin(now*.004+entity.x)*5; context.translate(0,bob);
        context.shadowBlur=16;
        if(entity.type==='banana'){context.font='36px Arial';context.textAlign='center';context.shadowColor='#ffe34f';context.fillText('🍌',0,8);}
        else if(entity.type==='health_potion'||entity.type==='shield_potion'){
            const shield=entity.type==='shield_potion';context.shadowColor=shield?'#45c8ff':'#ff5266';context.fillStyle=shield?'#49bfff':'#ff5266';context.strokeStyle='#f5fbff';context.lineWidth=3;context.beginPath();context.roundRect(-14,-19,28,34,8);context.fill();context.stroke();context.fillStyle='#fff';context.fillRect(-8,-28,16,9);context.font='900 17px Arial';context.textAlign='center';context.fillText(shield?'◆':'+',0,5);
        } else { context.font='42px Arial';context.textAlign='center';context.shadowColor='#ffe074';context.fillText(entity.type==='frozen_treasure'?'🧊':'🎁',0,10); }
        context.restore();
    }

    function drawBoss(context, boss, now) {
        const img=image('bossbreakermonkey.png');
        const position=smoothNpcPosition(`boss:${boss.id}`,boss,.1),attackFx=[...effects].reverse().find((fx)=>fx.kind==='boss_attack'&&now-fx.localAt<950);
        const attackProgress=attackFx?Math.min(1,(now-attackFx.localAt)/900):0;
        const windup=attackProgress>0&&attackProgress<.32?Math.sin(attackProgress/.32*Math.PI/2):0;
        const strike=attackProgress>=.32&&attackProgress<.68?Math.sin((attackProgress-.32)/.36*Math.PI):0;
        const recovery=attackProgress>=.68?1-(attackProgress-.68)/.32:0;
        const moving=Boolean(boss.moving)&&Math.hypot(position.x-position.previousX,position.y-position.previousY)>.02;
        const walkStep=moving?Math.sin(now*.012+Number(boss.x)*.01):Math.sin(now*.0025+Number(boss.y)*.01)*.18;
        const stride=Math.abs(walkStep)*(moving?8:2);
        const facing=boss.direction==='left'?-1:1,lunge=(strike*34-recovery*4)*facing;
        const squash=1-windup*.09+strike*.12,pulse=1+Math.sin(now*.003)*.015,size=190*pulse;
        context.save();context.translate(position.x+lunge,position.y-stride);context.scale(facing*(1-Math.abs(walkStep)*.025+windup*.06),squash*(1+Math.abs(walkStep)*.04));context.rotate(walkStep*.035+facing*(-windup*.08+strike*.075));context.shadowColor=attackFx?'#ffd45c':'#ff593c';context.shadowBlur=attackFx?44:24;if(img.complete&&img.naturalWidth)context.drawImage(img,-size/2,-size+38,size,size);context.restore();
    }

    function drawEnemy(context, enemy, now) {
        const img=image('Pirate Monkey.png'),position=smoothNpcPosition(`enemy:${enemy.id}`,enemy,.14);
        const attackFx=[...effects].reverse().find((fx)=>fx.kind==='pirate_attack'&&fx.attackerId===enemy.id&&now-fx.localAt<680);
        const attackProgress=attackFx?Math.min(1,(now-attackFx.localAt)/640):0;
        const windup=attackProgress>0&&attackProgress<.34?Math.sin(attackProgress/.34*Math.PI/2):0;
        const strike=attackProgress>=.34&&attackProgress<.7?Math.sin((attackProgress-.34)/.36*Math.PI):0;
        const moving=Boolean(enemy.moving)&&Math.hypot(position.x-position.previousX,position.y-position.previousY)>.02;
        const walkStep=moving?Math.sin(now*.012+Number(enemy.x)*.01):Math.sin(now*.0025+Number(enemy.y)*.01)*.18;
        const stride=Math.abs(walkStep)*(moving?5:1.2);
        const facing=enemy.direction==='left'?-1:1,lunge=strike*facing*19;
        context.save();context.translate(position.x+lunge,position.y-stride);context.scale(facing*(1-Math.abs(walkStep)*.025+strike*.05),(1+Math.abs(walkStep)*.04)*(1-windup*.08+strike*.1));context.rotate(walkStep*.035+facing*(-windup*.12+strike*.1));context.shadowColor=attackFx?'#ffe27b':'#ff594b';context.shadowBlur=attackFx?24:10;if(img.complete&&img.naturalWidth)context.drawImage(img,-42,-78,84,84);context.scale(facing,1);context.fillStyle='rgba(2,20,18,.9)';context.beginPath();context.roundRect(-45,-96,90,11,6);context.fill();context.fillStyle='#ff4655';context.beginPath();context.roundRect(-43,-94,86*Math.max(0,enemy.hp/enemy.maxHp),7,4);context.fill();context.fillStyle='#fff0a8';context.font='900 9px Arial';context.textAlign='center';context.fillText(enemy.name,0,-104);context.restore();
    }

    function smoothNpcPosition(key, entity, responsiveness) {
        const targetX=Number(entity?.x)||0,targetY=Number(entity?.y)||0;
        let position=npcDisplayPositions.get(key);
        const now=performance.now();
        if(!position){position={x:targetX,y:targetY,previousX:targetX,previousY:targetY,targetX,targetY,startX:targetX,startY:targetY,startAt:now,duration:112};npcDisplayPositions.set(key,position);return position;}
        position.previousX=position.x;position.previousY=position.y;
        const targetChanged=Math.abs(targetX-position.targetX)>.01||Math.abs(targetY-position.targetY)>.01;
        if(targetChanged){
            const distance=Math.hypot(targetX-position.x,targetY-position.y);
            if(distance>520){position.x=targetX;position.y=targetY;position.startX=targetX;position.startY=targetY;}
            else{position.startX=position.x;position.startY=position.y;}
            position.targetX=targetX;position.targetY=targetY;position.startAt=now;
            // Server NPC snapshots arrive at roughly 10 Hz. Tween across that
            // interval rather than racing to each snapshot in a few frames;
            // this removes the visible stop-and-jump motion on fast displays.
            position.duration=Math.max(94,Math.min(126,132-Number(responsiveness||.1)*120));
        }
        const progress=Math.max(0,Math.min(1,(now-position.startAt)/Math.max(1,position.duration)));
        const eased=progress*progress*(3-2*progress);
        position.x=position.startX+(position.targetX-position.startX)*eased;
        position.y=position.startY+(position.targetY-position.startY)*eased;
        return position;
    }

    function drawWoodSword(context, player, now) {
        const recent=[...effects].reverse().find((fx)=>fx.kind==='sword_swing'&&fx.attackerId===player.profileId&&now-fx.localAt<520);
        const stats=(event?.leaderboard||[]).find((entry)=>entry.profileId===player.profileId);
        const guarding=Number(stats?.blockUntil||0)>Date.now();
        const progress=recent?Math.min(1,(now-recent.localAt)/520):0;
        const facing=player.direction==='left'?-1:1;
        const sword=image('assets/duel/runtime/sword-wood-world.png?v=20260815b');
        const idleAngle=(player.direction==='up'?-.42:player.direction==='down'?.42:-.16)+Math.sin(now*.0025+player.x)*.025;
        const ease=(value)=>value*value*(3-2*value);
        let swordAngle=guarding?-.98:idleAngle;
        if(recent&&!guarding){
            if(progress<.18){const t=ease(progress/.18);swordAngle=idleAngle+(-.92-idleAngle)*t;}
            else if(progress<.58){const t=ease((progress-.18)/.4);swordAngle=-.92+(1.02+.92)*t;}
            else{const t=ease((progress-.58)/.42);swordAngle=1.02+(idleAngle-1.02)*t;}
        }
        context.save();
        // The transform origin is the sword handle, so the weapon stays in the
        // monkey's hand throughout the wind-up, strike, and recovery phases.
        context.translate(player.x+facing*19,player.y-22);
        context.scale(facing,1);
        context.rotate(swordAngle);
        context.shadowColor=recent?'#ffe678':'rgba(0,0,0,.7)';context.shadowBlur=recent?18:8;
        // Use the same recognizable Wood Sword art as Monkey Duel, cropped to
        // a transparent runtime asset and anchored at the handle. Keeping it
        // below the monkey's full height prevents the weapon hiding the skin.
        if(sword.complete&&sword.naturalWidth)context.drawImage(sword,141,0,1051,1254,-4,-74,62,74);
        context.restore();

        if(guarding){
            const pulse=(Math.sin(now*.018)+1)/2;
            context.save();context.translate(player.x+facing*7,player.y-42);context.scale(facing,1);
            context.globalAlpha=.72+pulse*.2;context.strokeStyle='#77efff';context.lineWidth=7;
            context.shadowColor='#51dcff';context.shadowBlur=22+pulse*10;context.beginPath();context.arc(0,0,39,-2.35,-.72);context.stroke();
            context.globalAlpha=.16+pulse*.08;context.fillStyle='#6eeaff';context.beginPath();context.arc(0,0,34,-2.35,-.72);context.lineTo(0,0);context.closePath();context.fill();context.restore();
        }

        if(recent&&!guarding){
            const arcProgress=Math.sin(progress*Math.PI);
            context.save();context.globalAlpha=.48*arcProgress;context.strokeStyle='#fff1a0';context.lineWidth=5;context.lineCap='round';context.shadowColor='#ffe45d';context.shadowBlur=14;context.beginPath();
            if(facing>0)context.arc(player.x+7,player.y-42,56,-1.28,.45);
            else context.arc(player.x-7,player.y-42,56,Math.PI-.45,Math.PI+1.28);
            context.stroke();context.restore();
        }
    }

    function drawDanceStage(context, now) {
        const [x,y]=event.danceCenter||[1600,1350];
        const stage=image('assets/event-vault/dance-party-stage-runtime.png?v=20260815a');
        context.save();
        context.translate(x,y);
        const beat=(Math.sin(now*.008)+1)/2;
        const stagePulse=1+beat*.012;
        context.scale(stagePulse,stagePulse);
        context.shadowColor=`hsla(${(now*.045)%360},100%,65%,.75)`;context.shadowBlur=28+beat*28;
        if(stage.complete&&stage.naturalWidth)context.drawImage(stage,-440,-440,880,880);
        context.shadowBlur=0;
        context.save();context.globalCompositeOperation='screen';context.globalAlpha=.16+beat*.18;
        const floorGlow=context.createRadialGradient(0,90,40,0,90,330);floorGlow.addColorStop(0,`hsla(${(now*.05)%360},100%,72%,.85)`);floorGlow.addColorStop(.58,`hsla(${(now*.05+120)%360},100%,55%,.38)`);floorGlow.addColorStop(1,'rgba(0,0,0,0)');context.fillStyle=floorGlow;context.beginPath();context.ellipse(0,95,345,270,0,0,Math.PI*2);context.fill();context.restore();
        context.globalCompositeOperation='lighter';
        for(let beam=0;beam<5;beam+=1){const angle=now*.00055+beam*Math.PI*.4;context.fillStyle=`hsla(${(beam*72+now*.035)%360},95%,65%,${.055+beat*.035})`;context.beginPath();context.moveTo(0,-245);context.lineTo(Math.cos(angle)*620,Math.sin(angle)*430);context.lineTo(Math.cos(angle+.13)*620,Math.sin(angle+.13)*430);context.closePath();context.fill();}
        context.restore();
    }

    function drawFireworkLauncher(context, launcher, now) {
        const art=image('assets/event-vault/firework-launcher-runtime.png?v=20260815a');
        const pulse=(Math.sin(now*.006+launcher.x*.01)+1)/2;
        context.save();context.translate(launcher.x,launcher.y);context.shadowColor='#ff63d4';context.shadowBlur=28+pulse*24;if(art.complete&&art.naturalWidth)context.drawImage(art,-84,-132,168,168);context.globalAlpha=.42+pulse*.32;context.strokeStyle='#72f3ff';context.lineWidth=4;context.beginPath();context.ellipse(0,29,61+pulse*7,21+pulse*3,0,0,Math.PI*2);context.stroke();context.restore();
    }

    function drawCombatArena(context, now) {
        if(!event.combat)return;
        const pulse=.16+Math.sin(now*.003)*.035;
        context.save();context.strokeStyle=`rgba(255,224,105,${pulse})`;context.lineWidth=9;context.setLineDash([34,22]);context.lineDashOffset=-now*.03;context.beginPath();context.ellipse(1600,1120,1220,820,0,0,Math.PI*2);context.stroke();context.restore();
    }

    function drawFireworkEffect(context, fx, age) {
        const launcher=fx.launcher||{x:1600,y:900};
        const rise=Math.min(1,age/820),burstAge=Math.max(0,age-820);
        const x=launcher.x,y=launcher.y-rise*570;
        const fade=Math.max(0,1-burstAge/3000);
        const seed=String(fx.id||'').split('').reduce((sum,char)=>sum+char.charCodeAt(0),0);
        context.save();context.globalCompositeOperation='lighter';context.shadowColor=fx.color;context.shadowBlur=22;
        if(age<820){
            context.strokeStyle=fx.color;context.lineWidth=4;context.globalAlpha=.72;context.beginPath();context.moveTo(x,launcher.y);context.quadraticCurveTo(x-18,y+120,x,y);context.stroke();context.globalAlpha=1;context.fillStyle='#fff';context.beginPath();context.arc(x,y,6,0,Math.PI*2);context.fill();
        }else{
            const flashRadius=Math.max(0,98-burstAge*.025);
            const core=context.createRadialGradient(x,y,0,x,y,Math.max(2,flashRadius));core.addColorStop(0,`rgba(255,255,255,${Math.min(1,fade*1.35)})`);core.addColorStop(.18,'rgba(255,248,190,.92)');core.addColorStop(.52,fx.color);core.addColorStop(1,'rgba(0,0,0,0)');context.globalAlpha=Math.min(1,fade*1.2);context.fillStyle=core;context.beginPath();context.arc(x,y,Math.max(2,flashRadius),0,Math.PI*2);context.fill();
            const points=42,pattern=seed%3;
            for(let index=0;index<points;index+=1){
                const angle=index/points*Math.PI*2;
                const wave=pattern===1?.72+Math.abs(Math.sin(angle*5))*.35:pattern===2?.78+Math.sin(angle*3)*.22:1;
                const distance=Math.min(205,burstAge*.18)*wave;
                const px=x+Math.cos(angle)*distance,py=y+Math.sin(angle)*distance+burstAge*burstAge*.000018;
                context.globalAlpha=Math.min(1,fade*(.72+(index%4)*.13));context.fillStyle=index%3===0?'#fffdf0':fx.color;context.beginPath();context.arc(px,py,3+(index%3)*1.2,0,Math.PI*2);context.fill();
                if(index%3===0){context.strokeStyle='#fff8cf';context.lineWidth=1.8;context.beginPath();context.moveTo(x+Math.cos(angle)*distance*.58,y+Math.sin(angle)*distance*.58);context.lineTo(px,py);context.stroke();}
                if(index%4===0){context.strokeStyle=fx.color;context.lineWidth=1.5;context.beginPath();context.moveTo(x+Math.cos(angle)*distance*.65,y+Math.sin(angle)*distance*.65);context.lineTo(px,py);context.stroke();}
            }
            if(fx.golden){context.globalAlpha=fade;context.fillStyle='#ffe05b';context.strokeStyle='#6e3a00';context.lineWidth=6;context.font='1000 38px Arial';context.textAlign='center';context.strokeText('FLAPPY MONKEY',x,y+10);context.fillText('FLAPPY MONKEY',x,y+10);}
        }
        context.restore();
    }

    function drawEventEffect(context, fx, now) {
        const age=now-fx.localAt;
        if(['damage','sword_hit'].includes(fx.kind)&&fx.amount){
            const target=(event.leaderboard||[]).find((entry)=>entry.profileId===fx.targetId);
            const x=Number.isFinite(Number(fx.x))?Number(fx.x):target?.x,y=Number.isFinite(Number(fx.y))?Number(fx.y):target?.y;
            if(Number.isFinite(x)){context.save();context.globalAlpha=Math.max(0,1-age/1500);context.fillStyle='#fff08c';context.strokeStyle='#641c13';context.lineWidth=4;context.font='1000 24px Arial';context.textAlign='center';context.strokeText(`-${fx.amount}`,x,y-100-age*.03);context.fillText(`-${fx.amount}`,x,y-100-age*.03);context.restore();}
        }
        if(fx.kind==='firework')drawFireworkEffect(context,fx,age);
        if(fx.kind==='boss_attack'){
            const progress=Math.min(1,age/900),radius=60+progress*250;
            context.save();context.globalAlpha=Math.max(0,1-progress);context.strokeStyle=fx.attack==='shockwave'?'#ffde67':'#ff644c';context.lineWidth=10-progress*7;context.shadowColor=context.strokeStyle;context.shadowBlur=25;context.beginPath();context.arc(fx.x,fx.y,radius,0,Math.PI*2);context.stroke();
            if(Number.isFinite(Number(fx.targetX))){context.setLineDash([14,10]);context.lineWidth=4;context.beginPath();context.moveTo(fx.x,fx.y);context.lineTo(fx.targetX,fx.targetY);context.stroke();}context.restore();
        }
        if(fx.kind==='pirate_attack'){
            const progress=Math.min(1,age/480),x=Number(fx.targetX),y=Number(fx.targetY);
            if(Number.isFinite(x)){context.save();context.globalAlpha=1-progress;context.translate(x,y);context.rotate(-.8+progress*1.6);context.strokeStyle='#ffe797';context.lineWidth=8;context.shadowColor='#ff873b';context.shadowBlur=18;context.beginPath();context.arc(0,0,45,-1.2,.8);context.stroke();context.restore();}
        }
        if(fx.kind==='block'||fx.kind==='parry'){
            const x=Number(fx.x),y=Number(fx.y),progress=Math.min(1,age/650);
            if(Number.isFinite(x)){context.save();context.translate(x,y-38);context.globalAlpha=1-progress;context.strokeStyle=fx.kind==='parry'?'#fff07c':'#72e8ff';context.lineWidth=7-progress*4;context.shadowColor=context.strokeStyle;context.shadowBlur=24;context.beginPath();context.arc(0,0,34+progress*28,-2.45,-.68);context.stroke();context.restore();}
        }
        if(fx.kind==='collect'||fx.kind==='treasure'||fx.kind==='heal'||fx.kind==='shield'){
            const x=Number(fx.x),y=Number(fx.y),progress=Math.min(1,age/700);
            if(Number.isFinite(x)){context.save();context.globalAlpha=1-progress;context.strokeStyle=fx.kind==='shield'?'#67d9ff':'#ffe36b';context.lineWidth=6;context.beginPath();context.arc(x,y,18+progress*56,0,Math.PI*2);context.stroke();context.restore();}
        }
        if(fx.kind==='snowman'){const fade=age>10000?Math.max(0,1-(age-10000)/2000):1;context.save();context.translate(fx.x,fx.y);context.globalAlpha=fade;context.shadowColor='#9ee7ff';context.shadowBlur=20;context.font='66px Arial';context.textAlign='center';context.fillText('⛄',0,0);context.restore();}
        if(fx.kind==='snowball'){
            const travel=Math.min(1,age/760),directions={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]},vector=directions[fx.direction]||[0,1];
            const targetX=Number.isFinite(Number(fx.targetX))?Number(fx.targetX):Number(fx.x)+vector[0]*270,targetY=Number.isFinite(Number(fx.targetY))?Number(fx.targetY):Number(fx.y)+vector[1]*270;
            const eased=travel*travel*(3-2*travel),x=Number(fx.x)+(targetX-Number(fx.x))*eased,y=Number(fx.y)+(targetY-Number(fx.y))*eased-Math.sin(travel*Math.PI)*72;
            context.save();context.translate(x,y);context.rotate(travel*Math.PI*3);context.shadowColor='#76dfff';context.shadowBlur=20;
            const snow=context.createRadialGradient(-5,-6,2,1,1,18);snow.addColorStop(0,'#ffffff');snow.addColorStop(.52,'#edfaff');snow.addColorStop(1,'#a9d9e9');context.fillStyle=snow;context.strokeStyle='#d9f6ff';context.lineWidth=2.5;
            context.beginPath();context.moveTo(-14,-4);context.quadraticCurveTo(-12,-15,-2,-16);context.quadraticCurveTo(10,-17,15,-7);context.quadraticCurveTo(19,4,11,12);context.quadraticCurveTo(1,19,-10,12);context.quadraticCurveTo(-18,5,-14,-4);context.closePath();context.fill();context.stroke();
            context.shadowBlur=0;context.fillStyle='rgba(112,178,204,.42)';for(const [dotX,dotY,size] of [[-7,-1,1.7],[4,7,1.4],[7,-6,1.2],[-3,10,1]]){context.beginPath();context.arc(dotX,dotY,size,0,Math.PI*2);context.fill();}context.restore();
            context.save();context.globalAlpha=.32*(1-travel);context.strokeStyle='#dff9ff';context.lineWidth=10;context.lineCap='round';context.beginPath();context.moveTo(Number(fx.x),Number(fx.y));context.quadraticCurveTo((Number(fx.x)+targetX)/2,(Number(fx.y)+targetY)/2-86,x,y);context.stroke();context.restore();
            if(travel>.86){const impact=(travel-.86)/.14;context.save();context.translate(targetX,targetY);context.globalAlpha=1-impact;context.strokeStyle='#dffaff';context.lineWidth=5;context.shadowColor='#7edfff';context.shadowBlur=18;for(let ray=0;ray<8;ray+=1){const angle=ray*Math.PI/4,radius=18+impact*34;context.beginPath();context.moveTo(Math.cos(angle)*10,Math.sin(angle)*10);context.lineTo(Math.cos(angle)*radius,Math.sin(angle)*radius);context.stroke();}context.restore();}
        }
    }

    function drawWorld(context, stage, data) {
        if (!event || !active) return;
        const now=data.now||performance.now();
        if(stage==='back'){
            drawCombatArena(context,now);
            if(event.type==='snowstorm'){
                const worldWidth=5200,worldHeight=3400;context.save();const chill=context.createLinearGradient(0,0,0,worldHeight*.78);chill.addColorStop(0,'rgba(225,247,255,.24)');chill.addColorStop(1,'rgba(102,177,218,.18)');context.fillStyle=chill;context.fillRect(0,0,worldWidth,worldHeight);
                for(let i=0;i<170;i+=1){const x=(i*379+now*.05*(1+i%3))%worldWidth,y=(i*193+now*.08*(1+i%4))%worldHeight;context.globalAlpha=.45+(i%4)*.12;context.fillStyle='#fff';context.beginPath();context.arc(x,y,2+i%3,0,Math.PI*2);context.fill();}context.restore();
            }
            if(event.type==='dance_party')drawDanceStage(context,now);
            for(const launcher of event.launchers||[])drawFireworkLauncher(context,launcher,now);
            for(const entity of event.entities||[])drawPickup(context,entity,now);
            if(event.boss)drawBoss(context,event.boss,now);
            for(const enemy of event.enemies||[])drawEnemy(context,enemy,now);
        }else{
            if(event.combat)for(const player of data.players||[]){const stats=(event.leaderboard||[]).find((entry)=>entry.profileId===player.profileId);if(!stats?.alive)continue;drawWoodSword(context,player,now);}
            for(const fx of effects)drawEventEffect(context,fx,now);
        }
    }

    document.addEventListener('keydown',(input)=>{
        if(!event||!active||input.repeat||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))return;
        if(input.code==='Space'&&event.combat){perform('attack');input.preventDefault();input.stopImmediatePropagation();}
        else if(input.code==='KeyF'&&event.combat){perform('attack');input.preventDefault();}
        else if(input.code==='KeyR'&&event.combat){perform('block');input.preventDefault();input.stopImmediatePropagation();}
    },true);

    document.addEventListener('contextmenu',(input)=>{
        if(!event?.combat||!active||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))return;
        input.preventDefault();input.stopImmediatePropagation();perform('block');
    },true);

    window.FlappyWorldEvents = Object.freeze({ attach, syncWorld, handleMessage, tick, drawWorld, modifyMovement, isMovementLocked, current:()=>event });
})();
