# VEX IQ Builder

Build VEX IQ robots in your browser from the official parts. Place parts, snap them together, mesh gears, run chain and track, mirror one side to the other, and explode the build to see how it goes together.

**Try it:** https://adriangonsalves.github.io/vexiq-builder/

What the app does is in [features.md](features.md). Notes on how real pieces fit together are in [AGENTS.md](AGENTS.md).

## Use it offline

On the site, open **Settings → Offline** and turn on **Use offline**. It downloads the app and every part (about 94 MB), then shows how to install it: **Install app** in Chrome or Edge, or Share → **Add to Home Screen** on an iPad or iPhone (do this first there, then turn on Use offline inside the Home Screen app). When a new version is published, the app asks you to download it again. Builds are kept only in your browser, so use **File → Export** to keep a copy.

## Run it yourself

```
npm install
npm run dev        # the app, at http://localhost:5173
npm run mcp        # the MCP server, so an AI assistant can build with the same tools
npm run build:static   # plain files for any static host, into dist-static/
```

The converted part models are in `public/models/`. To add parts, put the STEP files in `VEX-IQ-All-Parts/`, then run `npm run convert` and `npm run index-metadata`.

## Credits and licence

The code is under the MIT licence (see [LICENSE](LICENSE)).

The part models in `public/models/`, and the part names and numbers in the catalog, come from the official VEX IQ CAD files and belong to VEX Robotics. This is a fan project with no connection to VEX Robotics. The models are included only so the builder works. If you are VEX Robotics and want them removed, open an issue and they will be taken down. The MIT licence covers the code, not the models.
