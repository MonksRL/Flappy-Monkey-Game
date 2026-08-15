# Flappy Monkey Control Panel

`flappy_monkey_control_deck.py` is the separate Windows desktop control app for Flappy Monkey. It never contains the Discord OAuth secret, bot token, signing secret, or direct database credentials.

Access is denied unless the signed-in Discord account is currently in the Flappy Monkey server and currently has at least one of these roles:

- Flappy Monkey Developer
- Flappy Monkey Admin
- Flappy Monkey Exploiter

The server re-checks membership and roles during use. Leaving the server or losing every approved role signs the user out, blocks further requests, and clears live controls created by that Discord session. Otherwise the encrypted Windows session is restored automatically when the app reopens.

## Run it

1. Install Python 3.11 or newer from python.org. Enable **Add Python to PATH** during installation.
2. Optional: run `py -3 -m pip install -r requirements.txt` for Discord avatars and custom banner images.
3. Double-click `Run Control Panel.bat` or run `py -3 flappy_monkey_control_deck.py`.

The first screen opens the server-managed Discord authorization flow. No guest/offline bypass exists. The correct community invite is `https://discord.gg/HCmAVTNtNe`.

## What it controls

- Search and grant one exact item.
- Remove one exact item.
- Unlock all skins, all titles, one collection category, or the full collection.
- Add/remove Banana Coins, Monkey XP, Duel Coins, Duel XP, power-ups, and crate tickets.
- Automatically load only the signed-in Discord user's linked game account.
- Apply server-issued live controls to that linked account.
- Display the Discord avatar, user ID, server join date, all roles, highest approved role, and role-color badges.
- Customize the Control Panel's local profile banner and accent color.

The app is self-only: it has no target-player field and the server rejects attempts to modify another account. Individual grants and collection unlocks are saved before success is shown. If the game is closed, pending unlocks arrive the next time that account signs in. Live controls are restricted to supported solo, practice, and private play; public ranked modes do not use the hooks.

## Share it with approved staff

Double-click `Build Control Panel.bat` on the development PC. It installs the local packaging tools and creates this portable Windows app:

`dist\Flappy Monkey Control Panel.exe`

Distribute that EXE rather than the source folder. Windows may show an Unknown Publisher warning until the EXE is code-signed with a trusted Windows signing certificate; the build script cannot manufacture that certificate.

Each person authorizes their own Discord account and must be a current member of the configured Flappy Monkey server with an approved role. Add a server-side Discord-to-game link for every non-owner user with `DISCORD_CHEAT_ACCOUNT_LINKS` using `DISCORD_USER_ID=FMU_USER_ID` entries separated by commas. This mapping is what lets the app identify their game account without exposing a field that could target someone else.

## Local data

Settings are saved under `%LOCALAPPDATA%\FlappyMonkeyControlDeck`. The authorization token is protected with Windows DPAPI for the current Windows user.

Server configuration is documented in `SERVER-SETUP.md`. Never put any secret in this folder, a screenshot, Discord message, Git commit, or Codex chat.
