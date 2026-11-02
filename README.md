# SHATTER — Practice FPS

A playable local-practice FPS demo: a lobby, the imported Rust map with low-resolution textures, a training opponent, and three weapons. This version does not provide online multiplayer.

## Deploy on Railway

1. In Railway, choose **New Project → Deploy from GitHub repo** and select this repository. Allow Railway access to this private repository if it is not listed.
2. Keep the root directory at the repository root. Railway detects the included `Dockerfile`. No build command, dependency installation, database, volume or secret variables are needed.
3. Set **Settings → Deploy → Healthcheck Path** to `/health`.
4. Under **Settings → Networking**, choose **Generate Domain**. The server uses Railway's `PORT`; if a target port is requested, use the service's `PORT` value (8080 by default).
5. Open the generated HTTPS address and share it with testers. Testers do not need GitHub access to use the deployed game.

Each visitor gets an independent practice match against a bot. Hosting this build does not enable player-versus-player matches, shared lobbies or invite codes.

The container uses Node 24, runs as the non-root `node` user and serves only `dist/`. `HOST` defaults to `0.0.0.0` and `PORT` defaults to `8080`. `/health` returns HTTP 200. The map and vendor libraries are included; no separate asset upload is required. The gzip map is decompressed by the browser, so the server intentionally sends it without a `Content-Encoding` header.

Useful checks: `npm run check`, `npm test`, `npm run test:server`.

Railway references: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [health checks](https://docs.railway.com/deployments/healthchecks), [public networking](https://docs.railway.com/networking/public-networking).

## Run

With Node.js installed, run `npm start`, then open http://localhost:8080 in a desktop browser. Click **Start practice** to capture the mouse. Escape pauses the entire simulation and releases the mouse.

If an embedded browser refuses mouse capture, the demo automatically enables click-and-drag look. A regular desktop browser with pointer-lock support provides the intended FPS controls.

## Controls

| Action | Input |
| --- | --- |
| Move / sprint | WASD / Shift |
| Look / jump | Mouse / Space |
| Crouch / crawl | Hold C; move with WASD |
| Fire or stab | Left click |
| Sniper aim / fire | Hold right click / release right click; left click also fires while held |
| Shotgun aim / throw equipped knife | Hold right click / right click |
| Weapon selection | 1 shotgun, 2 sniper, 3 knife, or mouse wheel |
| Reload | R |
| Quick throw knife | Q |
| Pause | Escape |

The double-barrel shotgun holds 2 shells and fires 10 hitscan pellets per shot (14 damage per pellet, no headshot bonus). It reloads both barrels in 2.2 seconds. Pellet damage stays at 100% through 5 metres, drops along a quadratic curve to 28.75% at 15 metres and 5% at 25 metres, then tapers to zero at 40 metres. Spread further reduces actual damage at range. The hitscan sniper has 5 rounds. During the first 0.65 seconds after scoping it deals 80 body / 100 head damage; afterward, and during hip-fire, it deals 76 body / 95 head damage. Scoping immediately caps horizontal movement at 1.8 m/s (normal run: 6.5 m/s), including while sprint is held. The knife deals 65 melee damage and 100 thrown damage; a training knife returns after 3 seconds. Ammunition reserves are unlimited. First to five round wins takes the match. At 60 seconds, the player with higher health wins the round; equal health is a draw.

## Implementation

Sniper accuracy: hip-fire has a wide random shot cone (about 10° half-angle when stationary), with additional spread while moving or jumping. Movement also makes scoped shots inaccurate. The scope aligns during its first 0.25 seconds, including while moving. Once aligned, stopping restores full precision immediately; movement still adds spread while you are moving. Releasing aim, switching weapons or reloading resets scope alignment. The scope and HUD show when the shot is steady. Spread affects the actual hitscan ray and its tracer, not just the crosshair.

- Babylon.js 9.33.0 is vendored in `dist/vendor/babylon.js` with its license; characters and weapons are procedural meshes. Rust is imported from the user-provided Blender scene; placed instances are baked by material and textures capped at 256px.
- `dist/game.js` contains local movement, obstacle collision, hit tests, projectile physics, bot behavior, round flow, synthesized audio, and UI integration.
- `dist/style.css` provides the lobby and HUD. Google Fonts is optional; system font fallbacks are included.
- `server.mjs` serves the game assets on Railway or locally. It is not a multiplayer server.
- Preferences save to browser localStorage. No accounts, telemetry, or external gameplay API are used.
- `window.shatter.snapshot()` exposes read-only diagnostics for debugging.

## Next step

Extract movement and weapon rules into a shared TypeScript simulation, replace local authority with Colyseus rooms, and integrate prediction, reconciliation, and lag compensation. This prototype uses Rapier character controllers against imported triangle geometry, hitscan guns, and a swept projectile knife. A network server is not implemented.

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
