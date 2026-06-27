# ChromeAmp — Product Requirements Document

## Vision
A premium Android music player that fuses the nostalgic tactile feel of the iPod Shuffle / Click Wheel with a Vision Pro-style dark glassmorphic UI, while giving audiophiles desktop-class parametric EQ tooling (Equalizer APO / Peace compatible).

## Target Platform
- Expo (React Native) SDK 54 — Android first, runs on iOS too.
- Final APK is built via Emergent **Publish** button.

## Tabs / Screens
1. **Player (Home)** — Chrome Click Wheel + 4 corner controls + center SELECT + album art + progress.
2. **Folders** — Scans device audio (via expo-media-library), groups into folder/album cards with track counts. "Recently Played" pinned row. Tap to open detail or play-all.
3. **Folder Detail** — Track list of the chosen folder with playing indicator.
4. **Parametric Equalizer** — Frequency response SVG graph (biquad math), preamp slider, presets row, dynamic bands (filter type / freq / gain / Q), import + export EqualizerAPO `.txt`.
5. **Settings** — Shuffle, Repeat, EQ toggle, Rescan, system permissions, about.

## Click Wheel Spec
- Outer ring: chrome linear gradient (light→mid→dark→mid→light) + top-light/bottom-shadow overlay.
- 4 corner labels: MENU (top), Prev (left), Next (right), Play/Pause (bottom).
- Center glass blur SELECT button (toggles VOL ↔ TRACK scroll mode).
- Circular pan gesture → angle delta → tick (every 10°) → adjusts volume or steps track.
- Haptic feedback per tick (selection) and per button press (medium impact).

## Parametric EQ Spec
- Biquad math (Robert Bristow-Johnson cookbook) for: PK, LSC, HSC, LP, HP, NO, BP, AP.
- Bands stored as `{enabled, type, freq, gain, q}`; preamp dB.
- Real-time SVG frequency response curve (−18 dB to +18 dB, log freq 20 Hz–20 kHz).
- Built-in presets: Flat, Bass Boost, Vocal, Rock, Classical, Electronic.
- Import `.txt` in Equalizer APO format (`Filter N: ON PK Fc 1000 Hz Gain 3 dB Q 1.0`).
- Export & share via expo-sharing.
- State persisted via AsyncStorage.
- ⚠️ **Real-time DSP filtering** of audio requires native Android `AudioEffect` / `Equalizer` integration via a custom Expo Module — activates only in the production APK build. In Expo Go preview the EQ UI updates the visualization & config; audio plays unfiltered.

## Permissions (Android)
- READ_MEDIA_AUDIO (Android 13+)
- READ_EXTERNAL_STORAGE (Android <13 fallback)
- WAKE_LOCK, FOREGROUND_SERVICE (background playback)
- MODIFY_AUDIO_SETTINGS (EQ on native APK)

## Tech Stack
- expo-router (file-based tabs)
- expo-audio (playback)
- expo-media-library (audio scan)
- expo-document-picker + expo-file-system (EQ config I/O)
- expo-sharing (export)
- react-native-reanimated + react-native-gesture-handler (Click Wheel)
- react-native-svg (frequency graph)
- expo-blur + expo-linear-gradient (glassmorphism + chrome)
- expo-haptics (tactile feedback)
- AsyncStorage (preferences & EQ persistence)

## Non-functional
- Dark theme only (warm amber `#F59E0B` accent on obsidian `#05050A`).
- No purple/indigo/blue colors.
- All interactive elements have `testID` (25+ verified).
- Mobile-first layout (390×844 baseline), safe-area aware.

## Out of Scope (v1)
- Cloud sync of EQ presets.
- Lyrics / metadata fetch.
- Multi-room / cast.
- Online streaming.

## Open Items for User
- Provide an Android device & build the APK via the **Publish** button to verify:
  1. Folder scanning lists real device folders/albums.
  2. Audio plays from selected folder with prev/next/auto-advance.
  3. (Future native module) Parametric EQ DSP application.
