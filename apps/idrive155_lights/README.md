# IDRIVE155 Lights

Parked-only exterior lamp controls for BMW iDrive 7 / 8.

## Softkeys

| Key | Action |
|---|---|
| Bal / Jobb / Mind | Left / right / both indicators (held via lamp-test renew) |
| Távoli | High beam |
| Köd | Fog lights |
| Disco | Short rhythmic pattern |
| Stop | End session — lamps back to the car |

## Safety

- Blocked while moving (> 3 km/h)
- Auto-stop after 30 seconds
- Closing the app / Stop ends the diagnostic session so the body controller releases the lamps
- Private property only

## Notes

Uses BDC `LEUCHTEN_FUNKTION` timed tests (same family as community Light Show). Not every car / light answers; if nothing lights, the status line shows the diagnostic error.
