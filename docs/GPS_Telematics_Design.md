# GPS & Telematics: Design (not built yet)

**Goal:** track every unit live, keep trip history, and rate how drivers drive (harsh braking/acceleration, RPM habits, idling, speeding, fuel use). Then feed that into maintenance, billing proof, and driver coaching.

**Status:** design for review. Nothing in the app changes until the open questions in §9 are answered.

## 1. What's realistic with which hardware

Driver behaviour depends on what the tracker can read from the car:

| Data | GPS-only tracker | OBD-II tracker (plugs into OBD port) | CAN tracker / CAN adapter |
|---|---|---|---|
| Position, speed, heading, odometer (GPS) | ✅ | ✅ | ✅ |
| Ignition on/off, idling time | ✅ (wired ACC) | ✅ | ✅ |
| Harsh accel / brake / cornering | ✅ (accelerometer) | ✅ | ✅ |
| Engine RPM | ❌ | ✅ (standard PID) | ✅ |
| Vehicle speed from ECU, coolant temp, engine load, fault codes (DTC) | ❌ | ✅ (most cars) | ✅ |
| Fuel level / fuel used | ❌ | ⚠️ often **not** exposed by Indonesian-market MPVs | ✅ usually (depends on model) |
| Driver ID (who is driving) | ⚠️ via iButton/RFID reader | same | same |

Fuel is the hardest part:

- If the car doesn't publish fuel over OBD/CAN, the options are a fuel-level sensor in the tank (capacitive probe, installed by a specialist), or **refuelling receipts in "Catat Transaksi → BBM"** tagged to the unit. That already gives Rp/km per unit from Books.
- Recommendation: start with receipts. Add probes only on units where fuel theft is suspected.

Teltonika's "green driving" feature produces harsh accel/brake/cornering events on-device. Traccar can show them once they are mapped (forum guidance: computed attributes on the IO values). **You said you already have devices — tell me the brand/model** so the exact IO mapping can be confirmed.

## 2. Architecture

```
 Tracker (4G)  ──TCP/UDP (device protocol)──►  Traccar server  ──►  Traccar DB (raw positions)
                                                   │  REST API + WebSocket
                                                   │  event/position forwarding (HTTP)
                                                   ▼
                                         DSR API  /api/telematics/*
                                         • device ↔ car mapping
                                         • trips, daily summaries, behaviour scores  ──► Neon (small tables)
                                         • alerts → Telegram (geofence, overspeed, SOS, unplug)
                                                   ▼
                                         DSR Web  /admin/tracking (live map, trip replay, scores)
```

**Why Traccar instead of writing our own device server:**

- It is open source (Apache-2.0).
- It speaks ~2,000 device protocols (Teltonika, Concox, Queclink, Ruptela…).
- It already handles reconnects, odometer, trips and stops, geofences and notifications.
- Writing and maintaining our own TCP protocol decoders is months of work for no business gain.

DSR keeps the business logic Traccar doesn't know: which order/driver/client a unit was serving, scores, billing proof.

## 3. Where to store GPS data (the key decision)

**Volume estimate:**

- One unit reporting every 30 s while moving and every 5–10 min parked ≈ **1,000–1,500 points/day**.
- 30 units × 1,500 × 365 ≈ **16 million rows/year**.
- At ~200 bytes/row with indexes, that is ~3–4 GB/year uncompressed.

| Store | Holds | Why |
|---|---|---|
| **Traccar DB on a VPS**: PostgreSQL, optionally with **TimescaleDB** (community edition, self-hosted) | Raw positions & events, 6–12 months | Write-heavy and grows constantly. Timescale's compression (~90%) is *not* available on Neon (Neon only ships the Apache-licensed subset), so raw data stays off Neon. |
| **Neon (main DSR DB)** | `telematics_devices`, `trips` (one row per trip: start/end, km, max speed, events count), `driver_scores_daily`, `telematics_alerts` | Small: hundreds of rows/day. Joins with orders, drivers, cars, Books. |
| **Object storage** (Backblaze B2 / S3 / Google Drive, same off-site as backups) | Monthly archive of raw positions older than retention (`positions-2026-10.csv.gz`) | Cheap; used only for disputes or audits |

**Retention proposal:**

- Raw positions: 6 months online, then archived for 2 years, then deleted.
- Trips and scores: kept with the business records.
- Write this into the privacy policy: location is personal data under UU PDP.

**Where Traccar runs:**

- **Recommended:** its own small VPS (2 vCPU / 4 GB), so heavy GPS writes never slow the booking app, and an outage of one doesn't take down the other.
- **Pilot:** it can share the current VPS for 2–3 units. Then add it to the backup cron: `pg_dump` of the Traccar DB.

## 4. Data model in DSR (Neon)

```
telematics_devices (id, organization_id, car_id, traccar_device_id, imei, model, sim_number, installed_at, active)
trips              (id, organization_id, car_id, driver_id, order_id NULL, start_at, end_at, start_lat/lng, end_lat/lng,
                    distance_km, duration_min, idle_min, max_speed, overspeed_sec, harsh_accel, harsh_brake, harsh_corner,
                    over_rpm_sec NULL, fuel_used_l NULL, score)
driver_scores_daily(driver_id, date, km, trips, score, events_per_100km, idle_pct, overspeed_pct)
telematics_alerts  (id, organization_id, car_id, type: geofence|overspeed|sos|unplug|harsh|dtc, at, lat, lng, payload, ack_by, ack_at)
```

**Who drove:**

- During a rental, the driver is the one assigned on the order: the order's `driver_id` and dates match the unit.
- Outside orders, use an iButton/RFID tag if installed; otherwise the trip is "unassigned".

## 5. Driver behaviour score (per trip, rolled up per day/month)

All counts are normalised per **100 km**, so long trips aren't punished:

```
score = 100
      − 4 × harsh_brake/100km
      − 3 × harsh_accel/100km
      − 3 × harsh_corner/100km
      − 0.5 × overspeed minutes/100km     (speed > limit: 100 km/h toll, 60 km/h city, configurable)
      − 0.3 × over-RPM minutes/100km      (RPM > 3,000 sustained ≥ 10 s; needs OBD/CAN)
      − 0.2 × idle % above 10%
clamped to 0..100   →   A ≥ 85 · B 70–84 · C 55–69 · D < 55
```

The weights are a starting point. Calibrate them after one month of pilot data so a careful driver lands around 85–95.

**Fuel efficiency:**

- km/l (or Rp/km from BBM receipts) per **car model**, compared with that model's fleet median.
- Flag a unit/driver 20% worse than the median.
- Flag sudden fuel-level drops while parked (possible siphoning; needs a tank sensor or CAN fuel level).

## 6. Features by phase

| Phase | Scope | Value |
|---|---|---|
| **G0 Pilot** (2–3 units, 1 month) | Install Traccar, connect devices, verify which data each unit actually reports (RPM? fuel?) | De-risks everything |
| **G1 Live map & history** | `/admin/tracking`: last position of every unit, status (moving/parked/offline), trip replay per day; unit card in Armada shows last location | Answers "where is the car?" without phoning the driver |
| **G2 Alerts & odometer** | Geofences (garage, client sites, out-of-province), overspeed, SOS, tracker unplugged → Telegram. Odometer from GPS feeds **maintenance by km** | Safety, theft prevention, timely servicing |
| **G3 Driver behaviour** | Trips linked to orders/drivers, per-trip and monthly score, leaderboard, coaching report | Fewer accidents, lower wear and fuel |
| **G4 Client proof & billing** | Trip report on the invoice (km, hours, route) for lembur/inap disputes; optional client view of their own active rental | Fewer disputes on overtime and inap charges |

## 7. Tools

| Need | Choice | Notes |
|---|---|---|
| Device server | **Traccar** (self-hosted) | Java, runs as a service; has its own web UI for admins during the pilot |
| Raw storage | PostgreSQL (+ TimescaleDB community) on the Traccar VPS | Compression + retention policies |
| Map in DSR web | **Leaflet + OpenStreetMap tiles** | A new frontend dependency (map library). Needs your OK per project rules. OSM's free tiles have a fair-use policy; for heavier use, MapTiler or Stadia have free/low tiers. |
| Integration | Traccar REST API (devices, positions, reports/trips) + event forwarding webhook → DSR | DSR never talks to devices directly |
| Alerts | Existing Telegram bot | Already in DSR |

## 8. Security & privacy

- Tracking data is visible only to agency users with `fleet.view`, under a new permission `tracking.view`. Clients may see only their own active rental, never history.
- Drivers must be told in writing (employment/partner agreement) that units are tracked and how the data is used.
- The Traccar admin UI is not exposed publicly: it sits behind a VPN or IP allow-list. Device ports are open only for the device protocol.

## 9. Open questions (needed before building)

1. **Tracker brand & model** in the units, and whether an OBD/CAN adapter or fuel sensor is installed.
2. How many units now, and planned in 12 months?
3. Reporting interval currently configured on the devices (e.g. 30 s moving / 10 min parked)?
4. Separate VPS for Traccar (recommended) or share the current one for the pilot?
5. OK to add Leaflet (map library) to the frontend?
6. Speed limits and RPM threshold you want for scoring (default: 100 / 60 km/h, 3,000 RPM)?

## Sources

- Traccar protocol coverage & self-hosting overview: https://www.pistack.xyz/posts/2026-05-04-self-hosted-gps-tracking-fleet-management-traccar-owntracks-gpslogger-guide/
- Traccar forum: Teltonika harsh-driving via computed attributes: https://www.traccar.org/forums/topic/teltonika-fmb9205/
- Traccar forum: OBD trackers with driving-behaviour data: https://www.traccar.org/forums/topic/obd-tracker-with-driving-behaviour-data/
- Teltonika green-driving wiki: https://wiki.teltonika-gps.com/view/Special:MobileDiff/64320
- Neon TimescaleDB support (Apache-2 subset only): https://neon.com/docs/extensions/extension-explorer
