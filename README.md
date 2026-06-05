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
