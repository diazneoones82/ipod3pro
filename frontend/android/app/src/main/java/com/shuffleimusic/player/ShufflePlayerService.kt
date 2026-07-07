package com.shuffleimusic.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject

class ShufflePlayerService : MediaBrowserServiceCompat() {
  private var castManager: ShuffleCastManager? = null
  private var castActive = false
  private var pendingCastQueue: String? = null
  private var pendingCastIndex: Int = 0
  private var pendingCastPositionMs: Long = 0
  private var autoMusicProvider: AutoMusicProvider? = null
  private var packageValidator: PackageValidator? = null

  companion object {
    const val ACTION_INIT = "init"
    const val ACTION_LOAD_QUEUE = "load_queue"
    const val ACTION_PLAY = "play"
    const val ACTION_PAUSE = "pause"
    const val ACTION_TOGGLE = "toggle"
    const val ACTION_NEXT = "next"
    const val ACTION_PREVIOUS = "previous"
    const val ACTION_SEEK_TO = "seek_to"
    const val ACTION_SET_REPEAT_MODE = "set_repeat"
    const val ACTION_SET_SHUFFLE = "set_shuffle"
    const val ACTION_SET_VOLUME = "set_volume"
    const val ACTION_STOP = "stop"
    const val ACTION_CAST_CONNECTED = "cast_connected"
    const val ACTION_SET_GAPLESS = "set_gapless"
    const val ACTION_CAST_DISCONNECTED = "cast_disconnected"
    const val ACTION_CAST_LOAD = "cast_load"
    const val ACTION_CAST_PLAY = "cast_play"
    const val ACTION_CAST_PAUSE = "cast_pause"
    const val ACTION_CAST_TOGGLE = "cast_toggle"

    const val EXTRA_TRACKS = "tracks"
    const val EXTRA_START_INDEX = "start_index"
    const val EXTRA_POSITION_MS = "position_ms"
    const val EXTRA_REPEAT_MODE = "repeat_mode"
    const val EXTRA_SHUFFLE_ENABLED = "shuffle_enabled"
    const val EXTRA_VOLUME = "volume"
    const val EXTRA_GAPLESS_ENABLED = "gapless_enabled"
    const val EXTRA_CAST_TRACKS = "cast_tracks"
    const val EXTRA_CAST_START_INDEX = "cast_start_index"

    const val EVENT_PLAYBACK_STATE = "ShufflePlaybackState"
    const val EVENT_TRACK_CHANGED = "ShuffleTrackChanged"
    const val EVENT_PLAYBACK_ERROR = "ShufflePlaybackError"
    const val EVENT_QUEUE_ENDED = "ShuffleQueueEnded"
    const val EVENT_CAST_STATE = "ShuffleCastState"

    private const val CHANNEL_ID = "shuffle_music_playback_service"
    private const val NOTIFICATION_ID = 4243
    private const val TAG = "ShufflePlayerService"

    private var serviceInstance: ShufflePlayerService? = null
    private var reactEventContext: com.facebook.react.bridge.ReactApplicationContext? = null

    fun setReactEventContext(ctx: com.facebook.react.bridge.ReactApplicationContext?) {
      reactEventContext = ctx
    }

    fun getAudioSessionId(): Int {
      return serviceInstance?.exoPlayer?.audioSessionId ?: 0
    }

    fun getServiceInstance(): ShufflePlayerService? = serviceInstance

    fun getTracks(): List<TrackData> = serviceInstance?.tracks ?: emptyList()

    fun isPlaying(): Boolean = serviceInstance?.exoPlayer?.isPlaying ?: false

    fun getCurrentPosition(): Long = serviceInstance?.exoPlayer?.currentPosition ?: 0L

    fun getDuration(): Long = serviceInstance?.exoPlayer?.duration?.coerceAtLeast(0) ?: 0L

    fun getCurrentTrackData(): TrackData? {
      val s = serviceInstance ?: return null
      val idx = s.exoPlayer?.currentMediaItemIndex ?: return null
      return s.tracks.getOrNull(idx)
    }

    fun getExoPlayer(): androidx.media3.exoplayer.ExoPlayer? = serviceInstance?.exoPlayer
  }

  private var exoPlayer: ExoPlayer? = null
  private var mediaSession: MediaSessionCompat? = null
  private var tracks: List<TrackData> = emptyList()
  private var isForeground = false
  private var gaplessEnabled = true
  private var lastNotifyTitle = "Shuffle MuSic"
  private var lastNotifySubtitle = "Ready"
  private var lastNotifyArtworkUri: String? = null

  private val playerListener = object : Player.Listener {
    override fun onIsPlayingChanged(isPlaying: Boolean) {
      ensureNotification(isPlaying)
      updateMediaSessionPlaybackState()
      emitState()
      ShuffleMediaControls.updateWidgets(this@ShufflePlayerService)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      val index = exoPlayer?.currentMediaItemIndex ?: 0
      val track = tracks.getOrNull(index)
      if (track != null) {
        lastNotifyTitle = track.title
        lastNotifySubtitle = track.artist
        lastNotifyArtworkUri = track.artworkUri
        updateMediaSessionMetadata()
        emitTrackChanged(index, track)
        ensureNotification(exoPlayer?.isPlaying == true)
        ShuffleMediaControls.updateWidgets(
          this@ShufflePlayerService,
          title = track.title,
          subtitle = track.artist,
          isPlaying = exoPlayer?.isPlaying == true,
          artworkUri = track.artworkUri
        )
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_ENDED) {
        emitQueueEnded()
      }
      updateMediaSessionPlaybackState()
      emitState()
    }

    override fun onPlayerError(error: PlaybackException) {
      emitError(error.message ?: "Playback error")
    }
  }

  override fun onCreate() {
    super.onCreate()
    serviceInstance = this
    autoMusicProvider = AutoMusicProvider(this)
    packageValidator = PackageValidator(this)
    initExoPlayer()
    initMediaSession()
    initCast()
  }

  override fun onGetRoot(
    clientPackageName: String,
    clientUid: Int,
    rootHints: Bundle?
  ): BrowserRoot {
    if (packageValidator?.isKnownCaller(clientPackageName, clientUid) == false) {
      return BrowserRoot(AutoMediaIDHelper.MEDIA_ID_EMPTY_ROOT, null)
    }
    return BrowserRoot(AutoMediaIDHelper.MEDIA_ID_ROOT, null)
  }

  override fun onLoadChildren(
    parentId: String,
    result: Result<MutableList<MediaBrowserCompat.MediaItem>>
  ) {
    result.sendResult(
      autoMusicProvider?.getChildren(parentId, tracks)?.toMutableList() ?: mutableListOf()
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    handleIntent(intent)
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? {
    if (intent?.action == "android.media.browse.MediaBrowserService") {
      return super.onBind(intent)
    }
    return null
  }

  override fun onDestroy() {
    serviceInstance = null
    castManager?.release()
    castManager = null
    exoPlayer?.release()
    exoPlayer = null
    mediaSession?.release()
    mediaSession = null
    if (isForeground) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      isForeground = false
    }
    stopSelf()
    super.onDestroy()
  }

  private fun initExoPlayer() {
    val attrs = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.CONTENT_TYPE_MUSIC)
      .build()
    exoPlayer = ExoPlayer.Builder(this)
      .setAudioAttributes(attrs, true)
      .setHandleAudioBecomingNoisy(true)
      .setRenderersFactory(PeqRenderersFactory(this))
      .build()
      .apply {
        addListener(playerListener)
        repeatMode = Player.REPEAT_MODE_OFF
        shuffleModeEnabled = false
        pauseAtEndOfMediaItems = false
      }
  }

  private fun initMediaSession() {
    mediaSession = MediaSessionCompat(this, "ShuffleMuSic").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() { exoPlayer?.play() }
        override fun onPause() { exoPlayer?.pause() }
        override fun onSkipToNext() { exoPlayer?.seekToNext() }
        override fun onSkipToPrevious() { exoPlayer?.seekToPrevious() }
        override fun onStop() { stopPlayback() }
        override fun onSeekTo(pos: Long) { exoPlayer?.seekTo(pos) }

        override fun onPlayFromMediaId(mediaId: String, extras: Bundle?) {
          Log.d(TAG, "onPlayFromMediaId: $mediaId")
          val category = AutoMediaIDHelper.getCategory(mediaId)
          val value = AutoMediaIDHelper.getValue(mediaId)
          if (category == "song" && value != null) {
            playSongFromMediaStore(value.toLongOrNull() ?: return)
          }
        }
      })
      isActive = true
    }
    sessionToken = mediaSession?.sessionToken
  }

  private fun playSongFromMediaStore(songId: Long) {
    try {
      val uri = android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      val projection = arrayOf(
        android.provider.MediaStore.Audio.Media._ID,
        android.provider.MediaStore.Audio.Media.TITLE,
        android.provider.MediaStore.Audio.Media.ARTIST,
        android.provider.MediaStore.Audio.Media.ALBUM,
        android.provider.MediaStore.Audio.Media.ALBUM_ID,
        android.provider.MediaStore.Audio.Media.DURATION,
        android.provider.MediaStore.Audio.Media.DATA
      )
      val selection = "${android.provider.MediaStore.Audio.Media._ID} = ?"
      var cursor: android.database.Cursor? = null
      try {
        cursor = contentResolver.query(uri, projection, selection, arrayOf(songId.toString()), null)
        if (cursor?.moveToFirst() == true) {
          val id = cursor.getString(0) ?: return
          val title = cursor.getString(1) ?: "Unknown"
          val artist = cursor.getString(2) ?: "Unknown"
          val album = cursor.getString(3) ?: ""
          val durationMs = cursor.getLong(5)
          val data = cursor.getString(6) ?: return

          val trackData = TrackData(
            id = id,
            uri = data,
            title = title,
            artist = artist,
            album = album,
            durationMs = durationMs,
            artworkUri = null
          )
          tracks = listOf(trackData)
          exoPlayer?.apply {
            stop()
            setMediaItems(listOf(MediaItem.fromUri(Uri.parse(data))))
            prepare()
            play()
          }
          updateMediaSessionMetadata()
          emitTrackChanged(0, trackData)
        }
      } finally {
        cursor?.close()
      }
    } catch (e: Exception) {
      Log.e(TAG, "playSongFromMediaStore error", e)
    }
  }

  private fun updateMediaSessionMetadata() {
    val track = tracks.getOrNull(exoPlayer?.currentMediaItemIndex ?: 0) ?: return
    val metadata = android.support.v4.media.MediaMetadataCompat.Builder()
      .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_TITLE, track.title)
      .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ARTIST, track.artist)
      .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM, track.album)
      .putLong(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DURATION, track.durationMs)
      .putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_MEDIA_ID, track.id)
      .build()
    mediaSession?.setMetadata(metadata)
  }

  private fun updateMediaSessionPlaybackState() {
    val p = exoPlayer ?: return
    val state = if (p.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    val playbackState = PlaybackStateCompat.Builder()
      .setActions(
        PlaybackStateCompat.ACTION_PLAY or
        PlaybackStateCompat.ACTION_PAUSE or
        PlaybackStateCompat.ACTION_PLAY_PAUSE or
        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
        PlaybackStateCompat.ACTION_STOP or
        PlaybackStateCompat.ACTION_SEEK_TO or
        PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
      )
      .setState(state, p.currentPosition, if (p.isPlaying) 1f else 0f)
      .build()
    mediaSession?.setPlaybackState(playbackState)
  }

  private fun initCast() {
    castManager = ShuffleCastManager.getInstance(this)
    castManager?.setListener(object : ShuffleCastManager.CastListener {
      override fun onCastConnected() {
        castActive = true
        exoPlayer?.pause()
        pendingCastQueue?.let { q ->
          castManager?.loadMedia(q, pendingCastIndex, pendingCastPositionMs)
          pendingCastQueue = null
          pendingCastIndex = 0
          pendingCastPositionMs = 0
        }
        emitState()
        emitCastEvent("connected", castManager?.getCastDeviceName() ?: "Cast Device")
      }
      override fun onCastDisconnected() {
        castActive = false
        emitCastEvent("disconnected", null)
      }
      override fun onCastMediaLoaded() {
        emitCastEvent("media_loaded", null)
      }
      override fun onCastTrackChanged(queueIndex: Int) {
        Log.d(TAG, "Cast track changed to index $queueIndex")
        exoPlayer?.let { p ->
          if (queueIndex in tracks.indices) {
            p.seekTo(queueIndex, C.TIME_UNSET)
            val track = tracks[queueIndex]
            if (track != null) {
              lastNotifyTitle = track.title
              lastNotifySubtitle = track.artist
              lastNotifyArtworkUri = track.artworkUri
              emitTrackChanged(queueIndex, track)
            }
          }
        }
        emitState()
      }
      override fun onCastError(message: String) {
        emitError("Cast: $message")
      }
    })
    castManager?.init()
  }

  private fun handleIntent(intent: Intent?) {
    if (intent == null) return
    when (intent.action) {
      ACTION_INIT -> { ensureNotification(false) }
      ACTION_LOAD_QUEUE -> {
        val tracksJson = intent.getStringExtra(EXTRA_TRACKS) ?: return
        val startIndex = intent.getIntExtra(EXTRA_START_INDEX, 0)
        loadQueue(tracksJson, startIndex)
      }
      ACTION_PLAY -> {
        if (castActive) castManager?.play() else exoPlayer?.play()
      }
      ACTION_PAUSE -> {
        if (castActive) castManager?.pause() else exoPlayer?.pause()
      }
      ACTION_TOGGLE -> {
        if (castActive) {
          castManager?.togglePlay()
        } else {
          val p = exoPlayer ?: return
          if (p.isPlaying) p.pause() else p.play()
        }
      }
      ACTION_NEXT -> {
        if (castActive) castManager?.next() else exoPlayer?.seekToNext()
      }
      ACTION_PREVIOUS -> {
        if (castActive) castManager?.previous() else exoPlayer?.seekToPrevious()
      }
      ACTION_SEEK_TO -> {
        if (castActive) {
          castManager?.seekTo(intent.getLongExtra(EXTRA_POSITION_MS, 0))
        } else {
          exoPlayer?.seekTo(intent.getLongExtra(EXTRA_POSITION_MS, 0))
        }
      }
      ACTION_STOP -> stopPlayback()
      ACTION_SET_REPEAT_MODE -> {
        exoPlayer?.repeatMode = intent.getIntExtra(EXTRA_REPEAT_MODE, Player.REPEAT_MODE_OFF)
      }
      ACTION_SET_SHUFFLE -> {
        exoPlayer?.shuffleModeEnabled = intent.getBooleanExtra(EXTRA_SHUFFLE_ENABLED, false)
      }
      ACTION_SET_GAPLESS -> {
        gaplessEnabled = intent.getBooleanExtra(EXTRA_GAPLESS_ENABLED, true)
      }
      ACTION_SET_VOLUME -> {
        exoPlayer?.volume = intent.getFloatExtra(EXTRA_VOLUME, 1f).coerceIn(0f, 1f)
      }
      ACTION_CAST_LOAD -> {
        val tracksJson = intent.getStringExtra(EXTRA_CAST_TRACKS) ?: return
        val startIndex = intent.getIntExtra(EXTRA_CAST_START_INDEX, 0)
        val positionMs = exoPlayer?.currentPosition ?: 0L
        if (castActive) {
          castManager?.loadMedia(tracksJson, startIndex, positionMs)
        } else {
          pendingCastQueue = tracksJson
          pendingCastIndex = startIndex
          pendingCastPositionMs = positionMs
        }
      }
      ACTION_CAST_PLAY -> castManager?.play()
      ACTION_CAST_PAUSE -> castManager?.pause()
      ACTION_CAST_TOGGLE -> castManager?.togglePlay()
      ACTION_CAST_CONNECTED -> { /* handled by listener */ }
      ACTION_CAST_DISCONNECTED -> { /* handled by listener */ }
    }
  }

  data class TrackData(
    val id: String,
    val uri: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val artworkUri: String?
  )

  private fun loadQueue(tracksJson: String, startIndex: Int) {
    try {
      val arr = JSONArray(tracksJson)
      val trackList = mutableListOf<TrackData>()
      val mediaItems = mutableListOf<MediaItem>()
      for (i in 0 until arr.length()) {
        val obj = arr.getJSONObject(i)
        val td = TrackData(
          id = obj.optString("id", ""),
          uri = obj.optString("uri", ""),
          title = obj.optString("title", obj.optString("filename", "Unknown")),
          artist = obj.optString("artist", ""),
          album = obj.optString("album", ""),
          durationMs = (obj.optDouble("duration", 0.0) * 1000).toLong().coerceAtLeast(0),
          artworkUri = obj.optString("artworkUri", null)?.takeIf { it.isNotBlank() }
        )
        trackList.add(td)
        mediaItems.add(MediaItem.fromUri(Uri.parse(td.uri)))
      }
      tracks = trackList
      exoPlayer?.apply {
        setMediaItems(mediaItems)
        prepare()
        if (startIndex in tracks.indices) {
          seekTo(startIndex, C.TIME_UNSET)
        }
        if (!castActive) {
          play()
        }
      }
      if (tracks.isNotEmpty()) {
        val track = tracks[startIndex.coerceIn(0, tracks.lastIndex)]
        lastNotifyTitle = track.title
        lastNotifySubtitle = track.artist
        lastNotifyArtworkUri = track.artworkUri
        updateMediaSessionMetadata()
        emitTrackChanged(startIndex, track)
      }
    } catch (e: Throwable) {
      Log.e(TAG, "loadQueue error", e)
      emitError("Failed to load queue: ${e.message}")
    }
  }

  private fun stopPlayback() {
    exoPlayer?.apply {
      stop()
      seekTo(0)
    }
    if (isForeground) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      isForeground = false
    }
    stopSelf()
  }

  private fun ensureNotification(isPlaying: Boolean) {
    val channelId = CHANNEL_ID
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(channelId, "Shuffle MuSic Playback", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Ongoing playback notification"
        setSound(null, null)
        enableVibration(false)
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
    val playPauseAction = if (isPlaying) {
      NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pause",
        controlPendingIntent("pause", 201))
    } else {
      NotificationCompat.Action(android.R.drawable.ic_media_play, "Play",
        controlPendingIntent("play", 201))
    }
    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(lastNotifyTitle)
      .setContentText(lastNotifySubtitle.ifBlank { "Ready to play" })
      .setContentIntent(openPendingIntent())
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(isPlaying)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .addAction(android.R.drawable.ic_media_previous, "Previous",
        controlPendingIntent("previous", 202))
      .addAction(playPauseAction)
      .addAction(android.R.drawable.ic_media_next, "Next",
        controlPendingIntent("next", 203))
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(mediaSession?.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
    if (!isForeground) {
      startForeground(NOTIFICATION_ID, notification)
      isForeground = true
    } else {
      ((getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)).notify(NOTIFICATION_ID, notification)
    }
  }

  private fun controlPendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, ShuffleMediaActionReceiver::class.java).apply {
      this.action = ShuffleMediaControls.ACTION_MEDIA_CONTROL
      putExtra(ShuffleMediaControls.EXTRA_MEDIA_ACTION, action)
    }
    return PendingIntent.getBroadcast(this, requestCode, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun openPendingIntent(): PendingIntent {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    return PendingIntent.getActivity(this, 100, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun emitState() {
    val p = exoPlayer ?: return
    val map = Arguments.createMap()
    map.putBoolean("isPlaying", if (castActive) true else p.isPlaying)
    map.putDouble("positionMs", p.currentPosition.toDouble())
    map.putDouble("durationMs", p.duration.coerceAtLeast(0).toDouble())
    map.putInt("currentIndex", p.currentMediaItemIndex)
    map.putInt("repeatMode", p.repeatMode)
    map.putBoolean("shuffleEnabled", p.shuffleModeEnabled)
    map.putInt("queueSize", tracks.size)
    map.putBoolean("castActive", castActive)
    emitEvent(EVENT_PLAYBACK_STATE, map)
  }

  private fun emitTrackChanged(index: Int, track: TrackData) {
    val map = Arguments.createMap()
    map.putInt("index", index)
    map.putString("trackId", track.id)
    map.putString("title", track.title)
    map.putString("artist", track.artist)
    map.putString("album", track.album)
    map.putString("artworkUri", track.artworkUri)
    map.putDouble("durationMs", track.durationMs.toDouble())
    emitEvent(EVENT_TRACK_CHANGED, map)
  }

  private fun emitError(message: String) {
    val map = Arguments.createMap()
    map.putString("message", message)
    emitEvent(EVENT_PLAYBACK_ERROR, map)
  }

  private fun emitQueueEnded() {
    emitEvent(EVENT_QUEUE_ENDED, null)
  }

  private fun emitCastEvent(state: String, deviceName: String?) {
    val map = Arguments.createMap()
    map.putString("state", state)
    if (deviceName != null) map.putString("deviceName", deviceName)
    emitEvent(EVENT_CAST_STATE, map)
  }

  fun isCastActive(): Boolean = castActive

  private fun emitEvent(name: String, params: com.facebook.react.bridge.ReadableMap?) {
    reactEventContext?.let { ctx ->
      if (ctx.hasActiveReactInstance()) {
        ctx.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(name, params)
      }
    }
  }
}