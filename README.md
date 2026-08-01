# Flappy Monkey

The public desktop and installable mobile/web client for Flappy Monkey.

## Install on mobile

Open the GitHub Pages address in your phone browser, then:

- **Android:** tap **Install Mobile App** in the game, or use the browser menu and choose **Install app**.
- **iPhone/iPad:** open the game in Safari, tap **Share**, then choose **Add to Home Screen**.

The installed Progressive Web App opens full-screen and uses the same online account and multiplayer server as the PC game, so synchronized progress and items carry between platforms. Guest/offline progress remains local to that device.

## Private server boundary

This public repository intentionally excludes multiplayer server source, account databases, local configuration, credentials, test utilities, and deployment secrets. The browser client contains only the public WebSocket address; private values are configured in the server host's environment.
