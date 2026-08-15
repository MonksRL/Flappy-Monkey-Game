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
            ? '<button type="button" data-mw-event-action="attack">🗡️ Swing Wood Sword · SPACE</button>'
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
        if (local && stats?.alive && now - lastAutoCollectAt > 170) {
            // Falling bananas were visually inside the monkey before the old
            // 108-unit threshold accepted them. The server independently
            // validates this slightly more forgiving pickup radius.
            const nearby = (event.entities || []).filter((entity) => Math.hypot(local.x-entity.x,local.y-entity.y) < 142).sort((a,b) => Math.hypot(local.x-a.x,local.y-a.y)-Math.hypot(local.x-b.x,local.y-b.y))[0];
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
        const img=image('bossbreakermonkey.png');
        const serverNow=Date.now()+(bridge?.serverOffset?.()||0),attacking=Number(boss.attackUntil||0)>serverNow;
        const walk=boss.moving?Math.sin(now*.014)*7:Math.sin(now*.004)*2;
        const lunge=attacking?Math.sin(Math.min(1,(Number(boss.attackUntil)-serverNow)/520)*Math.PI)*18:0;
        const facing=boss.direction==='left'?-1:1,pulse=1+Math.sin(now*.004)*.025; const size=190*pulse;
        context.save();context.translate(boss.x+facing*lunge,boss.y+walk);context.scale(facing,1);context.shadowColor=attacking?'#ffd45c':'#ff593c';context.shadowBlur=attacking?42:28;if(img.complete&&img.naturalWidth)context.drawImage(img,-size/2,-size+38,size,size);context.restore();
    }

    function drawEnemy(context, enemy, now) {
        const img=image('Pirate Monkey.png'),serverNow=Date.now()+(bridge?.serverOffset?.()||0),attacking=Number(enemy.attackUntil||0)>serverNow;
        const bob=enemy.moving?Math.sin(now*.016+enemy.x)*5:Math.sin(now*.005+enemy.x)*2;
        const facing=enemy.direction==='left'?-1:1,lunge=attacking?facing*12:0;
        context.save();context.translate(enemy.x+lunge,enemy.y+bob);context.scale(facing,1);context.shadowColor=attacking?'#ffe27b':'#ff594b';context.shadowBlur=attacking?24:12;if(img.complete&&img.naturalWidth)context.drawImage(img,-42,-78,84,84);context.scale(facing,1);context.fillStyle='rgba(2,20,18,.9)';context.beginPath();context.roundRect(-45,-96,90,11,6);context.fill();context.fillStyle='#ff4655';context.beginPath();context.roundRect(-43,-94,86*Math.max(0,enemy.hp/enemy.maxHp),7,4);context.fill();context.fillStyle='#fff0a8';context.font='900 9px Arial';context.textAlign='center';context.fillText(enemy.name,0,-104);context.restore();
    }

    function drawWoodSword(context, player, now) {
        const recent=[...effects].reverse().find((fx)=>fx.kind==='sword_swing'&&fx.attackerId===player.profileId&&now-fx.localAt<430);
        const progress=recent?Math.min(1,(now-recent.localAt)/430):0;
        const facing=player.direction==='left'?-1:1;
        const baseAngle=player.direction==='up' ? Math.PI-.35 : player.direction==='down' ? .55 : (facing<0 ? Math.PI-.7 : .7);
        const swing=recent?(-1.05+progress*2.1):Math.sin(now*.0025+player.x)*.035;
        context.save();
        context.translate(player.x+(player.direction==='left'?-25:player.direction==='right'?25:18),player.y-57);
        context.rotate(baseAngle+swing);
        context.shadowColor=recent?'#ffe678':'rgba(0,0,0,.7)';context.shadowBlur=recent?18:8;
        // A lightweight canvas weapon keeps the recognizable Wood Sword look
        // without drawing the square shop-card background around the player.
        context.fillStyle='#6e3516';context.strokeStyle='#2c160c';context.lineWidth=3;
        context.beginPath();context.roundRect(-7,18,14,29,6);context.fill();context.stroke();
        context.fillStyle='#b76a2d';context.beginPath();context.roundRect(-21,13,42,10,3);context.fill();context.stroke();
        const blade=context.createLinearGradient(-12,-49,13,14);blade.addColorStop(0,'#ffd487');blade.addColorStop(.18,'#bd7536');blade.addColorStop(.72,'#7c3f1d');blade.addColorStop(1,'#4f2815');
        context.fillStyle=blade;context.beginPath();context.moveTo(-11,14);context.lineTo(-13,-34);context.lineTo(0,-54);context.lineTo(13,-34);context.lineTo(11,14);context.closePath();context.fill();context.stroke();
        context.strokeStyle='rgba(255,224,151,.7)';context.lineWidth=2;context.beginPath();context.moveTo(-5,7);context.lineTo(-6,-31);context.lineTo(0,-43);context.stroke();
        context.restore();
    }

    function drawWorld(context, stage, data) {
        if (!event || !active) return;
        const now=data.now||performance.now();
        if(stage==='back'){
            if(event.type==='snowstorm'){context.save();context.fillStyle='rgba(226,243,255,.3)';context.fillRect(0,0,3200,1700);context.fillStyle='rgba(246,251,255,.7)';for(let i=0;i<90;i++){const x=(i*379+now*.05*(1+i%3))%3200,y=(i*193+now*.08*(1+i%4))%1700;context.beginPath();context.arc(x,y,2+i%3,0,Math.PI*2);context.fill();}context.restore();}
            if(event.type==='dance_party'){const [x,y]=event.danceCenter||[1600,930];context.save();context.translate(x,y);context.fillStyle='rgba(3,18,31,.4)';context.shadowColor='#9bf4ff';context.shadowBlur=32;context.beginPath();context.roundRect(-250,-170,500,340,35);context.fill();for(let row=-3;row<=3;row++)for(let col=-5;col<=5;col++){const hue=(row*42+col*28+now*.08)%360;context.fillStyle=`hsla(${hue},90%,60%,.68)`;context.beginPath();context.roundRect(col*43-19,row*42-18,38,36,7);context.fill();}context.translate(0,-245);const disco=context.createRadialGradient(-8,-10,5,0,0,39);disco.addColorStop(0,'#fff');disco.addColorStop(.35,'#9ff5ff');disco.addColorStop(1,'#7b45dc');context.fillStyle=disco;context.beginPath();context.arc(0,0,38,0,Math.PI*2);context.fill();context.strokeStyle='rgba(255,255,255,.55)';for(let i=-28;i<=28;i+=14){context.beginPath();context.moveTo(i,-29);context.lineTo(i,29);context.stroke();context.beginPath();context.moveTo(-29,i);context.lineTo(29,i);context.stroke();}context.restore();}
            for(const launcher of event.launchers||[]){context.save();context.translate(launcher.x,launcher.y);context.shadowColor='#ff9f57';context.shadowBlur=22;const tube=context.createLinearGradient(-20,0,20,0);tube.addColorStop(0,'#52233f');tube.addColorStop(.5,'#d95c56');tube.addColorStop(1,'#572340');context.fillStyle=tube;context.strokeStyle='#ffe487';context.lineWidth=3;context.beginPath();context.roundRect(-20,-34,40,58,11);context.fill();context.stroke();context.fillStyle='#ffdd65';context.beginPath();context.moveTo(-11,-35);context.lineTo(0,-53);context.lineTo(11,-35);context.closePath();context.fill();context.stroke();context.fillStyle='#fff1a7';context.font='900 8px Arial';context.textAlign='center';context.fillText('LAUNCH',0,7);context.restore();}
            for(const entity of event.entities||[])drawPickup(context,entity,now);
            if(event.boss)drawBoss(context,event.boss,now);
            for(const enemy of event.enemies||[])drawEnemy(context,enemy,now);
        }else{
            if(event.combat)for(const player of data.players||[]){const stats=(event.leaderboard||[]).find((entry)=>entry.profileId===player.profileId);if(!stats?.alive)continue;drawWoodSword(context,player,now);}
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
