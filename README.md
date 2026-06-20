# SHaWZ QoL Tracker

A quality-of-life addon for [voididle.com](https://voididle.com).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Click → [Install SHaWZ QoL Tracker](https://raw.githubusercontent.com/MattShawz/voididle-shawz-qol/main/shawz-qol-tracker.user.js)
3. Click **Install** in the Tampermonkey prompt

## Features

- 🏠 **Home tab** — session rates (XP/hr, Gold/hr, Shards/hr, Kills/hr, Frags/hr), level progress bar, active zone events
- 🔍 **Gear Finder** — highlight Best/Salvage items in your inventory based on configurable per-slot conditions. Supports Light and Heavy armor stat pools separately
- 👥 **Team tab** — party stats, berserk tracker with animated bar, mana regen breakdown, leaderboard ranks, weapon type icons
- Auto-updates via Tampermonkey

## Usage

- Open your inventory and click **Equipped** tab, then hold **⬇ Import Equipped** to set conditions from your gear
- Hold **🔍 Scan Bag** to classify all bag items
- On the Team tab, hold **↺ Players & Stats** to inspect party members, hold **↺ Leaderboard** to fetch rankings
- Drag the panel anywhere on screen — the ✦ minimise button is also draggable

## Changelog

## 1.3.0
- New "MMO" character page layout fully supported (.cv-mmo) — stats, weapon detection, attack speed and hit chance now read correctly regardless of which character UI layout is active
- Live mana tracking — mana flow is now measured directly from your actual mana bar instead of predicted from skill/aura/imbue costs, so mythic abilities and any other dynamic mana source are reflected automatically - with zero extra configuration
- Mana rate smoothing — one-off events (mythic mana procs, potions) are detected and excluded from the trend calculation so the displayed flow doesn't spike and crash; result is further smoothed with exponential averaging for a stable, readable number
- Mana deficit / OOM warning now uses the same live measured rate and current mana value instead of the old static prediction
- Settings tab (⚙) added — toggle buff description chips, buff icon row (both UIs), and weapon class portraits independently
- Weapon class portraits — replaces generic player art with class-specific artwork based on equipped weapon; includes a dedicated portrait for the Spear class's summoned Guardian pet
- Portrait rendering switched to an image overlay approach for reliability against the game's own UI re-renders
- Fixed weapon detection bleeding between party members during refresh (each player's data is now verified against the inspect modal's displayed name before being trusted)
- Fixed self weapon/stat scraping picking up data from an open inspect modal instead of your own character sheet
- Inspect refresh now stays on the Party panel for the full inspect loop instead of navigating away early, preventing stale reads
- Buff description chips and buff icon row can be hidden independently via Settings, with experimental UI support

### 1.2.1
- Experimental UI (mab-bar) support — skills, imbues and aura read via popover scrape during refresh
- Mab-bar popovers hidden during scrape so they don't visually appear
- Inspect modals and party panel hidden during refresh scrape
- Returns to combat view immediately after collecting inspect buttons
- Berserk zerk mode — compact toggleable view showing only players and berserk state
- Zerk mode uses void purple theme with static gradient fill and pulsing edge indicator
- Smooth berserk depletion via CSS transition synced to remaining seconds
- Location names removed from party cards, inspect button changed to 🔍
- Hold-to-execute buttons fixed — no longer fires on release without holding
- Viewport drag clamped — panel and reopen button cannot leave screen bounds
- Mana bar upgraded to stacked segment breakdown (skills, aura, imbues per source)
- Mana warning hidden in zerk mode
- Refresh speed improvements across player inspect, character scrape and leaderboard

### 1.2.0
- Berserk tracker — animated per-player bar with smooth depletion, glow states for ready and active
- Mana regen stacked breakdown bar showing skills, aura drain and imbue costs
- Imbue mana cost calculation including mana/hit imbues (Flame Edge, Venom Tip, Arcane Charge etc.)
- Experimental UI (mab-bar) support — refresh automatically reads skill costs, imbues and aura from popovers
- Leaderboard rank badges (overall level + weapon level) on Team tab
- Weapon type image icon pulled from equipped gear
- Level progress bar on Home tab with time-to-level estimate
- Viewport bounds clamping — panel can no longer be dragged off screen
- Hold-to-execute buttons fixed — no longer fires early on mouseleave
- Stat quality tracking per stat key (fixes positional mismatch bug)
- Bonus stat pool updated to match current game data per slot and armor type

### 1.1.0
- Added leaderboard rank + weapon type display on Team tab
- Berserk tracker with animated bar
- Home tab with zone events and session tracking
- Mana regen calculation including aura drain
