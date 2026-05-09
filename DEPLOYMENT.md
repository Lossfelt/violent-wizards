# Deployment

## Recommended v1 setup

- Host the frontend on Netlify.
- Host the realtime server on Railway or Render as a regular Node.js web service.
- Keep one backend instance while game state is in memory.

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
