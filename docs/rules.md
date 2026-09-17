# Public demonstration rules

These are deliberately small fictional rules designed to expose concurrency, privacy, and persistence problems. They are not a claim to reproduce the entire private game's balance or content.

## Setup

Two to five players start with one unit and two districts each. Districts form a ring; the first and last are adjacent. Player 1 starts at district 0, player 2 at district 2, and so on. A seed assigns each district an income of 1–3. Treasury begins at zero and stays private until final scores are published.

## Planning

Every living player can replace their order until they seal it. Supported orders:

| Order | Meaning |
| --- | --- |
| `hold` | Stay in place |
| `collect` | Earn the current district's income if still alive at settlement |
| `move` | Intend to move to an adjacent district |
| `attack` | Intend to enter an adjacent district occupied by an opponent |

Sealing without an order seals hold. A sealed order cannot be replaced. Even if everyone seals, planning waits for its deadline. An unsealed or missing order becomes hold when the deadline passes.

## Simultaneous resolution

Resolution uses starting occupancy, not whichever HTTP request arrived first. Two units targeting the same district are connected. A moving unit targeting another unit's starting district is connected to that unit even if the defender planned to move away. Connected components form conflict groups, so a chain of attacks does not resolve the same unit twice.

Every participant privately chooses `engage` or `withdraw`:

| Choices | Outcome |
| --- | --- |
| Everyone withdraws | All involved units stay at their original positions |
| Exactly one engages | That player survives; other participants are eliminated; the survivor executes its move if it had one |
| Multiple players engage | Every participant in that conflict is eliminated |

Choices cannot be changed once submitted. Conflicts can settle early once every participant in every group has voted. Missing choices become withdraw at the deadline. Uncontested moves resolve after conflict outcomes. Entering a district claims its ownership. Eliminated players never collect income.

## End of match

The match ends when at most one player survives or the configured turn limit is reached. At the turn limit, surviving players score treasury plus two points per owned district. Highest score wins; ties have multiple winners. Total elimination is a draw with an empty winners list. Finished matches reject further commands.

## Time and recovery

The server chooses time. Planning defaults to five minutes and conflicts to three minutes. The demo injects a logical clock through the internal library API only.

If the server was offline for an hour, recovery advances one overdue phase and gives players a fresh full window. It does not charge them for dozens of unseen turns. Persisted conflict participants and choices survive a restart. A settled phase is never applied again merely because the scheduler runs twice.
