# Violent Wizards

Violent Wizards is a browser-based multiplayer game about hidden shield
frequencies, magical torpedoes, fragile alliances, and badly timed betrayal.

One player creates a lobby, shares a short code or QR link, and the rest join
from their own phones. The game is built for people playing in the same room,
with the app handling the hidden state, realtime combat, and exact information
sharing.

For parties, a TV or laptop can be the table screen instead. It hosts the
lobby with a QR code and a message from the host ("the war starts at 21:30"),
starts the game, and then shows the public state of the war for everyone in
the room: the phase, who is done, who is fighting whom, rotations and who has
fallen. Rounds advance on their own after a short countdown. Open the table
screen through the computer's network address, not `localhost`, so phones can
reach the join link.

## Game Summary

Each wizard has:

- 200 health
- One hidden shield frequency
- Up to five Mados, magical torpedoes with their own frequencies
- Partial insight into other players' shield frequencies

Damage depends on how closely a Mado frequency matches the target's shield
frequency: full damage within 15°, falling to nothing at 45°. Every shot sends
back an echo (glowing, warm, lukewarm or cold) that rules out part of the
circle, so a battle is also a hunt for the enemy shield. Between battles each
wizard can tune one Mado up to 60° toward a shield they have tracked.

Shields drift a hidden 2 to 6° per round in a fixed direction, so knowledge
goes stale unless it is refreshed. Instead of attacking, a wizard can rotate
their shield up to 60°: everyone senses it and loses precision, but the
rotating wizard can only flee if attacked that round.

Each round has these phases:

1. Empty Mado slots are filled.
2. Players may discard unwanted Mados and tune one Mado.
3. Living players choose whether to attack another player, pass or rotate
   their shield.
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
