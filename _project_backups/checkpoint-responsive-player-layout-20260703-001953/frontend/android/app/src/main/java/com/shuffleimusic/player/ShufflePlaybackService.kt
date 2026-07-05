package com.shuffleimusic.player

import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.IBinder
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.DefaultAudioSink
import expo.modules.audio.PeqAudioProcessor

data class ShuffleQueueItem(
  val uri: String,
  val title: String,
  val subtitle: String,
  val artworkUri: String?,
  val durationSec: Double
)

class ShufflePlaybackService : Service() {
  private var player: ExoPlayer? = null
  private var queue: List<ShuffleQueueItem> = emptyList()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensurePlayer()
    pendingQueue?.let { pending ->
      pendingQueue = null
      setQueue(pending.items, pending.startIndex, pending.autoplay, pending.volume)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensurePlayer()
    publishForeground()
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    player?.release()
    player = null
    super.onDestroy()
  }

  private fun ensurePlayer(): ExoPlayer {
    player?.let { return it }
    val renderersFactory = object : DefaultRenderersFactory(this) {
      override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean
      ) = DefaultAudioSink.Builder(context)
        .setEnableFloatOutput(enableFloatOutput)
        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
        .setAudioProcessors(arrayOf(PeqAudioProcessor()))
        .build()
    }
    return ExoPlayer.Builder(this)
      .setRenderersFactory(renderersFactory)
      .build()
      .also { exo ->
        exo.addListener(object : Player.Listener {
          override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            log("native_track_transition index=${exo.currentMediaItemIndex} reason=$reason title=\"${currentItem()?.title.orEmpty()}\"")
            publishForeground()
            ShuffleEqualizerModule.emitNativePlaybackStatus(statusMap())
          }

          override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED) log("native_queue_ended index=${exo.currentMediaItemIndex} length=${queue.size}")
            publishForeground()
            ShuffleEqualizerModule.emitNativePlaybackStatus(statusMap())
          }

          override fun onIsPlayingChanged(isPlaying: Boolean) {
            log("native_is_playing=$isPlaying index=${exo.currentMediaItemIndex} title=\"${currentItem()?.title.orEmpty()}\"")
            publishForeground()
            ShuffleEqualizerModule.emitNativePlaybackStatus(statusMap())
          }
        })
        player = exo
      }
  }

  fun setQueue(items: List<ShuffleQueueItem>, startIndex: Int, autoplay: Boolean, volume: Float) {
    queue = items
    val exo = ensurePlayer()
    exo.setMediaItems(items.map { item ->
      MediaItem.Builder()
        .setUri(Uri.parse(item.uri))
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(item.title)
            .setArtist(item.subtitle)
            .setArtworkUri(item.artworkUri?.let { Uri.parse(it) })
            .build()
        )
        .build()
    }, startIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0)), 0L)
    exo.volume = volume.coerceIn(0f, 1f)
    exo.prepare()
    if (autoplay) exo.play()
    publishForeground()
    log("native_queue_set index=${exo.currentMediaItemIndex} length=${items.size} autoplay=$autoplay")
  }

  fun playIndex(index: Int) {
    val exo = ensurePlayer()
    if (queue.isEmpty()) return
    exo.seekToDefaultPosition(index.coerceIn(0, queue.lastIndex))
    exo.play()
    publishForeground()
  }

  fun toggle() {
    val exo = ensurePlayer()
    if (exo.isPlaying) exo.pause() else exo.play()
    publishForeground()
  }

  fun play() {
    ensurePlayer().play()
    publishForeground()
  }

  fun pause() {
    ensurePlayer().pause()
    publishForeground()
  }

  fun stopPlayback() {
    ensurePlayer().pause()
    publishForeground()
  }

  fun next() {
    val exo = ensurePlayer()
    if (exo.hasNextMediaItem()) exo.seekToNextMediaItem() else if (queue.isNotEmpty()) exo.seekToDefaultPosition(0)
    exo.play()
    publishForeground()
  }

  fun previous() {
    val exo = ensurePlayer()
    if (exo.currentPosition > 3000) exo.seekTo(0) else if (exo.hasPreviousMediaItem()) exo.seekToPreviousMediaItem() else if (queue.isNotEmpty()) exo.seekToDefaultPosition(queue.lastIndex)
    exo.play()
    publishForeground()
  }

  fun seekTo(sec: Double) {
    ensurePlayer().seekTo((sec * 1000).toLong().coerceAtLeast(0))
  }

  fun setVolume(volume: Float) {
    ensurePlayer().volume = volume.coerceIn(0f, 1f)
  }

  fun statusMap(): Map<String, Any?> {
    val exo = player
    return mapOf(
      "active" to (exo != null && queue.isNotEmpty()),
      "isPlaying" to (exo?.isPlaying ?: false),
      "currentIndex" to (exo?.currentMediaItemIndex ?: -1),
      "positionSec" to ((exo?.currentPosition ?: 0L).toDouble() / 1000.0),
      "durationSec" to durationSec(),
      "queueLength" to queue.size,
      "title" to currentItem()?.title
    )
  }

  private fun durationSec(): Double {
    val d = player?.duration ?: 0L
    return if (d > 0) d.toDouble() / 1000.0 else currentItem()?.durationSec ?: 0.0
  }

  private fun currentItem(): ShuffleQueueItem? {
    val idx = player?.currentMediaItemIndex ?: -1
    return queue.getOrNull(idx)
  }

  private fun publishForeground() {
    val item = currentItem()
    val exo = player
    val title = item?.title ?: "Shuffle MuSic"
    val subtitle = item?.subtitle ?: "Ready"
    val isPlaying = exo?.isPlaying ?: false
    val position = ((exo?.currentPosition ?: 0L).toDouble() / 1000.0)
    val duration = durationSec()
    val notification = ShuffleMediaControls.update(this, title, subtitle, isPlaying, position, duration, item?.artworkUri)
    startForeground(4242, notification)
  }

  private fun log(message: String) {
    try { ShuffleEqualizerModule.appendDownloadsLog(applicationContext, message) } catch (_: Throwable) {}
  }

  companion object {
    private var instance: ShufflePlaybackService? = null
    private data class PendingQueue(val items: List<ShuffleQueueItem>, val startIndex: Int, val autoplay: Boolean, val volume: Float)
    private var pendingQueue: PendingQueue? = null

    fun ensure(context: Context): ShufflePlaybackService? {
      val app = context.applicationContext
      androidx.core.content.ContextCompat.startForegroundService(app, Intent(app, ShufflePlaybackService::class.java))
      return instance
    }

    fun startQueue(context: Context, items: List<ShuffleQueueItem>, startIndex: Int, autoplay: Boolean, volume: Float) {
      ensure(context)
      val service = instance
      if (service != null) service.setQueue(items, startIndex, autoplay, volume)
      else pendingQueue = PendingQueue(items, startIndex, autoplay, volume)
    }

    fun handleMediaAction(context: Context, action: String): Boolean {
      val service = ensure(context) ?: return false
      when (action) {
        "toggle" -> service.toggle()
        "play" -> service.play()
        "pause", "phone_pause" -> service.pause()
        "phone_resume" -> service.play()
        "next" -> service.next()
        "previous" -> service.previous()
        "stop" -> service.stopPlayback()
        else -> return false
      }
      return true
    }

    fun currentStatus(): Map<String, Any?> = instance?.statusMap() ?: mapOf(
      "active" to false,
      "isPlaying" to false,
      "currentIndex" to -1,
      "positionSec" to 0.0,
      "durationSec" to 0.0,
      "queueLength" to 0
    )
  }
}
