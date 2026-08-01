'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const OPCODE_HANDSHAKE = 0;
const OPCODE_FRAME = 1;
const OPCODE_CLOSE = 2;
const OPCODE_PING = 3;
const OPCODE_PONG = 4;

function cleanText(value, fallback) {
    const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, 128);
}

function loadPresenceConfig(baseDirectory) {
    let saved = {};
    try {
        saved = JSON.parse(fs.readFileSync(path.join(baseDirectory, 'discord-presence.json'), 'utf8'));
    } catch (_) {}
    return {
        clientId: cleanText(process.env.FLAPPY_MONKEY_DISCORD_CLIENT_ID || saved.clientId, ''),
        largeImage: cleanText(process.env.FLAPPY_MONKEY_DISCORD_LARGE_IMAGE || saved.largeImage, ''),
        largeText: cleanText(saved.largeText, 'Flappy Monkey')
    };
}

function discordIpcPaths() {
    if (process.platform === 'win32') {
        return Array.from({ length:10 }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`);
    }
    const baseDirectories = [
        process.env.XDG_RUNTIME_DIR,
        process.env.TMPDIR,
        process.env.TMP,
        process.env.TEMP,
        os.tmpdir()
    ].filter(Boolean);
    return [...new Set(baseDirectories)].flatMap((directory) =>
        Array.from({ length:10 }, (_, index) => path.join(directory, `discord-ipc-${index}`))
    );
}

function encodeFrame(opcode, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(opcode, 0);
    header.writeInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
}

function createDiscordPresence({ baseDirectory, onStatus = () => {} }) {
    const config = loadPresenceConfig(baseDirectory);
    let socket = null;
    let receiveBuffer = Buffer.alloc(0);
    let enabled = false;
    let ready = false;
    let connecting = false;
    let retryTimer = null;
    let activityStartedAt = Math.floor(Date.now() / 1000);
    let activity = { details:'Playing Flappy Monkey', state:'In the Main Lobby' };
    let lastStatus = '';

    function publishStatus(status, message) {
        const signature = `${status}:${message || ''}`;
        if (signature === lastStatus) return;
        lastStatus = signature;
        onStatus({ status, message:message || '', configured:Boolean(config.clientId), enabled });
    }

    function clearRetry() {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
    }

    function scheduleRetry() {
        clearRetry();
        if (!enabled || !config.clientId) return;
        retryTimer = setTimeout(connect, 15000);
        retryTimer.unref?.();
    }

    function send(opcode, payload) {
        if (!socket || socket.destroyed || !socket.writable) return false;
        try {
            socket.write(encodeFrame(opcode, payload));
            return true;
        } catch (_) {
            return false;
        }
    }

    function sendActivity() {
        if (!ready) return;
        const presence = enabled ? {
            details:cleanText(activity.details, 'Playing Flappy Monkey'),
            state:cleanText(activity.state, 'In the Main Lobby'),
            timestamps:{ start:activityStartedAt },
            instance:false
        } : null;
        if (presence && config.largeImage) {
            presence.assets = {
                large_image:config.largeImage,
                large_text:config.largeText
            };
        }
        send(OPCODE_FRAME, {
            cmd:'SET_ACTIVITY',
            args:{ pid:process.pid, activity:presence },
            nonce:crypto.randomUUID()
        });
    }

    function detachSocket() {
        const previous = socket;
        socket = null;
        ready = false;
        receiveBuffer = Buffer.alloc(0);
        if (previous && !previous.destroyed) previous.destroy();
    }

    function handlePayload(opcode, payload) {
        if (opcode === OPCODE_PING) {
            send(OPCODE_PONG, payload);
            return;
        }
        if (opcode === OPCODE_CLOSE) {
            detachSocket();
            publishStatus('disconnected', 'Discord closed the Rich Presence connection.');
            scheduleRetry();
            return;
        }
        if (opcode !== OPCODE_FRAME) return;
        if (payload?.evt === 'READY') {
            ready = true;
            publishStatus('connected', 'Visible on Discord.');
            sendActivity();
        } else if (payload?.evt === 'ERROR') {
            publishStatus('error', cleanText(payload?.data?.message, 'Discord rejected the Rich Presence update.'));
        }
    }

    function consumeData(chunk) {
        receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
        while (receiveBuffer.length >= 8) {
            const opcode = receiveBuffer.readInt32LE(0);
            const length = receiveBuffer.readInt32LE(4);
            if (length < 0 || length > 1024 * 1024) {
                detachSocket();
                scheduleRetry();
                return;
            }
            if (receiveBuffer.length < 8 + length) return;
            const body = receiveBuffer.subarray(8, 8 + length);
            receiveBuffer = receiveBuffer.subarray(8 + length);
            try {
                handlePayload(opcode, JSON.parse(body.toString('utf8')));
            } catch (_) {}
        }
    }

    function tryPath(paths, index = 0) {
        if (!enabled || socket || index >= paths.length) {
            connecting = false;
            if (enabled && !socket) {
                publishStatus('waiting', 'Open Discord to show Rich Presence.');
                scheduleRetry();
            }
            return;
        }
        const candidate = net.createConnection(paths[index]);
        let settled = false;
        const advance = () => {
            if (settled) return;
            settled = true;
            candidate.removeAllListeners();
            candidate.destroy();
            tryPath(paths, index + 1);
        };
        candidate.once('error', advance);
        candidate.once('connect', () => {
            if (settled) return;
            settled = true;
            clearRetry();
            candidate.removeListener('error', advance);
            socket = candidate;
            connecting = false;
            receiveBuffer = Buffer.alloc(0);
            candidate.on('data', consumeData);
            candidate.on('error', () => {
                detachSocket();
                publishStatus('waiting', 'Discord disconnected. Reconnecting automatically.');
                scheduleRetry();
            });
            candidate.on('close', () => {
                if (socket === candidate) {
                    socket = null;
                    ready = false;
                    publishStatus('waiting', 'Open Discord to show Rich Presence.');
                    scheduleRetry();
                }
            });
            publishStatus('connecting', 'Connecting to Discord…');
            send(OPCODE_HANDSHAKE, { v:1, client_id:config.clientId });
        });
    }

    function connect() {
        if (!enabled || socket || connecting) return;
        if (!config.clientId) {
            publishStatus('setup-required', 'Discord App ID needs to be added to discord-presence.json.');
            return;
        }
        connecting = true;
        publishStatus('connecting', 'Connecting to Discord…');
        tryPath(discordIpcPaths());
    }

    function setEnabled(value) {
        const nextEnabled = Boolean(value);
        if (enabled === nextEnabled) {
            if (enabled) connect();
            return;
        }
        enabled = nextEnabled;
        if (!enabled) {
            clearRetry();
            if (ready) sendActivity();
            setTimeout(detachSocket, 120).unref?.();
            publishStatus('disabled', 'Rich Presence is off.');
            return;
        }
        activityStartedAt = Math.floor(Date.now() / 1000);
        connect();
    }

    function updateActivity(nextActivity = {}) {
        const previousDetails = activity.details;
        activity = {
            details:cleanText(nextActivity.details, 'Playing Flappy Monkey'),
            state:cleanText(nextActivity.state, 'In the Main Lobby')
        };
        if (activity.details !== previousDetails) activityStartedAt = Math.floor(Date.now() / 1000);
        sendActivity();
    }

    function destroy() {
        enabled = false;
        clearRetry();
        if (ready) sendActivity();
        detachSocket();
    }

    return {
        config,
        setEnabled,
        updateActivity,
        destroy,
        getStatus:() => ({
            status:!enabled ? 'disabled' : !config.clientId ? 'setup-required' : ready ? 'connected' : connecting ? 'connecting' : 'waiting',
            configured:Boolean(config.clientId),
            enabled
        })
    };
}

module.exports = { createDiscordPresence, loadPresenceConfig, encodeFrame };
