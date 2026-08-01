# Flappy Monkey v1.9.5

- Added and rebalanced Santa, Cowboy, Christmas Tree, Elf, Birthday Bash, Disco Ball, Gift, Candy Cane, Popcorn, Scuba, Flower Bloom, Rose, Soda, Boss Breaker, Dark Matter, and Glitch defenders across offline, Campaign, and Online Monkey Defense.
- Reworked Shark, Firework, Honey, Snow, Leprechaun, Easter, Egg Hunt, and Boxer abilities with finite durations, longer high-power cooldowns, improved effects, and offline/online parity.
- Fixed Birthday Bash Party Meter activation, one-click reward presents, Gift Monkey rewards, Candy Cane storms, Dark Matter pulling, and Singularity collapse behavior.
- Added the complete Monkey Defense Guide and updated the Power-Ups Guide.
- Fixed full progress resets, owner single/global resets, earned-XP removal, level-reward re-locking, guest persistence, offline resets, and owner grant/remove coverage for every cosmetic category.
- Added the Collection Index with live progress, search, locked previews, master rewards, owner-grant support, and exclusive Index Monkey, theme, title, VFX, animated pipe skin, XP, coins, and boost rewards.
- Replaced the Index Monkey artwork with the new emerald-and-gold sock monkey design.
- Updated Banana Market power-up, gift, and crate artwork plus crate-opening visuals.
- Fixed redeem-code Banana Coins so rewards add to the existing balance.
- Added simultaneous owner live events with compact, non-blocking event presentation.
- Added the lobby-only JADE heart Easter egg with an elegant reduced-motion-safe heart, ring, sparkle, and aurora effect that never displays the typed name.
- Fixed numerous menu overlaps, long reward names, profile/inventory icons, unlock popups, skin search selection, and other presentation issues.

## Flappy Monkey v1.9.4

- Recovered the permanent public User ID in the desktop profile even when an older reset removed the saved session and cached online profile.
- Added durable per-account identity caching so username and User ID survive future progress resets independently of gameplay progress.
- Added offline display-name and profile-picture saving; the authoritative online account profile synchronizes again after reconnecting.
- Added a packaged Electron regression test for the missing-profile recovery case.

## Flappy Monkey v1.9.3

- Moderately increased the in-match Bananas earned from defeated Invaders and cleared waves in Monkey Defense.
- Applied the same build-Banana balance to Online Monkey Defense.
- Slightly increased the Standard Monkey Defense Banana Coin Market Reward without restoring the old oversized payouts.

## Flappy Monkey v1.9.2

- Fixed Reset All Progress incorrectly clearing the saved login, username, profile picture, or User ID when the online server was unavailable.
- Kept queued offline account resets intact across the required game reload.

## Flappy Monkey v1.9.1

- Fixed complete progress resets so local XP/level, high scores, achievements, online ranks, redeemed codes, receipts, and unlocks stay reset after reload.
- Fixed User ID copy feedback on the player's own profile.
- Changed Birthday Bash countdowns to an hours/minutes/seconds display.
- Fixed friend/group message deletion and clear-chat resurrection caused by stale social snapshots.
- Fixed PC image attachments, retained multiple chat images, and compressed uploads before sending.
- Reduced Render bandwidth by sending unchanged chat images, profile pictures, and group icons only once per connection.
- Added a usable Play Offline action to the reconnect screen and spaced it safely beneath the loading bar.
- Configured Discord Rich Presence for the Flappy Monkey Discord application.

## Flappy Monkey v1.9.0

- Fixed message deletion, clear-chat behavior, and persistent image messages.
- Fixed saved login restoration, offline logout/reset, account input focus, and online/offline controls.
- Fixed ranked leave/forfeit results, match cleanup, tie protection, and the permanent Monkey King rank floor.
- Fixed Monkey World menu ownership, freezes, inventory opening, player visibility, building exits, and walkable routes.
- Added Birthday Bash Monkey, its annual server-authoritative event, menu background, countdown, and owner controls.
- Added Explosion VFX cosmetics plus XP, crate-luck, and revive boosts with shop, gifting, inventory, and owner-grant support.
- Fixed full progress resets, reusable redeem codes after reset, reset announcements, rank/XP clearing, and owner reset tools.
- Added public copyable User IDs with clear copied feedback.
- Replaced native Windows alert, confirmation, and prompt boxes with Flappy Monkey dialogs.
- Rebalanced Monkey Defense rewards, wave income, difficulty, ranges, abilities, weather, and defender ordering.
- Added Rock, Neon, Four Leaf Clover, Egg Hunt, BBQ, Electric, Easter, Sun, Leprechaun, Cracked, and Lightning defenders.
- Added the new defenders to themed Campaign rosters with weather buffs/debuffs in offline and online Defense.
- Added improved defender effects, finite earthquake shake, progression skins, and campaign/menu backgrounds.
- Added active-match leave and map-change warnings across game modes.
- Added optional Discord Rich Presence support, enabled by default in Settings.

## Previous

- Fixed crash when launching the built .exe.
- Removed auto-updater temporarily.
- General stability improvements.
