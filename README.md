# SHATTER — Online 1v1 FPS

A browser FPS with invite-only two-player lobbies, host-controlled rules, bot practice, and an explorable Rust map. Build 0.20 improves weapon handling and multiplayer presentation.

## Build 0.20: handling and network polish

- Immediate local muzzle flash, tracer, recoil and sound; only server-confirmed hits award damage or show hit markers.
- Server-timestamped opponent interpolation with a jitter-adaptive buffer, a monotonic playback clock and bounded catch-up after stalls. Positions hold when data runs out instead of extrapolating through cover.
- Fixed-step local prediction now renders between simulation steps. Small reconciliation errors decay visually over roughly 100ms; large corrections snap. Collision state always corrects immediately.
- Reload/cooldown presentation subtracts estimated snapshot transit time. Rewind includes snapshot downlink, shot uplink and the render buffer, capped at 250ms; target positions interpolate within recorded history.
- Separate ADS, sway, movement, sprint, equip and recoil layers. Shotgun break/open/load/close stages, sniper magazine reload and bolt action; knife keeps its forward-only stab.
- No damage, rate-of-fire, movement speed, hover duration or quickscope power-window changes. Reload can start during firing recovery, matching practice mode.

Research used before implementation: [Glenn Fiedler: Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/), [Networked Physics](https://gafferongames.com/post/networked_physics_2004/), and [Epic: additive Aim Offsets](https://dev.epicgames.com/documentation/en-us/unreal-engine/aim-offset-in-unreal-engine). These inform the implementation; this is custom browser animation/networking, not MW2 code or extracted animations.

Validation: deterministic 50/100/200ms RTT plus variable delivery/bursts at 30/60/144 FPS; correction continuity, moving-target rewind and timer aging; actual WebSocket lobby/match/disconnect tests; existing combat, scope release and hover tests. Browser checks cover weapon display/reloads and a two-client match. Real remote friends-playtests are still needed: WebSocket/TCP can stall behind retransmissions, and presentation smoothing does not remove physical latency. Use a Railway region close to both players. Diagnostics are available through `window.shatter.snapshot().network`.

## Play with a friend

1. Open the same deployed game address on both computers.
2. Choose **Online 1v1**, enter your name, and **Create lobby**.
3. The host selects rounds to win (1–15), round time (30–180 seconds), and all weapons or one weapon type.
4. **Copy link** and send it to your friend. They enter their name and choose **Join**.
5. Both players choose **Ready**. The host chooses **Start match**. Click **Enter match** to capture your mouse.
6. First to the chosen score wins. At the time limit, higher health wins; equal health is a draw. The host can return both players to the lobby for a rematch.

Escape opens the menu but **does not pause an online match**. Leaving or disconnecting returns the remaining player to the lobby and transfers host control if needed. Rejoin using the same link while that lobby still has a player. Empty lobbies are deleted. Links are unlisted, not password-protected: anyone with the link can take the second slot.

## Deploy on Railway

1. Choose **New Project → Deploy from GitHub repo** and select `joshrees77/1v1me`, branch `main`.
2. Keep the root at the repository root. Railway detects the included `Dockerfile`, installs the pinned WebSocket dependency, and runs the Node server.
3. Set **Settings → Deploy → Healthcheck Path** to `/health`. Allow at least 60 seconds for startup while the map collision and combat index load.
4. Under **Settings → Networking**, **Generate Domain**, target port **8080** (or the service's `PORT`).
5. Use **one replica**. Disable sleeping/serverless mode for active playtests. The HTTP game and WebSocket endpoint run on the same service and domain. No database, volumes or secrets are required.
6. Share the generated HTTPS game address. Create invite links from that address; localhost links only work on the same computer.

Existing Railway services connected to `main` can redeploy the latest commit. The old static ChatGPT Site does not provide the Node multiplayer server; use the Railway domain for online matches.

Rooms and scores are held in memory. A restart or deployment ends current lobbies. This is a friends-playtest MVP with a limit of 20 simultaneous rooms / 64 connections, not ranked matchmaking or persistent accounts. One process owns all rooms; horizontal scaling requires a shared room routing/persistence design.

The container uses Node 24, runs as the non-root `node` user, and serves only `dist/`. `HOST` defaults to `0.0.0.0` and `PORT` to `8080`. `/health` returns 200 after map initialization succeeds. The map and engine assets are included. The gzip map is decompressed by the browser, so it is served without `Content-Encoding`.

Railway references: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [health checks](https://docs.railway.com/deployments/healthchecks), [public networking](https://docs.railway.com/networking/public-networking).

## Run locally

Install Node 22+ (Node 24 recommended), then run:

```sh
npm ci
npm start
```

Open http://localhost:8080 in a desktop browser. For a same-computer test, open an invite link in a second tab. A background tab may run at a reduced frame rate; two computers are better for testing movement. Bot practice and map exploration remain available offline after the assets load.

If an embedded browser refuses mouse capture, click-and-drag look is available. A normal desktop browser with pointer-lock support is recommended.

## Controls

| Action | Input |
| --- | --- |
| Move / sprint | WASD / Shift |
| Look / jump | Mouse / Space |
| Crouch / crawl | Hold C |
| Fire / stab | Left click |
| Sniper scope / release shot | Hold / release right click (or Control-click on Mac) |
| Shotgun aim / knife throw | Right click |
| Weapon selection | 1 shotgun, 2 sniper, 3 knife / wheel |
| Reload / quick throw | R / Q |
| Menu / release mouse | Escape |
| Reset position in Explore | T |

Sniper alignment takes 0.25 seconds. Stationary scoped headshots deal 100 damage for the first 0.65 seconds of a scope hold, then 95 (body damage 80, then 76). Hip-fire and movement add spread. Scoping while airborne suspends movement for up to 0.6 seconds, once per jump/fall; hovering players take 50% extra damage. Landing restores hover. Right-click release captures scoped state before unscoping. A left-click shot prevents a duplicate release shot.

The shotgun has two shells, ten pellets, and strong range falloff. Knife stabs deal 65 damage within 2.7m; thrown knives are swept projectiles dealing 100 damage and return after 3 seconds. Weapon restrictions apply to quick throw as well as weapon selection.

## Multiplayer implementation

- `multiplayer/server.mjs`: same-origin WebSocket upgrade, heartbeat, payload/message limits, slow-client handling and fixed simulation ticks.
- `multiplayer/rooms.mjs`: lobby ownership, ready state, rules, server-controlled movement, ammo, reloads, cooldowns, spread, hit validation, health, projectiles and scoring. Clients send controls, never accepted positions or damage claims.
- `dist/online-motion.js`: shared 60 Hz Rapier movement. The browser predicts inputs, then restores authoritative snapshots and replays unacknowledged inputs.
- `dist/multiplayer.js` and `dist/game.js`: invite UI, transport, input packets, hit feedback, adaptive 75–150ms opponent interpolation on server timestamps, remote weapon display and round/results UI. Server snapshots arrive at 20 Hz.
- `multiplayer/world.mjs`: imports the same terrain and visible-map BVH, including transparent fence/grate holes. Online character hits use simplified head/body hitboxes aligned with the operator model. Hitscan target rewind is bounded to 200ms using measured connection latency; world cover remains authoritative. Thrown knives are simulated on the server.
- The server rejects non-host rule/start requests, invalid inputs, stale/duplicate frames, unavailable weapons, excessive fire rates and client-supplied damage/positions. Competitive cheat resistance and high-latency tuning need further playtesting.

## Verification

```sh
npm run check
npm test
npm run test:server
npm run test:multiplayer
```

Multiplayer checks exercise two real WebSocket clients plus deterministic simulation: joining/full lobbies, host authority, readiness, movement prediction/reconciliation, jump/crouch/hover, sniper damage timing, shotgun falloff, knife projectile hits, map cover, reloads, round/match flow, rematches and disconnects. Input tests preserve right-click release firing and duplicate-shot prevention. Local browser QA covers the two-player lobby and arena flow; internet-latency playtesting is still needed after Railway deployment.

## Earlier builds

The notes below describe the original practice build and subsequent art/gameplay work. Online matches use the server rules described above.

## Rust traversal build (0.4)

Choose **Explore Map · No Damage** for unlimited time, invulnerable characters, and a bot patrol that visits the highest connected platform and the ground lanes. **T** resets your position. The overlay reports grounding, height relative to the yard, remaining bot route steps, and frame rate. Standard practice duels remain available.

Player and bot share `dist/physics.js`: a capsule, swept movement, 36cm auto-step, 40cm ground snap, a 45-degree climbing limit, gravity, and jump/ceiling collision. The bot model is scaled to fit that capsule. Navigation retains the playable yard component of a layered 80cm grid; every directed edge is checked by moving the actual controller through it. A* paths include height, and the bot follows the same movement routine. Spawn points are selected on connected clear ground. A fall outside the supported map resets the character.

`node test-traversal.mjs` verifies grounding, jumping and landing, sprinting against a real map wall, the spawn route, the highest connected platform and its descent, and 12 patrol paths. It writes `traversal-report.json`. `node test.mjs` checks preserved weapon behavior and rounds. Browser checks cover rendering, controls, and exploration.

Ladders and jump/mantle navigation links are not implemented. The bot deliberately uses connected walking routes and ramps; isolated tower tops and prop roofs are not claimed as reachable. Exploration allows manual jumping. This is a testing build, not a guarantee that every collision edge is perfect.

The map stays in the existing private demo. Original map assets are supplied by the user; the vendored Babylon and Rapier engines have their own license files. No Blender runtime or original archive is shipped.

Conversion tools in `tools/` export the visible Blender instances with embedded scripts disabled, create browser meshes/collision data, reduce diffuse textures, and build the physically checked navigation graph. Run `export-map.py` in Blender, `pack-map.py` and `textures.py` with Python (NumPy/Pillow), then `node tools/build-nav.mjs`. The source archive paths are currently configured for the local supplied asset. Runtime requires a modern desktop browser with WebGL, WebAssembly, and DecompressionStream.

## Movement update (0.5)

Space jumps approximately 1.5 metres. A 160ms jump buffer preserves presses just before landing, and 100ms of ledge grace helps over uneven terrain. Keyboard auto-repeat cannot trigger repeated jumps. Hold C to shrink the collision capsule from 1.76m to 1m, lower eye height from 1.68m to 0.85m, and cap movement at 2.1m/s. Releasing C stands only when the full standing capsule fits; it retries automatically after leaving low cover. Bot aim height follows the player's stance. The crosshair is now 12px wide, with sniper spread feedback capped at 1.4×; weapon accuracy is unchanged.

`node test-movement.mjs` checks passage clearance, headroom, jump buffering, ledge grace, and double-jump prevention with actual physics capsules. Gameplay checks also cover C input, eye height, and immediate sprint slowdown.

## Neon Rust theme (0.7)

All 113 unique original map texture images have individual cyberpunk replacements, including ground, architecture, vehicle and equipment atlases, foliage, water and decals. The built-in image-generation tool edited 112 from their own originals; equipment label 106 was replaced with a benign service-unit atlas generated to its original layout. Every output uses the exact original dimensions. Low-resolution wear and source texture placement remain; no procedural replacement tiles or world-space UV overrides are used.

The complete mapping lives in dist/neon-materials.js. The source names, output files and individual edit prompts are recorded in dist/assets/neon/conversions.json. Run node validate-textures.mjs to require complete coverage, unique outputs, source-matching image dimensions and provenance. Game startup awaits every converted texture so a missing or failed asset cannot silently leave an incomplete theme.

Original texture alpha is used separately as the authoritative opacity mask for existing cutout materials. Generated colour images cannot fill fence holes, alter foliage silhouettes or redraw decal boundaries. Original Rust retains the original materials and all source files. No mesh positions, UVs, indices, physics, navigation, spawns or weapon mechanics are changed.

Night lighting, cyan/magenta accents, signs and a cosmetic city skyline remain. Added scenery is non-pickable and has no physics. Both themes remain available from the lobby.

## Surface and operator update (0.8)

The renderer removes 3,944 coincident triangles within imported material batches and gives structural surfaces and decals deterministic depth precedence. The near clipping plane is 10cm for better depth precision. Source meshes, UVs, collision and navigation files remain intact; cleanup changes only the visual index buffers at load time. Both themes inherit the depth rules.

Releasing a movement axis clears its horizontal momentum immediately, including diagonal sprint and airborne input. Acceleration into movement remains; scoped/crouched speed limits and jump gravity are unchanged. Bot leg animation now advances with actual travel and stops when stationary.

The opponent is a low-poly operator with worn teal plates, dark clothing, a respirator, pink visor, radio, pouches and backpack. First-person gloves, sleeves and wrist armour match. Helmet accessories retain headshot tagging; torso equipment uses body damage. Tests cover release at 30/60/144fps, diagonal-axis release, operator head/body ray hits, duplicate surface cleanup and deterministic material layering.

## Sniper timing update (0.9)

One-shot headshots require firing within the first 0.65 seconds of a scope hold. Damage drops 5% afterward (100 → 95 head, 80 → 76 body); hip-fire uses the reduced values. The independent 0.25-second stationary accuracy settling remains, giving a 0.40-second fully accurate one-shot opportunity. Moving does not pause or reset the damage timer. Unscoping and scoping again starts a fresh window; reloads and weapon changes end the current hold. The scope and weapon hint show head damage and the remaining window.

## Combat and map audit (0.10)

Weapon rays now check rendered map surfaces and the original texture alpha masks, rather than treating the movement collider as opaque. Shots can pass through visible chain-link and grate holes; opaque pixels and solid cover still stop them. This applies to both map themes and preserves the sniper's 0.65-second damage window, 0.25-second settling, and movement/hip spread. Movement collision is unchanged. Neon signs have correctly oriented lettering on both sides.

Validation: gameplay tests cover sniper head/body damage, timing, spread, cover, shotgun, knife and scoring. `test-combat-map.mjs` tests real imported fence/grate triangles and UVs (transparent and opaque pixels), a clear lane and solid cover. Movement tests cover jumping, crouching and ceiling clearance. Traversal checks cover 684 metres across spawn routes, raised-pipe ascent/descent and 12 patrol paths. A browser visual pass inspected the spawn lane, tower approach, east/rear lanes, raised pipe and return route using local-only stepping controls; these controls are not shipped. The upper tower/ladder route is not part of the connected walkable navigation mesh and was not certified by that route test.

## Scoped stop accuracy (0.11)

Moving no longer restarts the scope-alignment timer. After the initial 0.25-second scope-in, releasing movement restores zero spread immediately, including when firing between key release and the next simulation frame. Key release clears only the released movement axes; continuing to strafe, hip-fire or jump retains the appropriate inaccuracy. Scope damage timing remains independent and unchanged.

Regression tests cover diagonal/partial release and actual shot direction at 30, 60 and 144 FPS, alongside initial scope settling and damage-window checks. A browser test using the real key-up handler and imported map confirmed movement spread 0.120 → 0.000 on release, zero horizontal velocity, unchanged scope age, and a registered held-scope headshot for 95 damage.

## Sniper release-to-fire (0.12)

Hold the secondary mouse/trackpad button (or macOS Control-click) to aim the sniper, then release to fire once before leaving the scope. The release uses the existing scoped spread and damage window. A very short tap still has initial scope-in spread; movement spread is unchanged. Left-click firing while scoped consumes the release shot, including after the weapon cooldown has elapsed. Pausing, losing focus, reloading, round transitions and switching weapons cancel pending release shots. Shotgun and knife controls are unchanged.

`test-input.mjs` exercises the actual registered mouse handlers, including fresh/late release headshots, duplicate release events, primary-click suppression, cancellation and cooldown.

Browser validation uses local diagnostic buttons to deliver standard press/release events to the real input handlers. The automated in-app browser secondary-click action emits only a context-menu event, so it does not verify a physical trackpad gesture. Diagnostic controls are not shipped.


## Floor stability (0.13)

Imported ground decals now draw in a stable, separate pass after solid map geometry, with depth testing retained and depth writes disabled. Overlapping dirt and gravel patches no longer compete with each other in the depth buffer; solid walls still occlude them. Weapon viewmodels remain in their existing final pass. Original texture/opacity masks use mipmapped trilinear sampling, and both themes use 8x anisotropic filtering where supported. Low-resolution assets, map geometry, physics and combat hit masks are unchanged.

A browser comparison at the same spawn viewpoint with a 0.0002-radian camera turn reduced high-contrast pixel changes (>20/255 in any channel) in the foreground floor region from 512 to 5; the farther ground region dropped from 541 to 36. This is a targeted rendering comparison, not a claim that every surface is alias-free.


## Metal housing and skyline (0.14)

The curved tower vent contained coincident four-corner panels triangulated along opposite diagonals. Exact triangle deduplication did not catch these. A targeted second cleanup for `me_metal_rust_03` removes repeated convex planar quads while retaining their UVs, boundaries and two-sided rendering. Two-sided lighting keeps the retained faces lit correctly. Collision geometry is unchanged. Tests verify nonplanar faces are preserved, cleanup is idempotent, and 414 samples on the 138 removed triangles remain covered by retained surfaces. Combat-map tests use the same cleaned metal geometry.

The cyberpunk backdrop now reuses the existing gritty concrete and corrugated-metal textures at a larger visible scale, with brighter muted material tints, recessed windows, ledges, corner piers and rooftop plant. Cosmetic geometry remains outside the playable yard and is merged by material to limit draw calls. Both original and neon themes were inspected in-browser at the repaired vent.


## Refined weapon and operator models (0.15)

Weapons use custom beveled cross sections, tapered stocks/grips and rounded barrel/scope components. The shotgun retains its break-action hinge; the sniper adds scope rings, a bolt handle and muzzle ports; the knife has a flat tapered blade and shaped grip. First-person gloves now have fingers/thumbs and tapered sleeves. The operator has a shaped helmet, wraparound visor, separate armour plates, rounded shoulder/elbow/knee joints, longer leg proportions and bent arms holding the weapon. Existing attack, scope, reload, movement and damage rules are unchanged.

`test-models.mjs` constructs the real models in Babylon's headless engine, checks outward-facing bevel geometry, head/body hits from three angles, weapon exclusion from combat picking and the shotgun barrel hinge. Browser checks cover each held weapon, the reload pose and the operator's front/side silhouette.


## Straight knife thrust (0.16)

The knife now thrusts forward in 90 ms and retracts over 290 ms, holding its starting grip angle and height throughout the attack. Switching weapons cancels the pose, and quick throws no longer swing the held gun. Melee damage, reach, cooldown and projectile behaviour are unchanged. Controls now describe the attack as a stab.


## Air scope and interface wording (0.17)

Scoping the sniper while airborne pauses movement for up to 0.6 seconds. The normal 0.25-second scope settling remains, with no movement spread during the hover. Incoming damage is multiplied by 1.5 while hovering. Releasing scope fires before cancelling the hover; reload, switching weapons and pause cancel it. Each jump or fall permits one hover, recharged on landing, so repeated scope presses cannot suspend the player indefinitely. The character controller remains active for collision.

Weapon names are Shotgun, Sniper and Knife. Lobby, HUD, settings, results and instructions use direct labels and factual descriptions instead of slogans.

`test-air-sniper.mjs` exercises the real character controller at 30, 60 and 144 fps, including hover duration, release-to-fire headshots, extra damage, landing recharge and cancellation. Browser checks cover the scope warning, lobby weapon names, settings and controls.


## Firing hitch (0.18)

Hit detection now uses a static triangle BVH built during map loading. The index follows the cleaned rendered geometry and original UV opacity masks; the moving operator still uses Babylon picking. Each shot visits only spatially relevant map triangles rather than repeatedly scanning material batches. Damage, spread, cover, knife projectiles and scope mechanics are unchanged. The index assumes static map geometry; moving or rebuilding map surfaces requires rebuilding it.

In a local browser comparison of 12 shots per weapon at the same viewpoint, with sound off and the bot hidden to isolate map picking, median fire processing fell from 108.0 ms to 0.8 ms for the shotgun, and from 12.5 ms to 0.7 ms for the sniper. These are CPU timings for the tested scene, not a guaranteed frame rate. The index builds once during loading (about 1.1 seconds in the headless map test). The regression suite compares 240 rays against the original picker, plus real cutouts, clear/blocked target lanes, transformed surfaces and current material transparency.

A follow-up browser run with sound and the operator enabled measured median fire processing of 1.1 ms for the shotgun (maximum 11.8 ms, including audio initialization) and 0.9 ms for the sniper (maximum 1.3 ms).
