(() => {
    'use strict';

    const STORAGE_KEY = 'gameAccessibilitySettings';
    const MUTED_KEY = 'flappyMonkeyWorldMutedVoices:v1';
    const peers = new Map();
    const mutedPlayers = new Set(readJson(MUTED_KEY, []));
    const shared = window.gameAccessibility || {};
    let localStream = null;
    let localId = '';
    let roster = [];
    let joined = false;
    let pttActive = false;
    let controllerPtt = false;
    let previousDpadDown = false;
    let statusMessage = '';
    let audioContext = null;
    let localMeter = null;
    let localVoiceLevel = 0;
    let voiceMeterFrame = 0;

    if (typeof shared.voiceChatEnabled !== 'boolean') shared.voiceChatEnabled = false;
    if (typeof shared.voiceMicMuted !== 'boolean') shared.voiceMicMuted = false;
    if (!['push-to-talk', 'open-mic'].includes(shared.voiceMode)) shared.voiceMode = 'push-to-talk';
    window.gameAccessibility = shared;

    function readJson(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            return value ?? fallback;
        } catch (_) {
            return fallback;
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
        }[character]));
    }

    function persistSettings() {
        const saved = readJson(STORAGE_KEY, {});
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, ...shared }));
        window.dispatchEvent(new CustomEvent('flappy-accessibility-settings-changed', { detail:{ ...shared } }));
    }

    function worldGameplayOpen() {
        const screen = document.getElementById('monkeyWorldScreen');
        const game = document.getElementById('mwGame');
        const building = document.getElementById('mwBuildingModal');
        return Boolean(joined && screen?.classList.contains('open') && game && !game.classList.contains('mp-hidden') && building?.getAttribute('aria-hidden') !== 'false');
    }

    function sendSignal(targetId, signal) {
        return window.flappyMonkeyWorldVoiceSignal?.(targetId, signal) !== false;
    }

    function setStatus(message) {
        statusMessage = message || '';
        renderUi();
    }

    function localTrackShouldTransmit() {
        return Boolean(shared.voiceChatEnabled && !shared.voiceMicMuted && (shared.voiceMode === 'open-mic' || pttActive || controllerPtt));
    }

    function syncLocalTrack() {
        const enabled = localTrackShouldTransmit();
        localStream?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
        renderUi();
    }

    function createVoiceMeter(stream) {
        if (!stream || !window.AudioContext && !window.webkitAudioContext) return null;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContext ||= new AudioContextClass();
            audioContext.resume?.().catch(() => {});
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = .72;
            source.connect(analyser);
            return { source, analyser, samples:new Uint8Array(analyser.fftSize), level:0 };
        } catch (_) {
            return null;
        }
    }

    function sampleVoiceMeter(meter) {
        if (!meter?.analyser) return 0;
        meter.analyser.getByteTimeDomainData(meter.samples);
        let energy = 0;
        for (const value of meter.samples) {
            const normalized = (value - 128) / 128;
            energy += normalized * normalized;
        }
        const rms = Math.sqrt(energy / meter.samples.length);
        meter.level = Math.max(rms, meter.level * .78);
        return meter.level;
    }

    function pollVoiceMeters() {
        voiceMeterFrame = requestAnimationFrame(pollVoiceMeters);
        localVoiceLevel = localTrackShouldTransmit() ? sampleVoiceMeter(localMeter) : 0;
        for (const entry of peers.values()) entry.voiceLevel = mutedPlayers.has(entry.id) ? 0 : sampleVoiceMeter(entry.meter);
    }

    async function ensureLocalStream() {
        if (localStream?.active) return localStream;
        if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Voice chat is not supported by this browser or desktop build.');
        localStream = await navigator.mediaDevices.getUserMedia({
            audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 },
            video:false
        });
        localMeter = createVoiceMeter(localStream);
        syncLocalTrack();
        return localStream;
    }

    function closePeer(profileId, notify = false) {
        const id = String(profileId || '').toUpperCase();
        const entry = peers.get(id);
        if (!entry) return;
        peers.delete(id);
        try { if (notify) sendSignal(id, { kind:'hangup' }); } catch (_) {}
        clearTimeout(entry.connectTimer);
        try { entry.meter?.source?.disconnect(); } catch (_) {}
        try { entry.pc.onicecandidate = null; entry.pc.ontrack = null; entry.pc.close(); } catch (_) {}
        entry.audio?.remove();
        renderUi();
    }

    function closeAllPeers(notify = false) {
        [...peers.keys()].forEach((profileId) => closePeer(profileId, notify));
    }

    function stopLocalStream() {
        localStream?.getTracks().forEach((track) => track.stop());
        localStream = null;
        try { localMeter?.source?.disconnect(); } catch (_) {}
        localMeter = null;
        localVoiceLevel = 0;
    }

    async function setVoiceEnabled(enabled, options = {}) {
        if (!enabled) {
            shared.voiceChatEnabled = false;
            pttActive = false;
            controllerPtt = false;
            closeAllPeers(true);
            stopLocalStream();
            persistSettings();
            setStatus('Voice chat is off. Your microphone is not being used.');
            return;
        }
        if (!window.flappyOnlineState?.().serverCapabilities?.includes('monkey_world_voice_v1')) {
            shared.voiceChatEnabled = false;
            persistSettings();
            setStatus('Voice chat needs the matching multiplayer server build.');
            return;
        }
        try {
            setStatus('Requesting microphone access…');
            await ensureLocalStream();
            shared.voiceChatEnabled = true;
            persistSettings();
            syncLocalTrack();
            setStatus(shared.voiceMode === 'push-to-talk' ? 'Voice ready. Hold the Push to Talk bind while speaking.' : 'Voice ready. Open microphone is active.');
            reconcilePeers();
        } catch (error) {
            shared.voiceChatEnabled = false;
            stopLocalStream();
            persistSettings();
            setStatus(error?.name === 'NotAllowedError' ? 'Microphone access was denied. Voice chat remains off.' : (error?.message || 'Microphone access could not be started.'));
            if (options.fromUi && typeof window.gameAlert === 'function') window.gameAlert(statusMessage, { title:'Voice Chat Unavailable' });
        }
    }

    function createPeer(profileId, username = 'Monkey') {
        const id = String(profileId || '').toUpperCase();
        if (!id || id === localId || !shared.voiceChatEnabled || !localStream) return null;
        const existing = peers.get(id);
        if (existing) {
            existing.username = username || existing.username;
            return existing;
        }
        const pc = new RTCPeerConnection({
            iceServers:[
                { urls:'stun:stun.l.google.com:19302' },
                { urls:'stun:stun1.l.google.com:19302' },
                { urls:'stun:stun.cloudflare.com:3478' }
            ],
            bundlePolicy:'max-bundle',
            iceCandidatePoolSize:4
        });
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.dataset.audioChannel = 'effects';
        audio.dataset.voiceProfile = id;
        audio.setAttribute('aria-hidden', 'true');
        document.body.append(audio);
        const entry = { id, username, pc, audio, pendingIce:[], makingOffer:false, meter:null, voiceLevel:0, connectTimer:0 };
        peers.set(id, entry);
        localStream.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));
        pc.onicecandidate = (event) => {
            const candidate = event.candidate;
            if (!candidate) return;
            sendSignal(id, { kind:'ice', candidate:candidate.candidate, sdpMid:candidate.sdpMid || '', sdpMLineIndex:candidate.sdpMLineIndex || 0 });
        };
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0] || new MediaStream([event.track]);
            audio.srcObject = remoteStream;
            try { entry.meter?.source?.disconnect(); } catch (_) {}
            entry.meter = createVoiceMeter(remoteStream);
            audio.muted = mutedPlayers.has(id);
            audio.play().catch(() => {});
            renderUi();
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') clearTimeout(entry.connectTimer);
            if (['failed', 'closed'].includes(pc.connectionState)) {
                closePeer(id);
                if (joined && shared.voiceChatEnabled) setTimeout(reconcilePeers, 900);
            } else renderUi();
        };
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') {
                try { pc.restartIce(); } catch (_) {}
                if (localId.localeCompare(id) < 0) makeOffer(entry, true);
            }
        };
        entry.connectTimer = setTimeout(() => {
            if (peers.get(id) !== entry || pc.connectionState === 'connected') return;
            closePeer(id, true);
            if (joined && shared.voiceChatEnabled) setTimeout(reconcilePeers, 900);
        }, 12_000);
        return entry;
    }

    async function flushIce(entry) {
        while (entry.pendingIce.length && entry.pc.remoteDescription) {
            try { await entry.pc.addIceCandidate(entry.pendingIce.shift()); } catch (_) {}
        }
    }

    async function makeOffer(entry, iceRestart = false) {
        if (!entry || entry.makingOffer || entry.pc.signalingState !== 'stable') return;
        entry.makingOffer = true;
        try {
            const offer = await entry.pc.createOffer(iceRestart ? { iceRestart:true } : undefined);
            await entry.pc.setLocalDescription(offer);
            sendSignal(entry.id, { kind:'offer', sdp:entry.pc.localDescription.sdp });
        } catch (_) {
            closePeer(entry.id);
        } finally {
            entry.makingOffer = false;
        }
    }

    async function handleSignal(message) {
        if (!shared.voiceChatEnabled || !joined) return;
        const fromId = String(message?.fromId || '').toUpperCase();
        const signal = message?.signal || {};
        if (!fromId || fromId === localId) return;
        if (signal.kind === 'hangup') {
            closePeer(fromId);
            return;
        }
        try {
            await ensureLocalStream();
            const player = roster.find((entry) => String(entry.profileId || '').toUpperCase() === fromId);
            const entry = createPeer(fromId, message.fromUsername || player?.username || 'Monkey');
            if (!entry) return;
            if (signal.kind === 'offer') {
                if (entry.pc.signalingState !== 'stable') await entry.pc.setLocalDescription({ type:'rollback' }).catch(() => {});
                await entry.pc.setRemoteDescription({ type:'offer', sdp:signal.sdp });
                await flushIce(entry);
                const answer = await entry.pc.createAnswer();
                await entry.pc.setLocalDescription(answer);
                sendSignal(fromId, { kind:'answer', sdp:entry.pc.localDescription.sdp });
            } else if (signal.kind === 'answer' && entry.pc.signalingState === 'have-local-offer') {
                await entry.pc.setRemoteDescription({ type:'answer', sdp:signal.sdp });
                await flushIce(entry);
            } else if (signal.kind === 'ice') {
                const candidate = { candidate:signal.candidate, sdpMid:signal.sdpMid || null, sdpMLineIndex:Number(signal.sdpMLineIndex) || 0 };
                if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(candidate).catch(() => {});
                else entry.pendingIce.push(candidate);
            }
        } catch (_) {
            closePeer(fromId);
        }
    }

    function reconcilePeers() {
        if (!shared.voiceChatEnabled || !joined || !localStream || !localId) {
            closeAllPeers();
            renderUi();
            return;
        }
        const remotePlayers = roster.filter((player) => {
            const id = String(player.profileId || '').toUpperCase();
            return id && id !== localId;
        });
        const valid = new Set(remotePlayers.map((player) => String(player.profileId).toUpperCase()));
        [...peers.keys()].forEach((id) => { if (!valid.has(id)) closePeer(id); });
        remotePlayers.forEach((player) => {
            const id = String(player.profileId).toUpperCase();
            const entry = createPeer(id, player.username || 'Monkey');
            if (entry && localId.localeCompare(id) < 0 && !entry.pc.localDescription) makeOffer(entry);
        });
        renderUi();
    }

    function toggleRemoteMute(profileId) {
        const id = String(profileId || '').toUpperCase();
        if (mutedPlayers.has(id)) mutedPlayers.delete(id);
        else mutedPlayers.add(id);
        localStorage.setItem(MUTED_KEY, JSON.stringify([...mutedPlayers]));
        const entry = peers.get(id);
        if (entry?.audio) entry.audio.muted = mutedPlayers.has(id);
        renderUi();
    }

    function updateSpatialAudio() {
        const local = roster.find((player) => String(player.profileId || '').toUpperCase() === localId);
        for (const [id, entry] of peers) {
            const remote = roster.find((player) => String(player.profileId || '').toUpperCase() === id);
            if (!local || !remote) {
                entry.audio.volume = 0.65;
                continue;
            }
            const distance = Math.hypot(Number(local.x) - Number(remote.x), Number(local.y) - Number(remote.y));
            const proximity = distance <= 260 ? 1 : Math.max(0.12, 1 - (distance - 260) / 900);
            entry.audio.volume = proximity * Math.max(0, Math.min(1, Number(shared.effects ?? 80) / 100));
        }
    }

    function renderUi() {
        const button = document.getElementById('mwVoiceButton');
        const panel = document.getElementById('mwVoicePanel');
        const enableInput = document.getElementById('voiceChatEnabledSetting');
        const muteInput = document.getElementById('voiceMicMutedSetting');
        const modeInput = document.getElementById('voiceModeSetting');
        const settingStatus = document.getElementById('voiceChatSettingStatus');
        const pttLabel = window.controlLabel?.(window.gameControls?.voicePushToTalk || 'KeyV') || 'V';
        if (enableInput) enableInput.checked = Boolean(shared.voiceChatEnabled);
        if (muteInput) {
            muteInput.checked = Boolean(shared.voiceMicMuted);
            muteInput.disabled = !shared.voiceChatEnabled;
        }
        if (modeInput) {
            modeInput.value = shared.voiceMode;
            modeInput.disabled = !shared.voiceChatEnabled;
        }
        if (settingStatus) settingStatus.textContent = statusMessage || (shared.voiceChatEnabled ? 'Connected voice uses proximity audio. Push to Talk: ' + pttLabel + '.' : 'Off by default. No microphone is requested until you enable it.');
        if (button) {
            button.textContent = !shared.voiceChatEnabled ? 'Voice Off' : shared.voiceMicMuted ? 'Mic Muted' : 'Voice On';
            button.classList.toggle('mw-voice-live', Boolean(shared.voiceChatEnabled));
        }
        if (!panel) return;
        const list = panel.querySelector('[data-voice-list]');
        const livePlayers = roster.filter((player) => String(player.profileId || '').toUpperCase() !== localId);
        list.innerHTML = livePlayers.length ? livePlayers.map((player) => {
            const id = String(player.profileId || '').toUpperCase();
            const connected = peers.get(id)?.pc?.connectionState === 'connected';
            const muted = mutedPlayers.has(id);
            return '<button type="button" data-voice-player="' + escapeHtml(id) + '" class="mw-voice-player' + (muted ? ' muted' : '') + '"><span><strong>' + escapeHtml(player.username || 'Monkey') + '</strong><small>' + (connected ? 'Connected' : 'Connecting…') + '</small></span><b>' + (muted ? 'Unmute' : 'Mute') + '</b></button>';
        }).join('') : '<p class="mw-voice-empty">No other players are in voice range yet.</p>';
        panel.querySelector('[data-voice-mic]').textContent = shared.voiceMicMuted ? 'Unmute My Mic' : 'Mute My Mic';
    }

    function installUi() {
        const styles = document.createElement('style');
        styles.id = 'monkey-world-voice-styles';
        styles.textContent = [
            '#mwVoiceButton.mw-voice-live{border-color:#70eaa7;background:linear-gradient(180deg,#267048,#174d34);box-shadow:0 0 16px rgba(73,230,142,.22)}',
            '.voice-settings-select{width:100%;min-height:38px;margin-top:5px;padding:7px 10px;border:1px solid rgba(111,219,157,.38);border-radius:9px;color:#f3fff7;background:#0b3528}',
            '#voiceChatSettingStatus{margin:9px 0 0;color:#bcd5c5;font-size:11px;line-height:1.45}',
            '#mwVoicePanel{position:fixed;z-index:2147482200;top:auto;right:18px;bottom:min(476px,calc(100dvh - 150px));width:min(300px,calc(100vw - 28px));padding:12px;border:1px solid rgba(119,226,164,.48);border-radius:14px;color:#effff5;background:rgba(5,37,29,.97);box-shadow:0 18px 48px rgba(0,0,0,.48)}',
            '#mwVoicePanel[hidden]{display:none}.mw-voice-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:9px}.mw-voice-head strong{color:#ffe886;font-size:13px;letter-spacing:.04em}.mw-voice-head button{min-width:34px!important;min-height:30px!important;padding:3px 8px!important}',
            '.mw-voice-player{display:flex!important;align-items:center!important;justify-content:space-between!important;width:100%!important;min-height:48px!important;margin:6px 0!important;padding:8px 10px!important;text-align:left!important}.mw-voice-player span{display:grid;gap:2px}.mw-voice-player small{color:#9fc8ae}.mw-voice-player b{color:#ffe377}.mw-voice-player.muted{opacity:.68}.mw-voice-empty{margin:8px 2px;color:#a8c5b2;font-size:11px}',
            '.mw-voice-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.mw-voice-actions button{min-height:35px!important;font-size:11px!important}@media(max-width:800px){#mwVoicePanel{top:78px;right:10px}.mw-top-actions #mwVoiceButton{order:4}}'
        ].join('');
        document.head.append(styles);
        const grid = document.querySelector('#settingsPopup .settings-upgrade-grid');
        if (grid && !document.getElementById('voiceChatSettingsPanel')) {
            grid.insertAdjacentHTML('beforeend', [
                '<section id="voiceChatSettingsPanel" class="settings-upgrade-panel"><h3>Monkey World Voice Chat</h3>',
                '<label class="settings-toggle-row"><span>Enable voice chat</span><input id="voiceChatEnabledSetting" type="checkbox"></label>',
                '<label class="settings-toggle-row"><span>Mute my microphone</span><input id="voiceMicMutedSetting" type="checkbox"></label>',
                '<label style="display:block;margin-top:8px;font-size:12px">Microphone mode<select id="voiceModeSetting" class="voice-settings-select"><option value="push-to-talk">Push to Talk</option><option value="open-mic">Open Microphone</option></select></label>',
                '<p id="voiceChatSettingStatus"></p></section>'
            ].join(''));
        }
        document.body.insertAdjacentHTML('beforeend', [
            '<aside id="mwVoicePanel" hidden aria-label="Monkey World voice chat"><div class="mw-voice-head"><strong>VOICE CHAT</strong><button type="button" data-voice-close aria-label="Close voice panel">×</button></div>',
            '<div data-voice-list></div><div class="mw-voice-actions"><button type="button" data-voice-mic>Mute My Mic</button><button type="button" data-voice-disable>Turn Voice Off</button></div></aside>'
        ].join(''));
        document.getElementById('voiceChatEnabledSetting')?.addEventListener('change', (event) => setVoiceEnabled(event.target.checked, { fromUi:true }));
        document.getElementById('voiceMicMutedSetting')?.addEventListener('change', (event) => {
            shared.voiceMicMuted = event.target.checked;
            persistSettings();
            syncLocalTrack();
        });
        document.getElementById('voiceModeSetting')?.addEventListener('change', (event) => {
            shared.voiceMode = event.target.value === 'open-mic' ? 'open-mic' : 'push-to-talk';
            persistSettings();
            syncLocalTrack();
        });
        document.getElementById('mwVoiceButton')?.addEventListener('click', async () => {
            if (!shared.voiceChatEnabled) await setVoiceEnabled(true, { fromUi:true });
            if (shared.voiceChatEnabled) {
                const panel = document.getElementById('mwVoicePanel');
                panel.hidden = !panel.hidden;
                document.getElementById('mwVoiceButton')?.setAttribute('aria-expanded', String(!panel.hidden));
            }
        });
        const panel = document.getElementById('mwVoicePanel');
        panel?.addEventListener('click', (event) => {
            if (event.target.closest('[data-voice-close]')) {
                panel.hidden = true;
                document.getElementById('mwVoiceButton')?.setAttribute('aria-expanded', 'false');
            }
            if (event.target.closest('[data-voice-disable]')) setVoiceEnabled(false);
            if (event.target.closest('[data-voice-mic]')) {
                shared.voiceMicMuted = !shared.voiceMicMuted;
                persistSettings();
                syncLocalTrack();
            }
            const player = event.target.closest('[data-voice-player]');
            if (player) toggleRemoteMute(player.dataset.voicePlayer);
        });
        renderUi();
    }

    window.addEventListener('flappy-monkey-world-roster', (event) => {
        joined = Boolean(event.detail?.joined);
        localId = String(event.detail?.localId || '').toUpperCase();
        roster = Array.isArray(event.detail?.players) ? event.detail.players : [];
        if (!joined) {
            closeAllPeers(true);
            document.getElementById('mwVoicePanel')?.setAttribute('hidden', '');
        } else if (shared.voiceChatEnabled) {
            ensureLocalStream().then(reconcilePeers).catch((error) => setStatus(error.message));
        }
        renderUi();
    });
    window.addEventListener('flappy-monkey-world-voice-signal', (event) => handleSignal(event.detail));
    window.addEventListener('game-control-bindings-changed', renderUi);
    window.addEventListener('keydown', (event) => {
        if (event.code !== (window.gameControls?.voicePushToTalk || 'KeyV') || event.repeat || !worldGameplayOpen() || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '')) return;
        pttActive = true;
        syncLocalTrack();
    }, true);
    window.addEventListener('keyup', (event) => {
        if (event.code !== (window.gameControls?.voicePushToTalk || 'KeyV')) return;
        pttActive = false;
        syncLocalTrack();
    }, true);
    window.addEventListener('blur', () => {
        pttActive = false;
        controllerPtt = false;
        syncLocalTrack();
    });
    window.setInterval(() => {
        if (joined && peers.size) updateSpatialAudio();
    }, 250);

    window.flappyMonkeyWorldVoiceActivity = (profileId) => {
        const id = String(profileId || '').toUpperCase();
        if (!id || !shared.voiceChatEnabled) return { connected:false, speaking:false, level:0, muted:false };
        if (id === localId) {
            const level = localVoiceLevel;
            return { connected:Boolean(localStream?.active), speaking:localTrackShouldTransmit() && level > .035, level, muted:Boolean(shared.voiceMicMuted) };
        }
        const entry = peers.get(id);
        const muted = mutedPlayers.has(id);
        const connected = entry?.pc?.connectionState === 'connected' || ['connected','completed'].includes(entry?.pc?.iceConnectionState);
        const level = muted ? 0 : Number(entry?.voiceLevel) || 0;
        return { connected, speaking:connected && level > .028, level, muted };
    };

    let voicePadFrame = 0;
    function pollVoiceGamepad() {
        voicePadFrame = 0;
        if (!worldGameplayOpen()) {
            if (controllerPtt) {
                controllerPtt = false;
                syncLocalTrack();
            }
            previousDpadDown = false;
            return;
        }
        const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
        const nextControllerPtt = Boolean(pad?.buttons?.[6]?.pressed);
        if (nextControllerPtt !== controllerPtt) {
            controllerPtt = nextControllerPtt;
            syncLocalTrack();
        }
        const dpadDown = Boolean(pad?.buttons?.[13]?.pressed);
        if (dpadDown && !previousDpadDown) {
            const code = window.gameControls?.emoteWheel || 'KeyB';
            window.dispatchEvent(new KeyboardEvent('keydown', { code, key:code.replace(/^Key/, ''), bubbles:true, cancelable:true }));
        }
        previousDpadDown = dpadDown;
        voicePadFrame = requestAnimationFrame(pollVoiceGamepad);
    }

    function startVoiceGamepadPolling() {
        if (worldGameplayOpen() && !voicePadFrame) voicePadFrame = requestAnimationFrame(pollVoiceGamepad);
    }

    installUi();
    if (!voiceMeterFrame) voiceMeterFrame = requestAnimationFrame(pollVoiceMeters);
    const context = window.flappyMonkeyWorldVoiceContext?.();
    if (context) {
        joined = Boolean(context.joined);
        localId = String(context.localId || '').toUpperCase();
        roster = Array.isArray(context.players) ? context.players : [];
    }
    if (shared.voiceChatEnabled && joined) ensureLocalStream().then(reconcilePeers).catch((error) => setStatus(error.message));
    const worldScreen = document.getElementById('monkeyWorldScreen');
    const worldGame = document.getElementById('mwGame');
    if (worldScreen) new MutationObserver(startVoiceGamepadPolling).observe(worldScreen, { attributes:true, attributeFilter:['class'] });
    if (worldGame) new MutationObserver(startVoiceGamepadPolling).observe(worldGame, { attributes:true, attributeFilter:['class'] });
    window.addEventListener('flappy-monkey-world-roster', startVoiceGamepadPolling);
    window.addEventListener('gamepadconnected', startVoiceGamepadPolling);
    startVoiceGamepadPolling();
})();
