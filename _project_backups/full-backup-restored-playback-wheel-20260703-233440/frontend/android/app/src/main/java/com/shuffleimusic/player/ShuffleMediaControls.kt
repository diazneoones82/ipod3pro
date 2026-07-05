package com.shuffleimusic.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.media.AudioManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import kotlin.math.sin

object ShuffleMediaControls {
  private const val CHANNEL_ID = "shuffle_music_playback"
  private const val NOTIFICATION_ID = 4242
  private const val WIDGET_FRAME_MS = 320L
  const val ACTION_MEDIA_CONTROL = "com.shuffleimusic.player.MEDIA_CONTROL"
  const val EXTRA_MEDIA_ACTION = "media_action"

  private var session: MediaSessionCompat? = null
  private var tick = 0
  private var appContext: Context? = null
  private var lastTitle = "Shuffle MuSic"
  private var lastSubtitle = "Ready"
  private var lastArtworkUri: String? = null
  private var lastPlaying = false
  private val widgetHandler = Handler(Looper.getMainLooper())
  private val widgetTicker = object : Runnable {
    override fun run() {
      val context = appContext ?: return
      if (!lastPlaying) return
      updateWidgets(context, lastTitle, lastSubtitle, true, lastArtworkUri, scheduleNext = false)
      widgetHandler.postDelayed(this, WIDGET_FRAME_MS)
    }
  }

  fun update(context: Context, title: String, subtitle: String, isPlaying: Boolean, positionSec: Double, durationSec: Double, artworkUri: String?) {
    val app = context.applicationContext
    appContext = app
    lastTitle = title.ifBlank { "Shuffle MuSic" }
    lastSubtitle = subtitle.ifBlank { "Ready" }
    lastArtworkUri = artworkUri?.takeIf { it.isNotBlank() }
    lastPlaying = isPlaying

    ensureChannel(app)
    val albumArt = decodeAlbumArt(app, lastArtworkUri)
    val mediaSession = ensureSession(app)
    val actions = PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_STOP
    val metadata = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, lastTitle)
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, lastSubtitle)
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (durationSec * 1000).toLong().coerceAtLeast(0))
    albumArt?.let {
      metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
      metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it)
    }
    mediaSession.setMetadata(metadata.build())
    mediaSession.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(actions)
        .setState(
          if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
          (positionSec * 1000).toLong().coerceAtLeast(0),
          if (isPlaying) 1f else 0f
        )
        .build()
    )
    mediaSession.isActive = true

    val notification = NotificationCompat.Builder(app, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(lastTitle)
      .setContentText(lastSubtitle.ifBlank { "Ready to play" })
      .setContentIntent(openIntent(app, 100))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setOngoing(isPlaying)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .addAction(android.R.drawable.ic_media_previous, "Previous", controlIntent(app, "previous", 101))
      .addAction(if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (isPlaying) "Pause" else "Play", controlIntent(app, "toggle", 102))
      .addAction(android.R.drawable.ic_media_next, "Next", controlIntent(app, "next", 103))
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
    albumArt?.let { notification.setLargeIcon(it) }
    val built = notification.build()
    built.flags = built.flags or Notification.FLAG_NO_CLEAR
    notificationManager(app).notify(NOTIFICATION_ID, built)
    updateWidgets(app, lastTitle, lastSubtitle, isPlaying, lastArtworkUri)
  }

  private fun ensureSession(context: Context): MediaSessionCompat {
    session?.let { return it }
    return MediaSessionCompat(context, "ShuffleMuSic").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() { dispatchMediaAction(context, "play") }
        override fun onPause() { dispatchMediaAction(context, "pause") }
        override fun onSkipToNext() { dispatchMediaAction(context, "next") }
        override fun onSkipToPrevious() { dispatchMediaAction(context, "previous") }
        override fun onStop() { dispatchMediaAction(context, "stop") }
      })
      session = this
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Shuffle MuSic playback", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Lock screen and notification playback controls"
      setSound(null, null)
      enableVibration(false)
    }
    notificationManager(context).createNotificationChannel(channel)
  }

  private fun notificationManager(context: Context) =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun controlIntent(context: Context, action: String, requestCode: Int): PendingIntent {
    val intent = Intent(context, ShuffleMediaActionReceiver::class.java).apply {
      this.action = ACTION_MEDIA_CONTROL
      putExtra(EXTRA_MEDIA_ACTION, action)
    }
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun openIntent(context: Context, requestCode: Int): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun dispatchMediaAction(context: Context, action: String) {
    if (action == "volume_up" || action == "volume_down") {
      val audio = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.adjustStreamVolume(
        AudioManager.STREAM_MUSIC,
        if (action == "volume_up") AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER,
        AudioManager.FLAG_SHOW_UI
      )
    }
    ShuffleEqualizerModule.dispatchMediaAction(context.applicationContext, action)
  }

  private fun startWidgetTicker() {
    widgetHandler.removeCallbacks(widgetTicker)
    widgetHandler.postDelayed(widgetTicker, WIDGET_FRAME_MS)
  }

  private fun stopWidgetTicker() {
    widgetHandler.removeCallbacks(widgetTicker)
  }

  fun updateWidgets(
    context: Context,
    title: String = lastTitle,
    subtitle: String = lastSubtitle,
    isPlaying: Boolean = lastPlaying,
    artworkUri: String? = lastArtworkUri,
    scheduleNext: Boolean = true
  ) {
    val app = context.applicationContext
    appContext = app
    lastTitle = title.ifBlank { "Shuffle MuSic" }
    lastSubtitle = subtitle.ifBlank { "Ready" }
    lastArtworkUri = artworkUri?.takeIf { it.isNotBlank() }
    lastPlaying = isPlaying
    tick = (tick + 1) % 96

    updateClassicWidgets(app)
    updateWheelWidgets(app)

    if (scheduleNext) {
      if (isPlaying) startWidgetTicker() else stopWidgetTicker()
    }
  }

  private fun updateClassicWidgets(app: Context) {
    val manager = AppWidgetManager.getInstance(app)
    val ids = manager.getAppWidgetIds(ComponentName(app, ShuffleMusicWidgetProvider::class.java))
    if (ids.isEmpty()) return
    val views = RemoteViews(app.packageName, R.layout.shuffle_music_widget)
    views.setTextViewText(R.id.widget_title, lastTitle)
    views.setTextViewText(R.id.widget_subtitle, lastSubtitle)
    views.setTextViewText(R.id.widget_play, if (lastPlaying) "Pause" else "Play")
    views.setImageViewBitmap(R.id.widget_visualizer, renderWidgetVisualizer(lastPlaying))
    views.setOnClickPendingIntent(R.id.widget_prev, controlIntent(app, "previous", 301))
    views.setOnClickPendingIntent(R.id.widget_play, controlIntent(app, "toggle", 302))
    views.setOnClickPendingIntent(R.id.widget_next, controlIntent(app, "next", 303))
    views.setOnClickPendingIntent(R.id.widget_root, openIntent(app, 304))
    manager.updateAppWidget(ids, views)
  }

  private fun updateWheelWidgets(app: Context) {
    val manager = AppWidgetManager.getInstance(app)
    val ids = manager.getAppWidgetIds(ComponentName(app, ShuffleMusicWheelWidgetProvider::class.java))
    if (ids.isEmpty()) return
    val views = RemoteViews(app.packageName, R.layout.shuffle_music_wheel_widget)
    views.setImageViewBitmap(R.id.wheel_widget_glow, renderWheelGlow(lastPlaying))
    views.setOnClickPendingIntent(R.id.wheel_widget_prev, controlIntent(app, "previous", 401))
    views.setOnClickPendingIntent(R.id.wheel_widget_next, controlIntent(app, "next", 402))
    views.setOnClickPendingIntent(R.id.wheel_widget_play, controlIntent(app, "toggle", 403))
    views.setOnClickPendingIntent(R.id.wheel_widget_vol_up, controlIntent(app, "volume_up", 404))
    views.setOnClickPendingIntent(R.id.wheel_widget_vol_down, controlIntent(app, "volume_down", 405))
    views.setOnClickPendingIntent(R.id.wheel_widget_root, openIntent(app, 406))
    manager.updateAppWidget(ids, views)
  }

  private fun renderWidgetVisualizer(isPlaying: Boolean): Bitmap {
    val width = 420
    val height = 38
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(if (isPlaying) 90 else 35, 0, 245, 255)
      strokeWidth = 2f
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val barCount = 44
    val gap = 3.5f
    val barWidth = (width - gap * (barCount + 1)) / barCount
    val center = height / 2f
    val phase = tick * 0.34

    canvas.drawColor(Color.TRANSPARENT)
    canvas.drawLine(0f, center, width.toFloat(), center, glow)

    for (i in 0 until barCount) {
      val wave = if (isPlaying) {
        val a = sin(i * 0.55 + phase)
        val b = sin(i * 0.18 - phase * 1.6)
        ((a + b + 2.0) / 4.0).toFloat()
      } else {
        0.16f + (i % 7) * 0.025f
      }
      val barHeight = 5f + wave * 30f
      val left = gap + i * (barWidth + gap)
      val top = center - barHeight / 2f
      val right = left + barWidth
      val bottom = center + barHeight / 2f
      paint.shader = LinearGradient(
        left,
        top,
        right,
        bottom,
        intArrayOf(Color.rgb(0, 245, 255), Color.rgb(50, 255, 120), Color.rgb(255, 0, 204), Color.rgb(255, 176, 0)),
        null,
        Shader.TileMode.CLAMP
      )
      paint.alpha = if (isPlaying) 245 else 95
      canvas.drawRoundRect(RectF(left, top, right, bottom), barWidth, barWidth, paint)
    }
    paint.shader = null
    return bitmap
  }

  private fun renderWheelGlow(isPlaying: Boolean): Bitmap {
    val size = 360
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val center = size / 2f
    val breath = if (isPlaying) 0.52f + 0.48f * ((sin(tick * 0.13) + 1f) / 2f).toFloat() else 0.42f
    val outerGlow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 18f + breath * 18f
      shader = LinearGradient(
        0f,
        0f,
        size.toFloat(),
        size.toFloat(),
        intArrayOf(Color.rgb(0, 245, 255), Color.rgb(255, 0, 204), Color.rgb(255, 196, 0), Color.rgb(30, 255, 120), Color.rgb(0, 245, 255)),
        null,
        Shader.TileMode.MIRROR
      )
      alpha = if (isPlaying) (110 + breath * 125).toInt() else 90
    }
    val wheelFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = RadialGradient(
        center - 40f,
        center - 52f,
        center * 1.15f,
        intArrayOf(Color.rgb(238, 239, 248), Color.rgb(150, 153, 170), Color.rgb(64, 66, 82)),
        floatArrayOf(0f, 0.55f, 1f),
        Shader.TileMode.CLAMP
      )
    }
    val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(150, 0, 0, 0)
    }
    val inner = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = RadialGradient(center, center, center * 0.34f, Color.rgb(28, 28, 42), Color.rgb(4, 5, 12), Shader.TileMode.CLAMP)
    }
    val innerStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 5f
      color = Color.argb(130, 255, 255, 255)
    }
    val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(235, 30, 31, 42)
      textAlign = Paint.Align.CENTER
      typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    val innerLabel = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(235, 228, 230, 240)
      textAlign = Paint.Align.CENTER
      typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
    }
    canvas.drawColor(Color.TRANSPARENT)
    canvas.drawCircle(center, center + 7f, center - 23f, shadow)
    canvas.drawCircle(center, center, center - 24f, outerGlow)
    canvas.drawCircle(center, center, center - 42f, wheelFill)
    canvas.drawCircle(center, center, center * 0.34f, inner)
    canvas.drawCircle(center, center, center * 0.34f, innerStroke)
    label.textSize = 44f
    canvas.drawText("+", center, center - 96f, label)
    canvas.drawText("-", center, center + 124f, label)
    label.textSize = 21f
    canvas.drawText("PREV", center - 108f, center + 8f, label)
    canvas.drawText("NEXT", center + 108f, center + 8f, label)
    innerLabel.textSize = if (isPlaying) 42f else 24f
    canvas.drawText(if (isPlaying) "II" else "PLAY", center, center + if (isPlaying) 14f else 8f, innerLabel)
    return bitmap
  }

  private fun decodeAlbumArt(context: Context, artworkUri: String?): Bitmap? {
    if (artworkUri.isNullOrBlank()) return null
    return try {
      context.contentResolver.openInputStream(Uri.parse(artworkUri))?.use { stream ->
        scaleBitmap(BitmapFactory.decodeStream(stream), 512)
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun scaleBitmap(bitmap: Bitmap?, maxSize: Int): Bitmap? {
    if (bitmap == null) return null
    val largest = maxOf(bitmap.width, bitmap.height)
    if (largest <= maxSize) return bitmap
    val scale = maxSize.toFloat() / largest.toFloat()
    return Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
  }
}
