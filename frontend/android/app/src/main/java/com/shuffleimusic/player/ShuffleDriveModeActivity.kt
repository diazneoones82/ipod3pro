package com.shuffleimusic.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class ShuffleDriveModeActivity : AppCompatActivity() {
  private var isPlaying = false
  private var trackTitle = "No Track Playing"
  private var trackArtist = "Ready"
  private var trackDurationMs = 0L
  private var trackPositionMs = 0L
  private var artworkUri: String? = null
  private val handler = Handler(Looper.getMainLooper())

  private lateinit var albumArt: ImageView
  private lateinit var closeBtn: ImageButton
  private lateinit var titleView: TextView
  private lateinit var artistView: TextView
  private lateinit var playPauseBtn: ImageButton
  private lateinit var nextBtn: ImageButton
  private lateinit var prevBtn: ImageButton
  private lateinit var shuffleBtn: ImageButton
  private lateinit var repeatBtn: ImageButton
  private lateinit var seekBar: SeekBar
  private lateinit var timeCurrent: TextView
  private lateinit var timeTotal: TextView

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_drive_mode)

    albumArt = findViewById(R.id.drive_album_art)
    closeBtn = findViewById(R.id.drive_close)
    titleView = findViewById(R.id.drive_title)
    artistView = findViewById(R.id.drive_artist)
    playPauseBtn = findViewById(R.id.drive_play_pause)
    nextBtn = findViewById(R.id.drive_next)
    prevBtn = findViewById(R.id.drive_previous)
    shuffleBtn = findViewById(R.id.drive_shuffle)
    repeatBtn = findViewById(R.id.drive_repeat)
    seekBar = findViewById(R.id.drive_progress)
    timeCurrent = findViewById(R.id.drive_time_current)
    timeTotal = findViewById(R.id.drive_time_total)

    closeBtn.setOnClickListener { finish() }
    playPauseBtn.setOnClickListener { sendAction(ShufflePlayerService.ACTION_TOGGLE) }
    nextBtn.setOnClickListener { sendAction(ShufflePlayerService.ACTION_NEXT) }
    prevBtn.setOnClickListener { sendAction(ShufflePlayerService.ACTION_PREVIOUS) }
    shuffleBtn.setOnClickListener { sendToggleShuffle() }
    repeatBtn.setOnClickListener { sendCycleRepeat() }

    seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
      private var isTracking = false
      override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {}
      override fun onStartTrackingTouch(seek: SeekBar) { isTracking = true }
      override fun onStopTrackingTouch(seek: SeekBar) {
        isTracking = false
        if (trackDurationMs > 0) {
          val pos = (seek.progress.toLong() * trackDurationMs) / seek.max
          sendSeekTo(pos)
        }
      }
    })

    val filter = IntentFilter().apply {
      addAction(ShuffleMediaControls.ACTION_MEDIA_CONTROL)
    }
    ContextCompat.registerReceiver(this, stateReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    startProgressUpdates()
  }

  override fun onResume() {
    super.onResume()
    refreshState()
  }

  override fun onDestroy() {
    super.onDestroy()
    handler.removeCallbacksAndMessages(null)
    try { unregisterReceiver(stateReceiver) } catch (_: Exception) {}
  }

  private fun sendAction(action: String) {
    startService(Intent(this, ShufflePlayerService::class.java).setAction(action))
  }

  private fun sendSeekTo(posMs: Long) {
    startService(Intent(this, ShufflePlayerService::class.java)
      .setAction(ShufflePlayerService.ACTION_SEEK_TO)
      .putExtra(ShufflePlayerService.EXTRA_POSITION_MS, posMs))
  }

  private fun sendToggleShuffle() {
    val enabled = !(ShufflePlayerService.getExoPlayer()?.shuffleModeEnabled ?: false)
    startService(Intent(this, ShufflePlayerService::class.java)
      .setAction(ShufflePlayerService.ACTION_SET_SHUFFLE)
      .putExtra(ShufflePlayerService.EXTRA_SHUFFLE_ENABLED, enabled))
  }

  private fun sendCycleRepeat() {
    val current = ShufflePlayerService.getExoPlayer()?.repeatMode ?: 0
    val next = (current + 1) % 3
    startService(Intent(this, ShufflePlayerService::class.java)
      .setAction(ShufflePlayerService.ACTION_SET_REPEAT_MODE)
      .putExtra(ShufflePlayerService.EXTRA_REPEAT_MODE, next))
  }

  private fun refreshState() {
    isPlaying = ShufflePlayerService.isPlaying()
    trackPositionMs = ShufflePlayerService.getCurrentPosition()
    trackDurationMs = ShufflePlayerService.getDuration()
    val track = ShufflePlayerService.getCurrentTrackData()
    if (track != null) {
      trackTitle = track.title
      trackArtist = track.artist
      artworkUri = track.artworkUri
    }
    updateUI()
  }

  private val stateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      refreshState()
    }
  }

  private fun startProgressUpdates() {
    handler.post(object : Runnable {
      override fun run() {
        if (!isDestroyed) {
          trackPositionMs = ShufflePlayerService.getCurrentPosition()
          isPlaying = ShufflePlayerService.isPlaying()
          playPauseBtn.setImageResource(
            if (isPlaying) android.R.drawable.ic_media_pause
            else android.R.drawable.ic_media_play
          )
          updateProgress()
          handler.postDelayed(this, 250)
        }
      }
    })
  }

  private fun updateUI() {
    titleView.text = trackTitle
    artistView.text = trackArtist
    playPauseBtn.setImageResource(
      if (isPlaying) android.R.drawable.ic_media_pause
      else android.R.drawable.ic_media_play
    )
    if (artworkUri != null) {
      try {
        val bmp = if (artworkUri!!.startsWith("content://") || artworkUri!!.startsWith("file://")) {
          val uri = Uri.parse(artworkUri)
          contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
        } else if (artworkUri!!.startsWith("/")) {
          BitmapFactory.decodeFile(artworkUri)
        } else null
        if (bmp != null) {
          albumArt.setImageBitmap(bmp)
          return
        }
      } catch (_: Exception) {}
    }
    albumArt.setImageResource(android.R.color.black)
    updateProgress()
  }

  private fun updateProgress() {
    val max = seekBar.max
    if (trackDurationMs > 0) {
      seekBar.progress = ((trackPositionMs * max) / trackDurationMs).toInt()
    }
    timeCurrent.text = formatTime(trackPositionMs)
    timeTotal.text = formatTime(trackDurationMs)
  }

  private fun formatTime(ms: Long): String {
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return "%d:%02d".format(min, sec)
  }
}