// ==UserScript==
// @name         SHaWZ QoL Tracker
// @namespace    https://github.com/MattShawz/voididle-shawz-qol
// @version      1.3.1
// @description  QoL addon for voididle.com — Gear Finder with inventory highlighting, Team tab with party stats, berserk tracker, session rates, leaderboard ranks, zone events and more.
// @author       MattShawz
// @match        https://voididle.com/*
// @match        https://www.voididle.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/MattShawz/voididle-shawz-qol/main/shawz-qol-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/MattShawz/voididle-shawz-qol/main/shawz-qol-tracker.user.js
// @homepageURL  https://github.com/MattShawz/voididle-shawz-qol
// @supportURL   https://github.com/MattShawz/voididle-shawz-qol/issues
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'shawz_qol_v10';
    let POLL_MS = Math.min(15000, Math.max(3000, parseInt(localStorage.getItem('shawz_poll_ms')||'') || 10000));
    const RATE_WINDOW = 3600000; // rolling 1-hour window for rate calc

    // ─── CONSTANTS ────────────────────────────────────────────────────────────
    const RARITY_BY_COLOR = {
        '122,110,98': { name: 'Common',    rank: 0 },
        '47,107,95':  { name: 'Rare',      rank: 1 },
        '107,58,138': { name: 'Epic',      rank: 2 },
        '198,168,92': { name: 'Legendary', rank: 3 },
        '179,58,58':  { name: 'Mythic',    rank: 4 },
    };
    const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
    const CAT_MAP = {
        'weapons':'weapons','armor':'armor','accessories':'accessories',
        'consumables':'consumables','potions':'potions','boss currency':'boss',
    };
    const NON_EQUIP = new Set(['consumables','potions','boss','other']);

    const ALL_STATS = [
        { key:'atk',               label:'ATK'         },
        { key:'def',               label:'DEF'         },
        { key:'hp',                label:'HP'          },
        { key:'mana',              label:'Mana'        },
        { key:'critChance',        label:'Crit Chance' },
        { key:'critDamage',        label:'Crit Dmg'    },
        { key:'healingPower',      label:'Heal Power'  },
        { key:'cooldownReduction', label:'CDR'         },
        { key:'dropRate',          label:'Drop Rate'   },
        { key:'atkSpeed',          label:'Atk Speed'   },
        { key:'allStats',          label:'All Stats'   },
        { key:'manaRegen',         label:'Mana Regen'  },
        { key:'goldFind',          label:'Gold Find'   },
        { key:'execute',           label:'Execute'     },
    ];

    // Bonus stats per slot — weapon type and armor weight aware.
    // Light armor = caster/DPS slots (no hp/def primary bonus, no healingPower)
    // Heavy armor = spear tank (no crit/mana/cdr/atkSpeed bonus)
    // Weapon stats split by weapon type (set via weaponType condition)
    const SLOT_STATS = {
        // Weapons — split by type via weaponType condition
        // Sword/Spear: critChance, critDamage, hp, def, atkSpeed, allStats
        // Bow: critChance, critDamage, atk, hp, atkSpeed, allStats
        // Staff/Harp: mana, healingPower, cdr, hp, atkSpeed, allStats
        // Fan: mana, critChance, critDamage, cdr, atkSpeed, allStats
        // Combined union for selector (user filters via weaponType condition):
        weapon:    ['critChance','critDamage','atk','hp','def','mana','healingPower','cooldownReduction','atkSpeed','allStats'],

        // Shield (always light, always offhand for spear/fan)
        offhand:   ['mana','cooldownReduction','manaRegen','allStats'],

        // Light armor
        helmet:    ['mana','cooldownReduction','critChance','atkSpeed','manaRegen','allStats'],
        shoulders: ['cooldownReduction','critChance','atkSpeed','manaRegen','allStats'],
        chest:     ['mana','cooldownReduction','critChance','critDamage','atkSpeed','manaRegen','dropRate','allStats'],
        hands:     ['critChance','critDamage','atk','cooldownReduction','atkSpeed','manaRegen','allStats'],
        legs:      ['mana','cooldownReduction','critDamage','atkSpeed','manaRegen','allStats'],
        boots:     ['mana','cooldownReduction','atkSpeed','critChance','manaRegen','allStats'],

        // Heavy armor overrides (applied when armorWeight === 'Heavy')
        helmet_heavy:    ['hp','def','healingPower','manaRegen','allStats'],
        shoulders_heavy: ['hp','def','healingPower','manaRegen','allStats'],
        chest_heavy:     ['hp','def','healingPower','manaRegen','allStats'],
        hands_heavy:     ['hp','def','healingPower','manaRegen','allStats'],
        legs_heavy:      ['hp','def','healingPower','manaRegen','allStats'],
        boots_heavy:     ['hp','def','healingPower','manaRegen','allStats'],

        // Accessories
        amulet:    ['mana','healingPower','cooldownReduction','critChance','atkSpeed','dropRate','manaRegen','allStats'],
        ring1:     ['critChance','critDamage','mana','healingPower','cooldownReduction','hp','atkSpeed','dropRate','manaRegen','allStats'],
        ring2:     ['critChance','critDamage','mana','healingPower','cooldownReduction','hp','atkSpeed','dropRate','manaRegen','allStats'],
    };

    function getStatOptsForSlot(slotId, armorWeight) {
        const isHeavy = armorWeight === 'Heavy';
        const heavyKey = slotId + '_heavy';
        const keys = (isHeavy && SLOT_STATS[heavyKey]) ? SLOT_STATS[heavyKey] : SLOT_STATS[slotId];
        if (!keys) return ALL_STATS.map(s => s.label);
        return ALL_STATS.filter(s => keys.includes(s.key)).map(s => s.label);
    }

    const SLOTS = [
        { id:'weapon',    label:'Weapon',    icon:'⚔️', types:['sword','bow','spear','staff','harp','fan'],
          weaponTypes: ['Sword','Bow','Spear','Staff','Harp','Fan'] },
        { id:'offhand',   label:'Offhand',   icon:'🛡️', types:['shield'] },
        { id:'helmet',    label:'Helmet',    icon:'🪖', types:['helmet','helm'],   canHeavy: true },
        { id:'shoulders', label:'Shoulders', icon:'🥋', types:['shoulders','shoulder'], canHeavy: true },
        { id:'chest',     label:'Chest',     icon:'🧥', types:['chest'],           canHeavy: true },
        { id:'hands',     label:'Hands',     icon:'🧤', types:['hands','gloves','hand'], canHeavy: true },
        { id:'legs',      label:'Legs',      icon:'👖', types:['legs','leggings','leg'], canHeavy: true },
        { id:'boots',     label:'Boots',     icon:'👢', types:['boots','feet','boot'],   canHeavy: true },
        { id:'amulet',    label:'Amulet',    icon:'📿', types:['amulet'] },
        { id:'ring1',     label:'Ring 1',    icon:'💍', types:['ring'] },
        { id:'ring2',     label:'Ring 2',    icon:'💍', types:['ring'] },
    ];

    const COND_TYPES = [
        { key:'tier',        label:'Tier ≥',           input:'number', min:1,  max:9,   ph:'3'  },
        { key:'subtier',     label:'Item level ≥',    input:'number', min:1,  max:163, ph:'27' },
        { key:'rarity',      label:'Rarity ≥',         input:'select', opts:RARITY_NAMES },
        { key:'hasStat',     label:'Has bonus stat',   input:'select', opts:[] },
        { key:'statQuality', label:'Stat quality ≥ %', input:'number', min:1,  max:100, ph:'90' },
        // Not shown in the dropdown — rendered as dedicated UI in the slot detail panel
        { key:'weaponType',  label:'Weapon type',      input:'hidden' },
        { key:'armorWeight', label:'Armor weight',     input:'hidden' },
    ];

    function mapTypeToSlotId(rawType) {
        if (!rawType) return '';
        const t = rawType.toLowerCase().trim();
        for (const s of SLOTS) {
            for (const kw of s.types) {
                if (t === kw || t.includes(kw) || kw.includes(t)) return s.id;
            }
        }
        return '';
    }

    // ─── STATE ────────────────────────────────────────────────────────────────
    const state = {
        // UI
        // Tooltip data keyed by stable item fingerprint (not DOM element ref)
        // so data survives React re-renders that replace element references.
        // Key: "{slotId}:{tier}:{rarityRank}:{enh}:{gridIndex}"
        tipCache: {},
        activeTab:    'home',
        activeSlot:   null,
        highlights:   { best:false, salvage:false },
        slotConfig:   {},
        cardCollapsed: {},
        layout:       { x:20, y:80, width:380, height:560, open:true },
        selfName:     null,
        lbRanks:      {},
        zerkMode:     false,
        settings: {
            hideBuffChips:    true,
            hideBuffIcons:    false,
            weaponPortraits:  false,
        },

        // Session tracking — arrays of { t: timestamp_ms, v: value }
        session: {
            startTime: Date.now(),
            xp:     [],   // raw xp values over time
            gold:   [],
            shards: [],
            kills:  [],   // each entry is { t } — one per kill event
            frags:  [],   // boss currency fragments
        },

        // Party member stats — keyed by name
        party: {},
    };

    SLOTS.forEach(s => {
        state.slotConfig[s.id] = { enabled:false, conditions:[] };
    });

    // ─── PERSIST ──────────────────────────────────────────────────────────────
    // Two storage keys: one for UI config (saved on every interaction),
    // one for session/party data (saved periodically and on scrape).
    const SESSION_KEY = STORAGE_KEY + '_session';

    const TIP_CACHE_KEY = STORAGE_KEY + '_tips';

    function loadPersist() {
        try {
            const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (p.layout)     Object.assign(state.layout, p.layout);
            if (p.activeTab)  state.activeTab = p.activeTab;
            if (p.highlights) Object.assign(state.highlights, p.highlights);
            if (p.settings)   Object.assign(state.settings, p.settings);
            if (p.zerkMode !== undefined) state.zerkMode = p.zerkMode;
            if (p.slotConfig) Object.keys(p.slotConfig).forEach(id => {
                state.slotConfig[id] = p.slotConfig[id];
            });
        } catch(e) {}

        // Restore tip cache so we don't re-scan on every page load
        try {
            const t = JSON.parse(localStorage.getItem(TIP_CACHE_KEY) || '{}');
            Object.assign(state.tipCache, t);
        } catch(e) {}

        // Restore session data + party stats from previous page load
        try {
            const s = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
            if (s.session) {
                ['xp','gold','shards'].forEach(k => {
                    if (s.session[k]) state.session[k] = s.session[k];
                });
                if (s.session.kills)     state.session.kills = s.session.kills;
                if (s.session.frags)     state.session.frags = s.session.frags;
                if (s.session.startTime) state.session.startTime = s.session.startTime;
            }
            if (s.party) {
                Object.keys(s.party).forEach(name => { state.party[name] = s.party[name]; });
            }
            if (s.selfName) state.selfName = s.selfName;
            // Load persisted leaderboard ranks
            try {
                const lb = localStorage.getItem(STORAGE_KEY+'_lb');
                if (lb) state.lbRanks = JSON.parse(lb);
            } catch(e) {}
        } catch(e) {}
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                layout:     Object.assign({}, state.layout, { panelHidden: state.layout.panelHidden||false }),
                activeTab:  state.activeTab,
                highlights: state.highlights,
                slotConfig: state.slotConfig,
                settings:   state.settings,
                zerkMode:   state.zerkMode,
            }));
        } catch(e) {}
    }

    function saveTipCache() {
        try { localStorage.setItem(TIP_CACHE_KEY, JSON.stringify(state.tipCache)); } catch(e) {}
    }

    // Save session + party data separately so it survives page reloads
    function saveSession() {
        try {
            // Trim kills to just timestamps (lightweight)
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                selfName: state.selfName,
                session: {
                    startTime: state.session.startTime,
                    xp:        state.session.xp,
                    gold:      state.session.gold,
                    shards:    state.session.shards,
                    kills:     state.session.kills,
                    frags:     state.session.frags,
                },
                // Persist party data but strip internal __ keys from stats
                // to avoid storing stale computed values
                party: Object.fromEntries(
                    Object.entries(state.party).map(([name, m]) => {
                        const cleanStats = Object.fromEntries(
                            Object.entries(m.stats || {}).filter(([k]) => !k.startsWith('__'))
                        );
                        return [name, { ...m, stats: cleanStats }];
                    })
                ),
            }));
        } catch(e) {}
    }

    // ─── SESSION TRACKING ─────────────────────────────────────────────────────
    function parseNum(str) {
        if (!str) return null;
        const n = parseFloat(str.replace(/,/g,''));
        return isNaN(n) ? null : n;
    }

    function pushSample(arr, val) {
        if (val === null) return;
        const now = Date.now();
        arr.push({ t: now, v: val });
        // Prune entries older than 2 hours so memory doesn't grow unbounded
        const cutoff = now - RATE_WINDOW * 2;
        while (arr.length && arr[0].t < cutoff) arr.shift();
    }

    // Rate per hour over up to the last RATE_WINDOW ms of data.
    // Only counts positive deltas — negative drops (spending) are ignored.
    function ratePerHour(arr) {
        if (arr.length < 2) return null;
        const now  = Date.now();
        const from = Math.max(arr[0].t, now - RATE_WINDOW);
        const recent = arr.filter(e => e.t >= from);
        if (recent.length < 2) return null;

        // Sum only positive consecutive deltas
        let gained = 0;
        for (let i = 1; i < recent.length; i++) {
            const delta = recent[i].v - recent[i-1].v;
            if (delta > 0) gained += delta;
        }

        const deltaT = (recent[recent.length-1].t - recent[0].t) / 3600000;
        if (deltaT <= 0) return null;
        return gained / deltaT;
    }

    // Kills/hr from timestamped kill events
    function killsPerHour() {
        const now    = Date.now();
        const cutoff = now - RATE_WINDOW;
        const recent = state.session.kills.filter(k => k.t >= cutoff);
        const oldest = recent.length ? recent[0].t : now;
        const elapsed = (now - oldest) / 3600000;
        return elapsed > 0.001 ? recent.length / elapsed : 0;
    }

    function pollSession() {
        // XP — extract raw xp from "(42,890 / 217,507)"
        const xpRaw = document.querySelector('.pb-xp-raw');
        if (xpRaw) {
            const m = xpRaw.textContent.match(/([\d,]+)\s*\/\s*([\d,]+)/);
            if (m) {
                const current = parseNum(m[1]);
                const total   = parseNum(m[2]);
                // XP earned this level = current. Track absolute total by adding
                // level-accumulated xp. We track % progress × max for simplicity.
                // Use (level * totalXpPerLevel) + current as a monotonic value.
                const lvEl = document.querySelector('.pb-level');
                const lv   = lvEl ? parseInt(lvEl.textContent.replace(/\D/g,'')) || 0 : 0;
                // Monotonic: lv * 1e6 + current (rough — gives correct delta)
                pushSample(state.session.xp, lv * 1000000 + (current || 0));
            }
        }

        // Gold
        const goldEl = document.querySelector('.inv-gold');
        if (goldEl) {
            const n = parseNum(goldEl.textContent.replace(/[^\d,]/g,''));
            pushSample(state.session.gold, n);
        }

        // Shards
        const shardEl = document.querySelector('.inv-shards');
        if (shardEl) {
            const n = parseNum(shardEl.textContent.replace(/[^\d,]/g,''));
            pushSample(state.session.shards, n);
        }

        // Boss Currency frags — sum all quantities across all frag slots
        const fragCat = [...document.querySelectorAll('.bag-category')].find(cat =>
            /boss.?curr/i.test(cat.querySelector('.bag-cat-label')?.textContent||'')
        );
        if (fragCat) {
            let total = 0;
            fragCat.querySelectorAll('.bag-grid .is-qty').forEach(el => {
                total += parseNum(el.textContent.replace(/[^\d,]/g,''));
            });
            if (total > 0) pushSample(state.session.frags, total);
        }

        // Berserk states — read from combat view every poll
        if (state.activeTab === 'team') renderTeamTab(document.getElementById('invf-body'));
        else if (state.activeTab === 'home') renderHomeTab(document.getElementById('invf-body'));

        // Persist session data so a page reload doesn't wipe the rates
        saveSession();
    }

    function formatRate(r, decimals) {
        if (r === null || isNaN(r)) return '—';
        const abs = Math.abs(r);
        const sign = r < 0 ? '-' : '+';
        if (abs >= 1e6) return sign + (abs/1e6).toFixed(decimals||1) + 'M';
        if (abs >= 1e3) return sign + (abs/1e3).toFixed(decimals||1) + 'K';
        return sign + abs.toFixed(decimals||0);
    }

    function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return h + 'h ' + (m%60) + 'm';
        if (m > 0) return m + 'm ' + (s%60) + 's';
        return s + 's';
    }

    // ─── KILL TRACKING ────────────────────────────────────────────────────────
    // Watch enemy cards for active → dead transitions
    function setupKillObserver() {
        const seen = new WeakSet();
        new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
                const card = m.target;
                if (!card.classList.contains('cc-ec-dead')) continue;
                if (seen.has(card)) continue;
                seen.add(card);
                state.session.kills.push({ t: Date.now() });
                // Prune old kills
                const cutoff = Date.now() - RATE_WINDOW * 2;
                while (state.session.kills.length && state.session.kills[0].t < cutoff)
                    state.session.kills.shift();
            }
        }).observe(document.body, { subtree:true, attributes:true, attributeFilter:['class'] });
    }

    // ─── PARTY STATS ──────────────────────────────────────────────────────────

    // Detect which party member is "you" — the row with no Inspect button.
    // Also sets state.selfName so we can label them correctly.
    function detectSelf() {
        const rows = document.querySelectorAll('.sp-member-row');
        rows.forEach(row => {
            const hasInspect = !!row.querySelector('.sp-btn-inspect');
            if (!hasInspect) {
                const nameEl = row.querySelector('.sp-member-name');
                const name   = [...(nameEl?.childNodes||[])]
                    .find(n=>n.nodeType===3)?.textContent.trim();
                if (name) state.selfName = name;
            }
        });
    }

    // Read all party members from the party panel into state.party
    function readPartyPanel() {
        detectSelf();
        const rows = document.querySelectorAll('.sp-member-row');
        rows.forEach(row => {
            const nameEl = row.querySelector('.sp-member-name');
            if (!nameEl) return;
            const name = [...nameEl.childNodes]
                .find(n=>n.nodeType===3)?.textContent.trim();
            if (!name) return;

            const lv       = row.querySelector('.sp-friend-lv')?.textContent.replace(/\D/g,'')||'?';
            const activity = row.querySelector('.sp-act-label')?.textContent.trim()||'—';
            const online   = !!row.querySelector('.sp-online-dot.on');
            const aura     = row.querySelector('.sp-member-aura')?.textContent.trim()||'';
            const isSelf   = name === state.selfName;

            if (!state.party[name]) state.party[name] = {};
            Object.assign(state.party[name], { name, lv, activity, online, aura, isSelf });
        });
    }

    // Read berserk state for all visible party members from .cc-party-grid
    // and for self from .zerk-wrapper. Updates state.party[name].zerk.
    // ── Weapon class portraits ──────────────────────────────────────────────
    // Hosted in the repo under /characters/ — override the generic .cc-player-img
    const PORTRAIT_BASE = 'https://raw.githubusercontent.com/MattShawz/voididle-shawz-qol/main/characters/';
    const PORTRAIT_MAP = {
        sword: PORTRAIT_BASE + 'SWORD_512.webp',
        bow:   PORTRAIT_BASE + 'BOW_512.webp',
        spear: PORTRAIT_BASE + 'SPEAR_512.webp',
        staff: PORTRAIT_BASE + 'STAFF_512.webp',
        harp:  PORTRAIT_BASE + 'HARP_512.webp',
        fan:   PORTRAIT_BASE + 'FAN_512.webp',
        guardian: PORTRAIT_BASE + 'GUARDIAN_512.webp?v=2',
    };

    function applyWeaponPortraits() {
        if (!state.settings.weaponPortraits) {
            // Remove any overlay images we previously inserted
            document.querySelectorAll('.shawz-portrait-overlay').forEach(el => el.remove());
            // Restore visibility of the original portraits we hid underneath
            document.querySelectorAll('.cc-player-img').forEach(img => {
                img.style.removeProperty('visibility');
            });
            return;
        }
        document.querySelectorAll('.cc-pm-card').forEach(card => {
            const name = card.querySelector('.cc-pm-name')?.textContent.trim();
            if (!name) return;

            // Summoned pets (e.g. spear class "🗿 Frisk's Guardian") aren't
            // real party members and won't have a weaponType in state.party.
            // Detect them by the "'s Guardian" naming pattern and apply a
            // dedicated portrait regardless of the summoner's own weapon.
            const isGuardian = /'s Guardian$/i.test(name) || name.includes('🗿');
            const wt = isGuardian ? 'guardian' : state.party[name]?.weaponType;
            const url = wt && PORTRAIT_MAP[wt];
            if (!url) return;

            const thumb = card.querySelector('.cc-pm-thumb') || card.querySelector('.cc-pm-thumb-v2');
            const img   = card.querySelector('.cc-player-img');
            const mountPoint = thumb || img?.parentElement;
            if (!mountPoint) return;

            let overlay = mountPoint.querySelector(':scope > .shawz-portrait-overlay');

            // Already showing the correct portrait — nothing to do
            if (overlay && overlay.getAttribute('data-shawz-portrait') === wt) return;

            if (!overlay) {
                overlay = document.createElement('img');
                overlay.className = 'shawz-portrait-overlay';
                overlay.style.cssText = `
                    position: absolute; inset: 0; width: 100%; height: 100%;
                    object-fit: cover; border-radius: inherit; z-index: 5;
                    pointer-events: none;
                `;
                // Ensure the mount point can host an absolutely-positioned child
                const mp = getComputedStyle(mountPoint).position;
                if (mp === 'static') mountPoint.style.position = 'relative';
                mountPoint.appendChild(overlay);

                overlay.onload  = () => _log('[portrait] overlay loaded OK:', wt, url);
                overlay.onerror = () => _warn('[portrait] overlay FAILED to load:', wt, url);
            }

            overlay.src = url;
            overlay.setAttribute('data-shawz-portrait', wt);

            // Hide the original background div underneath rather than fighting it
            if (img) img.style.setProperty('visibility', 'hidden', 'important');
        });
    }

    // ── Live mana tracking ──────────────────────────────────────────────────
    // Instead of modelling every individual mana-cost source (skills, auras,
    // imbues — which keeps growing as new mythic abilities are added), we
    // sample the player's ACTUAL mana value from the combat bar every tick
    // and derive a real measured regen rate from the deltas. This adapts
    // automatically to any drain or regen source, dynamic or otherwise.
    if (!window._shawzManaHistory) window._shawzManaHistory = []; // [{t, val, max}]
    if (window._shawzManaRateEMA === undefined) window._shawzManaRateEMA = null; // smoothed net rate
    const MANA_HISTORY_MS = 16000; // keep last 16s of samples — more data to smooth over
    const MANA_EMA_ALPHA = 0.25;   // smoothing factor — lower = smoother but slower to react

    function sampleLiveMana() {
        const card = document.querySelector('.cc-pm-card.cc-pm-you .cc-pm-mp-track .cc-bar-intext');
        if (!card) return null;
        const m = card.textContent.trim().match(/^([\d,]+)\s*\/\s*([\d,]+)$/);
        if (!m) return null;
        const val = parseFloat(m[1].replace(/,/g,''));
        const max = parseFloat(m[2].replace(/,/g,''));
        const now = Date.now();

        const hist = window._shawzManaHistory;
        hist.push({ t: now, val, max });
        // Trim old samples
        while (hist.length && now - hist[0].t > MANA_HISTORY_MS) hist.shift();

        return { val, max, now };
    }

    // Derive empirical mana rates from the sample history.
    //
    // ONE-OFF EVENT FILTERING: mythic procs (e.g. "+20% mana after X spells")
    // and mana potions create a single large jump between two samples. If we
    // included that delta at full weight in the rate, the displayed number
    // would spike wildly for a moment then crash back down on the next tick
    // as the window rolls past it. Instead, any single-tick delta whose
    // magnitude is way out of line with the recent typical delta is treated
    // as a discrete EVENT — it still updates "current mana" correctly (next
    // call to sampleLiveMana already captured the true value), but it's
    // excluded from the rate trend so the displayed flow stays smooth.
    //
    // SMOOTHING: on top of outlier exclusion, the final "net" rate is run
    // through an exponential moving average (EMA) so it eases toward the
    // true rate over ~1-2 seconds rather than jumping tick to tick.
    //
    // Returns:
    //   - net:    smoothed mana change per 10s, excluding one-off events —
    //             this is the headline number, answers "am I trending to OOM"
    //   - gross:  regen-only portion of net (positive ticks only, same outlier rules)
    //   - rawNet: unsmoothed net, for debugging/comparison
    function getEmpiricalManaRate() {
        const hist = window._shawzManaHistory;
        if (!hist || hist.length < 2) return null;

        // First pass: collect all per-tick deltas (rate-normalised to /10s)
        // so we can establish what a "typical" tick looks like.
        const ticks = [];
        for (let i = 1; i < hist.length; i++) {
            const prev = hist[i - 1];
            const cur  = hist[i];
            const dt   = cur.t - prev.t;
            if (dt <= 0 || dt > 4000) continue; // skip gaps (tab inactive, lag, reconnect)
            const dv = cur.val - prev.val;
            ticks.push({ dv, dt, ratePerSec: dv / (dt / 1000) });
        }
        if (!ticks.length) return null;

        // Typical tick magnitude — median of absolute per-second rates,
        // used as the baseline to detect outliers against. Median (not
        // mean) so a single huge proc doesn't drag the baseline up and
        // mask itself.
        const absRates = ticks.map(t => Math.abs(t.ratePerSec)).sort((a,b) => a-b);
        const median = absRates[Math.floor(absRates.length / 2)] || 0;
        // An event is "one-off" if its magnitude is much larger than the
        // typical tick — threshold scales with the median so it adapts to
        // each character's actual regen scale, with a sane floor so it
        // still catches outliers even when regen is near-zero.
        const outlierThreshold = Math.max(median * 4, 15); // MP/s

        let netChange = 0, grossGain = 0, elapsedMs = 0;
        let rawNetChange = 0, rawElapsedMs = 0;
        for (const t of ticks) {
            rawElapsedMs += t.dt;
            rawNetChange += t.dv;

            if (Math.abs(t.ratePerSec) > outlierThreshold) {
                // One-off event (mythic proc, potion, big spend) — counted
                // toward elapsed time so the rate doesn't get artificially
                // inflated by ignoring the time it took, but the magnitude
                // itself is excluded from the trend.
                elapsedMs += t.dt;
                continue;
            }
            elapsedMs += t.dt;
            netChange += t.dv;
            if (t.dv > 0) grossGain += t.dv;
        }
        if (elapsedMs <= 0) return null;

        const rawNet = (netChange / elapsedMs) * 10000;
        const gross  = (grossGain / elapsedMs) * 10000;

        // Exponential smoothing on top of outlier-filtered rate
        if (window._shawzManaRateEMA === null) {
            window._shawzManaRateEMA = rawNet;
        } else {
            window._shawzManaRateEMA = MANA_EMA_ALPHA * rawNet + (1 - MANA_EMA_ALPHA) * window._shawzManaRateEMA;
        }

        return {
            net: window._shawzManaRateEMA,
            rawNet,
            gross,
            sampleMs: rawElapsedMs,
        };
    }

    function readBerserkStates() {
        // Clear previous zerk states so offline/absent players don't show stale data
        Object.values(state.party).forEach(p => { delete p.zerk; });

        // Party members from combat view
        document.querySelectorAll('.cc-pm-card').forEach(card => {
            const name = card.querySelector('.cc-pm-name')?.textContent.trim();
            if (!name) return;

            const track  = card.querySelector('.cc-pm-zerk-track');
            const fill   = card.querySelector('.cc-pm-zerk-fill');
            if (!fill) return; // no berserk bar = 0%

            const pct    = parseFloat(fill.style.width) || 0;
            const active = track?.classList.contains('cc-pm-zerk-active') || false;
            // Title is "Berserk 40s" when active, "Berserk 94%" when charging
            const title  = track?.getAttribute('title') || '';
            const secM   = title.match(/(\d+)s/);
            const secsLeft = secM ? parseInt(secM[1]) : null;

            if (!state.party[name]) state.party[name] = {};
            state.party[name].zerk = { pct, active, secsLeft };
        });

        // Self from .zerk-wrapper (classic UI) or .mab-zerk (experimental UI)
        if (state.selfName) {
            const selfAlreadyRead = state.party[state.selfName]?.zerk;
            if (!selfAlreadyRead) {
                // Experimental UI — .mab-zerk button with height-based fill
                const mabZerkFill = document.querySelector('.mab-zerk .mab-zerk-fill');
                if (mabZerkFill) {
                    const pct = parseFloat(mabZerkFill.style.height) || 0;
                    const label = document.querySelector('.mab-zerk .mab-zerk-label')?.textContent || '';
                    const active = /\d+s/.test(label);
                    const secM = label.match(/(\d+)s/);
                    const secsLeft = secM ? parseInt(secM[1]) : null;
                    if (!state.party[state.selfName]) state.party[state.selfName] = {};
                    state.party[state.selfName].zerk = { pct, active, secsLeft };
                } else {
                    // Classic UI — .zerk-bar-fill with width-based fill
                    const selfFill = document.querySelector('.zerk-bar-fill');
                    if (selfFill) {
                        const pct = parseFloat(selfFill.style.width) || 0;
                        const label = document.querySelector('.zerk-bar-label')?.textContent || '';
                        const active = /\d+s/.test(label);
                        const secM = label.match(/(\d+)s/);
                        const secsLeft = secM ? parseInt(secM[1]) : null;
                        if (!state.party[state.selfName]) state.party[state.selfName] = {};
                        state.party[state.selfName].zerk = { pct, active, secsLeft };
                    }
                }
            }
        }
    }

    // Calculate MP/10s required to sustain all active skills.
    // Reads each .skill-row-active, extracts MP cost and cooldown in seconds,
    // sums (cost / cooldown) × 10 across all active skills.
    // Mana costs for flat mana/5s imbues by weapon type
    const IMBUE_MANA_PER_5S = {
        'Battle March': 8,
        'Guard Rhythm': 8,
        'Mana Sonata':  3,
        'Hymn of Life': 9,
    };

    // Mana costs for mana/hit imbues (weapon type → cost)
    const IMBUE_MANA_PER_HIT = {
        'Withering Wind': 3, // Fan
        'Flame Edge':     3, // Sword
        'Venom Tip':      2, // Bow
        'Stone Skin':     3, // Spear — mana per hit received, use estimate
    };

    // Arcane Charge (Staff) — mana/hit by rank
    const ARCANE_CHARGE_MANA = { 1:5, 2:6, 3:8, 4:9 };

    function getAttackIntervalMs() {
        // "Atk Speed" stat — format varies by character UI layout:
        //   New "MMO" layout: "1.76s"  → this IS the interval in seconds already
        //   Older layouts:    "1.76/s" or "1.76 atk/s" → this is a RATE (hits/sec)
        const atkRaw = state.party[state.selfName]?.stats?.['Attack Speed'] || '';
        const atkMatch = atkRaw.match(/([\d.]+)/);
        if (atkMatch) {
            const num = parseFloat(atkMatch[1]);
            // If the raw string ends in "s" with no "/" before it, it's an interval already
            const isInterval = /^\s*[\d.]+\s*s\s*$/i.test(atkRaw);
            return isInterval ? Math.round(num * 1000) : Math.round(1000 / num);
        }
        // Fallback: read from combat attack bar animation duration
        const selfCard = document.querySelector('.cc-pm-card.cc-pm-you .cc-attack-bar-fill');
        if (selfCard) {
            const anim = selfCard.style.animation || '';
            const ms = anim.match(/(\d+)ms/);
            if (ms) return parseInt(ms[1]);
        }
        return 2000; // default 2s
    }

    function getHitChance() {
        // "Hit Chance" stat e.g. "94%" or "94.5%"
        const raw = state.party[state.selfName]?.stats?.['Hit Chance'] ||
                    state.party[state.selfName]?.stats?.['Hit Rate'] || '';
        const m = raw.match(/([\d.]+)/);
        return m ? Math.min(1, parseFloat(m[1]) / 100) : 1.0; // default 100%
    }

    function getArcaneChargeRank() {
        // Look for Arcane Charge node in ability tree SVG
        // The rank is shown in a text element near the "Arcane Charge" label
        const svgTexts = [...document.querySelectorAll('svg text')];
        const acLabel = svgTexts.find(t => t.textContent.trim() === 'Arcane Charge');
        if (!acLabel) return 0;
        // Look for a rank number in nearby text elements (same parent group)
        const group = acLabel.closest('g');
        if (!group) return 0;
        const rankText = [...group.querySelectorAll('text')]
            .map(t => t.textContent.trim())
            .find(t => /^[1-4]$/.test(t));
        return parseInt(rankText) || 1; // default rank 1 if found but no number
    }

    function calcManaRequired() {
        let mpPer10s = 0;
        const breakdown = [];

        // ── 1. Skills ─────────────────────────────────────────────────────────
        let skillMp = 0;
        const mabBar = document.querySelector('.mab-bar');
        if (mabBar) {
            // Use cached costs from popover reads (most reliable)
            const cache = window._shawzMabCache?.skills || {};
            Object.values(cache).forEach(({ cost, cd }) => {
                if (cost > 0 && cd > 0) skillMp += (cost / cd) * 10;
            });
            // Fallback: try reading mana cost directly from slots if cache empty
            if (skillMp === 0) {
                const abGroup = [...mabBar.querySelectorAll('.mab-group')]
                    .find(g => g.querySelector('.mab-group-label')?.textContent.trim() === 'Abilities');
                if (abGroup) {
                    abGroup.querySelectorAll('.mab-slot-active').forEach(btn => {
                        const cost = parseFloat(btn.querySelector('.mab-mana-cost')?.textContent) || 0;
                        const cd   = parseFloat((btn.querySelector('.mab-cd-text')?.textContent||'').replace(/[^\d.]/g,'')) || 0;
                        if (cost > 0 && cd > 0) skillMp += (cost / cd) * 10;
                    });
                }
            }
        } else {
            document.querySelectorAll('.skill-row.skill-row-active').forEach(row => {
                const costEl = row.querySelector('.skill-mana-cost');
                const metaEl = row.querySelector('.skill-row-meta');
                if (!costEl || !metaEl) return;
                const cost = parseFloat(costEl.textContent.replace(/[^\d.]/g,'')) || 0;
                const cdM  = metaEl.textContent.match(/·\s*([\d.]+)s/);
                const cd   = cdM ? parseFloat(cdM[1]) : 0;
                if (cost > 0 && cd > 0) skillMp += (cost / cd) * 10;
            });
        }
        if (skillMp > 0) { mpPer10s += skillMp; breakdown.push({ label:'skills', value: skillMp }); }

        // ── 2. Aura drain ─────────────────────────────────────────────────────
        // Try mab cache first, then live aura-header-summary
        const cachedAura = window._shawzMabCache?.auraMpPer5s;
        const maxMana = parseFloat((state.party[state.selfName]?.stats?.['Max Mana']||'0').replace(/,/g,'')) || 0;
        if (cachedAura && typeof cachedAura === 'object') {
            let v = 0;
            if (cachedAura.pct && maxMana > 0) v = (cachedAura.pct / 100) * maxMana * 2;
            else if (cachedAura.flat) v = cachedAura.flat * 2;
            if (v > 0) { mpPer10s += v; breakdown.push({ label:'aura', value: v }); }
        } else {
            const auraSummary = document.querySelector('.aura-header-summary');
            if (auraSummary) {
                const auraText = auraSummary.textContent || '';
                const auraPct  = auraText.match(/([\d.]+)%\s*MP\/5s/i);
                if (auraPct && maxMana > 0) {
                    const v = (parseFloat(auraPct[1]) / 100) * maxMana * 2;
                    mpPer10s += v; breakdown.push({ label:'aura', value: v });
                } else {
                    const auraFlat = auraText.match(/([\d.]+)\s*MP\/5s/i);
                    if (auraFlat) { const v = parseFloat(auraFlat[1]) * 2; mpPer10s += v; breakdown.push({ label:'aura', value: v }); }
                }
            }
        }

        // ── 3. Imbues ─────────────────────────────────────────────────────────
        // Use cached imbue list from popover, fall back to live UI
        let activeImbues = window._shawzMabCache?.imbues?.length
            ? window._shawzMabCache.imbues
            : [...document.querySelectorAll('.virtuoso-imbue-pill.active')]
                .map(btn => btn.getAttribute('title')?.replace(/\s*—.*$/,'').trim()).filter(Boolean);

        if (!activeImbues.length && mabBar) {
            const ig = [...mabBar.querySelectorAll('.mab-group')]
                .find(g => g.querySelector('.mab-group-label')?.textContent.trim() === 'Imbue');
            if (ig) activeImbues = [...ig.querySelectorAll('.mab-slot-active')]
                .map(btn => (btn.getAttribute('aria-label')||'').replace(/^imbue:\s*/i,'')
                    .replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim()).filter(Boolean);
        }
        if (activeImbues.length > 0) {
            const hitsPerTen = (10000 / getAttackIntervalMs()) * getHitChance();
            activeImbues.forEach(name => {
                let v = 0;
                if      (IMBUE_MANA_PER_5S[name]  !== undefined) v = IMBUE_MANA_PER_5S[name] * 2;
                else if (name === 'Stone Skin')                   v = IMBUE_MANA_PER_HIT['Stone Skin'] * (10/3);
                else if (name === 'Arcane Charge')                v = (ARCANE_CHARGE_MANA[getArcaneChargeRank()] || 5) * hitsPerTen;
                else if (IMBUE_MANA_PER_HIT[name] !== undefined)  v = IMBUE_MANA_PER_HIT[name] * hitsPerTen;
                if (v > 0) { mpPer10s += v; breakdown.push({ label: name, value: v }); }
            });
        }

        return { total: mpPer10s, breakdown };
    }

    // Segment colours for each drain source
    const MANA_SEG_COLORS = {
        skills:        '#534AB7',
        aura:          '#1D9E75',
        'Battle March':'#BA7517',
        'Guard Rhythm':'#D85A30',
        'Mana Sonata': '#378ADD',
        'Hymn of Life':'#993556',
        'Flame Edge':  '#E05555',
        'Venom Tip':   '#55BB55',
        'Withering Wind':'#DD55AA',
        'Stone Skin':  '#5599DD',
        'Arcane Charge':'#BB77EE',
    };

    // Scrape YOUR OWN stats from .cv-stats-grid (always available on your char page).
    // Merges into existing stats so data from a previous scrape isn't wiped
    // if the grid isn't currently visible (e.g. wrong tab open).

    // Read weapon type and image from either .inv-eq-grid or .eq-grid (character panel)
    function readWeaponFromGrid(root) {
        const WEAPON_TYPES = ['sword','bow','spear','staff','harp','fan'];

        // Extract weapon type from an image src path, e.g.
        // "/Equipment/Harp/Harp Tier 1.webp" -> "harp"
        // "/Equipment/Bows/Bow Tier 5.webp"   -> "bow"
        // "/Equipment/Swords/New/Tier 4.webp" -> "sword"
        // "/Equipment/Spear/Spear Tier 1.webp"-> "spear"
        function wtFromSrc(src) {
            if (!src) return '';
            const lower = src.toLowerCase();
            if (lower.includes('/harp')) return 'harp';
            if (lower.includes('/bow'))  return 'bow';
            if (lower.includes('/spear'))return 'spear';
            if (lower.includes('/sword'))return 'sword';
            if (lower.includes('/staff'))return 'staff';
            if (lower.includes('/fan'))  return 'fan';
            return '';
        }

        // If a root is given, search ONLY within it — never fall back to the
        // whole document, or we risk picking up a stale weapon from another
        // player's modal / our own character sheet still present in the DOM.
        if (root) {
            // New "MMO" layout — .cv-mmo-center-weapon .cvm-slot img
            const mmoWeapon = root.querySelector('.cv-mmo-center-weapon img');
            if (mmoWeapon) {
                const src = mmoWeapon.getAttribute('src') || '';
                const alt = mmoWeapon.getAttribute('alt')?.trim().toLowerCase() || '';
                // alt is the item display name here, not the type — try matching
                // it directly first (covers cases where alt happens to be the type),
                // then fall back to parsing the src path
                const wt = WEAPON_TYPES.find(w => alt === w) || wtFromSrc(src);
                if (wt) return { wt, src };
            }
            const slot1 = [...root.querySelectorAll('.equip-slot-compact.filled')]
                .find(el => el.querySelector('.es-label')?.textContent.trim().toLowerCase() === 'weapon');
            if (slot1) {
                const img = slot1.querySelector('img');
                const alt = img?.getAttribute('alt')?.trim().toLowerCase() || '';
                const src = img?.getAttribute('src') || '';
                const wt = WEAPON_TYPES.find(w => alt === w) || wtFromSrc(src);
                if (wt) return { wt, src };
            }
            const slot2 = root.querySelector('.eq-slot.eq-weapon');
            if (slot2) {
                const img = slot2.querySelector('img.eq-item-img');
                const alt = img?.getAttribute('alt')?.trim().toLowerCase() || '';
                const src = img?.getAttribute('src') || '';
                const wt = WEAPON_TYPES.find(w => alt === w) || wtFromSrc(src);
                if (wt) return { wt, src };
            }
            // Root was given but nothing matched inside it — return null,
            // do NOT fall through to a document-wide search.
            return null;
        }

        // No root given (e.g. self-stats scrape with no specific container) —
        // search the whole document as a last resort, but EXCLUDE anything
        // inside an open .inspect-modal since that markup is structurally
        // identical to our own equipped gear and would otherwise contaminate
        // our own weapon reading with whichever player is currently inspected.
        const mmoWeapon = document.querySelector('.cv-mmo-center-weapon img');
        if (mmoWeapon && !mmoWeapon.closest('.inspect-modal')) {
            const src = mmoWeapon.getAttribute('src') || '';
            const alt = mmoWeapon.getAttribute('alt')?.trim().toLowerCase() || '';
            const wt = WEAPON_TYPES.find(w => alt === w) || wtFromSrc(src);
            if (wt) return { wt, src };
        }
        const slot1 = [...document.querySelectorAll('.equip-slot-compact.filled')]
            .filter(el => !el.closest('.inspect-modal'))
            .find(el => el.querySelector('.es-label')?.textContent.trim().toLowerCase() === 'weapon');
        if (slot1) {
            const img = slot1.querySelector('img');
            const alt = img?.getAttribute('alt')?.trim().toLowerCase() || '';
            const src = img?.getAttribute('src') || '';
            const wt = WEAPON_TYPES.find(w => alt === w) || wtFromSrc(src);
            if (wt) return { wt, src };
        }
        const slot2 = [...document.querySelectorAll('.eq-slot.eq-weapon img.eq-item-img')]
            .find(el => !el.closest('.inspect-modal'));
        if (slot2) {
            const alt = slot2.getAttribute('alt')?.trim().toLowerCase() || '';
            const src = slot2.getAttribute('src') || '';
            const wt = WEAPON_TYPES.find(w => alt === w) || wtFromSrc(src);
            if (wt) return { wt, src };
        }
        return null;
    }

    function scrapeSelfStats() {
        if (!state.selfName) return;

        // Start from existing stats so we preserve anything already scraped
        const existing = state.party[state.selfName]?.stats || {};
        const stats = { ...existing };

        const grid = document.querySelector('.cv-stats-grid');
        if (grid) {
            // Only update stat values we can actually see right now
            grid.querySelectorAll('.sb-stat-header').forEach(btn => {
                const name  = btn.querySelector('.sb-stat-name')?.textContent.trim();
                const total = btn.querySelector('.sb-stat-total')?.textContent.trim();
                if (name && total) stats[name] = total;
            });

            const pmRow = grid.querySelector('.sb-phys-mag-row');
            if (pmRow) {
                pmRow.querySelectorAll('.sb-pm-val').forEach(el => {
                    const t = el.textContent.trim();
                    const m = t.match(/^(Physical|Magical):\s*(.+)$/);
                    if (m) stats[m[1] + ' ATK'] = m[2];
                });
            }
        }

        // New "MMO" character layout — .cv-mmo-stats / .cvm-stat-row
        const mmoStats = document.querySelector('.cv-mmo-stats');
        if (mmoStats) {
            mmoStats.querySelectorAll('.cvm-stat-row').forEach(row => {
                const labelEl = row.querySelector('.cvm-stat-label');
                const valEl   = row.querySelector('.cvm-stat-value');
                if (!labelEl || !valEl) return;
                // Label text includes a leading "⌄" caret span — strip it,
                // keep only the trailing text node(s)
                const label = [...labelEl.childNodes]
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim())
                    .join('')
                    .trim();
                const val = valEl.textContent.trim();
                if (label && val && val !== '—') {
                    // Normalise label names to match what calcManaRequired/getAttackIntervalMs expect
                    const NORMALISE = {
                        'Attack':       'Attack',
                        'Atk Speed':    'Attack Speed',
                        'Hit Chance':   'Hit Chance',
                        'Crit Chance':  'Crit Chance',
                        'Crit Damage':  'Crit Damage',
                        'Max HP':       'Max HP',
                        'Defense':      'Defense',
                        'HP Regen':     'HP Regen',
                        'Max Mana':     'Max Mana',
                        'Mana Regen':   'Mana Regen',
                        'CDR':          'CDR',
                        'XP Bonus':     'XP Bonus',
                        'Gold Bonus':   'Gold Bonus',
                    };
                    stats[NORMALISE[label] || label] = val;
                }
            });
            // Power, Phys/Magic ATK from the WEAPON / RANGE section
            const physAtk = [...mmoStats.querySelectorAll('.cvm-stat-row')]
                .find(r => r.querySelector('.cvm-stat-label')?.textContent.includes('Phys ATK'));
            const magAtk = [...mmoStats.querySelectorAll('.cvm-stat-row')]
                .find(r => r.querySelector('.cvm-stat-label')?.textContent.includes('Magic ATK'));
            if (physAtk) stats['Physical ATK'] = physAtk.querySelector('.cvm-stat-value')?.textContent.trim();
            if (magAtk)  stats['Magical ATK']  = magAtk.querySelector('.cvm-stat-value')?.textContent.trim();
        }

        // Mana regen calculation — only update if skills panel is visible
        const skillRows = document.querySelectorAll('.skill-row.skill-row-active');
        const mabAbilities = document.querySelectorAll('.mab-group .mab-slot-active');
        if (skillRows.length > 0 || mabAbilities.length > 0) {
            const mpResult   = calcManaRequired();
            const mpRequired = mpResult.total;
            stats.__mpRequired  = mpRequired;
            stats.__mpBreakdown = mpResult.breakdown;

            // Build imbue list for display — check both UIs
            let activeImbueNames = [...document.querySelectorAll('.virtuoso-imbue-pill.active')]
                .map(btn => btn.getAttribute('title')?.replace(/\s*—.*$/,'').trim())
                .filter(Boolean);
            if (!activeImbueNames.length) {
                const mabImbue = [...document.querySelectorAll('.mab-group')]
                    .find(g => g.querySelector('.mab-group-label')?.textContent.trim() === 'Imbue');
                if (mabImbue) {
                    activeImbueNames = [...mabImbue.querySelectorAll('.mab-slot-active')]
                        .map(btn => (btn.getAttribute('aria-label')||'')
                            .replace(/^imbue:\s*/i,'').replace(/_/g,' ')
                            .replace(/\b\w/g,c=>c.toUpperCase()).trim())
                        .filter(Boolean);
                }
            }
            stats.__mpImbues = activeImbueNames;

            // Actual mana regen from stat
            const manaRegenRaw   = stats['Mana Regen'] || '';
            const manaRegenMatch = manaRegenRaw.match(/([\d.]+)/);
            const mpActual       = manaRegenMatch ? parseFloat(manaRegenMatch[1]) : (stats.__mpActual || 0);
            stats.__mpActual  = mpActual;
            stats.__mpDelta   = mpActual - mpRequired;
        }

        if (!state.party[state.selfName]) {
            state.party[state.selfName] = { name: state.selfName, isSelf: true };
        }
        state.party[state.selfName].stats     = stats;
        state.party[state.selfName].statsTime = Date.now();

        // Read own weapon type from any visible equipped grid.
        // IMPORTANT: .inv-eq-grid is NOT unique to your own inventory — every
        // .inspect-modal also contains .inv-eq-grid for the player being
        // inspected. If an inspect modal happens to be open when this runs,
        // a bare document.querySelector('.inv-eq-grid') will match THEIR
        // modal instead of your own equipped tab, silently assigning their
        // weapon to you. Explicitly exclude anything inside .inspect-modal.
        function ownInvEqGrid() {
            const candidates = document.querySelectorAll('.inv-eq-grid');
            for (const el of candidates) {
                if (!el.closest('.inspect-modal')) return el;
            }
            return null;
        }
        const selfWeapon = readWeaponFromGrid(
            document.querySelector('.cv-mmo') ||
            document.querySelector('.eq-grid') ||
            ownInvEqGrid()
        );
        if (selfWeapon?.wt) {
            state.party[state.selfName].weaponType = selfWeapon.wt;
            state.party[state.selfName].weaponImg  = selfWeapon.src;
        }

        // Persist immediately so a page reload doesn't wipe it
        saveSession();
    }

    // Scrape party member stats from the currently visible .inspect-stats panel.
    // expectedName should be passed so we don't have to guess which player it is.
    function scrapeInspectPanel(expectedName) {
        const panel = document.querySelector('.inspect-stats');
        if (!panel) return null;

        const name = expectedName || state.selfName;
        if (!name) return null;

        // Defense-in-depth: verify the modal is actually showing the player
        // we expect before trusting its contents. If the modal's displayed
        // username doesn't match, it's stale (e.g. didn't update from a
        // previous inspect) — bail out rather than writing wrong data.
        const modal = document.querySelector('.inspect-modal');
        const displayedName = modal?.querySelector('.inspect-username')?.textContent.trim();
        if (displayedName && displayedName !== name) {
            _warn('[inspect] modal shows "'+displayedName+'" but expected "'+name+'" — skipping stale read');
            return null;
        }

        if (!state.party[name]) state.party[name] = { name };

        const stats = {};
        panel.querySelectorAll('.char-stat-row').forEach(r => {
            const lbl = r.querySelector('.char-stat-label')?.textContent.trim();
            const val = r.querySelector('.char-stat-value')?.textContent.trim();
            if (lbl && val) stats[lbl] = val;
        });
        state.party[name].stats     = stats;
        state.party[name].statsTime = Date.now();

        // Read weapon type from the inspect modal's equipped grid
        const inspectWeapon = readWeaponFromGrid(modal);
        if (inspectWeapon?.wt) {
            state.party[name].weaponType = inspectWeapon.wt;
            state.party[name].weaponImg  = inspectWeapon.src;
        }

        saveSession();
        return name;
    }

    // Scrape leaderboard — reads all visible .lb-row entries into a name→rank map
    // and stores in state.lbRanks. Call whenever the leaderboard is open.

    function scrapeLeaderboard() {
        const rows = document.querySelectorAll('.lb-table .lb-row');
        if (!rows.length) return;
        const cat = document.querySelector('.lb-cat-btn.active')?.textContent.trim() || '';
        if (!cat) return;
        if (!state.lbRanks) state.lbRanks = {};

        rows.forEach(row => {
            const nameEl = row.querySelector('.lb-name');
            if (!nameEl) return;
            const name = [...nameEl.childNodes]
                .filter(n => n.nodeType === 3)
                .map(n => n.textContent.trim())
                .join('').trim();
            if (!name) return;

            // Rank: numeric rows have a plain text node in .lb-rank
            // Medal rows (top 3) have a span child — use the row class instead
            let rank = 0;
            const rankEl = row.querySelector('.lb-rank');
            if (rankEl) {
                const textNode = [...rankEl.childNodes].find(n => n.nodeType === 3);
                if (textNode) {
                    rank = parseInt(textNode.textContent.trim()) || 0;
                }
            }
            // Fallback for medal rows
            if (!rank) {
                if (row.classList.contains('lb-top-1')) rank = 1;
                else if (row.classList.contains('lb-top-2')) rank = 2;
                else if (row.classList.contains('lb-top-3')) rank = 3;
            }

            if (name && rank) {
                if (!state.lbRanks[name]) state.lbRanks[name] = {};
                state.lbRanks[name][cat] = rank;
            }
        });
        _log('Leaderboard scraped:', cat, Object.keys(state.lbRanks).length, 'players,', rows.length, 'rows');

        // Persist to session storage so ranks survive refresh
        try { localStorage.setItem(STORAGE_KEY+'_lb', JSON.stringify(state.lbRanks)); } catch(e) {}
    }

    // Helper: click a sidebar nav item by its title attribute
    function navTo(title) {
        const btn = document.querySelector(`.sb-item[title="${title}"]`);
        if (btn) btn.click();
        return !!btn;
    }

    // Wait for a DOM selector to appear, then call cb. Polls every interval ms, gives up after maxMs.
    function waitFor(selector, cb, maxMs=3000, interval=150) {
        const start = Date.now();
        const id = setInterval(() => {
            const el = document.querySelector(selector);
            if (el || Date.now()-start > maxMs) {
                clearInterval(id);
                cb(el || null);
            }
        }, interval);
    }

    // Full refresh sequence:
    //   1. Navigate to Party tab
    //   2. Read party panel, click each Inspect in sequence
    //   3. Navigate to Character tab
    //   4. Scrape .cv-stats-grid for self stats
    //   5. Navigate back to Combat tab
    //   6. Call onDone()
    let inspectBusy = false;
    // Read mab-bar data via React fiber — no popups needed
    function scrapeMabBar(onDone) {
        const mabBar = document.querySelector('.mab-bar');
        if (!mabBar) { if (onDone) onDone(); return; }

        if (!window._shawzMabCache) window._shawzMabCache = { skills:{}, imbues:[], auraMpPer5s:0 };
        window._shawzMabCache.skills = {};
        window._shawzMabCache.imbues = [];
        window._shawzMabCache.auraMpPer5s = 0;

        function fiberWalk(el, maxDepth) {
            const fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            if (!fk) return null;
            let node = el[fk];
            let depth = 0;
            while (node && depth < maxDepth) {
                const p = node.memoizedProps || node.pendingProps || {};
                if (Object.keys(p).length > 1) return p; // found meaningful props
                node = node.return;
                depth++;
            }
            return null;
        }

        function deepFiberSearch(el, maxDepth) {
            const fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            if (!fk) return [];
            const results = [];
            let node = el[fk];
            let depth = 0;
            while (node && depth < maxDepth) {
                const p = node.memoizedProps || node.pendingProps;
                if (p && typeof p === 'object') results.push(p);
                node = node.return;
                depth++;
            }
            return results;
        }

        // ── Abilities ─────────────────────────────────────────────────────────
        mabBar.querySelectorAll('.mab-group .mab-slot-active').forEach(btn => {
            const label = btn.getAttribute('aria-label') || '';
            if (!label || label.startsWith('Imbue') || label.startsWith('Aura') ||
                label.startsWith('hp') || label.startsWith('mp') || label.startsWith('Scroll') ||
                label.startsWith('Elixir')) return;

            const propsList = deepFiberSearch(btn, 30);
            for (const p of propsList) {
                // Look for ability data in props
                const ability = p.ability || p.slot?.ability || p.data || p.item;
                if (ability && (ability.manaCost !== undefined || ability.cooldown !== undefined)) {
                    const cost = parseFloat(ability.manaCost ?? ability.mana ?? ability.cost ?? 0);
                    const cd   = parseFloat(ability.cooldown ?? ability.cd ?? ability.cooldownTime ?? 0);
                    const active = ability.active !== false && ability.enabled !== false && ability.on !== false;
                    if (cost > 0 && cd > 0 && active) {
                        const name = ability.name || ability.id || label;
                        window._shawzMabCache.skills[name] = { cost, cd };
                        _log('[mab fiber] skill:', name, cost, 'mana /', cd, 's');
                    }
                    break;
                }
                // Some games store cost/cd directly on props
                if (p.manaCost !== undefined && p.cooldown !== undefined) {
                    const cost = parseFloat(p.manaCost ?? 0);
                    const cd   = parseFloat(p.cooldown ?? 0);
                    if (cost > 0 && cd > 0) {
                        window._shawzMabCache.skills[label] = { cost, cd };
                        _log('[mab fiber] skill (direct):', label, cost, 'mana /', cd, 's');
                    }
                    break;
                }
            }
        });

        // ── Imbues ────────────────────────────────────────────────────────────
        mabBar.querySelectorAll('.mab-group .mab-slot').forEach(btn => {
            const label = btn.getAttribute('aria-label') || '';
            if (!label.startsWith('Imbue')) return;

            const propsList = deepFiberSearch(btn, 30);
            for (const p of propsList) {
                // Imbue slot should have a list of imbues with on/off state
                const imbues = p.imbues || p.imbueList || p.slots || p.options;
                if (Array.isArray(imbues) && imbues.length) {
                    imbues.forEach(im => {
                        const name = im.name || im.id || im.label || '';
                        const on   = im.active !== false && im.enabled !== false && im.on !== false;
                        if (name && on && !window._shawzMabCache.imbues.includes(name)) {
                            window._shawzMabCache.imbues.push(name);
                        }
                    });
                    break;
                }
                // Might be a single imbue object
                if (p.imbueName || p.imbue?.name) {
                    const name = p.imbueName || p.imbue.name;
                    const on   = p.imbueActive !== false && p.imbue?.active !== false;
                    if (name && on && !window._shawzMabCache.imbues.includes(name)) {
                        window._shawzMabCache.imbues.push(name);
                    }
                    break;
                }
            }
        });

        // ── Aura ──────────────────────────────────────────────────────────────
        const auraBtn = mabBar.querySelector('.mab-slot[aria-label^="Aura"]');
        if (auraBtn) {
            const propsList = deepFiberSearch(auraBtn, 30);
            for (const p of propsList) {
                const aura = p.aura || p.activeAura || p.selectedAura || p.slot?.aura;
                if (aura) {
                    // Look for MP drain — could be pct or flat
                    const mpPct  = aura.mpCostPct ?? aura.manaCostPct ?? aura.mpPercentPerTick ?? null;
                    const mpFlat = aura.mpCost    ?? aura.manaCost    ?? aura.mpPerTick        ?? null;
                    if (mpPct  != null) { window._shawzMabCache.auraMpPer5s = { pct:  parseFloat(mpPct)  }; _log('[mab fiber] aura pct:', mpPct); break; }
                    if (mpFlat != null) { window._shawzMabCache.auraMpPer5s = { flat: parseFloat(mpFlat) }; _log('[mab fiber] aura flat:', mpFlat); break; }
                }
            }
        }

        _log('[mab fiber] cache:', JSON.stringify(window._shawzMabCache));

        // If fiber gave us no skills (prop names differ), fall back to popover clicks
        const hasSkills = Object.keys(window._shawzMabCache.skills).length > 0;
        if (!hasSkills) {
            _warn('[mab fiber] no skills found via fiber — falling back to popover click scrape');
            scrapeMabBarPopover(onDone);
        } else {
            if (onDone) onDone();
        }
    }

    // Fallback: original popover-click approach if fiber yields nothing
    function scrapeMabBarPopover(onDone) {
        const mabBar = document.querySelector('.mab-bar');
        if (!mabBar) { if (onDone) onDone(); return; }

        // Inject a style to hide popovers during scrape — they open/close invisibly
        const hideStyle = document.createElement('style');
        hideStyle.id = 'shawz-mab-hide';
        hideStyle.textContent = '.mab-popover { opacity: 0 !important; pointer-events: none !important; }';
        document.head.appendChild(hideStyle);

        const slots = [...mabBar.querySelectorAll('.mab-slot.mab-slot-active, .mab-slot[aria-label^="Aura"], .mab-slot[aria-label^="Imbue"]')]
            .filter(btn => !btn.querySelector('.mab-slot-plus'));

        if (!slots.length) {
            hideStyle.remove();
            if (onDone) onDone();
            return;
        }

        let si = 0;
        function nextSlot() {
            const existing = document.querySelector('.mab-popover');
            if (existing) {
                const closeBtn = existing.querySelector('.mab-popover-close:not(.mab-popover-danger)');
                if (closeBtn) closeBtn.click();
            }
            if (si >= slots.length) {
                setTimeout(() => {
                    hideStyle.remove();
                    if (onDone) onDone();
                }, 200);
                return;
            }
            const slot = slots[si++];
            slot.click();
            waitFor('.mab-popover', (popover) => {
                if (!popover) { nextSlot(); return; }
                setTimeout(() => {
                    const closeBtn = popover.querySelector('.mab-popover-close:not(.mab-popover-danger)');
                    if (closeBtn) closeBtn.click();
                    setTimeout(nextSlot, 100);
                }, 150);
            }, 1000);
        }
        nextSlot();
    }

    function refreshPartyStats(onDone) {
        if (inspectBusy) return;
        inspectBusy = true;

        const currentTab = document.querySelector('.sb-item.active')?.getAttribute('title') || 'Combat';

        // Hide inspect modals and party panel visually during scrape
        const scrapeStyle = document.createElement('style');
        scrapeStyle.id = 'shawz-scrape-hide';
        scrapeStyle.textContent = `
            .inspect-modal { opacity: 0 !important; pointer-events: none !important; }
            .sp-panel { opacity: 0 !important; }
        `;
        document.head.appendChild(scrapeStyle);

        navTo('Party');
        waitFor('.sp-member-row', () => {
            readPartyPanel();
            detectSelf();

            const queue = [...document.querySelectorAll('.sp-member-row')]
                .map(row => {
                    const btn    = row.querySelector('.sp-btn-inspect');
                    const nameEl = row.querySelector('.sp-member-name');
                    const name   = [...(nameEl?.childNodes||[])]
                        .find(n=>n.nodeType===3)?.textContent.trim();
                    return btn && name ? { name, btn } : null;
                })
                .filter(Boolean);

            // IMPORTANT: stay on the Party panel for the entire inspect loop.
            // .sp-btn-inspect lives inside .sp-panel — navigating away (even
            // though the inspect modal renders as an overlay) risks the Party
            // panel unmounting and detaching these button references from the
            // live DOM. A detached button's click() can silently no-op,
            // leaving whatever inspect modal was already open (e.g. the
            // previous player, or none) on screen — which then gets
            // misattributed to the next name in the queue. We only navigate
            // back to the original tab once every inspect has completed.

            let i = 0;
            function closeInspectPanel() {
                const closeBtn = document.querySelector(
                    '.inspect-close, .inspect-back, [class*="inspect-panel"] button[class*="close"], ' +
                    '[class*="inspect-panel"] button[class*="back"], .char-panel-close, ' +
                    '.sp-inspect-close, [title*="Close inspect" i], [title*="Back" i]'
                );
                if (closeBtn) { closeBtn.click(); return; }
                const lastBtn = queue[queue.length - 1]?.btn;
                if (lastBtn && document.querySelector('.inspect-stats')) { lastBtn.click(); return; }
                document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
            }

            function nextInspect() {
                if (i >= queue.length) {
                    closeInspectPanel();
                    setTimeout(() => {
                        // Now safe to leave Party — all inspects are done
                        navTo(currentTab === 'Party' ? 'Combat' : currentTab);
                        // Step 3: Character stats — briefly visit Character tab
                        navTo('Character');
                        waitFor('.cv-stats-grid, .char-stat-row, .char-panel-label, .cv-mmo-stats', (grid) => {
                            if (grid) scrapeSelfStats();
                            // Return to combat immediately
                            navTo(currentTab === 'Character' ? 'Combat' : currentTab);
                            // Step 4: mab-bar scrape (experimental UI only, invisible)
                            setTimeout(() => {
                                if (document.querySelector('.mab-bar')) {
                                    _log('Experimental UI detected — scraping mab-bar');
                                    scrapeMabBar(() => {
                                        scrapeSelfStats();
                                        scrapeStyle.remove();
                                        inspectBusy = false;
                                        if (onDone) onDone();
                                    });
                                } else {
                                    scrapeStyle.remove();
                                    inspectBusy = false;
                                    if (onDone) onDone();
                                }
                            }, 200);
                        }, 1500);
                    }, 150);
                    return;
                }

                const { name, btn } = queue[i++];
                btn.click();
                setTimeout(() => {
                    const result = scrapeInspectPanel(name);
                    if (result === null) {
                        // Modal may not have updated yet — give it one more chance
                        setTimeout(() => {
                            scrapeInspectPanel(name);
                            setTimeout(nextInspect, 100);
                        }, 300);
                    } else {
                        setTimeout(nextInspect, 100);
                    }
                }, 400);
            }

            nextInspect();
        }, 3000);
    }

    function refreshLeaderboard(onDone) {
        if (inspectBusy) return;
        inspectBusy = true;

        const currentTab = document.querySelector('.sb-item.active')?.getAttribute('title') || 'Combat';

        navTo('Leaderboard') || navTo('Rankings') || navTo('Ranks') || navTo('Ladder');
        waitFor('.lb-table', () => {
            scrapeLeaderboard(); // Player Level (default)

            const WEAPON_CATS = ['Sword Level','Bow Level','Spear Level','Staff Level','Harp Level','Fan Level'];
            let wi = 0;
            function nextCat() {
                if (wi >= WEAPON_CATS.length) {
                    setTimeout(() => {
                        navTo(currentTab === 'Leaderboard' ? 'Combat' : currentTab);
                        inspectBusy = false;
                        if (onDone) onDone();
                    }, 150);
                    return;
                }
                const catName = WEAPON_CATS[wi++];
                const combatGroup = [...document.querySelectorAll('.lb-group-btn')]
                    .find(b => b.textContent.trim() === 'Combat');
                if (combatGroup && !combatGroup.classList.contains('active')) combatGroup.click();
                setTimeout(() => {
                    const cb = [...document.querySelectorAll('.lb-cat-btn')]
                        .find(b => b.textContent.trim() === catName);
                    if (cb) cb.click();
                    setTimeout(() => { scrapeLeaderboard(); nextCat(); }, 80);
                }, 50);
            }
            // Click Combat group first
            const combatGroup = [...document.querySelectorAll('.lb-group-btn')]
                .find(b => b.textContent.trim() === 'Combat');
            if (combatGroup) { combatGroup.click(); setTimeout(nextCat, 100); }
            else nextCat();
        }, 2000);
    }

    // Keep refreshAllStats for backwards compat (runs both)
    function refreshAllStats(onDone) {
        refreshPartyStats(() => refreshLeaderboard(onDone));
    }

    // ─── DOM INFERENCE (inventory) ────────────────────────────────────────────
    function inferSlot(slot) {
        if (slot.dataset.invfReady) return;
        const sec = slot.closest('.bag-category,.bag-cat,[class*="category"]');
        let catRaw = '';
        if (sec) {
            const lbl = sec.querySelector('.bag-cat-label,[class*="cat-label"]');
            catRaw = lbl ? lbl.textContent.trim().toLowerCase() : '';
            if (!catRaw) {
                const hdr = sec.querySelector('button,[class*="cat-header"]');
                if (hdr) catRaw = [...hdr.childNodes]
                    .filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('').toLowerCase();
            }
        }
        slot.dataset.invfCat = CAT_MAP[catRaw] || 'other';

        const img = slot.querySelector('img.item-img,.is-icon img,img[alt]');
        const rawType = img ? (img.getAttribute('alt')||'').trim() : '';
        slot.dataset.invfType   = rawType.toLowerCase();
        slot.dataset.invfSlotId = mapTypeToSlotId(rawType);

        if (rawType && !slot.dataset.invfSlotId && !NON_EQUIP.has(slot.dataset.invfCat))
            console.warn('[SHaWZ] unmapped type:', rawType, '| cat:', slot.dataset.invfCat);

        let tier = 0;
        slot.querySelectorAll('span,div').forEach(el => {
            if (/^T\d$/.test(el.textContent.trim())) tier = parseInt(el.textContent.trim()[1])||0;
        });
        slot.dataset.invfTier = tier;

        let enh = 0;
        slot.querySelectorAll('span').forEach(el => {
            const t = el.textContent.trim();
            if (/^\+\d+$/.test(t) && el.style.visibility !== 'hidden')
                enh = parseInt(t.slice(1))||0;
        });
        slot.dataset.invfEnh = enh;

        slot.dataset.invfLocked = (slot.textContent.includes('🔒')||
            !!slot.querySelector('[class*="lock"]')) ? '1' : '0';

        // Heavy armor — game marks with .inv-item-heavy badge
        slot.dataset.invfHeavy = !!slot.querySelector('.inv-item-heavy,[class*="item-heavy"]') ? '1' : '0';

        const bc = slot.style.borderColor || '';
        const cm = bc.match(/(\d+),\s*(\d+),\s*(\d+)/);
        let rarityRank=-1, rarityName='Unknown';
        if (cm) {
            const r = RARITY_BY_COLOR[`${cm[1]},${cm[2]},${cm[3]}`];
            if (r) { rarityRank=r.rank; rarityName=r.name; }
        }
        slot.dataset.invfRarityRank = rarityRank;
        slot.dataset.invfRarityName = rarityName;
        slot.dataset.invfReady = '1';
    }

    function itemKey(el) {
        // Generate a stable key from visible attributes — survives React re-renders
        // Include grid position so two identical items in same slot are distinct
        const parent = el.parentElement;
        const idx = parent ? [...parent.children].indexOf(el) : 0;
        return [
            el.dataset.invfSlotId  || '',
            el.dataset.invfTier    || '0',
            el.dataset.invfRarityRank || '0',
            el.dataset.invfEnh     || '0',
            idx,
        ].join(':');
    }

    function getTipData(slot) {
        const k = itemKey(slot);
        return state.tipCache[k] || { subtierLv:0, bonusStats:[], qualities:[], forge:'' };
    }

    function hasTipData(slot) {
        return !!state.tipCache[itemKey(slot)];
    }

    function setTipData(slot, data) {
        state.tipCache[itemKey(slot)] = data;
    }

    // Maps tooltip display labels → our ALL_STATS keys
    // Based on observed tooltip format: "DEF +16 (63%) (10)"
    const TIP_STAT_MAP = {
        // Confirmed game labels from .tt-stat-label (stored lowercase)
        'atk':                'atk',
        'def':                'def',
        'hp':                 'hp',
        'mana':               'mana',
        // Crit chance — sort panel "Crit %", tooltip "CRIT%"
        'crit %':             'critChance',
        'crit%':              'critChance',
        'crit chance':        'critChance',
        'crit rate':          'critChance',
        'crit':               'critChance',
        // Crit damage — sort panel "Crit DMG"
        'crit dmg':           'critDamage',
        'crit dmg%':          'critDamage',
        'crit damage':        'critDamage',
        'critdmg':            'critDamage',
        // Attack speed — sort panel "Atk Spd", tooltip "ATK SPEED"
        'atk speed':          'atkSpeed',
        'atk spd':            'atkSpeed',
        'attack speed':       'atkSpeed',
        // Healing — sort panel "Heal"
        'heal power':         'healingPower',
        'healing power':      'healingPower',
        'heal':               'healingPower',
        // CDR
        'cooldown reduction': 'cooldownReduction',
        'cd reduction':       'cooldownReduction',
        'cooldown':           'cooldownReduction',
        'cdr':                'cooldownReduction',
        // Drop rate — sort panel "Drop"
        'drop rate':          'dropRate',
        'drop':               'dropRate',
        // All stats
        'all stats':          'allStats',
        'all stat':           'allStats',
        // Mana regen — sort panel "M. Regen", tooltip "MP/t"
        'm. regen':           'manaRegen',
        'mp/t':               'manaRegen',
        'mana regen':         'manaRegen',
        'mana regeneration':  'manaRegen',
        'mp regen':           'manaRegen',
        // Execute — confirmed label: "EXECUTE"
        'execute':            'execute',
        // Gold find — confirmed tooltip label: "GOLD FIND"
        'gold find':          'goldFind',
    };

    // Sorted longest-first so partial matching prefers specific keys:
    // "atk speed" matches before "atk", "crit dmg" before "crit", etc.
    const TIP_STAT_KEYS = Object.keys(TIP_STAT_MAP).sort((a,b) => b.length - a.length);

    function parseTip(elOrText) {
        const d = { subtierLv:0, bonusStats:[], qualities:[], forge:'' };
        const el   = (elOrText instanceof HTMLElement) ? elOrText : null;
        const text = el ? (el.textContent || '') : (elOrText || '');
        if (!text) return d;

        // Sub-tier level: "Tier 3 · Lv 21" → 21
        const lv = text.match(/Lv\s*(\d+)/i);
        if (lv) d.subtierLv = parseInt(lv[1]);

        // Forge
        if (/\bSun\b/i.test(text))       d.forge = 'Sun';
        else if (/\bMoon\b/i.test(text)) d.forge = 'Moon';

        // Parse each stat line with its quality %
        // Pattern: "STAT_NAME +VALUE (QUALITY%) (raw)" — e.g. "DEF +16 (63%) (10)"
        // We extract: stat label and quality % on the same line
        const lines = text.split(/\n|(?=\+|-\d)/);

        // Regex: find "StatLabel ... (XX%)" on a line
        // Works on the full text with a global search per stat
        const statLineRe = /([A-Za-z][A-Za-z /]+?)\s*[+\-][\d.]+\s*\((\d+)%\)/g;
        let match;
        while ((match = statLineRe.exec(text)) !== null) {
            const rawLabel = match[1].trim().toLowerCase();
            const quality  = parseInt(match[2]);
            d.qualities.push(quality);

            // Exact match first, then longest-key-first partial match
            let statKey = TIP_STAT_MAP[rawLabel];
            if (!statKey) {
                for (const k of TIP_STAT_KEYS) {
                    if (rawLabel === k || rawLabel.includes(k) || k.includes(rawLabel)) {
                        statKey = TIP_STAT_MAP[k]; break;
                    }
                }
            }
            if (statKey && !d.bonusStats.includes(statKey)) {
                d.bonusStats.push(statKey);
            }
        }

        // Fallback: full-text scan using longest-first keys
        if (d.bonusStats.length === 0) {
            for (const k of TIP_STAT_KEYS) {
                if (new RegExp('\\b' + k.replace('%','\\%') + '\\b', 'i').test(text) &&
                    !d.bonusStats.includes(TIP_STAT_MAP[k])) {
                    d.bonusStats.push(TIP_STAT_MAP[k]);
                }
            }
        }

        return d;
    }

    function bustCache() {
        getEquippableBagItems().forEach(el => { delete el.dataset.invfReady; });
    }

    // ─── CONDITION EVAL ───────────────────────────────────────────────────────
    // Returns:
    //   true  — item definitively meets ALL conditions
    //   false — item definitively fails at least one condition
    //   'unknown' — item has tooltip-dependent conditions not yet cached
    //               (shown as neither Best nor Salvage until hovered)
    function evalConds(slot, conds) {
        if (!conds||!conds.length) return true;
        const tier   = parseInt(slot.dataset.invfTier)||0;
        const enh    = parseInt(slot.dataset.invfEnh)||0;
        const rar    = parseInt(slot.dataset.invfRarityRank)||0;
        const locked = slot.dataset.invfLocked==='1';
        const heavy  = slot.dataset.invfHeavy==='1';
        const itype  = slot.dataset.invfType||'';
        const tip      = getTipData(slot);
        const hasCache = hasTipData(slot);

        let needsTooltip = false;

        for (const c of conds) {
            if (!c.type) continue;
            const v = c.value;
            switch(c.type) {
                case 'tier':
                    if(tier<(parseInt(v)||0)) return false;
                    break;
                case 'subtier':
                    if (!hasCache) { needsTooltip = true; break; }
                    if(tip.subtierLv<(parseInt(v)||0)) return false;
                    break;
                case 'enh':
                    if(enh<(parseInt(v)||0)) return false;
                    break;
                case 'rarity':
                    if(rar<RARITY_NAMES.indexOf(v)) return false;
                    break;
                case 'hasStat': {
                    // Without tooltip data we can't know — defer, don't assume pass
                    if (!hasCache) { needsTooltip = true; break; }
                    const sd = ALL_STATS.find(s=>s.label===v);
                    // Item has tooltip but stat is absent — definitive fail
                    if (sd && !tip.bonusStats.includes(sd.key)) return false;
                    break;
                }
                case 'statQuality': {
                    if (!hasCache) { needsTooltip = true; break; }
                    const mq = parseInt(v)||0;
                    // Use qualityMap if available (keyed by stat) for accurate checking
                    // Fall back to qualities array
                    const qualVals = tip.qualityMap
                        ? Object.values(tip.qualityMap)
                        : tip.qualities;
                    // All bonus stats must meet the minimum quality threshold
                    if (qualVals.length > 0 && !qualVals.every(q => q >= mq)) return false;
                    break;
                }
                case 'weaponType': {
                    if (!v) break;
                    if (!itype.toLowerCase().includes(v.toLowerCase())) return false;
                    break;
                }
                case 'armorWeight': {
                    if (!v) break;
                    const wantHeavy = v === 'Heavy';
                    if (wantHeavy !== heavy) return false;
                    break;
                }
                case 'forge': {
                    const fr={'':0,'Moon':1,'Sun':2};
                    if((fr[tip.forge]||0)<(fr[v]||0)) return false;
                    break;
                }
                case 'notLocked':
                    if(locked) return false;
                    break;
            }
        }

        // If any tooltip-dependent condition couldn't be evaluated, return unknown
        if (needsTooltip) return 'unknown';
        return true;
    }

    // ─── APPLY HIGHLIGHTS ─────────────────────────────────────────────────────
    function apply() {
        const slots = getEquippableBagItems();
        if (!slots.length) return;
        slots.forEach(inferSlot);

        const showBest    = state.highlights.best;
        const showSalvage = state.highlights.salvage;

        // Debug: log slot states once so you can see what's being matched
        if (!window._invfDebugDone) {
            window._invfDebugDone = true;
            const configuredSlots = SLOTS.filter(s => state.slotConfig[s.id]?.enabled);
            console.log('[SHaWZ] Highlight debug:',
                'slots found:', slots.length,
                '| configured:', configuredSlots.map(s=>s.id),
                '| best:', showBest, '| salvage:', showSalvage
            );
            // Sample first 3 items
            [...slots].slice(0,3).forEach(el => {
                console.log('[SHaWZ] sample item:',
                    'cat:', el.dataset.invfCat,
                    'slotId:', el.dataset.invfSlotId,
                    'tier:', el.dataset.invfTier,
                    'enabled:', state.slotConfig[el.dataset.invfSlotId]?.enabled
                );
            });
        }

        slots.forEach(el => {
            const cat    = el.dataset.invfCat    || '';
            const slotId = el.dataset.invfSlotId || '';

            el.classList.remove('invf-upgrade','invf-best','invf-salvage','invf-unknown');

            if (NON_EQUIP.has(cat)) return;

            // Offhand handling — shields are only usable with Spear or Fan
            if (slotId === 'offhand') {
                const weaponConds = state.slotConfig.weapon?.conditions || [];
                const typeCond = weaponConds.find(c => c.type === 'weaponType');
                if (!typeCond || !typeCond.value) return; // no weapon type set — neutral
                if (OFFHAND_WEAPON_TYPES.has(typeCond.value)) {
                    // Spear/Fan — use normal offhand config below
                } else {
                    // Non-shield weapon type explicitly set — offhand is useless, mark salvage
                    if (showSalvage) el.classList.add('invf-salvage');
                    return;
                }
            }

            const cfg = state.slotConfig[slotId];
            if (!cfg || !cfg.enabled) return;

            const result = evalConds(el, cfg.conditions);

            if (result === 'unknown') {
                // Tooltip not yet cached — show subtle indicator so user knows to hover
                el.classList.add('invf-unknown');
            } else if (showBest && result === true) {
                el.classList.add('invf-best');
            } else if (showSalvage && result === false) {
                el.classList.add('invf-salvage');
            }
        });

        const cnt = document.getElementById('invf-count');
        if (cnt) {
            const be = document.querySelectorAll('.invf-best').length;
            const sa = document.querySelectorAll('.invf-salvage').length;
            const un = document.querySelectorAll('.invf-unknown').length;
            const parts = [];
            if (be) parts.push(be + '★');
            if (sa) parts.push(sa + '🗑');
            if (un) parts.push(un + '?');
            cnt.textContent = parts.join('  ');
        }
    }

    // ─── STYLES ───────────────────────────────────────────────────────────────
    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = `
        .invf-upgrade{outline:2px solid #1D9E75!important;outline-offset:2px;background:rgba(29,158,117,.15)!important;}
        .invf-upgrade::after{content:"UP";position:absolute;bottom:2px;left:2px;font-size:8px;font-weight:700;background:#1D9E75;color:#fff;padding:0 3px;border-radius:3px;pointer-events:none;z-index:9;}
        .invf-best{outline:2px solid #c6a85c!important;outline-offset:-2px;background:rgba(198,168,92,.15)!important;}
        .invf-best::after{content:"BEST";position:absolute;bottom:2px;left:2px;font-size:8px;font-weight:700;background:#c6a85c;color:#111;padding:0 3px;border-radius:3px;pointer-events:none;z-index:9;}
        .invf-salvage{outline:2px dashed #cc4422!important;outline-offset:-2px;}
        .invf-salvage::before{content:"SAL";position:absolute;bottom:2px;left:2px;font-size:8px;font-weight:700;background:#cc4422;color:#fff;padding:0 3px;border-radius:3px;pointer-events:none;z-index:9;}
        .invf-unknown{outline:1px dashed #555!important;outline-offset:-1px;opacity:.75;}
        .invf-unknown::before{content:"?";position:absolute;bottom:2px;left:2px;font-size:8px;font-weight:700;background:#444;color:#aaa;padding:0 3px;border-radius:3px;pointer-events:none;z-index:9;}

        #invf-panel{position:fixed;z-index:999999;background:rgba(10,10,20,.96);border:1px solid #3a3a5a;border-radius:6px;font-family:system-ui,sans-serif;font-size:12px;color:#ccc;display:flex;flex-direction:column;box-shadow:0 4px 24px rgba(0,0,0,.85);min-width:300px;min-height:200px;max-height:95vh;overflow:hidden;}
        #invf-header{display:flex;align-items:center;padding:6px 8px;background:linear-gradient(to right,#1a1a30,#252545);border-bottom:1px solid #2a2a45;cursor:move;user-select:none;gap:6px;flex-shrink:0;}
        .invf-htitle{font-size:11px;font-weight:700;color:#b0a8ff;letter-spacing:.04em;flex:1;}
        .invf-hcount{font-size:11px;color:#888;}
        .invf-hbtn{font-size:12px;padding:2px 8px;border-radius:3px;border:1px solid #444;background:#2a2a40;color:#aaa;cursor:pointer;line-height:1.4;}
        .invf-hbtn:hover{background:#3a3a55;color:#fff;}

        #invf-tabs{display:flex;border-bottom:1px solid #1e1e34;flex-shrink:0;}
        .invf-tab-btn{flex:1;font-size:10px;font-weight:700;padding:6px 4px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:#555;text-transform:uppercase;letter-spacing:.06em;transition:all .15s;}
        .invf-tab-btn:hover{color:#aaa;}
        .invf-tab-btn.active{border-bottom-color:#7F77DD;color:#c0b8ff;}

        #invf-body{
            flex:1;
            overflow-y:auto;
            overflow-x:hidden;
            padding:8px 10px;
            display:flex;
            flex-direction:column;
            gap:8px;
            /* Ensure body actually scrolls within the fixed panel height */
            min-height:0;
        }
        #invf-body::-webkit-scrollbar{width:5px;}
        #invf-body::-webkit-scrollbar-track{background:transparent;}
        #invf-body::-webkit-scrollbar-thumb{background:#2a2a45;border-radius:3px;}
        #invf-body::-webkit-scrollbar-thumb:hover{background:#4a4a65;}
        #invf-resize{position:absolute;width:14px;height:14px;right:0;bottom:0;cursor:nwse-resize;border-radius:0 0 6px 0;background:linear-gradient(135deg,transparent 50%,#555 50%);}

        /* Highlight toggles */
        .invf-hl-row{display:flex;gap:5px;}
        .invf-hl-btn{flex:1;font-size:10px;font-weight:700;padding:7px 4px;border-radius:5px;border:1px solid #252535;background:#0e0e1e;color:#555;cursor:pointer;text-align:center;text-transform:uppercase;letter-spacing:.05em;transition:all .15s;line-height:1.3;}
        .invf-hl-btn:hover{border-color:#555;color:#aaa;background:#141424;}
        .invf-hl-btn.on-up{border-color:#1D9E75;background:rgba(29,158,117,.18);color:#5DCAA5;}
        .invf-hl-btn.on-best{border-color:#c6a85c;background:rgba(198,168,92,.18);color:#efd48a;}
        .invf-hl-btn.on-sal{border-color:#cc4422;background:rgba(204,68,34,.18);color:#ee8866;}
        .invf-divider{height:1px;background:#1a1a2e;flex-shrink:0;}

        /* Slot grid */
        .invf-slot-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
        .invf-slot-btn{display:flex;align-items:flex-start;gap:7px;padding:7px 8px;border-radius:5px;border:1px solid #1e1e30;background:#0e0e1e;cursor:pointer;transition:all .12s;}
        .invf-slot-btn:hover{border-color:#3a3a5a;background:#141424;}
        .invf-slot-btn.configured{border-color:#1D9E75;}
        .invf-slot-btn.open{border-color:#7F77DD;background:#14102a;}
        .invf-slot-btn.configured.open{border-color:#7F77DD;}
        .invf-slot-btn.na{opacity:.4;cursor:default;}
        .invf-slot-btn.na:hover{border-color:#1e1e30;background:#0e0e1e;}
        .invf-slot-icon{font-size:18px;flex-shrink:0;line-height:1;}
        .invf-slot-info{display:flex;flex-direction:column;min-width:0;gap:2px;}
        .invf-slot-name{font-size:10px;font-weight:700;color:#888;white-space:nowrap;}
        .invf-slot-btn.configured .invf-slot-name{color:#5DCAA5;}
        .invf-slot-btn.open .invf-slot-name{color:#c0b8ff;}
        .invf-slot-sub{font-size:9px;color:#444;line-height:1.3;}
        .invf-slot-btn.configured .invf-slot-sub{color:#2d7a58;}

        /* Slot detail */
        .invf-detail-wrap{background:#0a0a18;border:1px solid #252535;border-radius:5px;padding:8px;display:flex;flex-direction:column;gap:6px;}
        .invf-detail-hdr{display:flex;align-items:center;gap:8px;}
        .invf-detail-title{font-size:12px;font-weight:700;color:#c0b8ff;flex:1;}
        .invf-close-detail{font-size:14px;background:none;border:none;color:#555;cursor:pointer;padding:0 3px;line-height:1;}
        .invf-close-detail:hover{color:#D85A30;}
        .invf-clear-btn{
            font-size:9px;padding:2px 7px;border-radius:3px;
            border:1px solid #3a2020;background:#1a0e0e;
            color:#885555;cursor:pointer;transition:all .1s;margin-left:auto;
        }
        .invf-clear-btn:hover{border-color:#cc4422;color:#ee8866;background:#2a1010;}
        .invf-enable-row{display:flex;align-items:center;gap:8px;font-size:11px;}
        .invf-enable-row input[type=checkbox]{cursor:pointer;accent-color:#7F77DD;width:14px;height:14px;}
        .invf-enable-lbl{color:#666;}
        .invf-enable-lbl.on{color:#5DCAA5;}
        .invf-types-note{font-size:9px;color:#888;font-style:italic;line-height:1.4;}
        .invf-cond-row{display:flex;align-items:center;gap:4px;background:#0e0e18;border:1px solid #1e1e28;border-radius:4px;padding:5px 6px;}
        .invf-cond-row select,.invf-cond-row input[type=number]{font-size:10px;padding:3px 4px;border-radius:3px;border:1px solid #252535;background:#141424;color:#bbb;}
        .invf-cond-row select:focus,.invf-cond-row input:focus{outline:none;border-color:#7F77DD;}
        .invf-cond-type{flex:1;min-width:0;}
        .invf-cond-val{width:68px;}
        .invf-cond-del{font-size:13px;background:none;border:none;color:#333;cursor:pointer;padding:0 3px;flex-shrink:0;line-height:1;}
        .invf-cond-del:hover{color:#D85A30;}
        .invf-add-cond{font-size:10px;padding:5px;border-radius:4px;border:1px dashed #252535;background:none;color:#555;cursor:pointer;width:100%;transition:all .1s;}
        .invf-add-cond:hover:not(:disabled){border-color:#7F77DD;color:#b0a8ff;}
        .invf-add-cond:disabled{opacity:.25;cursor:default;}
        .invf-cond-summary{font-size:9px;color:#3a6a50;line-height:1.6;padding:3px 0;}

        /* Weapon type / armor weight selectors */
        .invf-type-section{display:flex;flex-direction:column;gap:4px;padding:4px 0;}
        .invf-type-label{font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
        .invf-type-pills{display:flex;flex-wrap:wrap;gap:4px;}
        .invf-type-pill{
            font-size:10px;font-weight:600;padding:3px 9px;border-radius:10px;
            border:1px solid #252535;background:#0e0e1e;color:#555;cursor:pointer;transition:all .12s;
        }
        .invf-type-pill:hover{border-color:#555;color:#aaa;background:#141424;}
        .invf-type-pill.active{border-color:#7F77DD;background:rgba(127,119,221,.2);color:#c0b8ff;}
        .invf-type-pill.active[data-weight="Heavy"]{border-color:#c6a85c;background:rgba(198,168,92,.18);color:#e8c96a;}
        .invf-type-pill.active[data-weight="Light"]{border-color:#6ab4f5;background:rgba(106,180,245,.15);color:#9dd4ff;}

        /* Mana warning banner */
        .invf-mana-warn{
            background:rgba(180,60,20,.18);border:1px solid rgba(204,68,34,.5);
            border-radius:5px;padding:7px 10px;font-size:10px;color:#ee8866;line-height:1.5;
        }
        .invf-mana-warn b{color:#ff6644;}

        /* Import / scan / debug buttons */
        .invf-import-row{display:flex;flex-direction:column;gap:4px;}
        .invf-import-btn{
            width:100%;font-size:10px;padding:6px 10px;border-radius:5px;
            border:1px dashed #3a3a5a;background:#0a0a18;
            color:#8888cc;cursor:pointer;transition:all .15s;text-align:center;
            font-family:system-ui,sans-serif;
        }
        .invf-import-btn:hover:not(:disabled){border-color:#7F77DD;background:#12102a;color:#c0b8ff;}
        .invf-import-btn:disabled{opacity:.5;cursor:default;}
        .invf-hold-btn{border-color:#3a2020!important;color:#cc6655!important;user-select:none;}
        .invf-hold-btn:hover:not(:disabled){border-color:#cc4433!important;}

        /* New zone event flash */
        @keyframes invf-evt-flash {
            0%,100%{ opacity:1; }
            50%    { opacity:.3; }
        }
        .invf-evt-new { animation: invf-evt-flash .6s ease-in-out 4; }

        /* Scan progress bar */


        .qol-session-bar{display:flex;align-items:center;gap:8px;font-size:10px;color:#aaa;}
        .qol-session-time{color:#7F77DD;font-weight:700;font-size:11px;}
        .qol-reset-btn{font-size:9px;color:#aaa;background:none;border:none;cursor:pointer;margin-left:auto;padding:2px 6px;border-radius:3px;border:1px solid #252535;transition:all .1s;}
        .qol-reset-btn:hover{color:#c0b8ff;border-color:#7F77DD;}
        .qol-rates{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;}
        .qol-rate-card{border-radius:5px;padding:6px 7px;border:1px solid #1a1a28;background:#0a0a18;border-top:2px solid transparent;}
        .qol-rate-card.xp   {border-top-color:#5DCAA5;}
        .qol-rate-card.gold {border-top-color:#c6a85c;}
        .qol-rate-card.shard{border-top-color:#6ab4f5;}
        .qol-rate-card.kills{border-top-color:#ee8866;}
        .qol-rate-card.frags{border-top-color:#a78bfa;}
        .qol-rate-label{font-size:8px;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;}
        .qol-rate-val{font-size:13px;font-weight:800;line-height:1;}
        .qol-rate-card.xp    .qol-rate-val{color:#5DCAA5;}
        .qol-rate-card.gold  .qol-rate-val{color:#c6a85c;}
        .qol-rate-card.shard .qol-rate-val{color:#6ab4f5;}
        .qol-rate-card.kills .qol-rate-val{color:#ee8866;}
        .qol-rate-card.frags .qol-rate-val{color:#a78bfa;}
        .qol-party-hdr{display:flex;align-items:center;gap:8px;}
        .qol-party-title{font-size:9px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.07em;flex:1;}
        .qol-refresh-btn{font-size:9px;padding:3px 9px;border-radius:4px;border:1px solid #2a2a40;background:#13132a;color:#7F77DD;cursor:pointer;transition:all .12s;}
        .qol-refresh-btn:hover{border-color:#7F77DD;color:#c0b8ff;}
        .qol-refresh-btn:disabled{opacity:.4;cursor:default;}
        .qol-player-card{border-radius:6px;border:1px solid #1a1a2e;background:#0c0c1e;overflow:hidden;flex-shrink:0;}
        .qol-player-card.self{border-color:#3a2e08;background:#0f0d04;flex-shrink:0;}
        .qol-player-card.offline .qol-player-name{color:#888;}
        .qol-player-top{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;}
        .qol-player-card.self .qol-player-top{background:#0f0d04;}

        .qol-player-name{font-size:11px;font-weight:700;color:#c0b8ff;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .qol-player-card.self .qol-player-name{color:#e8c96a;}
        .qol-you-badge{font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;background:rgba(198,168,92,.2);color:#c6a85c;border:1px solid rgba(198,168,92,.3);margin-left:4px;vertical-align:middle;}
        .qol-offline-badge{font-size:8px;padding:1px 5px;border-radius:8px;background:rgba(80,80,100,.2);color:#777;border:1px solid rgba(80,80,100,.3);margin-left:4px;vertical-align:middle;}
        .qol-zone-inline{font-size:9px;color:#2d7a50;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;}
        .qol-zone-inline.idle{color:#668;}
        .qol-player-lv{font-size:9px;color:#aaa;background:#111120;padding:1px 5px;border-radius:6px;flex-shrink:0;}
        .qol-player-card.self .qol-player-lv{background:#1a1508;color:#7a6a30;}
        .qol-collapse-arrow{font-size:10px;color:#666;transition:transform .15s;flex-shrink:0;}
        .qol-player-card.expanded .qol-collapse-arrow{transform:rotate(180deg);}
        .qol-inspect-btn{font-size:11px;padding:2px 5px;border-radius:3px;border:1px solid #2a2a45;background:#14142a;color:#aaa;cursor:pointer;flex-shrink:0;transition:all .1s;}
        .qol-inspect-btn:hover{color:#c0b8ff;border-color:#7F77DD;}
        .qol-inspect-btn:disabled{opacity:.3;cursor:default;}
        .qol-player-stats{padding:6px 9px 8px;border-top:1px solid #111120;display:flex;flex-direction:column;gap:5px;}
        .qol-player-card.self .qol-player-stats{border-top-color:#1a1508;}
        .qol-player-card.collapsed .qol-player-stats{display:none;}
        .qol-chips{display:flex;flex-wrap:wrap;gap:3px;}
        .qol-chip{display:flex;align-items:center;gap:3px;padding:2px 6px;border-radius:10px;background:#111120;border:1px solid #1a1a2e;white-space:nowrap;}
        .qol-chip-lbl{font-size:8px;color:#aaa;text-transform:uppercase;letter-spacing:.03em;}
        .qol-chip-val{font-size:10px;font-weight:700;}
        .qol-chip.atk   .qol-chip-val{color:#ee8866;}
        .qol-chip.def   .qol-chip-val{color:#6ab4f5;}
        .qol-chip.hp    .qol-chip-val{color:#5DCAA5;}
        .qol-chip.mana  .qol-chip-val{color:#a78bfa;}
        .qol-chip.crit  .qol-chip-val{color:#f5c842;}
        .qol-chip.spd   .qol-chip-val{color:#e0a0f0;}
        .qol-chip.bonus .qol-chip-val{color:#c6a85c;}
        .qol-chip.heal  .qol-chip-val{color:#5DCAA5;}
        .qol-chip.cdr   .qol-chip-val{color:#80c8ff;}
        .qol-chip.dmgred .qol-chip-val{color:#6ab4f5;}
        .qol-mana-bar-wrap{background:#0a0a14;border:1px solid #1a1a2e;border-radius:5px;padding:6px 8px;}
        .qol-mana-bar-hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;}
        .qol-mana-bar-title{font-size:9px;color:#89c8ff;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
        .qol-mana-bar-val{font-size:10px;font-weight:700;}
        .qol-mana-track{position:relative;height:8px;background:#111120;border-radius:4px;}
        .qol-mana-fill{height:100%;border-radius:4px;background:#a78bfa;}
        .qol-mana-needle{position:absolute;top:-3px;width:2px;height:14px;background:rgba(255,255,255,.45);border-radius:1px;}
        .qol-mana-needle-lbl{position:absolute;top:13px;font-size:8px;color:#555;transform:translateX(-50%);white-space:nowrap;pointer-events:none;}
        .qol-mana-sub{display:flex;justify-content:space-between;margin-top:5px;}
        .qol-mana-sub span{font-size:9px;color:#aaa;}
        .qol-updated{font-size:8px;color:#555;text-align:right;}
        .qol-updated.fresh{color:#1D9E75;}
        /* ── Berserk tracker ── */
        @keyframes zerk-ready-glow{0%,100%{text-shadow:0 0 4px #9944ee60,0 0 10px #7722cc30}50%{text-shadow:0 0 10px #aa44ffcc,0 0 22px #9933ee66}}
        @keyframes zerk-active-pulse{0%,100%{text-shadow:0 0 6px #9944ee80,0 0 14px #7722cc40;opacity:1}50%{text-shadow:0 0 16px #cc88ffff,0 0 30px #aa44ff88;opacity:.6}}
        @keyframes zerk-card-ready{0%,100%{opacity:.85}50%{opacity:1}}
        @keyframes zerk-card-active{0%,100%{border-color:#9944ee55}50%{border-color:#aa44ffaa}}
        @keyframes void-edge-pulse{0%,100%{opacity:.3}50%{opacity:.9}}
        .qol-player-card.zerk-ready{border-color:#9944ee55!important;animation:zerk-card-ready 2.5s ease-in-out infinite;}
        .qol-player-card.zerk-active{animation:zerk-card-active 1.5s ease-in-out infinite;}
        .qol-zerk-icon{font-size:10px;line-height:1;color:#2a2a3a;flex-shrink:0;}
        .qol-zerk-icon.ready{color:#aa44ff;animation:zerk-ready-glow 2.5s ease-in-out infinite;}
        .qol-zerk-icon.active{color:#cc88ff;animation:zerk-active-pulse 1.5s ease-in-out infinite;}
        .qol-zerk-badge{font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;flex-shrink:0;}
        .qol-zerk-badge.ready{background:#9944ee18;color:#aa44ff;border:1px solid #9944ee55;}
        .qol-zerk-badge.active{background:#7722cc18;color:#cc88ff;border:1px solid #7722cc55;}
        .qol-zerk-row{display:flex;align-items:center;gap:5px;padding:4px 9px;border-top:1px solid #111120;}
        .qol-zerk-lbl{font-size:7px;text-transform:uppercase;letter-spacing:.05em;color:#666;flex-shrink:0;}
        .qol-zerk-lbl.ready{color:#aa44ff;}.qol-zerk-lbl.active{color:#cc88ff;}
        .qol-zerk-track{flex:1;height:4px;background:#111120;border-radius:2px;overflow:hidden;}
        .qol-zerk-fill{height:100%;border-radius:2px;background:#3a3a5a;}
        .qol-zerk-fill.ready{background:linear-gradient(90deg,#2d0d66,#7722cc,#aa44ff);}
        .qol-zerk-fill.active{background:linear-gradient(90deg,#0a0520,#1d0a55,#4d1aaa,#7722cc);}
        .qol-zerk-pct{font-size:8px;font-weight:700;min-width:26px;text-align:right;color:#666;}
        .qol-zerk-pct.ready{color:#aa44ff;}.qol-zerk-pct.active{color:#cc88ff;}
        .qol-updated.stale{color:#c6a85c;}
        .qol-updated.old{color:#cc4422;}
        /* Sparkline */
        .qol-sparkline{display:block;width:100%;height:18px;}
        /* Level progress */
        .qol-lvl-bar{background:#0a0a14;border:1px solid #1a1a2e;border-radius:5px;padding:6px 8px;}
        .qol-lvl-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;}
        .qol-lvl-lbl{font-size:9px;color:#aaa;font-weight:700;}
        .qol-lvl-ttl{font-size:10px;font-weight:800;color:#7F77DD;}
        .qol-lvl-track{height:5px;background:#111120;border-radius:3px;overflow:hidden;}
        .qol-lvl-fill{height:100%;border-radius:3px;background:#534AB7;}
        .qol-lvl-sub{display:flex;justify-content:space-between;margin-top:3px;font-size:9px;color:#555;}
        /* Compare tab */
        .cmp-input{font-size:11px;padding:5px 8px;border-radius:4px;border:1px solid #252535;background:#0e0e1e;color:#ccc;width:100%;outline:none;transition:border-color .1s;}
        .cmp-input:focus{border-color:#7F77DD;}
        .cmp-input.you{color:#e8c96a;border-color:#3a2e08;}
        .cmp-header{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;}
        .cmp-col-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:center;padding:3px;border-radius:3px;}
        .cmp-col-lbl.a{color:#ee8866;background:rgba(238,136,102,.12);}
        .cmp-col-lbl.b{color:#6ab4f5;background:rgba(106,180,245,.12);}
        .cmp-bar-row{padding:4px 0;border-bottom:1px solid #111120;}
        .cmp-bar-row:last-of-type{border-bottom:none;}
        .cmp-bar-lbl{display:flex;justify-content:space-between;font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;}
        .cmp-bar-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px;}
        .cmp-track{height:5px;background:#111120;border-radius:3px;overflow:hidden;}
        .cmp-fill{height:100%;border-radius:3px;transition:width .4s;}
        .cmp-fill.a{background:#ee8866;}
        .cmp-fill.b{background:#6ab4f5;}
        .qol-no-stats-msg{padding:8px;text-align:center;font-size:10px;color:#888;font-style:italic;}
        .qol-no-stats-msg b{color:#bbb;font-style:normal;}
        `;
        document.head.appendChild(s);
    }

    // ─── BUILD PANEL ──────────────────────────────────────────────────────────
    function createReopenBtn(x, y, onClick) {
        document.getElementById('invf-reopen')?.remove();
        const btn = document.createElement('button');
        btn.id = 'invf-reopen';
        btn.textContent = '✦';
        btn.title = 'Open SHaWZ QoL';
        btn.style.cssText = [
            'position:fixed',
            `top:${y}px`, `left:${x}px`,
            'z-index:999999',
            'width:32px', 'height:32px',
            'border-radius:50%',
            'background:rgba(10,10,28,.95)',
            'border:1.5px solid #7F77DD',
            'color:#7F77DD',
            'font-size:14px',
            'cursor:pointer',
            'display:flex', 'align-items:center', 'justify-content:center',
            'box-shadow:0 0 10px rgba(127,119,221,.6), 0 0 20px rgba(127,119,221,.25)',
            'transition:box-shadow .2s, color .15s, border-color .15s',
            'user-select:none',
        ].join(';');

        // Pulse glow animation via keyframes
        if (!document.getElementById('invf-reopen-style')) {
            const s = document.createElement('style');
            s.id = 'invf-reopen-style';
            s.textContent = `
                @keyframes invf-pulse {
                    0%,100% { box-shadow: 0 0 8px rgba(127,119,221,.5), 0 0 18px rgba(127,119,221,.2); }
                    50%      { box-shadow: 0 0 14px rgba(127,119,221,.9), 0 0 30px rgba(127,119,221,.4); }
                }
                #invf-reopen { animation: invf-pulse 2.5s ease-in-out infinite; }
                #invf-reopen:hover { animation: none !important;
                    box-shadow: 0 0 18px rgba(192,184,255,.9), 0 0 36px rgba(127,119,221,.5) !important;
                    color: #c0b8ff !important; border-color: #c0b8ff !important; }
            `;
            document.head.appendChild(s);
        }

        // Draggable
        let dragging = false, hasDragged = false, ox = 0, oy = 0, bx = x, by = y;
        btn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragging = true;
            hasDragged = false;
            ox = e.clientX - bx;
            oy = e.clientY - by;
            e.preventDefault();
        });
        const onMove = e => {
            if (!dragging) return;
            const nx = e.clientX - ox;
            const ny = e.clientY - oy;
            if (Math.abs(nx - bx) > 4 || Math.abs(ny - by) > 4) hasDragged = true;
            bx = Math.min(window.innerWidth - 32, Math.max(0, nx));
            by = Math.min(window.innerHeight - 32, Math.max(0, ny));
            btn.style.left = bx + 'px';
            btn.style.top  = by + 'px';
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            // Don't update panel layout position — reopen btn has its own position
            // Panel will open at its original position when clicked
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);

        btn.addEventListener('click', () => {
            if (!hasDragged) onClick(btn, bx, by);
            hasDragged = false;
        });
        document.body.appendChild(btn);
        return btn;
    }

    function buildPanel() {
        if (document.getElementById('invf-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'invf-panel';
        panel.style.top   = state.layout.y + 'px';
        panel.style.left  = state.layout.x + 'px';
        panel.style.width = state.layout.width + 'px';
        panel.style.height = state.layout.height + 'px';

        // If panel was closed before page reload, hide it and show reopen button
        if (state.layout.panelHidden) {
            panel.style.display = 'none';
            setTimeout(() => {
                createReopenBtn(state.layout.x, state.layout.y, (btn, bx, by) => {
                    panel.style.left = bx + 'px';
                    panel.style.top  = by + 'px';
                    state.layout.x = bx;
                    state.layout.y = by;
                    panel.style.display = 'flex';
                    state.layout.panelHidden = false;
                    save();
                    document.getElementById('invf-reopen')?.remove();
                    document.getElementById('invf-reopen-style')?.remove();
                });
            }, 100);
        }

        // Header
        const header = document.createElement('div');
        header.id = 'invf-header';
        const htitle = mkEl('span','invf-htitle','✦ SHaWZ QoL');
        const hcount = mkEl('span','invf-hcount',''); hcount.id='invf-count';
        const closeBtn = mkEl('button','invf-hbtn','×');
        closeBtn.title = 'Minimise';
        header.append(htitle, hcount, closeBtn);

        // Tab bar
        const tabBar = document.createElement('div');
        tabBar.id = 'invf-tabs';
        [['home','🏠 Home'],['filter','🔍 Gear Finder'],['team','👥 Team'],['settings','⚙']].forEach(([id,lbl]) => {
            const tb = mkEl('button','invf-tab-btn'+(state.activeTab===id?' active':''),lbl);
            tb.addEventListener('click',()=>{
                state.activeTab = id;
                tabBar.querySelectorAll('.invf-tab-btn').forEach(b=>
                    b.classList.toggle('active', b.textContent===lbl));
                renderBody(body);
                save();
            });
            tabBar.appendChild(tb);
        });

        // Body
        const body = document.createElement('div');
        body.id = 'invf-body';
        body.style.display = 'flex';

        // Resize
        const resize = document.createElement('div');
        resize.id = 'invf-resize';
        resize.style.display = 'block';

        panel.append(header, tabBar, body, resize);
        document.body.appendChild(panel);


        closeBtn.addEventListener('click',()=>{
            panel.style.display = 'none';
            state.layout.panelHidden = true;
            save();
            createReopenBtn(state.layout.x, state.layout.y, (btn, bx, by) => {
                panel.style.left = bx + 'px';
                panel.style.top  = by + 'px';
                state.layout.x = bx;
                state.layout.y = by;
                panel.style.display = 'flex';
                state.layout.panelHidden = false;
                save();
                document.getElementById('invf-reopen')?.remove();
                document.getElementById('invf-reopen-style')?.remove();
            });
        });

        makeDraggable(panel, header);
        makeResizable(panel, resize);
        renderBody(body);
    }

    // ─── RENDER BODY ──────────────────────────────────────────────────────────
    function renderBody(body) {
        body.innerHTML = '';
        if (state.activeTab === 'home')        renderHomeTab(body);
        else if (state.activeTab === 'filter') renderFilterTab(body);
        else if (state.activeTab === 'settings') renderSettingsTab(body);
        else renderTeamTab(body);
    }

    // ─── IMPORT EQUIPPED GEAR ─────────────────────────────────────────────────
    // Parse a static .item-tooltip click window.
    // Used by both importEquippedGear and scanBagTooltips.
    function parseStaticTooltip(tip) {
        const d = { subtierLv:0, bonusStats:[], qualities:[], weaponType:'', armorWeight:'' };
        if (!tip) return d;

        // Resolve to the bag item tooltip only — never the equipped comparison panel.
        // The DOM structure when hovering a bag item with an equipped item is:
        //   .item-tooltip-wrap.has-compare
        //     .item-tooltip.item-tooltip-equipped  ← IGNORE (equipped item)
        //     .item-tooltip                        ← USE (bag item)
        // We may receive the wrap, the bag tooltip, or mistakenly the equipped one.
        let itemTip;
        if (tip.classList.contains('item-tooltip-equipped')) {
            // Received the wrong one — try to find bag tooltip sibling
            itemTip = tip.parentElement?.querySelector('.item-tooltip:not(.item-tooltip-equipped)');
            if (!itemTip) return d; // can't safely parse
        } else if (tip.classList.contains('item-tooltip-wrap') || tip.classList.contains('has-compare')) {
            itemTip = tip.querySelector('.item-tooltip:not(.item-tooltip-equipped)') || tip;
        } else {
            itemTip = tip; // already the bag item tooltip
        }

        const tierLine = itemTip.querySelector('.inv-tooltip-tier-line');
        if (tierLine) {
            const lv = tierLine.textContent.match(/Lv\s*(\d+)/i);
            if (lv) d.subtierLv = parseInt(lv[1]);
        }

        const sub = itemTip.querySelector('.tt-sub');
        if (sub) {
            const subText = sub.textContent.toUpperCase();
            ['Sword','Bow','Spear','Staff','Harp','Fan'].forEach(wt => {
                if (subText.includes('· '+wt.toUpperCase()) ||
                    subText.includes(wt.toUpperCase()+' ·') ||
                    subText.startsWith(wt.toUpperCase()))
                    d.weaponType = wt;
            });
            if (subText.includes('· HEAVY') || subText.includes('HEAVY ·')) {
                d.armorWeight = 'Heavy';
            } else if (subText.includes('· LIGHT') || subText.includes('LIGHT ·')) {
                d.armorWeight = 'Light';
            }
        }

        // Only read from the item's own .tt-stats.dst-stats block.
        // .tt-lost-block, .tt-equipped-compare, .tt-equipped-stats are siblings/children
        // that contain stats from the CURRENTLY EQUIPPED item — must be excluded.
        const statsBlock = itemTip.querySelector('.tt-stats.dst-stats');
        if (!statsBlock) return d;

        statsBlock.querySelectorAll(':scope > .dst-stat-row').forEach(row => {
            const labelEl   = row.querySelector('.tt-stat-label');
            const qualityEl = row.querySelector('.tt-stat-quality');
            if (!labelEl || !qualityEl) return; // quality required — excludes comparison/lost rows
            const rawLabel = labelEl.textContent.trim().toLowerCase();
            const quality  = parseInt(qualityEl.textContent.replace(/[^\d]/g,'')) || 0;

            let statKey = TIP_STAT_MAP[rawLabel];
            if (!statKey) {
                for (const k of TIP_STAT_KEYS) {
                    if (rawLabel === k || rawLabel.includes(k) || k.includes(rawLabel)) {
                        statKey = TIP_STAT_MAP[k]; break;
                    }
                }
            }
            if (statKey) {
                if (!d.bonusStats.includes(statKey)) {
                    d.bonusStats.push(statKey);
                }
                // Store quality per stat key so it's always correctly paired
                if (!d.qualityMap) d.qualityMap = {};
                d.qualityMap[statKey] = quality;
                // Also push to qualities array for backwards compat
                if (quality && !d.qualities.includes(quality)) d.qualities.push(quality);
            }
        });

        return d;
    }

    // Maps .es-label text → slot id for the equipped tab's unique layout
    const LABEL_TO_SLOT = {
        'weapon':    'weapon',
        'offhand':   'offhand',
        'helmet':    'helmet',
        'shoulders': 'shoulders',
        'chest':     'chest',
        'hands':     'hands',
        'legs':      'legs',
        'boots':     'boots',
        'amulet':    'amulet',
        'ring 1':    'ring1',
        'ring 2':    'ring2',
    };

    // Parse an equipped slot element (.equip-slot-compact)
    function inferEquipSlot(el) {
        // Slot identity from label text (handles Ring 1 / Ring 2 correctly)
        const labelEl = el.querySelector('.es-label');
        const labelRaw = labelEl ? labelEl.textContent.trim().toLowerCase() : '';
        const slotId = LABEL_TO_SLOT[labelRaw] || '';

        // Type from img alt
        const img = el.querySelector('img[alt]');
        const rawType = img ? img.getAttribute('alt').trim().toLowerCase() : '';

        // Tier
        const tierEl  = el.querySelector('.inv-item-tier');
        const tierTxt = tierEl ? tierEl.textContent.trim() : '';
        const tier    = tierTxt ? parseInt(tierTxt.replace(/\D/g,''), 10) || 0 : 0;

        // Enhancement from .es-plus (visible = enhanced)
        const plusEl = el.querySelector('.es-plus');
        let enh = 0;
        if (plusEl && plusEl.style.visibility !== 'hidden') {
            const m = plusEl.textContent.match(/\d+/);
            enh = m ? parseInt(m[0], 10) : 0;
        }

        // Rarity from border-color
        const bc = el.style.borderColor || '';
        const cm = bc.match(/(\d+),\s*(\d+),\s*(\d+)/);
        let rarityRank = -1, rarityName = 'Unknown';
        if (cm) {
            const r = RARITY_BY_COLOR[`${cm[1]},${cm[2]},${cm[3]}`];
            if (r) { rarityRank = r.rank; rarityName = r.name; }
        }

        return { slotId, rawType, tier, enh, rarityRank, rarityName, filled: el.classList.contains('filled') };
    }

    // Build slot conditions from parsed tooltip data + slot metadata
    function buildConditionsFromParsed(parsed, slotId, tier, rarityRank, rarityName) {
        const conditions = [];
        if (parsed.weaponType) {
            conditions.push({ type:'weaponType', value:parsed.weaponType });
        }
        if (parsed.armorWeight) {
            conditions.push({ type:'armorWeight', value:parsed.armorWeight });
        }
        if (tier > 0) {
            conditions.push({ type:'tier', value:String(tier) });
        }
        if (rarityName && rarityName !== 'Unknown' && rarityRank >= 0) {
            conditions.push({ type:'rarity', value:rarityName });
        }
        parsed.bonusStats.forEach(statKey => {
            if (conditions.length >= 8) return;
            const statDef = ALL_STATS.find(s=>s.key===statKey);
            if (statDef) conditions.push({ type:'hasStat', value:statDef.label });
        });
        if (parsed.qualities.length > 0 && conditions.length < 8) {
            const minQ = Math.min(...parsed.qualities);
            conditions.push({ type:'statQuality', value:String(minQ) });
        }
        return conditions;
    }

    // Read item bonus stats directly from React's internal fiber tree.
    // Works without any clicks or popups — instant and invisible.
    // Returns { bonusStats, qualities, subtierLv } or null if fiber not readable.
    function readItemFromReact(el) {
        const fiberKey = Object.keys(el).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
        );
        if (!fiberKey) return null;

        let node = el[fiberKey];
        let itemData = null;
        let depth = 0;

        while (node && depth < 25 && !itemData) {
            const props = node.memoizedProps || node.pendingProps;
            if (props) {
                const candidates = [
                    props.item, props.slot?.item, props.itemData,
                    props.data, props.bagItem, props.inventoryItem, props.equip,
                ];
                for (const c of candidates) {
                    if (c && (c.stats || c.bonusStats || c.affixes || c.mods)) {
                        itemData = c; break;
                    }
                }
                if (!itemData && Array.isArray(props.stats) && props.stats.length) {
                    itemData = props;
                }
            }
            node = node.return;
            depth++;
        }

        if (!itemData) return null;

        const d = { subtierLv: 0, bonusStats: [], qualities: [], forge: '', weaponType: '', armorWeight: '' };
        const statFields = itemData.stats || itemData.bonusStats || itemData.affixes || itemData.mods || [];
        const statArr = Array.isArray(statFields) ? statFields : Object.values(statFields);

        statArr.forEach(stat => {
            const label = (stat.label || stat.name || stat.type || stat.key || '').toLowerCase().trim();
            const quality = stat.quality || stat.roll || stat.pct || 0;
            let statKey = TIP_STAT_MAP[label];
            if (!statKey) {
                for (const k of TIP_STAT_KEYS) {
                    if (label === k || label.includes(k) || k.includes(label)) {
                        statKey = TIP_STAT_MAP[k]; break;
                    }
                }
            }
            if (statKey && !d.bonusStats.includes(statKey)) {
                d.bonusStats.push(statKey);
                if (quality) d.qualities.push(Math.round(quality));
            }
        });

        if (itemData.level || itemData.subtier) d.subtierLv = itemData.level || itemData.subtier;
        if (itemData.weaponType) d.weaponType = itemData.weaponType;
        if (itemData.armorWeight) d.armorWeight = itemData.armorWeight;
        return d;
    }

    let importBusy = false;
    let importSafetyTimer = null;

    function abortImport(reason) {
        clearTimeout(importSafetyTimer);
        importSafetyTimer = null;
        importBusy = false;
        document.getElementById('invf-hide-tips')?.remove();
        const btn = document.querySelector('#invf-body .invf-import-btn');
        if (btn && btn.textContent.includes('Importing')) {
            btn.textContent = '⬇ Import equipped gear as criteria';
            btn.disabled = false;
        }
        if (reason) console.warn('[SHaWZ] Import aborted:', reason);
    }

    function importEquippedGear(onDone, onProgress) {
        if (importBusy) { abortImport('forced reset'); }
        importBusy = true;

        importSafetyTimer = setTimeout(() => {
            abortImport('30s timeout');
            if (onDone) onDone('Import timed out.');
        }, 30000);

        // Find tabs — click Equipped if not already active
        const tabs        = [...document.querySelectorAll('.inv-tab,[class*="inv-tab"]')];
        const equippedTab = tabs.find(t => /equipped/i.test(t.textContent));
        const bagTab      = tabs.find(t => /bag/i.test(t.textContent));

        if (!equippedTab) {
            abortImport('no equipped tab');
            if (onDone) onDone('Open your inventory first.');
            return;
        }

        // Click equipped tab then wait 600ms for React to render
        equippedTab.click();
        setTimeout(() => {
            const eqGrid = document.querySelector('.inv-eq-grid');
            const slots  = eqGrid
                ? [...eqGrid.querySelectorAll('.equip-slot-compact.filled')]
                : [];

            console.log('[SHaWZ] Import: grid:', !!eqGrid, 'slots:', slots.length);

            if (!slots.length) {
                abortImport('no slots');
                if (bagTab) bagTab.click();
                if (onDone) onDone('No equipped items found — open the inventory Equipped tab first.');
                return;
            }

            let imported = 0;
            let idx = 0;

            function next() {
                if (idx >= slots.length) {
                    // Done — return to bag
                    if (bagTab) bagTab.click();
                    abortImport(null);
                    window._invfDebugDone = false;
                    bustCache(); save(); apply();
                    if (onProgress) onProgress(slots.length, slots.length, 'done');
                    if (onDone) onDone(null, imported);
                    return;
                }

                const el = slots[idx++];

                // Base data from DOM
                const label      = el.querySelector('.es-label')?.textContent.trim().toLowerCase() || '';
                const slotId     = LABEL_TO_SLOT[label] || '';
                if (!slotId) { next(); return; }
                const imgAlt     = el.querySelector('img[alt]')?.getAttribute('alt')?.trim().toLowerCase() || '';
                const tier       = parseInt((el.querySelector('.inv-item-tier')?.textContent||'').replace(/\D/g,'')) || 0;
                const bc         = el.style.borderColor || '';
                const cm         = bc.match(/(\d+),\s*(\d+),\s*(\d+)/);
                let rarityRank   = -1, rarityName = 'Unknown';
                if (cm) {
                    const r = RARITY_BY_COLOR[`${cm[1]},${cm[2]},${cm[3]}`];
                    if (r) { rarityRank = r.rank; rarityName = r.name; }
                }
                const weaponType = ['sword','bow','spear','staff','harp','fan'].find(w => imgAlt === w) || '';

                if (onProgress) onProgress(idx, slots.length, slotId);

                // Try React fiber — reads bonus stats instantly without any UI interaction
                const fiber = readItemFromReact(el);
                if (fiber) {
                    console.log('[SHaWZ] Import fiber OK:', slotId, fiber.bonusStats);
                    const parsed = {
                        bonusStats:  fiber.bonusStats,
                        qualities:   fiber.qualities,
                        weaponType:  fiber.weaponType  || weaponType,
                        armorWeight: fiber.armorWeight || '',
                    };
                    state.slotConfig[slotId] = { enabled:true, conditions: buildConditionsFromParsed(parsed, slotId, tier, rarityRank, rarityName) };
                    imported++;
                    next(); // immediate — no popup
                    return;
                }

                // Fiber failed — fall back to clicking for tooltip
                console.log('[SHaWZ] Import fiber failed for', slotId, '— trying click');
                el.click();
                let attempts = 0;
                const poll = setInterval(() => {
                    attempts++;
                    const tip = document.querySelector('.item-tooltip:not(.item-tooltip-equipped)');
                    if (tip || attempts > 20) {
                        clearInterval(poll);
                        const parsed = tip
                            ? parseStaticTooltip(tip)
                            : { bonusStats:[], qualities:[], weaponType, armorWeight:'' };
                        if (!parsed.weaponType) parsed.weaponType = weaponType;
                        state.slotConfig[slotId] = { enabled:true, conditions: buildConditionsFromParsed(parsed, slotId, tier, rarityRank, rarityName) };
                        imported++;
                        console.log('[SHaWZ] Import click:', slotId, tip ? 'got tooltip' : 'no tooltip fallback');
                        if (tip) {
                            const cb = tip.querySelector('.tt-close,.btn-tt-close-mobile');
                            if (cb) cb.click();
                            // Wait for tooltip to close
                            let w = 0;
                            const waitClose = setInterval(() => {
                                if (!document.querySelector('.item-tooltip:not(.item-tooltip-equipped)') || ++w > 20) {
                                    clearInterval(waitClose);
                                    next();
                                }
                            }, 50);
                        } else {
                            next();
                        }
                    }
                }, 80);
            }

            // Hide tooltips during click fallback so user doesn't see popups
            const hideStyle = document.createElement('style');
            hideStyle.id = 'invf-hide-tips';
            hideStyle.textContent = '.item-tooltip-wrap,.item-tooltip{opacity:0!important;}';
            document.head.appendChild(hideStyle);

            next();
        }, 600);
    }

    // Scan bag items by clicking each one to open the static .item-tooltip,
    // parse the stats, store in tipCache, then close. Only scans items
    // whose slot has hasStat or statQuality conditions.
    // onProgress(done, total) called each step for UI updates.
    let scanBusy = false;
    // Returns only .item-slot elements from equippable bag categories
    // (Weapons, Armor, Accessories) identified by .bag-cat-label text.
    // This avoids triple-counting from duplicate .bag-grid elements the game renders.
    function getEquippableBagItems() {
        const equippable = new Set(['weapons','armor','accessories']);
        const items = [];
        const seen  = new Set();
        document.querySelectorAll('.bag-category').forEach(cat => {
            const labelEl = cat.querySelector('.bag-cat-label');
            if (!labelEl) return;
            const label = labelEl.textContent.trim().toLowerCase();
            if (!equippable.has(label)) return;
            cat.querySelectorAll('.bag-grid .item-slot').forEach(el => {
                if (!seen.has(el)) { seen.add(el); items.push(el); }
            });
        });
        return items;
    }

    function scanBagTooltips(onDone, onProgress) {
        if (scanBusy) return;
        scanBusy = true;

        const needsTooltipSlots = new Set(
            SLOTS.filter(s => {
                const conds = state.slotConfig[s.id]?.conditions || [];
                return conds.some(c => c.type==='hasStat' || c.type==='statQuality' || c.type==='subtier');
            }).map(s => s.id)
        );

        if (needsTooltipSlots.size === 0) {
            scanBusy = false;
            if (onDone) onDone(0);
            return;
        }

        // Infer and collect only equippable bag items
        const allBagItems = getEquippableBagItems();
        allBagItems.forEach(inferSlot);

        const items = allBagItems.filter(el => {
            if (!el.isConnected) return false;
            const slotId = el.dataset.invfSlotId;
            return needsTooltipSlots.has(slotId) && !hasTipData(el);
        });

        const total = items.length;
        console.log('[SHaWZ] Scan: bag items found:', allBagItems.length,
            '| slots needing tips:', [...needsTooltipSlots].join(','),
            '| to scan:', total);

        if (!total) {
            scanBusy = false;
            document.getElementById('invf-scan-hide')?.remove();
            if (allBagItems.length === 0) {
                // Inventory not open — tell the user
                if (onDone) onDone(-1); // -1 = inventory not open
            } else {
                if (onDone) onDone(0); // 0 = nothing to scan (all cached)
            }
            return;
        }

        let idx = 0;
        let scanned = 0;
        if (onProgress) onProgress(0, total);

        // Hide tooltips during scan so popups don't flash visibly
        const scanHideStyle = document.createElement('style');
        scanHideStyle.id = 'invf-scan-hide';
        scanHideStyle.textContent = '.item-tooltip-wrap,.item-tooltip{opacity:0!important;}';
        document.head.appendChild(scanHideStyle);

        function nextItem() {
            if (idx >= items.length) {
                scanBusy = false;
                document.getElementById('invf-scan-hide')?.remove();
                saveTipCache();
                apply();
                if (onProgress) onProgress(total, total);
                if (onDone) onDone(scanned);
                return;
            }

            const el = items[idx++];
            if (!el.isConnected || hasTipData(el)) {
                if (onProgress) onProgress(idx, total);
                // Use setImmediate-style to avoid blocking — process in chunks
                setTimeout(nextItem, 0);
                return;
            }

            // Try React fiber first (no popup, instant)
            const fiberData = readItemFromReact(el);
            if (fiberData) {
                setTipData(el, fiberData);
                scanned++;
                if (onProgress) onProgress(idx, total);
                setTimeout(nextItem, 0);
                return;
            }

            // Fiber read failed — fall back to click method
            el.click();
            let attempts = 0;
            const wait = setInterval(() => {
                attempts++;
                // Prefer the bag item tooltip, not the equipped comparison one
                const wrap = document.querySelector('.item-tooltip-wrap');
                const tip  = wrap
                    ? wrap.querySelector('.item-tooltip:not(.item-tooltip-equipped)')
                    : document.querySelector('.item-tooltip:not(.item-tooltip-equipped)');
                if (tip || attempts > 15) {
                    clearInterval(wait);
                    if (tip) {
                        const parsed = parseStaticTooltip(tip);
                        setTipData(el, { subtierLv: parsed.subtierLv, bonusStats: parsed.bonusStats, qualities: parsed.qualities, forge: '' });
                        scanned++;
                        const cb = tip.querySelector('.tt-close,.btn-tt-close-mobile');
                        if (cb) cb.click();
                    }
                    if (onProgress) onProgress(idx, total);
                    let closeAttempts = 0;
                    const waitClose = setInterval(() => {
                        closeAttempts++;
                        if (!document.querySelector('.item-tooltip-wrap') || closeAttempts > 20) {
                            clearInterval(waitClose);
                            nextItem();
                        }
                    }, 60);
                }
            }, 40);
        }

        nextItem();
    }
    // Returns a warning object if mana regen can't sustain skills, null if fine.
    function getManaWarning() {
        const self = state.selfName ? state.party[state.selfName] : null;
        if (!self?.stats) return null;

        // Use the live measured rate, not the old static prediction model —
        // this reflects actual mythic abilities, procs, and any dynamic
        // source automatically.
        const empirical = getEmpiricalManaRate();
        if (!empirical || empirical.sampleMs < 2000) return null; // not enough data yet
        if (empirical.net >= 0) return null; // not in deficit

        // Current mana from the live sample history (most recent point),
        // falling back to the stats panel if no samples yet
        const hist = window._shawzManaHistory;
        const latest = hist && hist.length ? hist[hist.length - 1] : null;
        const currentMana = latest ? latest.val
            : parseFloat((self.stats['Mana'] || self.stats['Max Mana'] || '0').replace(/,/g,'')) || 0;

        const deficit = Math.abs(empirical.net); // MP lost per 10s, measured
        const secsToOOM = currentMana / (deficit / 10);

        return {
            deficit: deficit.toFixed(1),
            secsToOOM: Math.round(secsToOOM),
            currentMana: Math.round(currentMana),
        };
    }

    // ─── FILTER TAB ───────────────────────────────────────────────────────────
    function renderFilterTab(body) {
        // Mana warning banner — shown at top if active
        const warn = getManaWarning();
        if (warn) {
            const banner = mkEl('div','invf-mana-warn');
            banner.innerHTML =
                `⚠️ <b>Mana deficit</b> −${warn.deficit}/10s &nbsp;·&nbsp; `+
                `OOM in ~${warn.secsToOOM}s (${warn.currentMana} left) &nbsp;·&nbsp; `+
                `<span style="color:#aaa">Mana potions recommended</span>`;
            body.appendChild(banner);
        }

        // Two highlight buttons
        const hlRow = mkEl('div','invf-hl-row');
        hlRow.append(
            makeHlBtn(
                '★ Best',
                'Items that meet ALL conditions you set for their slot.\nGold border = keep / upgrade candidate.\nOnly highlights slots you have configured.',
                'on-best',
                state.highlights.best,
                () => { state.highlights.best = !state.highlights.best; save(); apply(); }
            ),
            makeHlBtn(
                '🗑 Salvage',
                'Items in a configured slot that FAIL your conditions.\nRed border = consider salvaging.\nSlots with no conditions set are never marked salvage.',
                'on-sal',
                state.highlights.salvage,
                () => { state.highlights.salvage = !state.highlights.salvage; save(); apply(); }
            )
        );
        body.appendChild(hlRow);

        // Import button
        // ── Three action buttons in a horizontal grid ──
        const btnGrid = mkEl('div','');
        btnGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;';

        // Shared hold-button factory
        function makeHoldBtn(label, holdMs, onComplete, color) {
            const btn = mkEl('button','invf-import-btn invf-hold-btn', label);
            btn.style.cssText += `;border-color:${color}33;color:${color};height:48px;white-space:normal;text-align:center;line-height:1.3;font-size:10px;`;
            let holdTimer = null, holdStart = null, holdRaf = null, fired = false;
            function cancel() {
                clearTimeout(holdTimer); cancelAnimationFrame(holdRaf);
                holdTimer = holdStart = holdRaf = null; fired = false;
                btn.style.background = ''; btn.style.color = color; btn.textContent = label;
            }
            function tick() {
                if (!holdStart) return;
                const pct = Math.min(100, ((Date.now()-holdStart)/holdMs)*100);
                btn.style.background = `linear-gradient(to right,${color}40 ${pct}%,#0a0a18 ${pct}%)`;
                if (pct < 100) holdRaf = requestAnimationFrame(tick);
            }
            function onDocUp() { if (!fired) cancel(); }
            btn.addEventListener('mousedown', () => {
                fired = false; holdStart = Date.now();
                clearTimeout(holdTimer); cancelAnimationFrame(holdRaf);
                holdRaf = requestAnimationFrame(tick);
                holdTimer = setTimeout(() => {
                    fired = true;
                    cancelAnimationFrame(holdRaf);
                    onComplete(btn, cancel);
                }, holdMs);
                // Delay so this mousedown's paired mouseup doesn't immediately trigger it
                setTimeout(() => document.addEventListener('mouseup', onDocUp, { once: true }), 50);
            });
            btn.addEventListener('touchstart', e => { e.preventDefault(); btn.dispatchEvent(new MouseEvent('mousedown')); });
            btn.addEventListener('touchend', () => { if (!fired) cancel(); });
            return btn;
        }

        // Progress helper
        function setBtnProgress(btn, pct, label, done) {
            if (!btn) return;
            const p = Math.max(0, Math.min(100, pct));
            if (done) {
                btn.style.background = ''; btn.style.color = '';
                btn.textContent = label;
            } else {
                btn.style.background = `linear-gradient(to right, rgba(127,119,221,.35) ${p}%, #0a0a18 ${p}%)`;
                btn.style.color = '#c0b8ff';
                btn.textContent = label;
            }
        }

        // ── Import button (hold 1.5s) ──
        const importBtn = makeHoldBtn('⬇ Import\nEquipped', 1500, (btn, cancel) => {
            cancel();
            btn.disabled = true;
            setBtnProgress(btn, 0, '⬇ Reading…');
            importEquippedGear(
                (err, count) => {
                    if (err) {
                        btn.disabled = false;
                        setBtnProgress(btn, 0, '⬇ Import\nEquipped', true);
                        btn.style.color = '#cc4422';
                        setTimeout(() => { btn.style.color = ''; btn.textContent = '⬇ Import\nEquipped'; }, 2500);
                    } else {
                        setBtnProgress(btn, 100, `✓ ${count} slots`, true);
                        state.highlights.best = true; save();
                        renderBody(document.getElementById('invf-body'));
                        // Phase 2 — auto scan
                        const scanB = [...document.querySelectorAll('#invf-body .invf-import-btn')]
                            .find(b => b.textContent.includes('Scan'));
                        if (scanB) setBtnProgress(scanB, 0, '🔍 Scanning…');
                        getEquippableBagItems().forEach(inferSlot);
                        scanBagTooltips(
                            (n) => {
                                const b2 = [...document.querySelectorAll('#invf-body .invf-import-btn')]
                                    .find(b => b.textContent.includes('Scan') || b.textContent.includes('✓') || b.textContent.includes('scanned'));
                                if (b2) {
                                    setBtnProgress(b2, 100, n > 0 ? `✓ ${n} scanned` : '✓ Cached', true);
                                    setTimeout(() => { b2.style.background=''; b2.style.color=''; b2.textContent='🔍 Scan\nBag'; }, 2500);
                                }
                                if (n > 0) { saveTipCache(); apply(); }
                            },
                            (done, total) => {
                                const b2 = [...document.querySelectorAll('#invf-body .invf-import-btn')]
                                    .find(b => b.textContent.includes('Scan') || b.textContent.includes('Scanning'));
                                if (b2) setBtnProgress(b2, total ? Math.round((done/total)*100) : 0, `🔍 ${done}/${total}`);
                            }
                        );
                    }
                },
                (done, total) => {
                    const pct = total ? Math.round((done/total)*100) : 0;
                    setBtnProgress(btn, pct, `⬇ ${done}/${total}`);
                }
            );
        }, '#7F77DD');
        importBtn.title = 'Hold to import equipped gear as conditions.\nOpen inventory → Equipped tab first.';

        // ── Scan button (click) ──
        const scanBtn = mkEl('button','invf-import-btn','🔍 Scan\nBag');
        scanBtn.style.cssText += ';height:48px;white-space:normal;text-align:center;line-height:1.3;font-size:10px;';
        scanBtn.title = 'Scan bag items to resolve ? marks. Open inventory bag first.';
        scanBtn.addEventListener('click', () => {
            if (scanBusy) return;
            scanBtn.disabled = true;
            setBtnProgress(scanBtn, 0, '🔍 Scanning…');
            getEquippableBagItems().forEach(inferSlot);
            scanBagTooltips(
                (n) => {
                    scanBtn.disabled = false;
                    if (n === -1)     setBtnProgress(scanBtn, 100, '⚠ Open bag first', true);
                    else if (n === 0) setBtnProgress(scanBtn, 100, '✓ Cached', true);
                    else              setBtnProgress(scanBtn, 100, `✓ ${n} scanned`, true);
                    setTimeout(() => { scanBtn.style.background=''; scanBtn.style.color=''; scanBtn.textContent='🔍 Scan\nBag'; }, 2500);
                    if (n > 0) { saveTipCache(); apply(); }
                },
                (done, total) => {
                    const pct = total ? Math.round((done/total)*100) : 0;
                    setBtnProgress(scanBtn, pct, `🔍 ${done}/${total}`);
                }
            );
        });

        // ── Clear all (hold 1.5s) ──
        const clearAllBtn = makeHoldBtn('✕ Clear\nAll', 1500, (btn, cancel) => {
            cancel();
            SLOTS.forEach(s => { state.slotConfig[s.id] = { enabled:false, conditions:[] }; });
            state.activeSlot = null; state.tipCache = {};
            try { localStorage.removeItem(TIP_CACHE_KEY); } catch(e) {}
            window._invfDebugDone = false;
            save(); apply();
            renderBody(document.getElementById('invf-body'));
        }, '#cc4422');
        clearAllBtn.title = 'Hold to clear all slot conditions.';

        btnGrid.append(importBtn, scanBtn, clearAllBtn);
        body.appendChild(btnGrid);

        body.appendChild(mkDivider());

        // Slot grid
        const grid = mkEl('div','invf-slot-grid'); grid.id='invf-slot-grid';
        SLOTS.forEach(sd => renderSlotBtn(grid, sd));
        body.appendChild(grid);

        if (state.activeSlot) {
            body.appendChild(mkDivider());
            body.appendChild(buildSlotDetail(state.activeSlot));
        }
    }

    function makeHlBtn(label, tooltip, onCls, active, onClick) {
        const btn = mkEl('button','invf-hl-btn'+(active?' '+onCls:''));
        btn.title = tooltip;
        btn.textContent = label;
        btn.addEventListener('click', function(){
            onClick();
            const key = onCls==='on-best'?'best':'salvage';
            this.classList.toggle(onCls, state.highlights[key]);
        });
        return btn;
    }

    // Build a compact readable summary of conditions for a slot button
    function condSummaryText(conds) {
        if (!conds || !conds.length) return null;
        return conds.map(c => {
            if (!c.type) return '';
            if (!c.value && c.type !== 'notLocked') return '';
            switch(c.type) {
                case 'tier':        return 'T' + c.value;
                case 'subtier':     return 'Lv≥' + c.value;
                case 'rarity':      return c.value;
                case 'hasStat':     return c.value;
                case 'statQuality': return 'Q≥' + c.value + '%';
                case 'weaponType':  return c.value;
                case 'armorWeight': return c.value;
                default:            return c.value;
            }
        }).filter(Boolean).join(' · ');
    }

    // Returns whether the Offhand slot is applicable given the current weapon type setting.
    // Offhand (shield) can only be equipped by Spear and Fan users.
    // If no weapon type is set, we assume it could be applicable (don't restrict).
    const OFFHAND_WEAPON_TYPES = new Set(['Spear', 'Fan']);
    function offhandApplicable() {
        const weaponConds = state.slotConfig.weapon?.conditions || [];
        const typeCond    = weaponConds.find(c => c.type === 'weaponType');
        if (!typeCond || !typeCond.value) return true; // no weapon type set — allow
        return OFFHAND_WEAPON_TYPES.has(typeCond.value);
    }

    function renderSlotBtn(grid, slotDef) {
        const cfg     = state.slotConfig[slotDef.id];
        const enabled = cfg?.enabled;
        const conds   = cfg?.conditions || [];
        const isOpen  = state.activeSlot === slotDef.id;

        // Offhand: dim and disable if weapon type is set to something without a shield slot
        const isOffhandNA = slotDef.id === 'offhand' && !offhandApplicable();

        const btn = mkEl('div','invf-slot-btn'
            + (enabled && !isOffhandNA ? ' configured' : '')
            + (isOpen ? ' open' : '')
            + (isOffhandNA ? ' na' : ''));
        btn.appendChild(mkEl('span','invf-slot-icon', slotDef.icon));

        const info = mkEl('div','invf-slot-info');
        info.appendChild(mkEl('div','invf-slot-name', slotDef.label));

        const sub = mkEl('div','invf-slot-sub');
        if (isOffhandNA) {
            sub.textContent = 'N/A — only usable with Spear or Fan';
            sub.style.color = '#553333';
        } else {
            const summary = condSummaryText(conds);
            if (enabled && summary) {
                sub.textContent = summary;
                sub.style.color = '#3a8a60';
            } else if (enabled) {
                sub.textContent = 'enabled — all items match';
            } else {
                sub.textContent = 'click to configure';
            }
        }
        info.appendChild(sub);
        btn.appendChild(info);

        btn.addEventListener('click', () => {
            if (isOffhandNA) return; // don't open config for N/A slot
            state.activeSlot = (state.activeSlot === slotDef.id) ? null : slotDef.id;
            renderBody(document.getElementById('invf-body'));
        });
        grid.appendChild(btn);
    }

    function buildSlotDetail(slotId) {
        const slotDef = SLOTS.find(s=>s.id===slotId);
        const cfg     = state.slotConfig[slotId];
        const wrap    = mkEl('div','invf-detail-wrap');

        const dh = mkEl('div','invf-detail-hdr');
        dh.appendChild(mkEl('span','invf-detail-title',slotDef.icon+' '+slotDef.label));

        // Clear all conditions button
        const clearBtn = mkEl('button','invf-clear-btn','✕ Clear');
        clearBtn.title = 'Remove all conditions for this slot and disable highlighting.';
        clearBtn.addEventListener('click', () => {
            state.slotConfig[slotId] = { enabled: false, conditions: [] };
            state.activeSlot = null;
            window._invfDebugDone = false;
            save(); apply();
            renderBody(document.getElementById('invf-body'));
        });
        dh.appendChild(clearBtn);

        const cb2 = mkEl('button','invf-close-detail','×');
        cb2.addEventListener('click',()=>{ state.activeSlot=null; renderBody(document.getElementById('invf-body')); });
        dh.appendChild(cb2);
        wrap.appendChild(dh);

        const er = mkEl('div','invf-enable-row');
        const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=!!cfg.enabled;
        const lbl = mkEl('span','invf-enable-lbl'+(cfg.enabled?' on':''));
        lbl.textContent = cfg.enabled ? 'Enabled — flagging matches' : 'Disabled';
        cb.addEventListener('change',function(){
            state.slotConfig[slotId].enabled=this.checked;
            lbl.textContent=this.checked?'Enabled — flagging matches':'Disabled';
            lbl.className='invf-enable-lbl'+(this.checked?' on':'');
            window._invfDebugDone=false;
            refreshSlotGrid(); save(); apply();
        });
        er.append(cb,lbl);
        wrap.appendChild(er);

        // Offhand: show weapon type note
        if (slotId === 'offhand') {
            const note = mkEl('div','invf-types-note',
                '⚠ Shields can only be equipped by Spear and Fan users. Set your weapon type on the Weapon slot — offhand items will be marked Salvage automatically for other weapon types.');
            note.style.color = offhandApplicable() ? '#555' : '#883333';
            wrap.appendChild(note);
        }

        // ── Weapon type selector ──────────────────────────────────────────────
        if (slotDef.weaponTypes) {
            const typeRow = mkEl('div','invf-type-section');
            typeRow.appendChild(mkEl('div','invf-type-label','Weapon type'));
            const typePills = mkEl('div','invf-type-pills');

            // Current selected weapon type from conditions
            const wCond = cfg.conditions.find(c=>c.type==='weaponType');
            const selType = wCond?.value || '';

            // "Any" pill
            const anyPill = mkEl('button','invf-type-pill'+(selType===''?' active':''),'Any');
            anyPill.addEventListener('click',()=>{
                // Remove weaponType condition
                const idx = cfg.conditions.findIndex(c=>c.type==='weaponType');
                if (idx !== -1) cfg.conditions.splice(idx, 1);
                save(); refreshSlotGrid(); apply();
                // Re-render detail panel in place
                const cw2 = document.getElementById('invf-cond-wrap');
                if (cw2) renderCondList(cw2, slotId);
                refreshSummary(slotId);
                buildSlotDetail._refresh(slotId, wrap);
            });
            typePills.appendChild(anyPill);

            slotDef.weaponTypes.forEach(wt => {
                const pill = mkEl('button','invf-type-pill'+(selType===wt?' active':''), wt);
                pill.addEventListener('click',()=>{
                    const existing = cfg.conditions.findIndex(c=>c.type==='weaponType');
                    if (existing !== -1) cfg.conditions[existing].value = wt;
                    else cfg.conditions.unshift({ type:'weaponType', value:wt });
                    // If new weapon type can't use offhand, disable it to avoid confusion
                    if (!OFFHAND_WEAPON_TYPES.has(wt) && state.slotConfig.offhand?.enabled) {
                        state.slotConfig.offhand.enabled = false;
                    }
                    save(); refreshSlotGrid(); apply();
                    buildSlotDetail._refresh(slotId, wrap);
                });
                typePills.appendChild(pill);
            });
            typeRow.appendChild(typePills);
            wrap.appendChild(typeRow);
        }

        // ── Armor weight selector ─────────────────────────────────────────────
        if (slotDef.canHeavy) {
            const weightRow = mkEl('div','invf-type-section');
            weightRow.appendChild(mkEl('div','invf-type-label','Armor weight'));
            const weightPills = mkEl('div','invf-type-pills');

            const wCond   = cfg.conditions.find(c=>c.type==='armorWeight');
            const selWeight = wCond?.value || '';

            ['Any','Light','Heavy'].forEach(w => {
                const pill = mkEl('button','invf-type-pill'+(selWeight===(w==='Any'?'':w)?' active':''), w);
                if (w !== 'Any') pill.dataset.weight = w;
                pill.addEventListener('click',()=>{
                    const existing = cfg.conditions.findIndex(c=>c.type==='armorWeight');
                    if (w === 'Any') {
                        if (existing !== -1) cfg.conditions.splice(existing, 1);
                    } else {
                        if (existing !== -1) cfg.conditions[existing].value = w;
                        else cfg.conditions.unshift({ type:'armorWeight', value:w });
                    }
                    save(); refreshSlotGrid(); apply();
                    buildSlotDetail._refresh(slotId, wrap);
                });
                weightPills.appendChild(pill);
            });
            weightRow.appendChild(weightPills);
            wrap.appendChild(weightRow);
        }

        wrap.appendChild(mkDivider());

        const cw=mkEl('div'); cw.id='invf-cond-wrap';
        // Filter out weaponType/armorWeight from the dropdown list — they have dedicated UI
        renderCondList(cw, slotId);
        wrap.appendChild(cw);

        const sm=mkEl('div','invf-cond-summary'); sm.id='invf-cond-summary';
        updateCondSummary(sm,cfg.conditions);
        wrap.appendChild(sm);
        return wrap;
    }

    // Helper to refresh only the type/weight pill state without full re-render
    buildSlotDetail._refresh = function(slotId, wrap) {
        const body = document.getElementById('invf-body');
        if (body) renderBody(body);
    };

    function renderCondList(wrap, slotId) {
        wrap.innerHTML='';
        const conds=state.slotConfig[slotId].conditions;
        // Filter: only show conditions that aren't handled by dedicated UI
        const displayConds = conds.map((c,i)=>({...c,_idx:i}))
            .filter(c => c.type !== 'weaponType' && c.type !== 'armorWeight');

        displayConds.forEach(({_idx: idx}) => {
            const cond = conds[idx];
            const row=mkEl('div','invf-cond-row');
            const ts=document.createElement('select'); ts.className='invf-cond-type';
            // Only show non-hidden cond types in dropdown
            COND_TYPES.filter(ct=>ct.input!=='hidden').forEach(ct=>{
                const o=document.createElement('option');
                o.value=ct.key; o.textContent=ct.label;
                if(ct.key===cond.type) o.selected=true;
                ts.appendChild(o);
            });
            ts.addEventListener('change',function(){
                conds[idx].type=this.value; conds[idx].value='';
                save(); renderCondList(wrap,slotId); refreshSummary(slotId); refreshSlotGrid(); apply(); scheduleAutoScan();
            });

            const ct=COND_TYPES.find(c=>c.key===cond.type);
            let ve=null;
            if(ct?.input==='number'){
                ve=document.createElement('input');
                ve.type='number'; ve.className='invf-cond-val';
                ve.min=ct.min||0; ve.max=ct.max||9999;
                ve.placeholder=ct.ph||''; ve.value=cond.value||'';
                ve.addEventListener('input',function(){
                    conds[idx].value=this.value;
                    save(); refreshSummary(slotId); refreshSlotGrid(); apply(); scheduleAutoScan();
                });
            } else if(ct?.input==='select'){
                ve=document.createElement('select');
                ve.className='invf-cond-val'; ve.style.width='82px';
                const armorWeight = state.slotConfig[slotId]?.conditions?.find(c=>c.type==='armorWeight')?.value || '';
                const opts=cond.type==='hasStat' ? getStatOptsForSlot(slotId, armorWeight) : ct.opts;
                opts.forEach(o=>{
                    const op=document.createElement('option');
                    op.value=o; op.textContent=o;
                    if(o===cond.value) op.selected=true;
                    ve.appendChild(op);
                });
                if(!cond.value&&opts.length){ conds[idx].value=opts[0]; ve.value=opts[0]; }
                ve.addEventListener('change',function(){
                    conds[idx].value=this.value;
                    save(); refreshSummary(slotId); refreshSlotGrid(); apply(); scheduleAutoScan();
                });
            }

            const del=mkEl('button','invf-cond-del','✕');
            del.title='Remove';
            del.addEventListener('click',()=>{
                conds.splice(idx,1);
                save(); renderCondList(wrap,slotId); refreshSummary(slotId); refreshSlotGrid(); apply(); scheduleAutoScan();
            });
            row.appendChild(ts);
            if(ve) row.appendChild(ve);
            row.appendChild(del);
            wrap.appendChild(row);
        });

        const add=mkEl('button','invf-add-cond','+ Add condition');
        // Cap only counts the user-visible conditions, not weapon/armor type
        const visibleCount = conds.filter(c=>c.type!=='weaponType'&&c.type!=='armorWeight').length;
        add.disabled = visibleCount >= 8;
        add.addEventListener('click',()=>{
            if(visibleCount>=8) return;
            conds.push({type:'tier',value:''});
            save(); renderCondList(wrap,slotId); refreshSummary(slotId); refreshSlotGrid(); apply(); scheduleAutoScan();
        });
        wrap.appendChild(add);
    }

    function refreshSummary(slotId){
        const el=document.getElementById('invf-cond-summary');
        if(el) updateCondSummary(el,state.slotConfig[slotId].conditions);
    }
    function updateCondSummary(el,conds){
        if(!conds?.length){ el.textContent='No conditions — all items of this type will be flagged when enabled.'; return; }
        el.innerHTML=conds.map(c=>{
            const ct=COND_TYPES.find(t=>t.key===c.type);
            const lbl=ct?(ct.input==='none'?ct.label:ct.label+' '+(c.value||'?')):'?';
            return `<b style="color:#5DCAA5">${lbl}</b>`;
        }).join(' <span style="color:#444">AND</span> ');
    }
    function refreshSlotGrid(){
        const grid=document.getElementById('invf-slot-grid');
        if(!grid) return;
        grid.innerHTML='';
        SLOTS.forEach(sd=>renderSlotBtn(grid,sd));
    }

    // Auto-scan debounce — fires 1.2s after conditions stop changing.
    // Silently scans any items that became 'unknown' due to new hasStat conditions.
    let autoScanTimer = null;
    function scheduleAutoScan() {
        clearTimeout(autoScanTimer);
        autoScanTimer = setTimeout(() => {
            const hasUnknown = document.querySelector('.invf-unknown');
            if (hasUnknown && !scanBusy) {
                scanBagTooltips(n => { if (n > 0) { saveTipCache(); apply(); } }, null);
            }
        }, 1200);
    }

    // ─── TEAM TAB ─────────────────────────────────────────────────────────────
    function chip(label, val, cls) {
        const c = mkEl('div','qol-chip'+(cls?' '+cls:''));
        c.appendChild(mkEl('span','qol-chip-lbl',label));
        c.appendChild(mkEl('span','qol-chip-val',val));
        return c;
    }

    function buildManaBar(stats) {
        const empirical = getEmpiricalManaRate();
        const breakdown = stats.__mpBreakdown || [];
        const mpRequired = stats.__mpRequired; // predicted, used only as fallback/context

        // Need at least a little sample history to show anything meaningful
        if (!empirical && (!mpRequired || mpRequired === 0)) return null;

        const wrap = mkEl('div','qol-mana-bar-wrap');

        // Header: live net mana flow (measured, not predicted)
        const hdr = mkEl('div','qol-mana-bar-hdr');
        hdr.appendChild(mkEl('span','qol-mana-bar-title','💠 Mana flow'));
        const valEl = mkEl('span','qol-mana-bar-val');

        if (empirical && empirical.sampleMs >= 2000) {
            const net = empirical.net;
            if (net >= 0) {
                valEl.innerHTML = `<span style="color:#5DCAA5">+${net.toFixed(1)}</span> <span style="font-size:8px;color:#5DCAA5;font-weight:400">/10s surplus</span>`;
            } else {
                valEl.innerHTML = `<span style="color:#ee8866">${net.toFixed(1)}</span> <span style="font-size:8px;color:#ee8866;font-weight:400">/10s deficit</span>`;
            }
        } else {
            // Not enough samples yet — show a "measuring" state rather than
            // a stale/predicted number that could be wrong
            valEl.innerHTML = `<span style="color:#666;font-size:10px;">measuring…</span>`;
        }
        hdr.appendChild(valEl);
        wrap.appendChild(hdr);

        // Live bar — shows gross regen vs net flow as two overlapping indicators
        if (empirical && empirical.sampleMs >= 2000) {
            const maxVal = Math.max(Math.abs(empirical.gross), Math.abs(empirical.net), mpRequired||0, 10) * 1.15;
            const zeroPct = 50; // center the zero-point so deficit can show left of it
            const track = mkEl('div','');
            track.style.cssText = 'position:relative;height:10px;background:#111120;border-radius:5px;overflow:hidden;';

            // Net flow fill — from center toward + or -
            const netPct = (empirical.net / maxVal) * 50; // half-width scale either direction
            const netFill = mkEl('div','');
            const netClamped = Math.max(-50, Math.min(50, netPct));
            netFill.style.cssText = `position:absolute;top:0;bottom:0;` +
                (netClamped >= 0
                    ? `left:50%;width:${netClamped}%;background:linear-gradient(90deg,#1D9E75,#5DCAA5);`
                    : `right:50%;width:${-netClamped}%;background:linear-gradient(90deg,#ee8866,#cc4422);`);
            track.appendChild(netFill);

            // Center zero line
            const zeroLine = mkEl('div','');
            zeroLine.style.cssText = 'position:absolute;top:0;bottom:0;left:50%;width:1px;background:rgba(255,255,255,.25);';
            track.appendChild(zeroLine);

            wrap.appendChild(track);

            // Sub-row: gross regen context + sample window
            const sub = mkEl('div','');
            sub.style.cssText = 'display:flex;justify-content:space-between;font-size:8px;color:#444;margin-top:3px;';
            const left = mkEl('span','', `gross regen ${empirical.gross.toFixed(1)}/10s`);
            const right = mkEl('span','', `${(empirical.sampleMs/1000).toFixed(0)}s sample`);
            sub.append(left, right);
            wrap.appendChild(sub);
        }

        // Predicted breakdown — kept as secondary context for understanding
        // WHY the rate looks the way it does (skills/aura/imbue contributions).
        // This is an estimate and may not capture every dynamic source —
        // the header number above is the one to trust.
        if (breakdown.length > 0) {
            const predLbl = mkEl('div','');
            predLbl.style.cssText = 'font-size:7px;color:#333;text-transform:uppercase;letter-spacing:.04em;margin-top:6px;margin-bottom:2px;';
            predLbl.textContent = 'Estimated cost breakdown';
            wrap.appendChild(predLbl);

            const maxVal2 = Math.max(...breakdown.map(s=>s.value), mpRequired||0) * 1.1;
            const track2 = mkEl('div','');
            track2.style.cssText = 'display:flex;overflow:hidden;border-radius:3px;gap:1px;height:5px;';
            breakdown.forEach(seg => {
                const pct = Math.min(100, (seg.value / maxVal2) * 100);
                const col = MANA_SEG_COLORS[seg.label] || '#555';
                const fill = mkEl('div','');
                fill.style.cssText = `height:5px;background:${col};border-radius:2px;flex-shrink:0;opacity:.7;`;
                fill.style.width = pct.toFixed(2)+'%';
                fill.title = `${seg.label}: ~${seg.value.toFixed(1)}/10s (estimated)`;
                track2.appendChild(fill);
            });
            wrap.appendChild(track2);

            const leg = mkEl('div','');
            leg.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px 8px;margin-top:3px;';
            breakdown.forEach(seg => {
                const col = MANA_SEG_COLORS[seg.label] || '#555';
                const item = mkEl('div','');
                item.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:7px;color:#444;';
                const dot = mkEl('span','');
                dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${col};flex-shrink:0;opacity:.7;`;
                const lbl = mkEl('span','',seg.label+' '+seg.value.toFixed(1));
                item.append(dot, lbl);
                leg.appendChild(item);
            });
            wrap.appendChild(leg);
        }

        return wrap;
    }

    // ── Settings ──────────────────────────────────────────────────────────────
    function applySettings() {
        let el = document.getElementById('shawz-settings-css');
        if (!el) { el = document.createElement('style'); el.id = 'shawz-settings-css'; document.head.appendChild(el); }
        const rules = [];
        if (state.settings.hideBuffChips) rules.push('.cc-ability-buffs{display:none!important}');
        if (state.settings.hideBuffIcons) rules.push('.cc-buff-icons{display:none!important}.cc-pm-buff-row{display:none!important}');
        el.textContent = rules.join('\n');
    }

    function renderSettingsTab(body) {
        body.innerHTML = '';
        const wrap = mkEl('div','');
        wrap.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:5px;';

        function section(label) {
            const h = mkEl('div','');
            h.style.cssText = 'font-size:9px;color:#444;text-transform:uppercase;letter-spacing:.07em;font-weight:700;margin-top:8px;margin-bottom:2px;padding-left:2px;';
            h.textContent = label;
            wrap.appendChild(h);
        }

        function toggle(label, desc, key, onToggleOn) {
            const on  = state.settings[key];
            const row = mkEl('div','');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:#0a0a14;border:1px solid #1a1a2e;border-radius:5px;cursor:pointer;user-select:none;';
            row.addEventListener('mouseenter', () => row.style.borderColor = '#2a2a3a');
            row.addEventListener('mouseleave', () => row.style.borderColor = '#1a1a2e');

            const txt = mkEl('div','');
            txt.style.cssText = 'flex:1;min-width:0;';
            const lbl = mkEl('div','');
            lbl.style.cssText = 'font-size:11px;font-weight:600;color:#c0b8ff;';
            lbl.textContent = label;
            const sub = mkEl('div','');
            sub.style.cssText = 'font-size:9px;color:#3a3a55;margin-top:2px;line-height:1.3;';
            sub.textContent = desc;
            txt.append(lbl, sub);

            const pill = mkEl('div','');
            pill.style.cssText = `width:32px;height:17px;border-radius:9px;flex-shrink:0;position:relative;transition:background .15s;background:${on?'#7F77DD':'#151525'};border:1px solid ${on?'#7F77DD':'#2a2a3a'};`;
            const knob = mkEl('div','');
            knob.style.cssText = `position:absolute;top:2px;left:${on?'13px':'2px'};width:11px;height:11px;border-radius:50%;background:${on?'#fff':'#3a3a5a'};transition:left .15s,background .15s;`;
            pill.appendChild(knob);
            row.append(txt, pill);

            row.addEventListener('click', () => {
                const turningOn = !state.settings[key];
                state.settings[key] = turningOn;
                applySettings(); save();
                if (turningOn && onToggleOn) onToggleOn();
                renderSettingsTab(body);
            });
            wrap.appendChild(row);
        }

        section('Combat UI');
        toggle('Hide buff descriptions', 'ATK Buff +8% 6s chips below player cards', 'hideBuffChips');
        toggle('Hide buff icons',        '✨⚔️🛡️ buff icon row on player cards (both UIs)',  'hideBuffIcons');
        toggle('Weapon class portraits', 'Replace generic portrait with class art based on equipped weapon. Requires ↺ Players & Stats refresh to apply.', 'weaponPortraits', () => {
            const hint = mkEl('div','');
            hint.style.cssText = 'font-size:9px;color:#c6a85c;background:rgba(198,168,92,.1);border:1px solid rgba(198,168,92,.3);border-radius:5px;padding:7px 9px;margin-top:4px;line-height:1.4;';
            hint.textContent = '⚠ Run ↺ Players & Stats on the Team tab now to load portraits for your party.';
            wrap.appendChild(hint);
        });

        body.appendChild(wrap);
    }

    function renderTeamTab(body) {
        body.innerHTML = '';
        readPartyPanel();
        scrapeSelfStats();

        // ── Mana warning ──
        if (!state.zerkMode) {
            const warn = getManaWarning();
            if (warn) {
                const banner = mkEl('div','invf-mana-warn');
                banner.innerHTML = `⚠️ <b>Mana deficit</b> −${warn.deficit}/10s &nbsp;·&nbsp; OOM in ~${warn.secsToOOM}s (${warn.currentMana} left)`;
                body.appendChild(banner);
            }
        }

        body.appendChild(mkDivider());

        // ── Party header ──
        const ph = mkEl('div','qol-party-hdr');
        ph.appendChild(mkEl('span','qol-party-title','👥 Party'));

        // Zerk mode toggle
        const zerkToggle = mkEl('button','qol-refresh-btn');
        zerkToggle.title = 'Toggle Berserk Mode';
        zerkToggle.style.cssText = `height:24px;padding:0 8px;font-size:10px;border-color:${state.zerkMode ? '#9944eeaa' : '#2a2a40'};color:${state.zerkMode ? '#aa44ff' : '#555'};background:${state.zerkMode ? 'rgba(153,68,238,.12)' : ''};white-space:nowrap;`;
        zerkToggle.textContent = '⚡ Zerk';
        zerkToggle.addEventListener('click', () => {
            state.zerkMode = !state.zerkMode;
            save();
            renderTeamTab(document.getElementById('invf-body'));
        });
        ph.appendChild(zerkToggle);
        // ── Two refresh hold buttons ──
        const rfGrid = mkEl('div','');
        rfGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

        function makeTeamHoldBtn(label, holdMs, color, action) {
            const btn = mkEl('button','qol-refresh-btn');
            btn.style.cssText = `height:28px;border-color:${color}44;color:${color};white-space:nowrap;text-align:center;line-height:1;font-size:10px;user-select:none;transition:none;`;
            btn.textContent = label;
            requestAnimationFrame(() => { btn.style.minWidth = btn.offsetWidth + 'px'; });
            let ht=null, hs=null, hr=null, fired=false;

            function cancel() {
                clearTimeout(ht); cancelAnimationFrame(hr);
                ht=hs=hr=null; fired=false;
                btn.style.background=''; btn.style.color=color; btn.textContent=label;
            }
            function tick() {
                if (!hs) return;
                const pct = Math.min(100,((Date.now()-hs)/holdMs)*100);
                btn.style.background=`linear-gradient(to right,${color}33 ${pct}%,#13132a ${pct}%)`;
                if (pct<100) hr=requestAnimationFrame(tick);
            }
            function onDocMouseUp() {
                // Only cancel if we haven't fired yet
                if (!fired) cancel();
            }

            btn.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                fired=false;
                hs=Date.now();
                clearTimeout(ht); cancelAnimationFrame(hr);
                hr=requestAnimationFrame(tick);
                ht=setTimeout(() => {
                    fired=true;
                    cancelAnimationFrame(hr);
                    btn.style.background=''; btn.textContent='↺ Refreshing…';
                    action(btn, cancel);
                }, holdMs);
                // Listen on document so mouseleave doesn't interfere
                // Delay so this mousedown's paired mouseup doesn't immediately trigger it
                setTimeout(() => document.addEventListener('mouseup', onDocMouseUp, { once:true }), 50);
            });
            btn.addEventListener('touchstart', e => { e.preventDefault(); btn.dispatchEvent(new MouseEvent('mousedown', {button:0})); });
            btn.addEventListener('touchend', () => { if (!fired) cancel(); });
            return btn;
        }

        const rfPartyBtn = makeTeamHoldBtn('↺ Players & Stats', 1500, '#7F77DD', (btn, cancel) => {
            cancel();
            btn.disabled=true; btn.textContent='↺ Refreshing…';
            refreshPartyStats(() => {
                btn.disabled=false; btn.textContent='✓ Done';
                setTimeout(()=>{ btn.textContent='↺ Players & Stats'; }, 2000);
                renderTeamTab(document.getElementById('invf-body'));
            });
        });

        const rfLbBtn = makeTeamHoldBtn('↺ Leaderboard', 1500, '#5DCAA5', (btn, cancel) => {
            cancel();
            btn.disabled=true; btn.textContent='↺ Refreshing…';
            refreshLeaderboard(() => {
                btn.disabled=false; btn.textContent='✓ Done';
                setTimeout(()=>{ btn.textContent='↺ Leaderboard'; }, 2000);
                renderTeamTab(document.getElementById('invf-body'));
            });
        });

        rfGrid.append(rfPartyBtn, rfLbBtn);
        ph.appendChild(rfGrid);
        body.appendChild(ph);

        // ── Player cards ──
        const members = Object.values(state.party)
            .filter(m=>m.name!=='__self__')
            .sort((a,b)=>(b.isSelf?1:0)-(a.isSelf?1:0));

        if (!members.length) {
            const msg = mkEl('div','qol-no-stats-msg');
            msg.innerHTML = "Open the game's <b>Party</b> panel then click <b>↺ Refresh all stats</b>.";
            body.appendChild(msg);
            return;
        }

        // ── Zerk mode — compact berserk-focused view ──────────────────────────
        if (state.zerkMode) {
            const zerkList = mkEl('div','');
            zerkList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
            members.forEach(m => {
                const zerk = m.zerk || null;
                const zs = zerk
                    ? (zerk.active ? 'active' : zerk.pct >= 100 ? 'ready' : 'charging')
                    : 'none';
                const pct = zerk ? Math.min(100, zerk.pct) : 0;

                const card = mkEl('div','');
                card.setAttribute('data-zerk-name', m.name);
                card.style.cssText = `position:relative;height:38px;border-radius:7px;overflow:hidden;border:1px solid ${
                    zs==='active' ? '#9944ee55' : zs==='ready' ? '#9944ee44' : m.isSelf ? '#1a0d33' : '#0d0820'
                };background:${m.isSelf ? '#09060f' : '#060610'};`;

                // Background fill
                const fill = mkEl('div','');
                fill.setAttribute('data-zerk-fill','');
                fill.setAttribute('data-zerk-state', zs);
                fill.style.cssText = `position:absolute;top:0;left:0;bottom:0;`;
                if (zs === 'active') {
                    fill.style.width = pct.toFixed(1)+'%';
                    fill.style.background = 'linear-gradient(90deg,#0a0520,#1d0a55,#4d1aaa,#7722cc)';
                    fill.style.backgroundSize = '';
                    fill.style.animation = '';
                    // Edge glow — positioned as a sibling so overflow:hidden on fill doesn't clip it
                    const edge = mkEl('div','');
                    edge.setAttribute('data-zerk-edge','');
                    edge.style.cssText = 'position:absolute;top:3px;bottom:3px;width:3px;border-radius:2px;background:#aa44ff;animation:void-edge-pulse 1.5s ease-in-out infinite;pointer-events:none;z-index:2;';
                    card.appendChild(edge);
                    // Smooth depletion — transition fill and edge together
                    if (zerk.secsLeft != null && zerk.secsLeft > 0) {
                        requestAnimationFrame(() => requestAnimationFrame(() => {
                            const cardW = card.offsetWidth;
                            // Set initial edge position in px
                            edge.style.left = (cardW * pct / 100 - 2) + 'px';
                            // Now animate both to 0 over secsLeft seconds
                            fill.style.transition = `width ${zerk.secsLeft}s linear`;
                            edge.style.transition = `left ${zerk.secsLeft}s linear`;
                            fill.style.width = '0%';
                            edge.style.left = '-4px';
                        }));
                    } else {
                        requestAnimationFrame(() => {
                            edge.style.left = (card.offsetWidth * pct / 100 - 2) + 'px';
                        });
                    }
                } else if (zs === 'ready') {
                    fill.style.width = '100%';
                    fill.style.background = 'rgba(153,68,238,.22)';
                    fill.style.animation = 'void-glow 2.5s ease-in-out infinite';
                } else {
                    fill.style.width = pct.toFixed(1)+'%';
                    fill.style.background = 'linear-gradient(90deg,#0d0820,#1a0d3d)';
                }
                card.appendChild(fill);

                // Content
                const content = mkEl('div','');
                content.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;padding:0 12px;';

                const nameEl = mkEl('span','');
                nameEl.style.cssText = `font-size:13px;font-weight:700;color:${m.isSelf ? '#e8c96a' : zs!=='charging'&&zs!=='none' ? '#eeddff' : '#6644aa'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
                nameEl.textContent = m.name;
                if (m.isSelf) {
                    const you = mkEl('span','');
                    you.style.cssText = 'font-size:6px;font-weight:700;padding:1px 3px;border-radius:2px;background:rgba(198,168,92,.15);color:#c6a85c;border:1px solid rgba(198,168,92,.3);vertical-align:middle;margin-left:4px;';
                    you.textContent = 'YOU';
                    nameEl.appendChild(you);
                }
                content.appendChild(nameEl);

                const stateBox = mkEl('div','');
                stateBox.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;';

                const stateVal = mkEl('span','');
                stateVal.setAttribute('data-zerk-val','');
                stateVal.style.cssText = `font-size:14px;font-weight:700;line-height:1;color:${
                    zs==='active' ? '#cc88ff' : zs==='ready' ? '#aa44ff' : '#2a1a55'
                };`;
                stateVal.textContent = zs==='active' && zerk.secsLeft
                    ? zerk.secsLeft+'s'
                    : zs==='ready' ? 'READY'
                    : zs==='none' ? '—'
                    : Math.round(pct)+'%';

                const stateLbl = mkEl('span','');
                stateLbl.setAttribute('data-zerk-lbl','');
                stateLbl.style.cssText = `font-size:8px;letter-spacing:.05em;color:${
                    zs==='active' ? '#7722cc' : zs==='ready' ? '#6611bb' : '#1a0d33'
                };`;
                stateLbl.textContent = 'BERSERK' + (zs!=='charging'&&zs!=='none' ? ' ⚡' : '');

                stateBox.append(stateVal, stateLbl);
                content.appendChild(stateBox);
                card.appendChild(content);
                zerkList.appendChild(card);
            });
            body.appendChild(zerkList);
            return;
        }

        // ── Full mode ─────────────────────────────────────────────────────────
        members.forEach(m => {
            if (state.cardCollapsed[m.name] === undefined)
                state.cardCollapsed[m.name] = !m.isSelf;
            const isCollapsed = state.cardCollapsed[m.name];

            const zerk = m.zerk || null;
            const zerkState = zerk
                ? (zerk.active ? 'active' : zerk.pct >= 100 ? 'ready' : 'charging')
                : 'none';

            const card = mkEl('div','qol-player-card'
                +(m.isSelf?' self':'')
                +(isCollapsed?' collapsed':' expanded')
                +(zerkState==='ready'?' zerk-ready':'')
                +(zerkState==='active'?' zerk-active':''));

            // ── Top row ──
            const top = mkEl('div','qol-player-top');
            top.addEventListener('click',(e)=>{
                if (e.target.classList.contains('qol-inspect-btn')) return;
                state.cardCollapsed[m.name]=!state.cardCollapsed[m.name];
                card.classList.toggle('collapsed', state.cardCollapsed[m.name]);
                card.classList.toggle('expanded',  !state.cardCollapsed[m.name]);
                arrow.style.transform = state.cardCollapsed[m.name]?'':'rotate(180deg)';
            });


            // Name + YOU/offline badge
            const nameEl = mkEl('span','qol-player-name', m.name);
            if (m.isSelf) nameEl.appendChild(mkEl('span','qol-you-badge','YOU'));
            else if (!m.online) nameEl.appendChild(mkEl('span','qol-offline-badge','offline'));

            // Weapon image icon
            const wt = m.weaponType || '';
            const weapImg = m.weaponImg || '';
            if (wt || weapImg) {
                const wIcon = document.createElement('img');
                if (weapImg) {
                    wIcon.src = weapImg;
                    wIcon.style.cssText = 'width:14px;height:14px;object-fit:contain;vertical-align:middle;margin-left:3px;opacity:.85;image-rendering:auto;border-radius:2px;';
                    wIcon.title = wt.charAt(0).toUpperCase()+wt.slice(1);
                    nameEl.appendChild(wIcon);
                } else {
                    // Fallback to emoji if no image stored yet
                    const WEAPON_ICONS = {sword:'⚔',bow:'🏹',spear:'🔱',staff:'🪄',harp:'🎵',fan:'🪭'};
                    const eIcon = mkEl('span','');
                    eIcon.title = wt;
                    eIcon.style.cssText = 'font-size:10px;margin-left:3px;opacity:.8;vertical-align:middle;';
                    eIcon.textContent = WEAPON_ICONS[wt] || '';
                    if (eIcon.textContent) nameEl.appendChild(eIcon);
                }
            }

            // Leaderboard ranks — overall level + weapon level
            const lbEntry = state.lbRanks?.[m.name];
            // Overall level rank
            const lvRank = lbEntry?.['Player Level'] || lbEntry?.['Level'];
            const lvRankTxt = lvRank ? '#'+lvRank : '50+';
            const lvBadge = mkEl('span','');
            lvBadge.title = 'Overall Level rank';
            lvBadge.style.cssText = 'font-size:7px;padding:1px 4px;border-radius:4px;background:rgba(127,119,221,.15);color:#7F77DD;border:1px solid rgba(127,119,221,.3);margin-left:3px;vertical-align:middle;font-weight:700;';
            lvBadge.textContent = '🏆'+lvRankTxt;
            nameEl.appendChild(lvBadge);

            // Weapon level rank
            const weaponLevelKey = wt ? wt.charAt(0).toUpperCase()+wt.slice(1)+' Level' : null;
            const wpnRank = weaponLevelKey && lbEntry ? lbEntry[weaponLevelKey] : null;
            const wpnRankTxt = wpnRank ? '#'+wpnRank : (wt ? '50+' : null);
            if (wpnRankTxt) {
                const wpnBadge = mkEl('span','');
                wpnBadge.title = (weaponLevelKey||wt)+' rank';
                wpnBadge.style.cssText = 'font-size:7px;padding:1px 4px;border-radius:4px;background:rgba(238,136,102,.12);color:#ee8866;border:1px solid rgba(238,136,102,.3);margin-left:3px;vertical-align:middle;font-weight:700;';
                wpnBadge.textContent = '⚔'+wpnRankTxt;
                nameEl.appendChild(wpnBadge);
            }
            top.appendChild(nameEl);

            // Zone inline — only show idle state, not location name
            if (m.online && m.activity && /idle/i.test(m.activity)) {
                top.appendChild(mkEl('span','qol-zone-inline idle','💤 Idle'));
            }

            // Berserk icon + badge shown in the zerk row below, not the top row

            top.appendChild(mkEl('span','qol-player-lv','Lv '+m.lv));

            const arrow = mkEl('span','qol-collapse-arrow','▾');
            arrow.style.transform = isCollapsed?'':'rotate(180deg)';
            top.appendChild(arrow);

            if (!m.isSelf) {
                const inspBtn = mkEl('button','qol-inspect-btn','🔍');
                inspBtn.addEventListener('click',()=>{
                    inspBtn.textContent='…'; inspBtn.disabled=true;
                    navTo('Party');
                    waitFor('.sp-member-row',()=>{
                        document.querySelectorAll('.sp-member-row').forEach(pr=>{
                            const pname=[...(pr.querySelector('.sp-member-name')?.childNodes||[])]
                                .find(n=>n.nodeType===3)?.textContent.trim();
                            if (pname===m.name) pr.querySelector('.sp-btn-inspect')?.click();
                        });
                        // Return to Combat — inspect panel stays open as overlay
                        setTimeout(()=>{
                            navTo('Combat');
                            inspBtn.textContent='🔍';
                            inspBtn.disabled=false;
                        }, 500);
                    },3000);
                });
                top.appendChild(inspBtn);
            }
            card.appendChild(top);

            // ── Stats ──
            if (m.stats && Object.keys(m.stats).length) {
                const sb = mkEl('div','qol-player-stats');

                if (m.isSelf) {
                    const magAtk  = m.stats['Magical Attack']||m.stats['Magical ATK'];
                    const physAtk = m.stats['Physical ATK'];

                    // Row 1: core combat
                    const r1 = mkEl('div','qol-chips');
                    if (magAtk)                    r1.appendChild(chip('Mag ATK', magAtk,'atk'));
                    if (physAtk)                   r1.appendChild(chip('Phys',    physAtk,'atk'));
                    if (m.stats.Defense)         r1.appendChild(chip('DEF',    m.stats.Defense,'def'));
                    if (m.stats['Max HP'])          r1.appendChild(chip('HP',     m.stats['Max HP'],'hp'));
                    if (m.stats['Max Mana'])        r1.appendChild(chip('Mana',   m.stats['Max Mana'],'mana'));
                    if (m.stats['Crit Chance'])     r1.appendChild(chip('Crit',   m.stats['Crit Chance'],'crit'));
                    if (m.stats['Crit Damage'])     r1.appendChild(chip('CritDmg',m.stats['Crit Damage'],'crit'));
                    if (m.stats['Attack Speed'])    r1.appendChild(chip('Spd',    m.stats['Attack Speed'],'spd'));
                    if (m.stats['Healing Power'])   r1.appendChild(chip('Heal',   m.stats['Healing Power'],'heal'));
                    if (m.stats['Cooldown Reduction']) r1.appendChild(chip('CDR', m.stats['Cooldown Reduction'],'cdr'));
                    sb.appendChild(r1);

                    // Mana bar (replaces MP REG / MP NEEDED / SURPLUS chips)
                    const manaBar = buildManaBar(m.stats);
                    if (manaBar) sb.appendChild(manaBar);

                    // Row 2: bonuses
                    const hasBonuses = m.stats['XP Bonus']||m.stats['Gold Bonus']||m.stats['Drop Rate'];
                    if (hasBonuses) {
                        const r2 = mkEl('div','qol-chips');
                        if (m.stats['XP Bonus'])  r2.appendChild(chip('XP Bonus',  m.stats['XP Bonus'],'bonus'));
                        if (m.stats['Gold Bonus']) r2.appendChild(chip('Gold Bonus',m.stats['Gold Bonus'],'bonus'));
                        if (m.stats['Drop Rate'])  r2.appendChild(chip('Drop Rate', m.stats['Drop Rate'],'bonus'));
                        sb.appendChild(r2);
                    }
                } else {
                    const r = mkEl('div','qol-chips');
                    if (m.stats.Attack)        r.appendChild(chip('ATK',     m.stats.Attack,'atk'));
                    if (m.stats.Defense)       r.appendChild(chip('DEF',     m.stats.Defense,'def'));
                    if (m.stats['Max HP'])        r.appendChild(chip('HP',      m.stats['Max HP'],'hp'));
                    if (m.stats['Dmg Reduction']) r.appendChild(chip('DMG Red', m.stats['Dmg Reduction'],'dmgred'));
                    if (m.stats['XP Rate'])       r.appendChild(chip('XP Rate', m.stats['XP Rate'],'bonus'));
                    if (m.stats['Gold Rate'])     r.appendChild(chip('Gold',    m.stats['Gold Rate'],'bonus'));
                    sb.appendChild(r);
                }

                if (m.statsTime) {
                    const ago = Date.now() - m.statsTime;
                    const mins = ago / 60000;
                    const txt = ago < 10000 ? 'Updated just now' :
                        mins < 60 ? 'Updated '+Math.floor(mins)+'m ago' :
                        'Updated '+(ago/3600000).toFixed(1)+'h ago';
                    const cls = 'qol-updated '+(mins < 1 ? 'fresh' : mins < 5 ? 'stale' : 'old');
                    sb.appendChild(mkEl('div', cls, txt));
                }
                card.appendChild(sb);
            } else {
                const msg = mkEl('div','qol-no-stats-msg');
                msg.innerHTML = m.isSelf
                    ? 'Open your character <b>Stats</b> panel — auto-populates'
                    : 'Click <b>Inspect</b> or <b>↺ Refresh all stats</b>';
                card.appendChild(msg);
            }

            // ── Berserk bar ──
            if (zerk && zerkState !== 'none') {
                const zRow  = mkEl('div','qol-zerk-row');
                const zIcon = mkEl('span','qol-zerk-icon'+(zerkState!=='charging'?' '+zerkState:''),'⚡');
                const zLbl  = mkEl('span','qol-zerk-lbl'+(zerkState!=='charging'?' '+zerkState:''),'Berserk');
                const zTrk  = mkEl('div','qol-zerk-track');
                const zFill = mkEl('div','qol-zerk-fill'+(zerkState!=='charging'?' '+zerkState:''));
                if (zerkState === 'active' && zerk.secsLeft !== null && zerk.secsLeft > 0) {
                    const startPct = Math.min(100, zerk.pct).toFixed(1)+'%';
                    const dur = zerk.secsLeft;
                    zFill.style.width = startPct;
                    zTrk.appendChild(zFill);
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        zFill.style.transition = `width ${dur}s linear`;
                        zFill.style.width = '0%';
                    }));
                } else {
                    zFill.style.width = Math.min(100, zerk.pct).toFixed(1)+'%';
                    zTrk.appendChild(zFill);
                }
                const zPct = mkEl('span','qol-zerk-pct'+(zerkState!=='charging'?' '+zerkState:''));
                zPct.textContent = zerkState==='active' && zerk.secsLeft!==null
                    ? zerk.secsLeft+'s' : Math.round(zerk.pct)+'%';
                zRow.append(zIcon, zLbl, zTrk, zPct);
                if (zerkState === 'ready') {
                    zRow.appendChild(mkEl('span','qol-zerk-badge ready','READY'));
                } else if (zerkState === 'active' && zerk.secsLeft !== null) {
                // No active badge — timer shown in pct label only
                }
                card.appendChild(zRow);
            }

            body.appendChild(card);
        });
    }

    // ─── HOME TAB ─────────────────────────────────────────────────────────────

    // Track previously seen events to detect new ones for flash animation
    const _seenEventKeys = new Set();

    function scrapeZoneEvents() {
        const zones = [];
        document.querySelectorAll('.zone-item').forEach(el => {
            const name    = el.querySelector('.zone-item-name')?.textContent.trim() || '';
            const tier    = el.querySelector('.zone-tier-tag')?.textContent.trim() || '';
            const levels  = el.querySelector('.lvl-badge')?.textContent.trim() || '';
            const players = parseInt(el.querySelector('.active-pip')?.textContent || '0') || 0;
            const bonus   = el.querySelector('.bonus-pip')?.textContent.trim() || '';
            const isActive= el.classList.contains('active');
            const events  = [...el.querySelectorAll('.zone-evt-tag')].map(t => ({
                label: t.textContent.trim(),
                desc:  t.getAttribute('title') || '',
                cls:   [...t.classList].find(c => c.startsWith('evt-')) || '',
                timer: '',
                isNew: false,
            }));
            if (name) zones.push({ name, tier, levels, players, bonus, isActive, events });
        });

        // Enrich with timer from zone-detail banner
        document.querySelectorAll('.zone-event-banner').forEach(banner => {
            const label = banner.querySelector('.zeb-label')?.textContent.trim() || '';
            const timer = banner.querySelector('.zeb-timer')?.textContent.trim() || '';
            if (!label) return;
            zones.forEach(z => z.events.forEach(ev => {
                if (ev.label.toLowerCase().includes(label.toLowerCase()) ||
                    label.toLowerCase().includes(ev.label.toLowerCase())) {
                    ev.timer = timer;
                }
            }));
        });

        // Mark genuinely new events (not seen in any previous poll)
        zones.forEach(z => z.events.forEach(ev => {
            const key = z.name + ':' + ev.cls;
            if (!_seenEventKeys.has(key)) {
                ev.isNew = true;
                _seenEventKeys.add(key);
            }
        }));

        return zones;
    }

    // Event type → colour
    const EVT_COLORS = {
        evt_gold_rush:      '#c6a85c',
        evt_wild_monsters:  '#ee8866',
        evt_xp_surge:       '#5DCAA5',
        evt_drop_frenzy:    '#a78bfa',
    };
    function evtColor(cls) {
        return EVT_COLORS[cls.replace('-','_')] || '#7F77DD';
    }

    function renderHomeTab(body) {
        body.innerHTML = '';
        const zones  = scrapeZoneEvents();
        const active = zones.find(z => z.isActive);
        const events = zones.filter(z => z.events.length > 0);

        // ── Current zone card ──
        if (active) {
            const card = mkEl('div','');
            card.style.cssText = 'background:#0a0a18;border:1px solid #7F77DD;border-radius:6px;padding:9px 11px;display:flex;flex-direction:column;gap:4px;';
            const top = mkEl('div','');
            top.style.cssText = 'display:flex;align-items:center;gap:6px;';
            const icon = mkEl('span',''); icon.textContent = '📍'; icon.style.fontSize = '13px';
            const nameEl = mkEl('span',''); nameEl.textContent = active.name;
            nameEl.style.cssText = 'font-size:12px;font-weight:700;color:#c0b8ff;flex:1;';
            const tierEl = mkEl('span',''); tierEl.textContent = active.tier;
            tierEl.style.cssText = 'font-size:9px;color:#555;background:#111120;padding:1px 5px;border-radius:4px;';
            top.append(icon, nameEl, tierEl);
            card.appendChild(top);

            const meta = mkEl('div','');
            meta.style.cssText = 'display:flex;gap:10px;font-size:10px;color:#666;';
            if (active.levels) { const s=mkEl('span',''); s.textContent='⚔ '+active.levels; meta.appendChild(s); }
            if (active.players){ const s=mkEl('span',''); s.textContent='👥 '+active.players+' online'; meta.appendChild(s); }
            if (active.bonus)  { const s=mkEl('span',''); s.textContent='★ '+active.bonus+' XP'; s.style.color='#5DCAA5'; meta.appendChild(s); }
            card.appendChild(meta);

            // Active events in current zone
            active.events.forEach(ev => {
                const evEl = mkEl('div','');
                const col = evtColor(ev.cls);
                evEl.style.cssText = `font-size:10px;padding:3px 7px;border-radius:4px;background:${col}22;border:1px solid ${col}55;color:${col};margin-top:2px;`;
                evEl.textContent = '⚡ '+ev.label;
                evEl.title = ev.desc;
                card.appendChild(evEl);
            });

            body.appendChild(card);
        } else {
            const msg = mkEl('div','');
            msg.style.cssText = 'font-size:10px;color:#444;font-style:italic;text-align:center;padding:8px;';
            msg.textContent = 'Open the Combat zone list to see your current zone';
            body.appendChild(msg);
        }

        // ── Session rates ──
        body.appendChild(mkDivider());

        const xpRate    = ratePerHour(state.session.xp);
        const goldRate  = ratePerHour(state.session.gold);
        const shardRate = ratePerHour(state.session.shards);
        const kph       = killsPerHour();
        const fragRate  = ratePerHour(state.session.frags);

        const sessionHdr = mkEl('div','');
        sessionHdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
        sessionHdr.appendChild(mkEl('span','qol-session-bar','')); // spacer

        const bar = mkEl('div','qol-session-bar');
        bar.appendChild(mkEl('span','','Session'));
        bar.appendChild(mkEl('span','qol-session-time', formatDuration(Date.now()-state.session.startTime)));
        const pollSec = Math.round(POLL_MS/1000);
        const sliderWrap = mkEl('div','');
        sliderWrap.style.cssText = 'display:flex;align-items:center;gap:5px;margin-left:auto;';
        const sliderIcon = mkEl('span',''); sliderIcon.textContent='⏱'; sliderIcon.style.cssText='font-size:11px;opacity:.7;';
        const slider = document.createElement('input');
        slider.type='range'; slider.min='1'; slider.max='10'; slider.step='1';
        slider.value=Math.min(10,Math.max(1,pollSec));
        slider.style.cssText='width:80px;height:3px;accent-color:#7F77DD;cursor:pointer;';
        const sliderLbl = mkEl('span',''); sliderLbl.style.cssText='font-size:10px;color:#7F77DD;font-weight:700;min-width:26px;';
        sliderLbl.textContent=slider.value+'s';
        slider.addEventListener('input',()=>{ sliderLbl.textContent=slider.value+'s'; });
        slider.addEventListener('change',()=>{ if(window._shawzRestartPoll) window._shawzRestartPoll(parseInt(slider.value)*1000); });
        sliderWrap.append(sliderIcon,slider,sliderLbl);
        bar.appendChild(sliderWrap);
        const resetBtn = mkEl('button','qol-reset-btn','↺ Reset');
        resetBtn.addEventListener('click',()=>{
            state.session.startTime=Date.now();
            ['xp','gold','shards','kills','frags'].forEach(k=>state.session[k]=[]);
            try{localStorage.removeItem(SESSION_KEY);}catch(e){}
            renderHomeTab(body);
        });
        bar.appendChild(resetBtn);
        body.appendChild(bar);

        function rateCard(cls, label, val) {
            const card = mkEl('div','qol-rate-card '+cls);
            card.appendChild(mkEl('div','qol-rate-label', label));
            card.appendChild(mkEl('div','qol-rate-val',   val));
            return card;
        }

        const rates = mkEl('div','qol-rates');
        rates.appendChild(rateCard('xp',   'XP / hr',     xpRate===null    ?'—':formatRate(xpRate,1),    state.session.xp));
        rates.appendChild(rateCard('gold',  'Gold / hr',   goldRate===null  ?'—':formatRate(goldRate,1),  state.session.gold));
        rates.appendChild(rateCard('shard', 'Shards / hr', shardRate===null ?'—':formatRate(shardRate,1), state.session.shards));
        rates.appendChild(rateCard('kills', 'Kills / hr',  kph>0?Math.round(kph).toString():'—',          state.session.kills));
        rates.appendChild(rateCard('frags', 'Frags / hr',  fragRate!==null  ?formatRate(fragRate,1):'—',  state.session.frags));
        body.appendChild(rates);

        // ── Level progress bar ──
        const xpEl = document.querySelector('.pb-xp-raw');
        const lvEl = document.querySelector('.pb-level');
        if (xpEl && lvEl) {
            const m = xpEl.textContent.match(/([\d,]+)\s*\/\s*([\d,]+)/);
            const lv = parseInt(lvEl.textContent.replace(/\D/g,'')) || 0;
            if (m && lv) {
                const cur = parseNum(m[1]), tot = parseNum(m[2]);
                const pct = tot > 0 ? Math.round((cur/tot)*100) : 0;
                const xpLeft = tot - cur;
                const ttl = xpRate && xpRate > 0
                    ? (() => { const h = xpLeft/xpRate; return h<1 ? Math.round(h*60)+'m' : h.toFixed(1)+'h'; })()
                    : null;
                const lvBar = mkEl('div','qol-lvl-bar');
                const lvTop = mkEl('div','qol-lvl-top');
                lvTop.appendChild(mkEl('span','qol-lvl-lbl','Lv '+lv+' → '+(lv+1)));
                if (ttl) lvTop.appendChild(mkEl('span','qol-lvl-ttl','⏱ '+ttl+' to level'));
                const track = mkEl('div','qol-lvl-track');
                const fill  = mkEl('div','qol-lvl-fill');
                fill.style.width = pct+'%';
                track.appendChild(fill);
                const sub = mkEl('div','qol-lvl-sub');
                sub.appendChild(mkEl('span','',pct+'% complete'));
                sub.appendChild(mkEl('span','',formatRate(tot-cur,0)+' XP remaining'));
                lvBar.append(lvTop, track, sub);
                body.appendChild(lvBar);
            }
        }
        if (events.length) {
            body.appendChild(mkDivider());
            const evHdr = mkEl('div','');
            evHdr.style.cssText = 'font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.07em;font-weight:700;margin-bottom:6px;';
            evHdr.textContent = '⚡ Active zone events';
            body.appendChild(evHdr);

            events.forEach(z => {
                z.events.forEach(ev => {
                    const col = evtColor(ev.cls);
                    const row = mkEl('div', ev.isNew ? 'invf-evt-new' : '');
                    row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;background:${col}18;border:1px solid ${col}44;margin-bottom:4px;`;

                    const evName = mkEl('span','');
                    evName.style.cssText = `font-size:10px;font-weight:700;color:${col};flex-shrink:0;`;
                    evName.textContent = ev.label;

                    const zoneName = mkEl('span','');
                    zoneName.style.cssText = 'font-size:10px;color:#aaa;flex:1;';
                    zoneName.textContent = z.name+' ('+z.tier+')';

                    const right = mkEl('div','');
                    right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;';

                    if (ev.timer) {
                        const timerEl = mkEl('span','');
                        timerEl.style.cssText = `font-size:9px;font-weight:700;color:${col};`;
                        timerEl.textContent = '⏱ '+ev.timer;
                        right.appendChild(timerEl);
                    }
                    if (z.players > 0) {
                        const pEl = mkEl('span','');
                        pEl.style.cssText = 'font-size:9px;color:#555;';
                        pEl.textContent = '👥 '+z.players;
                        right.appendChild(pEl);
                    }

                    row.append(evName, zoneName, right);
                    row.title = ev.desc;
                    body.appendChild(row);
                });
            });
        } else if (zones.length) {
            body.appendChild(mkDivider());
            const noEv = mkEl('div','');
            noEv.style.cssText = 'font-size:10px;color:#333;text-align:center;font-style:italic;padding:4px;';
            noEv.textContent = 'No active zone events';
            body.appendChild(noEv);
        }
    }


    // ─── HELPERS ──────────────────────────────────────────────────────────────
    function mkEl(tag,cls,text){
        const e=document.createElement(tag);
        if(cls) e.className=cls;
        if(text!==undefined) e.textContent=text;
        return e;
    }
    function mkDivider(){ return mkEl('div','invf-divider'); }

    // ─── DRAG & RESIZE ────────────────────────────────────────────────────────
    function makeDraggable(c,h){
        let on=false,sx,sy,sl,st;
        h.addEventListener('mousedown',e=>{ if(e.button!==0)return; on=true; sx=e.clientX; sy=e.clientY; const r=c.getBoundingClientRect(); sl=r.left; st=r.top; e.preventDefault(); });
        document.addEventListener('mousemove',e=>{ if(!on)return; const nl=sl+(e.clientX-sx),nt=st+(e.clientY-sy); const r=c.getBoundingClientRect(); const maxL=window.innerWidth-80,maxT=window.innerHeight-40,minL=-r.width+80,minT=0; const cl=Math.min(maxL,Math.max(minL,nl)),ct=Math.min(maxT,Math.max(minT,nt)); c.style.left=cl+'px'; c.style.top=ct+'px'; state.layout.x=cl; state.layout.y=ct; save(); });
        document.addEventListener('mouseup',()=>on=false);
    }
    function makeResizable(c,h){
        let on=false,sx,sy,sw,sh;
        h.addEventListener('mousedown',e=>{ if(e.button!==0)return; on=true; sx=e.clientX; sy=e.clientY; const r=c.getBoundingClientRect(); sw=r.width; sh=r.height; e.preventDefault(); });
        document.addEventListener('mousemove',e=>{ if(!on)return; const nw=Math.max(300,sw+(e.clientX-sx)),nh=Math.max(100,sh+(e.clientY-sy)); c.style.width=nw+'px'; c.style.height=nh+'px'; state.layout.width=nw; state.layout.height=nh; save(); });
        document.addEventListener('mouseup',()=>on=false);
    }

    // ─── OBSERVERS ────────────────────────────────────────────────────────────
    let debounce=null;
    let suppressObserver = false;

    function scheduleApply(){
        if (suppressObserver) return;
        bustCache();
        clearTimeout(debounce);
        debounce=setTimeout(apply,400);
    }

    function setupObservers(){
        // Re-apply highlights after click or hover on a bag item.
        // Suppress the observer while the game's handlers are running.
        function suppressAndApply() {
            suppressObserver = true;
            setTimeout(() => {
                apply();
                setTimeout(() => { suppressObserver = false; }, 300);
            }, 50);
        }

        document.addEventListener('click', e => {
            if (e.target.closest('.bag-grid .item-slot')) suppressAndApply();
        }, true);

        document.addEventListener('mouseenter', e => {
            if (e.target.closest && e.target.closest('.bag-grid .item-slot'))
                suppressAndApply();
        }, true);

        // Leaderboard observer — scrape DOM when visible AND trigger API fetch
        new MutationObserver(() => {
            if (document.querySelector('.lb-table')) {
                scrapeLeaderboard();
            }
        }).observe(document.body, { childList:true, subtree:true });

        // Also scrape on lb-cat-btn clicks (category change)
        document.addEventListener('click', e => {
            if (e.target.classList.contains('lb-cat-btn') ||
                e.target.classList.contains('lb-group-btn')) {
                setTimeout(scrapeLeaderboard, 300);
            }
        });

        // ── mab-bar popover observer ──────────────────────────────────────────
        if (!window._shawzMabCache) window._shawzMabCache = { skills:{}, imbues:[], auraMpPer5s:0 };
        let _lastMabPopoverSig = '';
        new MutationObserver(() => {
            const popover = document.querySelector('.mab-popover');
            if (!popover) { _lastMabPopoverSig = ''; return; }
            const titleEl  = popover.querySelector('.mab-popover-title');
            const descText = popover.querySelector('.mab-ability-desc')?.textContent || '';
            const titleText = titleEl?.textContent?.trim() || '';
            const sig = titleText + '|' + descText.slice(0, 40);
            if (sig === _lastMabPopoverSig) return;
            _lastMabPopoverSig = sig;

            // Extract ability name — text node after the icon span e.g. " Crescendo III"
            const nameFromTitle = [...(titleEl?.childNodes||[])]
                .filter(n => n.nodeType === 3 && n.textContent.trim().length > 0)
                .map(n => n.textContent.trim())
                .find(t => t.length > 0) || titleText.replace(/^\S+\s*/, '').trim();

            const manaM = descText.match(/(\d+)\s*mana/i);
            const cdEl  = popover.querySelector('.mab-ability-pick-cd');
            const cdM   = cdEl?.textContent.match(/([\d.]+)s/);
            const isOn  = popover.querySelector('.mab-toggle.on') !== null;
            const isImbue = titleText.startsWith('Imbue');
            const isAura  = titleText === 'Aura';

            if (manaM && cdM && !isImbue && !isAura) {
                const key = nameFromTitle || titleText;
                if (isOn) {
                    window._shawzMabCache.skills[key] = { cost: parseFloat(manaM[1]), cd: parseFloat(cdM[1]) };
                } else {
                    delete window._shawzMabCache.skills[key];
                }
                _log('[mab] skill:', key, window._shawzMabCache.skills[key]);
            }

            const imbueRows = popover.querySelectorAll('.mab-aura-row');
            if (imbueRows.length && isImbue && !_lastMabPopoverSig.includes('__imbuedone')) {
                _lastMabPopoverSig += '__imbuedone';
                window._shawzMabCache.imbues = [...imbueRows]
                    .filter(r => r.querySelector('.mab-aura-active'))
                    .map(r => r.getAttribute('title') || r.querySelector('.mab-aura-name')?.textContent?.trim())
                    .filter(Boolean);
                _log('[mab] imbues:', window._shawzMabCache.imbues);
            }

            if (isAura) {
                const selAura = popover.querySelector('.mab-aura-row.sel');
                const effect  = selAura?.querySelector('.mab-aura-effect')?.textContent || '';
                const mpM     = effect.match(/([\d.]+)%?\s*MP\/5s/i);
                window._shawzMabCache.auraMpPer5s = mpM
                    ? (effect.includes('%') ? { pct: parseFloat(mpM[1]) } : { flat: parseFloat(mpM[1]) })
                    : 0;
                _log('[mab] aura:', window._shawzMabCache.auraMpPer5s);
            }
        }).observe(document.body, { childList:true, subtree:true });

        // Inventory changes — skip tooltip elements and our own panel
        new MutationObserver(muts=>{
            if (suppressObserver) return;
            for(const m of muts){
                if(m.target.closest&&m.target.closest('#invf-panel')) continue;
                const target = m.target;
                const cls = (target.className||'') + (m.addedNodes.length ? [...m.addedNodes].map(n=>n.className||'').join('') : '');
                // Skip tooltip appearances
                if (/item-tooltip|item.?tip/i.test(cls)) continue;
                // Skip class/style changes on item slots — these are hover/click effects.
                // Only bust cache for structural changes (items added/removed).
                if (m.type === 'attributes' && target.classList?.contains('item-slot')) continue;
                if (m.type === 'childList' && m.addedNodes.length === 0 && m.removedNodes.length === 0) continue;
                // Structural change — bust cache so new items get inferred
                const isStructural = m.type === 'childList' &&
                    ([...m.addedNodes,...m.removedNodes].some(n =>
                        n instanceof HTMLElement && (n.classList?.contains('item-slot') || n.classList?.contains('bag-grid') || n.classList?.contains('bag-category'))
                    ));
                if (isStructural) {
                    scheduleApply(); // includes bustCache
                } else {
                    // Style/class change elsewhere — re-apply highlights but don't clear cache
                    clearTimeout(debounce);
                    debounce = setTimeout(apply, 400);
                }
                return;
            }
        }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});

        // Tooltip watcher — updates tipCache when a bag item is hovered.
        // Uses parseStaticTooltip (not parseTip) to correctly exclude the
        // .tt-equipped-compare section inside the tooltip wrap.
        new MutationObserver(muts=>{
            for(const m of muts) for(const n of m.addedNodes){
                if(!(n instanceof HTMLElement)) continue;
                const cls = n.className || '';
                if(!/item-tooltip-wrap/i.test(cls)) continue;

                const hovered = document.querySelector('[data-invf-ready]:hover')
                    || document.querySelector('.item-slot:hover');
                if(!hovered) continue;

                const slotId = hovered.dataset.invfSlotId;
                const conds  = state.slotConfig[slotId]?.conditions || [];
                const needsTip = conds.some(c => c.type==='hasStat' || c.type==='statQuality' || c.type==='subtier');
                if (!needsTip) continue;

                // Use parseStaticTooltip which correctly scopes to the bag item
                // and excludes .tt-equipped-compare / .tt-lost-block sections
                const parsed = parseStaticTooltip(n);
                if (parsed.bonusStats.length > 0) {
                    setTipData(hovered, {
                        subtierLv:  parsed.subtierLv,
                        bonusStats: parsed.bonusStats,
                        qualities:  parsed.qualities,
                        forge:      '',
                    });
                    setTimeout(apply, 80);
                }
            }
        }).observe(document.body,{childList:true,subtree:true});

        // Kill observer
        setupKillObserver();

        // Poll session rates every 10s
        let pollTimer = setInterval(pollSession, POLL_MS);
        pollSession();
        // Allow interval to be changed at runtime
        window._shawzRestartPoll = (ms) => {
            POLL_MS = ms;
            clearInterval(pollTimer);
            pollTimer = setInterval(pollSession, POLL_MS);
            try { localStorage.setItem('shawz_poll_ms', ms); } catch(e) {}
        };

        // Fast berserk loop — runs every 500ms independent of session poll.
        // Updates zerk state and patches the DOM in-place without re-rendering.
        setInterval(() => {
            readBerserkStates();
            applyWeaponPortraits();
            sampleLiveMana();

            // Patch existing zerk rows in the team tab without full re-render
            if (state.activeTab !== 'team') return;

            // In zerk mode — patch cards in-place to preserve active CSS transitions
            if (state.zerkMode) {
                const body = document.getElementById('invf-body');
                if (!body) return;
                const cards = [...body.querySelectorAll('[data-zerk-name]')];
                if (!cards.length) {
                    // No cards yet — do initial render
                    renderTeamTab(body);
                    return;
                }
                cards.forEach(card => {
                    const name = card.getAttribute('data-zerk-name');
                    const m    = state.party[name];
                    if (!m) return;
                    const zerk = m.zerk || null;
                    const zs   = zerk ? (zerk.active ? 'active' : zerk.pct >= 100 ? 'ready' : 'charging') : 'none';
                    const pct  = zerk ? Math.min(100, zerk.pct) : 0;
                    const fill = card.querySelector('[data-zerk-fill]');
                    const valEl = card.querySelector('[data-zerk-val]');
                    const lblEl = card.querySelector('[data-zerk-lbl]');
                    const alreadyActive = fill?.getAttribute('data-zerk-state') === 'active';

                    // Update border
                    card.style.borderColor = zs==='active' ? '#9944ee55' : zs==='ready' ? '#9944ee44' : m.isSelf ? '#3a2e08' : '#1a1a2e';

                    // Update fill — skip if already animating active depletion
                    if (fill) {
                        if (zs === 'active' && alreadyActive) {
                            // CSS transition running — leave fill alone, just update text
                        } else if (zs === 'active') {
                            fill.setAttribute('data-zerk-state','active');
                            fill.style.width = pct.toFixed(1)+'%';
                            fill.style.background = 'linear-gradient(90deg,#0a0520,#1d0a55,#4d1aaa,#7722cc)';
                            fill.style.backgroundSize = '';
                            fill.style.animation = '';
                            // Create or reuse edge element
                            let edge = card.querySelector('[data-zerk-edge]');
                            if (!edge) {
                                edge = document.createElement('div');
                                edge.setAttribute('data-zerk-edge','');
                                edge.style.cssText = 'position:absolute;top:3px;bottom:3px;width:3px;border-radius:2px;background:#aa44ff;animation:void-edge-pulse 1.5s ease-in-out infinite;pointer-events:none;z-index:2;';
                                card.appendChild(edge);
                            }
                            if (zerk.secsLeft != null && zerk.secsLeft > 0) {
                                requestAnimationFrame(() => requestAnimationFrame(() => {
                                    const cardW = card.offsetWidth;
                                    edge.style.left = (cardW * pct / 100 - 2) + 'px';
                                    fill.style.transition = `width ${zerk.secsLeft}s linear`;
                                    edge.style.transition = `left ${zerk.secsLeft}s linear`;
                                    fill.style.width = '0%';
                                    edge.style.left = '-4px';
                                }));
                            } else {
                                requestAnimationFrame(() => {
                                    edge.style.left = (card.offsetWidth * pct / 100 - 2) + 'px';
                                });
                            }
                        } else if (zs === 'ready') {
                            // Remove edge if transitioning away from active
                            card.querySelector('[data-zerk-edge]')?.remove();
                            fill.setAttribute('data-zerk-state','ready');
                            fill.style.transition = '';
                            fill.style.animation = 'void-glow 2.5s ease-in-out infinite';
                            fill.style.width = '100%';
                            fill.style.background = 'rgba(153,68,238,.22)';
                            fill.style.backgroundSize = '';
                        } else {
                            card.querySelector('[data-zerk-edge]')?.remove();
                            fill.setAttribute('data-zerk-state','charging');
                            fill.style.transition = 'width 0.4s ease';
                            fill.style.animation = '';
                            fill.style.width = pct.toFixed(1)+'%';
                            fill.style.background = 'linear-gradient(90deg,#0d0820,#1a0d3d)';
                            fill.style.backgroundSize = '';
                        }
                    }

                    // Update text
                    if (valEl) {
                        valEl.style.color = zs==='active' ? '#cc88ff' : zs==='ready' ? '#aa44ff' : '#2a1a55';
                        valEl.textContent = zs==='active' && zerk.secsLeft != null
                            ? zerk.secsLeft+'s' : zs==='ready' ? 'READY' : zs==='none' ? '—' : Math.round(pct)+'%';
                    }
                    if (lblEl) {
                        lblEl.style.color = zs==='active' ? '#7722cc' : zs==='ready' ? '#6611bb' : '#1a0d33';
                        lblEl.textContent = 'BERSERK' + (zs!=='charging'&&zs!=='none' ? ' ⚡' : '');
                    }
                });
                return;
            }
            document.querySelectorAll('.qol-player-card').forEach(card => {
                const nameEl = card.querySelector('.qol-player-name');
                if (!nameEl) return;
                const name = nameEl.childNodes[0]?.textContent?.trim();
                if (!name) return;
                const zerk = state.party[name]?.zerk;
                const zerkState = zerk
                    ? (zerk.active ? 'active' : zerk.pct >= 100 ? 'ready' : 'charging')
                    : 'none';

                // Update card border animation class
                card.classList.remove('zerk-ready','zerk-active');
                if (zerkState === 'ready')  card.classList.add('zerk-ready');
                if (zerkState === 'active') card.classList.add('zerk-active');

                // Update or create zerk row
                let zRow = card.querySelector('.qol-zerk-row');
                if (!zerk || zerkState === 'none') {
                    zRow?.remove();
                    return;
                }
                if (!zRow) {
                    zRow = document.createElement('div');
                    zRow.className = 'qol-zerk-row';
                    card.appendChild(zRow);
                }

                // If already animating active depletion, don't rebuild — let the CSS
                // transition run uninterrupted. Only rebuild on state change.
                const existingFill = zRow?.querySelector('.qol-zerk-fill');
                const alreadyActive = existingFill?.classList.contains('active');
                if (alreadyActive && zerkState === 'active') {
                    // Just update the timer text, leave the bar alone
                    const pctEl = zRow.querySelector('.qol-zerk-pct');
                    if (pctEl && zerk.secsLeft !== null) pctEl.textContent = zerk.secsLeft+'s';
                    return;
                }

                const cls = zerkState !== 'charging' ? ' '+zerkState : '';
                const pctTxt = zerkState === 'active'
                    ? (zerk.secsLeft !== null ? zerk.secsLeft+'s' : '…')
                    : Math.round(zerk.pct)+'%';

                zRow.innerHTML = '';
                zRow.className = 'qol-zerk-row';

                const zIcon = document.createElement('span');
                zIcon.className = 'qol-zerk-icon'+cls;
                zIcon.textContent = '⚡';

                const zLbl = document.createElement('span');
                zLbl.className = 'qol-zerk-lbl'+cls;
                zLbl.textContent = 'Berserk';

                const zTrk = document.createElement('div');
                zTrk.className = 'qol-zerk-track';
                const zFill = document.createElement('div');
                zFill.className = 'qol-zerk-fill'+cls;

                if (zerkState === 'active' && zerk.secsLeft !== null && zerk.secsLeft > 0) {
                    // Set starting width with no transition, append, then use double-rAF
                    // to guarantee the browser has painted before starting the transition
                    const startPct = Math.min(100, zerk.pct).toFixed(1)+'%';
                    const dur = zerk.secsLeft;
                    zFill.style.width = startPct;
                    zTrk.appendChild(zFill);
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        zFill.style.transition = `width ${dur}s linear`;
                        zFill.style.width = '0%';
                    }));
                } else {
                    zFill.style.transition = 'width 0.4s ease';
                    zFill.style.width = Math.min(100, zerk.pct).toFixed(1)+'%';
                    zTrk.appendChild(zFill);
                }

                // Show timer when active, % when charging/ready. No separate badge.
                const zPct = document.createElement('span');
                zPct.className = 'qol-zerk-pct'+cls;
                zPct.textContent = pctTxt;

                // READY badge only — no timer badge (timer shown in pct label)
                zRow.append(zIcon, zLbl, zTrk, zPct);
                if (zerkState === 'ready') {
                    const badge = document.createElement('span');
                    badge.className = 'qol-zerk-badge ready';
                    badge.textContent = 'READY';
                    zRow.appendChild(badge);
                }
            });
        }, 500);


        // Poll skills + self stats every 30s (CDR gear changes cooldowns)
        setInterval(() => {
            scrapeSelfStats();
            if (state.activeTab === 'team') {
                renderTeamTab(document.getElementById('invf-body'));
            }
        }, 30000);
    }

    // ─── INIT ─────────────────────────────────────────────────────────────────
    function init(){
        loadPersist();
        applySettings();
        injectStyles();
        buildPanel();
        setupObservers();
        apply();
    }

    const _log = (...a) => console.log('[SHaWZ]', ...a);
    const _warn = (...a) => console.warn('[SHaWZ]', ...a);

    let _initDone = false;
    function tryInit() {
        if (_initDone) return;
        if (!document.body || !document.head) {
            _warn('tryInit: body/head not ready yet');
            return;
        }
        _initDone = true;
        clearInterval(_initWait);
        _log('init starting — triggers:', {
            inv_panel:    !!document.querySelector('.inv-panel'),
            cc_party:     !!document.querySelector('.cc-party-grid'),
            sb_item:      !!document.querySelector('.sb-item'),
            root:         !!document.querySelector('#root'),
            readyState:   document.readyState,
        });
        init();
    }

    const _initWait = setInterval(() => {
        if (document.querySelector('.inv-panel') ||
            document.querySelector('.cc-party-grid') ||
            document.querySelector('.sb-item') ||
            document.querySelector('#root') ||
            document.readyState === 'complete') {
            tryInit();
        }
    }, 500);

    setTimeout(tryInit, 10000);

})();
