# Deployment

## Recommended v1 setup

- Host the frontend on Netlify.
- Host the realtime server on Railway or Render as a regular Node.js web service.
- Keep one backend instance while game state is in memory.

## Node version

The Node version is pinned in `.node-version` at the repo root. Netlify, Render and
GitHub Actions all read that one file, so CI and production cannot drift apart.

Node 22 is not arbitrary. The floor comes from the dependencies: `vite` and
`@vitejs/plugin-react` require `^20.19.0 || >=22.12.0`, `concurrently` requires
`>=22` and rules out Node 20, and `vitest` rules out Node 23. `engines.node` in
`package.json` mirrors this as `^22.12.0`.

Two things to know when changing it:

- On Render, a `NODE_VERSION` environment variable set in the dashboard **overrides**
  `.node-version`. If you pin a version and it has no effect on the backend, look
  there first.
- `@types/node` tracks Node major versions, so it must be bumped together with
  `.node-version`. Dependabot is configured to ignore its major updates for exactly
  this reason (see `.github/dependabot.yml`).

## Frontend: Netlify

Build command:

```sh
npm run build
```

Publish directory:

```sh
dist
```

Environment variables:

```sh
VITE_SERVER_URL=https://your-server.example.com
```

## Backend: Railway or Render

Build command:

```sh
npm run build:server
```

Start command:

```sh
npm start
```

Environment variables:

```sh
FRONTEND_URL=https://your-netlify-site.netlify.app
PORT=<provided by host>
```

`PORT` is normally injected by the hosting platform. Do not hardcode it.

## Current limitation

Active games are stored in memory on the Node.js process. If the backend restarts,
active lobbies and games disappear. That is acceptable for v1, but it means the
backend should not autoscale horizontally until persistence or shared state is
added.
