# Violent Wizards

Violent Wizards is a browser-based multiplayer game about hidden shield
frequencies, magical torpedoes, fragile alliances, and badly timed betrayal.

One player creates a lobby, shares a short code or QR link, and the rest join
from their own phones. The game is built for people playing in the same room,
with the app handling the hidden state, realtime combat, and exact information
sharing.

## Game Summary

Each wizard has:

- 200 health
- One hidden shield frequency
- Up to five Mados, magical torpedoes with their own frequencies
- Partial insight into other players' shield frequencies

Damage depends on how closely a Mado frequency matches the target's shield
frequency. Dealing damage gives the attacker more insight into the target's
shield, but only as narrowing segments on a circle, not exact numbers.

Each round has these phases:

1. Empty Mado slots are filled.
2. Players may discard unwanted Mados.
3. Living players choose whether to attack another player.
4. Matched battles resolve through simultaneous exchanges.
5. The round is cleaned up, deaths are applied, and the host starts the next
   round.

The last living wizard wins. If everyone dies at the same time, the game ends
in a draw.

## Tech Stack

- Vite
- React
- TypeScript
- Express
- Socket.IO
- Vitest

The server is authoritative. Clients do not own health, shield frequencies,
Mado frequencies, insight, or battle results.

## Local Development

Install dependencies:

```sh
npm install
```

Run frontend and backend together:

```sh
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

Useful commands:

```sh
npm run typecheck
npm test
npm run build
```

## Deployment

The recommended setup is:

- Frontend on Netlify
- Backend on Render or another regular Node.js host

The frontend needs:

```sh
VITE_SERVER_URL=https://your-backend-url
```

The backend needs:

```sh
FRONTEND_URL=https://your-netlify-url
```

Backend build command:

```sh
npm run build:server
```

Backend start command:

```sh
npm start
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the short deployment checklist.

## Current Limitation

Game state is stored in memory on the backend process. If the backend restarts,
active lobbies and games disappear. For the current version, run one backend
instance and avoid horizontal autoscaling until persistence or shared state is
added.
