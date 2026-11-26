# IDRIVE155 TikTok

Vertical TikTok-style feed on BMW iDrive 7 / 8 (MGU).

## Internet (Store Wi-Fi)

Yes — this app uses the same uplink as the MGU Store (`mguInternet: true` → **mgu-uplink**):

- Wi-Fi (phone hotspot / home Wi-Fi in Store → Settings → Wi-Fi)
- USB tethering / iPhone Personal Hotspot
- LTE stick / USB Ethernet

When the Store shows **Online**, this app can reach the network. There is **no Chromium browser** on the head unit, so TikTok.com is not embedded as a webpage; the app loads the feed over HTTPS and draws a car-native UI.

## Controls

| Input | Action |
|---|---|
| **Fel** / tilt up / turn left | Previous video |
| **Le** / tilt down / turn right | Next video |
| **OK** / press knob | Play / pause focus |
| **Frissít** | Reload feed |

## Safety

Parked only (blocks while moving, same idea as other entertainment apps).

## Notes

TikTok often blocks unsigned scrapers. If the live feed is empty, the app shows a demo reel and keeps next/prev working so you can verify controls and uplink. Full GPU video decode (RideTube-style media worker) is a separate native stack; this release is the feed + navigation client.
