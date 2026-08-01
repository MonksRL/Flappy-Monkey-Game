(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FlappyAccountStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    'use strict';

    const ACTIVE_ACCOUNT_KEY = 'flappyAccountActive:v1';
    const ACCOUNT_SLOT_PREFIX = 'flappyAccountSlot:v1:';
    const ONLINE_SESSION_PREFIX = 'flappyOnlineSession:';
    const ONLINE_PROFILE_PREFIX = 'flappyOnlineProfile:';
    const PENDING_OFFLINE_RESET_PREFIX = 'flappyPendingOfflineReset:';
    const ACCOUNT_IDENTITY_PREFIX = 'flappyAccountIdentity:v1:';
    const ACCOUNT_FLAG_PREFIX = 'flappyAccountFlag:v1:';
    const CLOUD_META_KEY = 'flappyCloudProgressMeta:v1';
    const CLOUD_EXCLUDED_KEYS = new Set([
        CLOUD_META_KEY,
        'customUsername',
        'profilePic'
    ]);
    const DEVICE_KEYS = new Set([
        'flappyOnlineServer',
        'gameAccessibilitySettings',
        'gameControlBindings',
        'musicEnabled',
        'musicSourcePreference',
        'customBGM',
        'fixedBGM',
        'towerDefenseMusic',
        'useCountdown',
        'flappyLastAnnouncementSeen'
    ]);

    function storageKeys(storage) {
        const keys = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key !== null) keys.push(key);
        }
        return keys;
    }

    function normalizeServerUrl(value) {
        return String(value || '')
            .trim()
            .replace(/\/+$/, '')
            .toLocaleLowerCase('en-US');
    }

    function normalizeIdentity(serverUrl, accountId) {
        const identity = {
            serverUrl: normalizeServerUrl(serverUrl),
            accountId: String(accountId || '').trim()
        };
        if (!identity.serverUrl || !identity.accountId) throw new Error('A server and account ID are required to select account progress.');
        return identity;
    }

    function sameIdentity(first, second) {
        return Boolean(
            first
            && second
            && normalizeServerUrl(first.serverUrl) === normalizeServerUrl(second.serverUrl)
            && first.accountId === second.accountId
        );
    }

    function readActiveAccount(storage) {
        try {
            const value = JSON.parse(storage.getItem(ACTIVE_ACCOUNT_KEY) || 'null');
            if (!value || typeof value !== 'object') return null;
            return normalizeIdentity(value.serverUrl, value.accountId);
        } catch (_) {
            return null;
        }
    }

    function writeActiveAccount(storage, identity) {
        storage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(normalizeIdentity(identity?.serverUrl, identity?.accountId)));
    }

    function slotPrefix(identity) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        return `${ACCOUNT_SLOT_PREFIX}${encodeURIComponent(normalized.serverUrl)}:${encodeURIComponent(normalized.accountId)}:`;
    }

    function parseSlotKey(key) {
        if (!String(key || '').startsWith(ACCOUNT_SLOT_PREFIX)) return null;
        try {
            const parts = key.slice(ACCOUNT_SLOT_PREFIX.length).split(':');
            if (parts.length < 3) return null;
            const identity = normalizeIdentity(decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
            return {
                slotKey:key,
                identity,
                liveKey:decodeURIComponent(parts.slice(2).join(':'))
            };
        } catch (_) {
            return null;
        }
    }

    function matchingSlotEntries(storage, identity) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        return storageKeys(storage)
            .map(parseSlotKey)
            .filter((entry) => entry && sameIdentity(entry.identity, normalized));
    }

    function identityCacheKey(identity) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        return `${ACCOUNT_IDENTITY_PREFIX}${encodeURIComponent(normalized.serverUrl)}:${encodeURIComponent(normalized.accountId)}`;
    }

    function parseIdentityCacheKey(key) {
        if (!String(key || '').startsWith(ACCOUNT_IDENTITY_PREFIX)) return null;
        try {
            const parts = key.slice(ACCOUNT_IDENTITY_PREFIX.length).split(':');
            if (parts.length !== 2) return null;
            return {
                cacheKey:key,
                identity:normalizeIdentity(decodeURIComponent(parts[0]), decodeURIComponent(parts[1]))
            };
        } catch (_) {
            return null;
        }
    }

    function matchingIdentityCacheKeys(storage, identity) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        return storageKeys(storage)
            .map(parseIdentityCacheKey)
            .filter((entry) => entry && sameIdentity(entry.identity, normalized))
            .map((entry) => entry.cacheKey);
    }

    function accountFlagKey(identity, flag) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        const normalizedFlag = String(flag || '').trim();
        if (!normalizedFlag) throw new Error('An account flag name is required.');
        return `${ACCOUNT_FLAG_PREFIX}${encodeURIComponent(normalized.serverUrl)}:${encodeURIComponent(normalized.accountId)}:${encodeURIComponent(normalizedFlag)}`;
    }

    function parseAccountFlagKey(key) {
        if (!String(key || '').startsWith(ACCOUNT_FLAG_PREFIX)) return null;
        try {
            const parts = key.slice(ACCOUNT_FLAG_PREFIX.length).split(':');
            if (parts.length < 3) return null;
            return {
                flagKey:key,
                identity:normalizeIdentity(decodeURIComponent(parts[0]), decodeURIComponent(parts[1])),
                flag:decodeURIComponent(parts.slice(2).join(':'))
            };
        } catch (_) {
            return null;
        }
    }

    function matchingAccountFlagEntries(storage, identity) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        return storageKeys(storage)
            .map(parseAccountFlagKey)
            .filter((entry) => entry && sameIdentity(entry.identity, normalized));
    }

    function hasAccountFlag(storage, identity, flag) {
        const normalizedFlag = String(flag || '').trim();
        if (!normalizedFlag) return false;
        return matchingAccountFlagEntries(storage, identity)
            .some((entry) => entry.flag === normalizedFlag && storage.getItem(entry.flagKey) === 'true');
    }

    function markAccountFlag(storage, identity, flag) {
        storage.setItem(accountFlagKey(identity, flag), 'true');
    }

    function clearAccountFlags(storage, identity) {
        for (const entry of matchingAccountFlagEntries(storage, identity)) storage.removeItem(entry.flagKey);
    }

    function applyAccountFlagsToLiveProgress(storage, identity) {
        if (!identity) return;
        if (storage.getItem('collectionIndexRewardClaimed') === 'true') {
            markAccountFlag(storage, identity, 'collection-index-master-claimed');
            return;
        }
        if (hasAccountFlag(storage, identity, 'collection-index-master-claimed')) {
            storage.setItem('collectionIndexRewardClaimed', 'true');
        }
    }

    function readCachedIdentity(storage, identity) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        const exactKey = identityCacheKey(normalized);
        const keys = [exactKey, ...matchingIdentityCacheKeys(storage, normalized).filter((key) => key !== exactKey)];
        for (const key of keys) {
            try {
                const value = JSON.parse(storage.getItem(key) || 'null');
                if (!value || typeof value !== 'object') continue;
                return {
                    id: String(value.id || normalized.accountId || '').trim(),
                    username: String(value.username || '').trim(),
                    usernameCanChangeAt: Math.max(0, Number(value.usernameCanChangeAt) || 0),
                    progressRevision: Math.max(0, Math.floor(Number(value.progressRevision) || 0))
                };
            } catch (_) {}
        }
        return null;
    }

    function writeCachedIdentity(storage, identity, profile = {}) {
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        const previous = readCachedIdentity(storage, normalized);
        const username = String(profile?.username || previous?.username || '').trim();
        const cached = {
            id: normalized.accountId,
            username,
            usernameCanChangeAt: Math.max(0, Number(profile?.usernameCanChangeAt ?? previous?.usernameCanChangeAt) || 0),
            progressRevision: Math.max(0, Math.floor(Number(profile?.progressRevision ?? previous?.progressRevision) || 0))
        };
        const exactKey = identityCacheKey(normalized);
        for (const key of matchingIdentityCacheKeys(storage, normalized)) {
            if (key !== exactKey) storage.removeItem(key);
        }
        storage.setItem(exactKey, JSON.stringify(cached));
        return cached;
    }

    function isInfrastructureKey(key) {
        return key === ACTIVE_ACCOUNT_KEY
            || key.startsWith(ACCOUNT_SLOT_PREFIX)
            || key.startsWith(ACCOUNT_IDENTITY_PREFIX)
            || key.startsWith(ACCOUNT_FLAG_PREFIX)
            || key.startsWith(ONLINE_SESSION_PREFIX)
            || key.startsWith(ONLINE_PROFILE_PREFIX)
            || key.startsWith(PENDING_OFFLINE_RESET_PREFIX)
            || DEVICE_KEYS.has(key);
    }

    function liveProgressKeys(storage) {
        return storageKeys(storage).filter((key) => !isInfrastructureKey(key));
    }

    function clearLiveProgress(storage) {
        for (const key of liveProgressKeys(storage)) storage.removeItem(key);
    }

    function hasAccountSlot(storage, identity) {
        return matchingSlotEntries(storage, identity).length > 0;
    }

    function shouldApplyServerReset(storage, identity, serverProgressRevision, { created = false, fallbackRevision = null } = {}) {
        if (created) return false;
        const normalized = normalizeIdentity(identity?.serverUrl, identity?.accountId);
        const serverRevision = Math.max(0, Math.floor(Number(serverProgressRevision) || 0));
        const durableIdentity = readCachedIdentity(storage, normalized);
        const fallbackProvided = fallbackRevision !== null
            && fallbackRevision !== undefined
            && Number.isFinite(Number(fallbackRevision));
        const localRevision = Math.max(
            0,
            Number(durableIdentity?.progressRevision) || 0,
            fallbackProvided ? Number(fallbackRevision) || 0 : 0
        );

        // A logged-out account keeps its progress in a separate slot. Guest
        // mode intentionally removes the active-account pointer, so the absence
        // of that pointer must never be treated as proof of a server-side reset.
        if (durableIdentity || fallbackProvided) return serverRevision > localRevision;
        if (hasAccountSlot(storage, normalized)) return false;
        return serverRevision > 0;
    }

    function cloudProgressKeys(storage) {
        return liveProgressKeys(storage).filter((key) => !CLOUD_EXCLUDED_KEYS.has(key));
    }

    function exportCloudProgress(storage) {
        const data = {};
        let totalLength = 0;
        for (const key of cloudProgressKeys(storage).sort()) {
            const value = storage.getItem(key);
            if (value === null || key.length > 120 || value.length > 220_000) continue;
            totalLength += key.length + value.length;
            if (totalLength > 1_500_000) break;
            data[key] = value;
        }
        return data;
    }

    function readCloudMeta(storage) {
        try {
            const value = JSON.parse(storage.getItem(CLOUD_META_KEY) || 'null');
            if (!value || typeof value !== 'object') return { revision:0, updatedAt:0 };
            return {
                revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
                updatedAt: Math.max(0, Math.floor(Number(value.updatedAt) || 0))
            };
        } catch (_) {
            return { revision:0, updatedAt:0 };
        }
    }

    function writeCloudMeta(storage, cloudSave = {}) {
        const meta = {
            revision: Math.max(0, Math.floor(Number(cloudSave.revision) || 0)),
            updatedAt: Math.max(0, Math.floor(Number(cloudSave.updatedAt) || 0))
        };
        storage.setItem(CLOUD_META_KEY, JSON.stringify(meta));
        return meta;
    }

    function restoreCloudProgress(storage, cloudSave, { force = false } = {}) {
        if (!cloudSave || typeof cloudSave !== 'object' || !cloudSave.data || typeof cloudSave.data !== 'object') {
            return { restored:false, reason:'missing' };
        }
        const incomingRevision = Math.max(0, Math.floor(Number(cloudSave.revision) || 0));
        const current = readCloudMeta(storage);
        if (!force && incomingRevision <= current.revision) {
            return { restored:false, reason:'current', revision:current.revision };
        }
        const identity = captureResetIdentity(storage);
        for (const key of cloudProgressKeys(storage)) storage.removeItem(key);
        let totalLength = 0;
        let restoredKeys = 0;
        for (const [rawKey, rawValue] of Object.entries(cloudSave.data).slice(0, 900)) {
            const key = String(rawKey || '');
            const value = String(rawValue ?? '');
            if (!key || key.length > 120 || value.length > 220_000 || isInfrastructureKey(key) || CLOUD_EXCLUDED_KEYS.has(key)) continue;
            totalLength += key.length + value.length;
            if (totalLength > 1_500_000) break;
            storage.setItem(key, value);
            restoredKeys += 1;
        }
        restoreResetIdentity(storage, identity);
        writeCloudMeta(storage, cloudSave);
        applyAccountFlagsToLiveProgress(storage, readActiveAccount(storage));
        return { restored:true, revision:incomingRevision, restoredKeys };
    }

    function restoreCloudProgressForActivation(storage, cloudSave, activation, options = {}) {
        if (activation?.restoredAccountSlot) {
            return { restored:false, reason:'local-account-slot' };
        }
        return restoreCloudProgress(storage, cloudSave, options);
    }

    function captureResetIdentity(storage, profile = null) {
        return {
            customUsername: String(profile?.username || storage.getItem('customUsername') || ''),
            profilePic: String(profile?.profilePicture || storage.getItem('profilePic') || '')
        };
    }

    function restoreResetIdentity(storage, identity = null) {
        if (identity?.customUsername) storage.setItem('customUsername', String(identity.customUsername));
        if (identity?.profilePic) storage.setItem('profilePic', String(identity.profilePic));
    }

    function clearAccountSlot(storage, identity) {
        for (const entry of matchingSlotEntries(storage, identity)) storage.removeItem(entry.slotKey);
    }

    function moveLiveProgressToSlot(storage, identity) {
        snapshotAccountProgress(storage, identity);
        clearLiveProgress(storage);
    }

    function snapshotAccountProgress(storage, identity) {
        clearAccountSlot(storage, identity);
        const prefix = slotPrefix(identity);
        for (const key of liveProgressKeys(storage)) {
            const value = storage.getItem(key);
            if (value === null) continue;
            storage.setItem(prefix + encodeURIComponent(key), value);
        }
    }

    function snapshotActiveAccount(storage) {
        const active = readActiveAccount(storage);
        if (!active) return false;
        snapshotAccountProgress(storage, active);
        return true;
    }

    function restoreSlotToLiveProgress(storage, identity) {
        const canonicalPrefix = slotPrefix(identity);
        const entries = matchingSlotEntries(storage, identity)
            // If an older non-canonical slot and the new canonical slot both
            // exist, restore the canonical value last.
            .sort((first, second) => Number(first.slotKey.startsWith(canonicalPrefix)) - Number(second.slotKey.startsWith(canonicalPrefix)));
        for (const entry of entries) {
            const value = storage.getItem(entry.slotKey);
            if (value === null) continue;
            storage.setItem(entry.liveKey, value);
        }
        applyAccountFlagsToLiveProgress(storage, identity);
    }

    function activateAccount(storage, { serverUrl, accountId, fresh = false }) {
        const target = normalizeIdentity(serverUrl, accountId);
        const current = readActiveAccount(storage);
        const targetHadSlot = hasAccountSlot(storage, target);

        if (sameIdentity(current, target)) {
            if (fresh) {
                clearLiveProgress(storage);
                clearAccountSlot(storage, target);
                clearAccountFlags(storage, target);
                return { changed: true, reloadRequired: true, startedFresh: true, restoredAccountSlot:false };
            }
            return { changed: false, reloadRequired: false, startedFresh: false, restoredAccountSlot:false };
        }

        if (current) moveLiveProgressToSlot(storage, current);

        if (fresh) {
            clearLiveProgress(storage);
            clearAccountSlot(storage, target);
            clearAccountFlags(storage, target);
        } else if (current || targetHadSlot) {
            if (!current) clearLiveProgress(storage);
            restoreSlotToLiveProgress(storage, target);
        }

        writeActiveAccount(storage, target);

        // Existing installs have one unscoped legacy save. The first existing account
        // to authenticate adopts it without a reload; newly created accounts never do.
        const claimedLegacyProgress = !current && !fresh && !targetHadSlot;
        return {
            changed: true,
            reloadRequired: !claimedLegacyProgress,
            startedFresh: fresh,
            claimedLegacyProgress,
            restoredAccountSlot:targetHadSlot && !fresh
        };
    }

    function resetActiveAccount(storage) {
        const active = readActiveAccount(storage);
        clearLiveProgress(storage);
        if (active) {
            clearAccountSlot(storage, active);
            clearAccountFlags(storage, active);
        }
    }

    function deleteActiveAccount(storage, expected = null) {
        const active = readActiveAccount(storage);
        if (!active) {
            clearLiveProgress(storage);
            return;
        }
        if (expected) {
            const normalizedExpected = normalizeIdentity(expected.serverUrl, expected.accountId);
            if (!sameIdentity(active, normalizedExpected)) return;
        }
        clearLiveProgress(storage);
        clearAccountSlot(storage, active);
        clearAccountFlags(storage, active);
        storage.removeItem(ACTIVE_ACCOUNT_KEY);
    }

    function logoutActiveAccount(storage) {
        const active = readActiveAccount(storage);
        if (active) moveLiveProgressToSlot(storage, active);
        else clearLiveProgress(storage);
        storage.removeItem(ACTIVE_ACCOUNT_KEY);
        return active;
    }

    return {
        ACTIVE_ACCOUNT_KEY,
        ACCOUNT_SLOT_PREFIX,
        ACCOUNT_IDENTITY_PREFIX,
        ACCOUNT_FLAG_PREFIX,
        CLOUD_META_KEY,
        activateAccount,
        applyAccountFlagsToLiveProgress,
        captureResetIdentity,
        clearAccountFlags,
        exportCloudProgress,
        clearLiveProgress,
        deleteActiveAccount,
        hasAccountSlot,
        hasAccountFlag,
        logoutActiveAccount,
        markAccountFlag,
        readCloudMeta,
        readCachedIdentity,
        readActiveAccount,
        resetActiveAccount,
        restoreCloudProgress,
        restoreCloudProgressForActivation,
        restoreResetIdentity,
        shouldApplyServerReset,
        snapshotActiveAccount,
        writeCloudMeta,
        writeCachedIdentity
    };
});
