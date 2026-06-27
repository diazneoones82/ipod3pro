# ChromeAmp — Product Requirements Document (v1.1)

## Vision
A premium Android music player that fuses the nostalgic tactile feel of the iPod Shuffle / Click Wheel with a Vision Pro-style dark glassmorphic UI, while giving audiophiles desktop-class parametric EQ tooling (Equalizer APO / Peace compatible) — *and* a community-powered Discover feed of EQ profiles for organic growth.

## Target Platform
- Expo (React Native) SDK 54 — Android first, runs on iOS too.
- Final APK is built via Emergent **Publish** button.

## Tabs / Screens
1. **Player (Home)** — Chrome Click Wheel + 4 corner controls + center SELECT + album art + interactive **waveform scrubber** (tap-to-seek) + **sleep timer** badge.
2. **Folders** — Scans device audio (via expo-media-library), groups into folder/album cards with track counts. "Recently Played" pinned row. Tap to open detail or play-all.
3. **Folder Detail** — Track list with playing indicator.
4. **Parametric Equalizer** — Frequency response SVG graph (biquad math), preamp, presets row, dynamic bands (Freq · Gain · Q · filter type), import + export EqualizerAPO `.txt`, link to **Discover**.
5. **Discover (stack route)** — Community EQ profile feed: search, sort (Trending / New / Top), star, share `.txt`, apply, **publish your own**.
6. **Settings** — Sleep timer, gapless, shuffle, repeat, EQ toggle, Discover entry, rescan, system permissions.

## Click Wheel Spec (unchanged from v1)
- Chrome ring + 4 corner buttons + center glass SELECT.
- Circular pan → tick every 10° → volume / track step.
- Haptics per tick & button press.

## Parametric EQ Spec
- Biquad math (Robert Bristow-Johnson cookbook) for: PK, LSC, HSC, LP, HP, NO, BP, AP.
- Bands stored as `{enabled, type, freq, gain, q}` + preamp dB; persisted via AsyncStorage.
- Real-time SVG frequency response curve (−18 dB to +18 dB, log freq 20 Hz–20 kHz).
- Built-in presets: Flat, Bass Boost, Vocal, Rock, Classical, Electronic.
- Import/export `.txt` in Equalizer APO format.
- ⚠️ Real-time DSP filtering of audio requires native Android `AudioEffect` integration — activates in production APK only.

## Discover (NEW in v1.1) — Smart Enhancement
- MongoDB-backed feed served via FastAPI (`/api/eq-profiles*`).
- 8 seeded audiophile profiles on first run (Studio Reference, Mega Bass, Crystal Vocals, Vinyl Warmth, Live Concert, Hip-Hop Punch, Classical Concerto, K-Pop Brightness).
- Each profile shows: name, author, description, mini frequency-response graph, star count, tags, band count.
- Users can: **search**, **sort** (Trending / New / Top), **star** (anonymous device-scoped user_id), **apply** to local EQ, **share** as `.txt` (via expo-sharing), **publish** own profile (name + author + description).
- Server emits Equalizer APO–formatted text at `GET /api/eq-profiles/{id}/config` — every shared `.txt` is a new acquisition channel.
- Star tracking: anon user_id generated client-side, persisted to AsyncStorage.

## Now-Playing Enhancements (NEW in v1.1)
- **Waveform scrubber**: 56 synthetic bars seeded deterministically from track ID, drawn with brand-amber fill up to progress. Pan-gesture seeks the player.
- **Sleep timer**: bottom-sheet (5/15/30/45/60/90 min presets); active state shows countdown badge in header; auto-pauses player on expiry. Also accessible from Settings.
- **Gapless playback toggle**: preloads next track 4s before current ends; on `didJustFinish` swaps players with no audible gap. Persisted.
- **Background playback**: `expo-audio` configured with `shouldPlayInBackground: true`. Full lock-screen / notification controls (foreground service) activate in the APK build.

## Backend API (FastAPI · MongoDB)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/` | health |
| POST/GET | `/api/status` | demo status checks |
| GET | `/api/eq-profiles?sort=trending\|new\|stars&q=...&user_id=...` | list profiles |
| GET | `/api/eq-profiles/{id}?user_id=...` | single profile + starred flag |
| POST | `/api/eq-profiles?user_id=...` | publish profile |
| POST | `/api/eq-profiles/{id}/star` | toggle star (body: user_id) |
| GET | `/api/eq-profiles/{id}/config` | EqualizerAPO `.txt` (also bumps download) |
| POST | `/api/eq-profiles/{id}/download` | bump download counter |

## Permissions (Android)
- `READ_MEDIA_AUDIO`, `READ_EXTERNAL_STORAGE`, `WAKE_LOCK`, `FOREGROUND_SERVICE`, `MODIFY_AUDIO_SETTINGS`

## Tech Stack
- expo-router · expo-audio · expo-media-library · expo-document-picker · expo-file-system · expo-sharing
- react-native-reanimated · react-native-gesture-handler · react-native-svg
- expo-blur · expo-linear-gradient · expo-haptics
- FastAPI · MongoDB · Motor

## Tests
- Backend pytest: 13/13 pass (3 from v1 + 10 from v1.1 Discover)
- Frontend: all critical flows verified on web preview by testing agent
- Test reports: `/app/test_reports/iteration_1.json`, `iteration_2.json`

## Known Constraints (Expo Go)
- Audio playback, folder scanning, document picker, sharing, lock-screen controls and parametric-EQ DSP do NOT execute in the web preview — they activate in the APK build.
- This is by design (native-only Android APIs).

## Out of Scope (v1.x)
- Cloud sync of EQ presets across devices (anon user_id is device-scoped).
- Lyrics / metadata fetch.
- Multi-room / cast.
- Online streaming.

## Next Action Items
- 📲 Generate Android APK via Emergent **Publish** button → side-load on device.
- 🐙 Push code to GitHub via Emergent **Save to GitHub** feature (top-right menu).
- (Optional) Migrate `expo-file-system/legacy` imports to new File API.
