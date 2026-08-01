(function birthdayEventModule(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FlappyBirthdayEvent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBirthdayEventApi() {
    'use strict';

    const TIME_ZONE = 'America/New_York';
    const FIRST_YEAR = 2026;
    const START_MONTH = 3;
    const START_DAY = 21;
    const START_HOUR = 22;
    const DURATION_MS = 24 * 60 * 60 * 1000;
    const SKIN_NAME = 'Birthday Bash Monkey';
    const SKIN_FILE = 'Birthday Bash Monkey.png';
    const EVENT_ID = 'birthday_bash';
    const formatterCache = new Map();

    function formatterFor(timeZone) {
        if (!formatterCache.has(timeZone)) {
            formatterCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hourCycle: 'h23'
            }));
        }
        return formatterCache.get(timeZone);
    }

    function zonedParts(timestamp, timeZone = TIME_ZONE) {
        const values = {};
        for (const part of formatterFor(timeZone).formatToParts(new Date(timestamp))) {
            if (part.type !== 'literal') values[part.type] = Number(part.value);
        }
        return values;
    }

    function zoneOffsetAt(timestamp, timeZone = TIME_ZONE) {
        const parts = zonedParts(timestamp, timeZone);
        const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
        return representedUtc - Math.floor(timestamp / 1000) * 1000;
    }

    function zonedTimestamp(year, month, day, hour, minute = 0, second = 0, timeZone = TIME_ZONE) {
        const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
        let timestamp = targetAsUtc;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const corrected = targetAsUtc - zoneOffsetAt(timestamp, timeZone);
            if (corrected === timestamp) break;
            timestamp = corrected;
        }
        return timestamp;
    }

    function startForYear(year) {
        return zonedTimestamp(year, START_MONTH, START_DAY, START_HOUR);
    }

    function windowAt(value = Date.now()) {
        const now = Number(value);
        const safeNow = Number.isFinite(now) ? now : Date.now();
        const localYear = zonedParts(safeNow).year;
        if (localYear < FIRST_YEAR) {
            const nextStartsAt = startForYear(FIRST_YEAR);
            return { active: false, year: FIRST_YEAR, startedAt: null, endsAt: null, nextStartsAt };
        }

        const candidateStartsAt = startForYear(localYear);
        const candidateEndsAt = candidateStartsAt + DURATION_MS;
        if (safeNow >= candidateStartsAt && safeNow < candidateEndsAt) {
            return {
                active: true,
                year: localYear,
                startedAt: candidateStartsAt,
                endsAt: candidateEndsAt,
                nextStartsAt: startForYear(localYear + 1)
            };
        }

        const nextYear = safeNow < candidateStartsAt ? localYear : localYear + 1;
        return {
            active: false,
            year: nextYear,
            startedAt: null,
            endsAt: null,
            nextStartsAt: startForYear(Math.max(FIRST_YEAR, nextYear))
        };
    }

    function formatRemaining(milliseconds) {
        const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
    }

    function formatRemainingWords(milliseconds) {
        const [hours, minutes, seconds] = formatRemaining(milliseconds).split(':');
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    return Object.freeze({
        TIME_ZONE,
        FIRST_YEAR,
        START_MONTH,
        START_DAY,
        START_HOUR,
        DURATION_MS,
        EVENT_ID,
        SKIN_NAME,
        SKIN_FILE,
        zonedParts,
        zonedTimestamp,
        startForYear,
        windowAt,
        formatRemaining,
        formatRemainingWords
    });
});
