# Discord and Render setup

This is the later setup checklist for the Flappy Monkey owner. Values marked **secret** belong only in Render environment variables. Never paste them into chat and never commit them.

## 1. Discord Developer Portal

1. Open the Discord Developer Portal and create (or choose) the application dedicated to Flappy Monkey Control Panel.
2. On **OAuth2**, add this exact redirect URL:
   `https://flappy-monkey-server.onrender.com/cheat-auth/callback`
3. Copy the Application ID. This is the OAuth client ID and is not secret.
4. The current browser-token authorization flow does not require the OAuth client secret. If an older setup already has one in Render, it can remain hidden, but the Control Panel does not use it.
5. On **Bot**, create the bot if needed and copy/reset its bot token. This is **secret**.
6. On the same **Bot** page, enable **Server Members Intent**. This lets role additions/removals update the Control Panel within a few seconds instead of waiting for a REST refresh.
7. Add the bot to the correct Flappy Monkey server. It only needs to read the guild member and role information used by the authorization server. It does not need Administrator.

## 2. Copy Discord IDs

Enable Developer Mode in Discord under **User Settings → Advanced**. In the correct server:

1. Right-click the server icon and choose **Copy Server ID**.
2. Right-click each authorized role in **Server Settings → Roles** and copy its role ID:
   - Flappy Monkey Developer
   - Flappy Monkey Admin
   - Flappy Monkey Exploiter

Using IDs prevents a renamed lookalike role from granting access.

## 3. Render environment variables

Open the private Flappy Monkey server service in Render, then add:

| Variable | Value |
|---|---|
| `DISCORD_CHEAT_CLIENT_ID` | Discord Application ID |
| `DISCORD_CHEAT_CLIENT_SECRET` | Legacy OAuth secret; no longer required by the browser-token flow |
| `DISCORD_GUILD_ID` | Correct Flappy Monkey Server ID |
| `DISCORD_BOT_TOKEN` | Discord bot token (**secret**) |
| `CHEAT_AUTH_SIGNING_SECRET` | A new random secret of at least 32 bytes (**secret**) |
| `DISCORD_CHEAT_REDIRECT_URI` | `https://flappy-monkey-server.onrender.com/cheat-auth/callback` |
| `DISCORD_CHEAT_ROLE_IDS` | The three copied role IDs separated by commas |
| `DISCORD_CHEAT_ROLE_NAMES` | `Flappy Monkey Developer,Flappy Monkey Admin,Flappy Monkey Exploiter` |
| `DISCORD_CHEAT_INVITE_URL` | `https://discord.gg/HCmAVTNtNe` |
| `DISCORD_CHEAT_OWNER_DISCORD_ID` | Discord User ID linked to the existing `OWNER_USER_ID` |
| `DISCORD_CHEAT_ACCOUNT_LINKS` | Optional non-owner links such as `DISCORD_ID=FMU_ID,DISCORD_ID=FMU_ID` |
| `DISCORD_CHEAT_MEMBER_EVENTS` | Optional: set to `true` only after enabling Discord's **Server Members Intent** for near-immediate role changes |
| `DISCORD_CHEAT_ROLE_AUDIT_MS` | Optional REST safety audit interval; defaults to `120000` (two minutes) |

Generate `CHEAT_AUTH_SIGNING_SECRET` locally with a password manager or a cryptographically secure random generator. Do not reuse a Discord token, game password, or database password.

## 4. Deploy and verify

1. Deploy the updated private server bundle.
2. Open `https://flappy-monkey-server.onrender.com/health` and confirm the build includes `control-panel-v4.5`, `controlDeck.configured` is true, and `controlDeck.allowedRoleIdsConfigured` is `3`.
3. Open `https://flappy-monkey-server.onrender.com/cheat-api/status`. It should report `configured: true`, `guestAccess: false`, and the three approved role names.
4. Run the Python app and authorize the approved account.
5. Test a non-member Discord account. It must receive **Access denied**.
6. Test a current member without an approved role. It must receive **Access denied**.
7. Remove an approved role from a test account and press **Refresh Access**. The app must return to authorization and its live controls must reset.

The Control Panel is self-only. It derives the game account from the authenticated Discord ID and the owner/account-link variables above; client-supplied attempts to target a different player are rejected. The bot resolves every Discord role name, color, and role icon for display, but only `DISCORD_CHEAT_ROLE_IDS` grants access. Authorized roles are privileged staff roles, so protect them carefully.

Without `DISCORD_CHEAT_MEMBER_EVENTS=true`, the server still refreshes live role names/colors through Discord's non-privileged gateway events and audits each authorized session through Discord REST about every two minutes. With the optional member-events setting enabled, additions and removals normally appear within seconds. If Discord rejects the privileged intent, the server safely falls back to the non-privileged connection and keeps the REST audit active.
