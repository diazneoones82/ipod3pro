package com.shuffleimusic.player

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import org.json.JSONArray
import org.json.JSONObject

class ShuffleCastManager(private val context: Context) {
  companion object {
    private const val TAG = "ShuffleCastManager"
    private var instance: ShuffleCastManager? = null

    fun getInstance(context: Context): ShuffleCastManager {
      if (instance == null) {
        instance = ShuffleCastManager(context.applicationContext)
      }
      return instance!!
    }
  }

  private var castContext: CastContext? = null
  private var remoteMediaClient: RemoteMediaClient? = null
  private var castSession: CastSession? = null
  private var webServer: RetroWebServer? = null
  private var isConnected = false
  private var listener: CastListener? = null
  private var queueItems: Array<MediaQueueItem> = emptyArray()
  private var lastCastItemId = -1

  interface CastListener {
    fun onCastConnected()
    fun onCastDisconnected()
    fun onCastMediaLoaded()
    fun onCastTrackChanged(queueIndex: Int)
    fun onCastError(message: String)
  }

  private val remoteListener = object : RemoteMediaClient.Listener {
    override fun onStatusUpdated() {
      val rmc = remoteMediaClient ?: return
      val status = rmc.mediaStatus ?: return
      val currentId = status.currentItemId
      if (currentId != 0 && currentId != lastCastItemId) {
        lastCastItemId = currentId
        val receiverItems = status.queueItems
        if (receiverItems != null) {
          val idx = receiverItems.indexOfFirst { it.itemId == currentId }
          if (idx >= 0) {
            Log.d(TAG, "Cast track changed to queue index $idx (itemId=$currentId)")
            listener?.onCastTrackChanged(idx)
          }
        }
      }
    }

    override fun onMetadataUpdated() {}
    override fun onQueueStatusUpdated() {
      val rmc = remoteMediaClient ?: return
      val status = rmc.mediaStatus ?: return
      val currentId = status.currentItemId
      if (currentId != 0 && currentId != lastCastItemId) {
        lastCastItemId = currentId
        val receiverItems = status.queueItems
        if (receiverItems != null) {
          val idx = receiverItems.indexOfFirst { it.itemId == currentId }
          if (idx >= 0) {
            Log.d(TAG, "Cast queue status updated — track index $idx (itemId=$currentId)")
            listener?.onCastTrackChanged(idx)
          }
        }
      }
    }

    override fun onPreloadStatusUpdated() {}
    override fun onAdBreakStatusUpdated() {}
    override fun onSendingRemoteMediaRequest() {}
  }

  private val sessionListener = object : SessionManagerListener<CastSession> {
    override fun onSessionStarted(session: CastSession, sessionId: String) {
      Log.d(TAG, "Cast session started: $sessionId")
      castSession = session
      remoteMediaClient = session.remoteMediaClient
      remoteMediaClient?.addListener(remoteListener)
      isConnected = true
      startWebServer()
      listener?.onCastConnected()
    }

    override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
      Log.d(TAG, "Cast session resumed")
      castSession = session
      remoteMediaClient = session.remoteMediaClient
      remoteMediaClient?.addListener(remoteListener)
      isConnected = true
      listener?.onCastConnected()
    }

    override fun onSessionEnded(session: CastSession, error: Int) {
      Log.d(TAG, "Cast session ended: error=$error")
      remoteMediaClient?.removeListener(remoteListener)
      castSession = null
      remoteMediaClient = null
      isConnected = false
      queueItems = emptyArray()
      lastCastItemId = -1
      stopWebServer()
      listener?.onCastDisconnected()
    }

    override fun onSessionSuspended(session: CastSession, reason: Int) {
      Log.d(TAG, "Cast session suspended")
    }

    override fun onSessionStarting(session: CastSession) {}
    override fun onSessionResuming(session: CastSession, sessionId: String) {}
    override fun onSessionStartFailed(session: CastSession, error: Int) {
      listener?.onCastError("Cast session start failed: $error")
    }
    override fun onSessionResumeFailed(session: CastSession, error: Int) {}
    override fun onSessionEnding(session: CastSession) {}
  }

  fun init() {
    try {
      castContext = CastContext.getSharedInstance(context)
      castContext?.sessionManager?.addSessionManagerListener(sessionListener, CastSession::class.java)
      castSession = castContext?.sessionManager?.currentCastSession
      if (castSession != null) {
        isConnected = true
        remoteMediaClient = castSession?.remoteMediaClient
        remoteMediaClient?.addListener(remoteListener)
        startWebServer()
      }
    } catch (e: Exception) {
      Log.e(TAG, "Cast init error", e)
    }
  }

  fun release() {
    try {
      remoteMediaClient?.removeListener(remoteListener)
      castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
    } catch (_: Exception) {}
    stopWebServer()
    isConnected = false
    castSession = null
    remoteMediaClient = null
    queueItems = emptyArray()
    lastCastItemId = -1
    instance = null
  }

  fun isCastConnected(): Boolean = isConnected

  fun setListener(l: CastListener?) { listener = l }

  fun loadMedia(tracksJson: String, startIndex: Int, startPositionMs: Long = 0) {
    if (!isConnected || remoteMediaClient == null) {
      listener?.onCastError("Not connected to Cast device")
      return
    }
    try {
      val arr = JSONArray(tracksJson)
      if (arr.length() == 0) return
      val startIdx = startIndex.coerceIn(0, arr.length() - 1)

      val buildItems = mutableListOf<MediaQueueItem>()
      for (i in 0 until arr.length()) {
        val obj = arr.getJSONObject(i)
        val songId = obj.optString("id", "")
        val title = obj.optString("title", obj.optString("filename", "Unknown"))
        val artist = obj.optString("artist", "")
        val album = obj.optString("album", "")
        val durationMs = (obj.optDouble("duration", 0.0) * 1000).toLong().coerceAtLeast(0)

        val serverUrl = webServer?.getUrl() ?: continue
        val contentUrl = "$serverUrl/song?id=$songId"
        val coverUrl = "$serverUrl/coverart?id=${obj.optString("albumId", songId)}"

        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK).apply {
          putString(MediaMetadata.KEY_TITLE, title)
          putString(MediaMetadata.KEY_ARTIST, artist)
          putString(MediaMetadata.KEY_ALBUM_TITLE, album)
          addImage(WebImage(Uri.parse(coverUrl)))
        }

        val mediaInfo = MediaInfo.Builder(contentUrl)
          .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
          .setContentType("audio/mpeg")
          .setMetadata(metadata)
          .setStreamDuration(durationMs)
          .build()

        val itemBuilder = MediaQueueItem.Builder(mediaInfo)
        if (i == startIdx && startPositionMs > 0) {
          itemBuilder.setStartTime(startPositionMs / 1000.0)
        }
        buildItems.add(itemBuilder.build())
      }

      if (buildItems.isEmpty()) return
      queueItems = buildItems.toTypedArray()
      lastCastItemId = -1
      val startItem = queueItems[startIdx]

      remoteMediaClient?.load(
        MediaLoadRequestData.Builder()
          .setMediaInfo(startItem.media)
          .setAutoplay(true)
          .build()
      )?.setResultCallback { result ->
        if (result.status.isSuccess) {
          remoteMediaClient?.queueLoad(
            queueItems, startIdx, 0, null
          )
          if (startPositionMs > 0) {
            remoteMediaClient?.seek(startPositionMs)
          }
          listener?.onCastMediaLoaded()
        } else {
          listener?.onCastError("Cast load failed: ${result.status.statusCode}")
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "loadMedia error", e)
      listener?.onCastError("Cast load error: ${e.message}")
    }
  }

  fun play() { remoteMediaClient?.play() }
  fun pause() { remoteMediaClient?.pause() }
  fun togglePlay() {
    val rmc = remoteMediaClient ?: return
    if (rmc.isPlaying) rmc.pause() else rmc.play()
  }
  fun seekTo(positionMs: Long) { remoteMediaClient?.seek(positionMs) }
  fun stop() { remoteMediaClient?.stop() }

  fun next() {
    remoteMediaClient?.queueNext(null)
  }

  fun previous() {
    remoteMediaClient?.queuePrev(null)
  }

  fun setVolume(vol: Double) {
    remoteMediaClient?.setStreamVolume(vol)
  }

  private fun startWebServer() {
    if (webServer == null) {
      webServer = RetroWebServer(context)
      webServer?.start()
      Log.d(TAG, "Web server started on port ${webServer?.port}")
    }
  }

  private fun stopWebServer() {
    webServer?.stop()
    webServer = null
  }

  fun getCastDeviceName(): String = castSession?.castDevice?.friendlyName ?: ""
}
