# YouTube Music Integration Plan

## Decision

Shuffle MuSic can add a YouTube tab for search, playlists, thumbnails, and visible embedded playback. It should not extract YouTube audio, cache YouTube audiovisual content, hide the YouTube player, or route YouTube streams through the local native audio engine.

Official YouTube API policy requires playback to happen through an approved YouTube player experience. YouTube Data API can provide metadata, search, channel, and playlist access, but it is not a YouTube Music subscription playback API.

## Product Shape

Add a new bottom tab named `YouTube`.

The tab should match the current Shuffle MuSic design language:

- Dark surface, orange accent, dense music-first layout.
- Search field at the top.
- Filter chips for `Songs`, `Videos`, `Playlists`, `Liked`, and `My Playlists`.
- Result rows with thumbnail, title, channel/artist, and duration when available.
- Queue panel for selected YouTube videos.
- Visible embedded YouTube player for playback.
- Clear handoff button: `Open in YouTube Music`.

## Google Account

Add Settings -> `Connect Google / YouTube`.

Use OAuth 2.0 PKCE for installed apps and request the smallest useful scope first:

- `https://www.googleapis.com/auth/youtube.readonly`

Store tokens in secure storage, not AsyncStorage. Keep the existing API-key path for unauthenticated artwork/search, but prefer OAuth for signed-in user playlists.

## API Use

Use YouTube Data API v3 for:

- Search music videos.
- Load the signed-in user's channel.
- Load the user's playlists.
- Load playlist items.
- Load liked videos where available.
- Read thumbnails and metadata for display.

Use the YouTube IFrame Player API for playback inside the app, hosted in a visible WebView area.

## Playback Rules

Local tracks keep using the current native player.

YouTube tracks use a separate `sourceType: 'youtube'` route:

- Display title, thumbnail, queue, and metadata in the Shuffle MuSic shell.
- Route play, pause, seek, next, and previous to the visible YouTube embedded player.
- Keep YouTube branding, controls, and attribution visible.
- Do not apply native EQ, local buffering, or offline cache to YouTube streams.
- Do not continue YouTube playback from a hidden/background player.

## Implementation Phases

1. Add `YouTube` tab shell and route.
2. Add Google OAuth connection in Settings.
3. Add YouTube Data API client for search and playlists.
4. Add visible WebView YouTube player wrapper.
5. Add YouTube queue state separate from local queue.
6. Add `Open in YouTube Music` handoff.
7. Add error states for quota, unavailable videos, age restrictions, and missing YouTube app.

## Acceptance Criteria

- User can connect a Google account.
- YouTube tab can search music videos.
- Signed-in user playlists load after consent.
- Selecting a result plays through a visible embedded YouTube player.
- Local playback, cache, album art, cast, EQ, and folder scan behavior remain unchanged.
- The app never downloads, extracts, or stores YouTube audiovisual content.
- The app never hides YouTube playback behind only the native iPod-style controls.

## References

- YouTube API Services Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- YouTube API Policy Guide: https://developers.google.com/youtube/terms/developer-policies-guide
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- OAuth 2.0 for Mobile and Desktop Apps: https://developers.google.com/youtube/v3/guides/auth/installed-apps
- YouTube Data API Playlists Guide: https://developers.google.com/youtube/v3/guides/implementation/playlists
