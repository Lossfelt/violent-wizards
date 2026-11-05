# UI prototype notes

Question: what should the game screen look like? The prototype lived at `?prototype` (dev only)
on the branch `prototype/ui-skiven` and was removed once A3 was built into the app.

## Round 1 (2026-11-04)

Three concepts: A "The Dial" (one big frequency dial), B "The Table" (the room as a table,
Mados as cards), C "The Grimoire" (one decision per screen, echoes explained in words).

Verdict:

- A wins. One dial with shield, Mados and known ranges on the same circle.
- Keep from B: seeing at a glance who has fought whom, and the Prepare / Declare / Battle
  step bar at the top.
- Keep from B: your own shield is hidden unless you deliberately reveal it.

## Round 2

Two ways of fitting the "who fought whom" overview next to the dial:

- A2: an arc diagram of all wizards above the dial. Arcs connect wizards who have fought,
  fading with age. Tapping a wizard focuses the dial on them.
- A3: a small table in the corner, as in B. Tapping it opens the full table.

Both show every known shield at once on its own thin lane of the dial, coloured per wizard,
so you can see which opponents your Mados are close to.

Verdict: A3, the user's preference. Asked for fight counts and ages in the full table, but
not shown all the time.

## Round 3

- The full table merges repeated fights into one thicker line. A "Show numbers" toggle adds
  labels on the lines (fights and last round) and a list with "last round" / "2 rounds ago".
  Numbers are hidden by default.
- Shield rotation shows whole degrees.
- The step bar says Warfare instead of Battle.
