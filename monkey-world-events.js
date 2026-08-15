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

    function renderHud() {
        ensureUi();
        const hud = document.getElementById('mwEventHud');
        const board = document.getElementById('mwEventLeaderboard');
        const actions = document.getElementById('mwEventActions');
        const respawn = document.getElementById('mwEventRespawn');
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
            [hud,board,actions,respawn].forEach((element) => element?.classList.add('mw-event-hidden'));
            return;
        }
        const stats = localStats();
        const remaining = event.endsAt ? event.endsAt - (Date.now() + (bridge?.serverOffset?.() || 0)) : 0;
        const boss = event.boss;
        const wave = event.type === 'pirate_invasion' ? ` · Wave ${event.wave}/${event.totalWaves}` : '';
        const extra = event.type === 'banana_rain' ? ` · ${stats?.bananas || 0} caught` : event.type === 'dance_party' ? ` · Combo ${stats?.combo || 0}` : event.type === 'boss_breaker' ? ` · ${Math.floor(stats?.damage || 0)} damage` : '';
        hud.classList.remove('mw-event-hidden');
        hud.innerHTML = `<div class="mw-event-hud-head"><span class="mw-event-hud-icon">${event.icon}</span><div class="mw-event-hud-copy"><strong>${escapeHtml(event.name)}${wave}${extra}</strong><span>${escapeHtml(event.description)}</span></div><span class="mw-event-timer">${formatTime(remaining)}</span></div>
            ${event.combat ? `<div class="mw-event-bars"><div class="mw-event-bar mw-event-health"><i style="width:${Math.max(0,stats?.health || 0)}%"></i><span>HEALTH ${Math.ceil(stats?.health || 0)}/100</span></div>${event.shield ? `<div class="mw-event-bar mw-event-shield"><i style="width:${Math.max(0,(stats?.shield || 0) / 50 * 100)}%"></i><span>SHIELD ${Math.ceil(stats?.shield || 0)}/50</span></div>` : '<div></div>'}${boss ? `<div class="mw-event-bar mw-event-boss"><i style="width:${Math.max(0,boss.hp / boss.maxHp * 100)}%"></i><span>${escapeHtml(boss.name)} · ${Math.ceil(boss.hp).toLocaleString()} / ${boss.maxHp.toLocaleString()}</span></div>` : ''}</div>` : ''}`;

        const showBoard = event.type === 'monkey_pvp' || event.type === 'last_monkey_standing';
        board.classList.toggle('mw-event-hidden', !showBoard);
        if (showBoard) {
            const sorted = [...(event.leaderboard || [])].sort((a,b) => event.type === 'monkey_pvp' ? b.kills - a.kills || b.damage - a.damage : Number(b.alive) - Number(a.alive) || b.health - a.health);
            board.innerHTML = `<h3>${event.type === 'monkey_pvp' ? 'PvP Kill Leaderboard' : 'Monkeys Still Standing'}</h3>${sorted.map((player,index) => `<div class="mw-event-leader-row" ${window.FlappyBanners?.attributes?.(player.banner || 'skin-default') || ''}><span class="mw-event-place">#${index + 1}</span><span class="mw-event-player-name">${nameMarkup(player)}${titleMarkup(player)}</span><span class="mw-event-score">${event.type === 'monkey_pvp' ? `${player.kills || 0} K` : player.alive ? 'ALIVE' : 'OUT'}</span></div>`).join('')}`;
        }

        const actionMarkup = event.combat && stats?.alive
            ? '<button type="button" data-mw-event-action="attack">⚔️ Swing Event Sword · SPACE</button>'
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
            actions.querySelectorAll('[data-mw-event-action]').forEach((button) => button.addEventListener('click', () => {
                bridge?.clearMovement?.();
                button.blur();
                perform(button.dataset.mwEventAction);
            }));
        }

        if (event.combat && stats && !stats.alive) {
            respawn.classList.remove('mw-event-hidden');
            if (event.elimination) respawn.innerHTML = 'ELIMINATED<small>SPECTATING A LIVING MONKEY</small>';
            else respawn.innerHTML = `RESPAWNING IN ${Math.max(1,Math.ceil((stats.respawnAt - (Date.now() + (bridge?.serverOffset?.() || 0))) / 1000))}<small>Your health${event.shield ? ' and shield' : ''} will be restored</small>`;
        } else respawn.classList.add('mw-event-hidden');
    }

    function nearestLauncher() {
        const local = localPlayer();
        if (!local) return null;
        return [...(event?.launchers || [])].sort((a,b) => Math.hypot(local.x-a.x,local.y-a.y)-Math.hypot(local.x-b.x,local.y-b.y))[0] || null;
    }

    function perform(action) {
        if (!event || !bridge?.send) return;
        bridge?.clearMovement?.();
        if (action === 'firework') {
            const launcher = nearestLauncher();
            if (!launcher || Math.hypot(localPlayer().x-launcher.x,localPlayer().y-launcher.y) > 130) { bridge.toast?.('Walk beside a firework launcher first.', true); return; }
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
            if (event.localStats?.spawn && ['monkey_pvp','last_monkey_standing'].includes(event.type)) bridge?.teleport?.(event.localStats.spawn[0], event.localStats.spawn[1]);
            bridge?.toast?.(`${event.icon} ${event.name} started!`);
        }
        if (!event) lastEventId = '';
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

    function handleMessage(message) {
        if (message.type === 'monkey_world_event_effect') {
            effects.push({ ...(message.effect || {}), localAt:performance.now() }); effects = effects.slice(-80);
            window.dispatchEvent(new CustomEvent('flappy-monkey-world-event-effect', { detail:{ ...(message.effect || {}), eventId:message.eventId || '' } }));
            if (message.effect?.kind === 'respawn' && message.effect.playerId === localId()) bridge?.teleport?.(message.effect.x,message.effect.y);
            if (['event_start','event_end','wave','dance_combo'].includes(message.effect?.kind) && message.effect.text) bridge?.toast?.(message.effect.text);
        } else if (message.type === 'monkey_world_event_reward') showRewards(message);
        else if (message.type === 'owner_monkey_world_event_action') bridge?.toast?.(message.message);
    }

    function tick(now, delta) {
        if (!event || !active) return;
        const local = localPlayer();
        const stats = localStats();
        if (local && stats?.alive && now - lastAutoCollectAt > 260) {
            const nearby = (event.entities || []).filter((entity) => Math.hypot(local.x-entity.x,local.y-entity.y) < 108).sort((a,b) => Math.hypot(local.x-a.x,local.y-a.y)-Math.hypot(local.x-b.x,local.y-b.y))[0];
            if (nearby) { lastAutoCollectAt = now; bridge.send({ type:'monkey_world_event_action', action:'collect', entityId:nearby.id }); }
        }
        if (event.type === 'dance_party' && local && stats?.alive) {
            const center = event.danceCenter || [1600,930];
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
        effects = effects.filter((effect) => now - effect.localAt < (effect.kind === 'firework' ? 4200 : 1800));
        renderHud();
    }

    function modifyMovement(dx, dy, delta) {
        if (rewardModalOpen) return { dx:0, dy:0 };
        if (event?.type !== 'snowstorm') { slipperyX = 0; slipperyY = 0; return { dx, dy }; }
        const smoothing = Math.min(1, delta * 3.2);
        slipperyX += (dx - slipperyX) * smoothing;
        slipperyY += (dy - slipperyY) * smoothing;
        if (!dx) slipperyX *= .985;
        if (!dy) slipperyY *= .985;
        return { dx:slipperyX, dy:slipperyY };
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
        const img=image('bossbreakermonkey.png'); const pulse=1+Math.sin(now*.004)*.035; const size=190*pulse;
        context.save();context.translate(boss.x,boss.y);context.shadowColor='#ff593c';context.shadowBlur=28;if(img.complete&&img.naturalWidth)context.drawImage(img,-size/2,-size+38,size,size);context.restore();
    }

    function drawEnemy(context, enemy, now) {
        const img=image('Pirate Monkey.png'); const bob=Math.sin(now*.005+enemy.x)*3;context.save();context.translate(enemy.x,enemy.y+bob);context.shadowColor='#ff594b';context.shadowBlur=12;if(img.complete&&img.naturalWidth)context.drawImage(img,-42,-78,84,84);context.fillStyle='rgba(2,20,18,.9)';context.fillRect(-45,-96,90,11);context.fillStyle='#ff4655';context.fillRect(-43,-94,86*Math.max(0,enemy.hp/enemy.maxHp),7);context.fillStyle='#fff0a8';context.font='900 9px Arial';context.textAlign='center';context.fillText(enemy.name,0,-104);context.restore();
    }

    function drawWorld(context, stage, data) {
        if (!event || !active) return;
        const now=data.now||performance.now();
        if(stage==='back'){
            if(event.type==='snowstorm'){context.save();context.fillStyle='rgba(226,243,255,.3)';context.fillRect(0,0,3200,1700);context.fillStyle='rgba(246,251,255,.7)';for(let i=0;i<90;i++){const x=(i*379+now*.05*(1+i%3))%3200,y=(i*193+now*.08*(1+i%4))%1700;context.beginPath();context.arc(x,y,2+i%3,0,Math.PI*2);context.fill();}context.restore();}
            if(event.type==='dance_party'){const [x,y]=event.danceCenter||[1600,930];context.save();context.translate(x,y);for(let row=-3;row<=3;row++)for(let col=-4;col<=4;col++){const hue=(row*42+col*28+now*.08)%360;context.fillStyle=`hsla(${hue},90%,60%,.62)`;context.fillRect(col*48-22,row*38-18,44,34);}context.restore();}
            for(const launcher of event.launchers||[]){context.save();context.translate(launcher.x,launcher.y);context.fillStyle='#7f4930';context.strokeStyle='#ffe26e';context.lineWidth=3;context.beginPath();context.roundRect(-17,-28,34,48,8);context.fill();context.stroke();context.fillStyle='#ff5d53';context.fillRect(-8,-37,16,14);context.restore();}
            for(const entity of event.entities||[])drawPickup(context,entity,now);
            if(event.boss)drawBoss(context,event.boss,now);
            for(const enemy of event.enemies||[])drawEnemy(context,enemy,now);
        }else{
            if(event.combat)for(const player of data.players||[]){const stats=(event.leaderboard||[]).find((entry)=>entry.profileId===player.profileId);if(!stats?.alive)continue;context.save();context.translate(player.x+24,player.y-65);context.rotate(-.6+Math.sin(now*.012+player.x)*.08);context.strokeStyle='#6b3e18';context.lineWidth=6;context.beginPath();context.moveTo(0,16);context.lineTo(0,34);context.stroke();context.strokeStyle='#eaf6ff';context.shadowColor='#8cd9ff';context.shadowBlur=10;context.lineWidth=6;context.beginPath();context.moveTo(0,15);context.lineTo(0,-30);context.stroke();context.restore();}
            for(const fx of effects){const age=now-fx.localAt;if(['damage','sword_hit'].includes(fx.kind)&&fx.amount){const target=(event.leaderboard||[]).find((entry)=>entry.profileId===fx.targetId);const x=fx.x||target?.x,y=fx.y||target?.y;if(Number.isFinite(x)){context.save();context.globalAlpha=Math.max(0,1-age/1500);context.fillStyle='#fff08c';context.strokeStyle='#641c13';context.lineWidth=4;context.font='1000 24px Arial';context.textAlign='center';context.strokeText(`-${fx.amount}`,x,y-100-age*.03);context.fillText(`-${fx.amount}`,x,y-100-age*.03);context.restore();}}
                if(fx.kind==='firework'){const launcher=fx.launcher||{x:1600,y:900};const progress=Math.min(1,age/900),burstAge=Math.max(0,age-900);const x=launcher.x,y=launcher.y-progress*520;context.save();context.globalCompositeOperation='lighter';context.fillStyle=fx.color;context.shadowColor=fx.color;context.shadowBlur=18;if(age<900){context.beginPath();context.arc(x,y,5,0,Math.PI*2);context.fill();}else{for(let i=0;i<28;i++){const angle=i/28*Math.PI*2,dist=Math.min(180,burstAge*.16);context.globalAlpha=Math.max(0,1-burstAge/3000);context.beginPath();context.arc(x+Math.cos(angle)*dist,y+Math.sin(angle)*dist,3,0,Math.PI*2);context.fill();}if(fx.golden){context.globalAlpha=Math.max(0,1-burstAge/2800);context.font='1000 32px Arial';context.textAlign='center';context.fillText('FLAPPY MONKEY',x,y);}}context.restore();}
                if(fx.kind==='snowman'){context.save();context.translate(fx.x,fx.y);context.font='54px Arial';context.textAlign='center';context.fillText('⛄',0,0);context.restore();}
                if(fx.kind==='snowball'){const travel=Math.min(1,age/700),directions={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]},vector=directions[fx.direction]||[0,1];context.save();context.translate(fx.x+vector[0]*travel*230,fx.y+vector[1]*travel*230);context.fillStyle='#f5fbff';context.shadowColor='#a9e5ff';context.shadowBlur=14;context.beginPath();context.arc(0,0,13,0,Math.PI*2);context.fill();context.restore();}}
        }
    }

    document.addEventListener('keydown',(input)=>{
        if(!event||!active||input.repeat||/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))return;
        if(input.code==='Space'&&event.combat){perform('attack');input.preventDefault();input.stopImmediatePropagation();}
        else if(input.code==='KeyF'&&event.combat){perform('attack');input.preventDefault();}
    },true);

    window.FlappyWorldEvents = Object.freeze({ attach, syncWorld, handleMessage, tick, drawWorld, modifyMovement, current:()=>event });
})();
