package com.shuffleimusic.player

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject

class ShufflePlayerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private var activeReactContext: ReactApplicationContext? = null
  }

  init {
    activeReactContext = reactContext
    ShufflePlayerService.setReactEventContext(reactContext)
  }

  override fun getName() = "ShufflePlayer"

  @ReactMethod
  fun initPlayer(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_INIT)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_INIT", e.message)
    }
  }

  @ReactMethod
  fun loadQueue(tracks: ReadableArray, startIndex: Int, promise: Promise) {
    try {
      val jsonArr = JSONArray()
      for (i in 0 until tracks.size()) {
        val map = tracks.getMap(i) ?: continue
        val obj = JSONObject()
        if (map.hasKey("id")) obj.put("id", map.getString("id"))
        if (map.hasKey("uri")) obj.put("uri", map.getString("uri"))
        if (map.hasKey("filename")) obj.put("filename", map.getString("filename"))
        if (map.hasKey("title")) obj.put("title", map.getString("title"))
        if (map.hasKey("artist")) obj.put("artist", map.getString("artist"))
        if (map.hasKey("album")) obj.put("album", map.getString("album"))
        if (map.hasKey("duration")) obj.put("duration", map.getDouble("duration"))
        if (map.hasKey("artworkUri")) {
          val art = map.getString("artworkUri")
          if (!art.isNullOrBlank()) obj.put("artworkUri", art)
        }
        jsonArr.put(obj)
      }
      val intent = Intent(reactContext, ShufflePlayerService::class.java).apply {
        action = ShufflePlayerService.ACTION_LOAD_QUEUE
        putExtra(ShufflePlayerService.EXTRA_TRACKS, jsonArr.toString())
        putExtra(ShufflePlayerService.EXTRA_START_INDEX, startIndex)
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_LOAD", e.message)
    }
  }

  @ReactMethod
  fun play(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_PLAY)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_PLAY", e.message)
    }
  }

  @ReactMethod
  fun pause(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_PAUSE)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_PAUSE", e.message)
    }
  }

  @ReactMethod
  fun togglePlay(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_TOGGLE)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_TOGGLE", e.message)
    }
  }

  @ReactMethod
  fun next(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_NEXT)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_NEXT", e.message)
    }
  }

  @ReactMethod
  fun previous(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_PREVIOUS)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_PREV", e.message)
    }
  }

  @ReactMethod
  fun seekTo(positionMs: Double, promise: Promise) {
    try {
      val intent = Intent().apply {
        setClass(reactContext, ShufflePlayerService::class.java)
        action = ShufflePlayerService.ACTION_SEEK_TO
        putExtra(ShufflePlayerService.EXTRA_POSITION_MS, positionMs.toLong())
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_SEEK", e.message)
    }
  }

  @ReactMethod
  fun stopPlayback(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_STOP)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_STOP", e.message)
    }
  }

  @ReactMethod
  fun setRepeatMode(repeatMode: Int, promise: Promise) {
    try {
      val intent = Intent().apply {
        setClass(reactContext, ShufflePlayerService::class.java)
        action = ShufflePlayerService.ACTION_SET_REPEAT_MODE
        putExtra(ShufflePlayerService.EXTRA_REPEAT_MODE, repeatMode)
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_REPEAT", e.message)
    }
  }

  @ReactMethod
  fun setShuffleEnabled(enabled: Boolean, promise: Promise) {
    try {
      val intent = Intent().apply {
        setClass(reactContext, ShufflePlayerService::class.java)
        action = ShufflePlayerService.ACTION_SET_SHUFFLE
        putExtra(ShufflePlayerService.EXTRA_SHUFFLE_ENABLED, enabled)
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_SHUFFLE", e.message)
    }
  }

  @ReactMethod
  fun setVolume(volume: Double, promise: Promise) {
    try {
      val intent = Intent().apply {
        setClass(reactContext, ShufflePlayerService::class.java)
        action = ShufflePlayerService.ACTION_SET_VOLUME
        putExtra(ShufflePlayerService.EXTRA_VOLUME, volume.toFloat().coerceIn(0f, 1f))
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_VOLUME", e.message)
    }
  }

  @ReactMethod
  fun setGaplessEnabled(enabled: Boolean, promise: Promise) {
    try {
      val intent = Intent(reactContext, ShufflePlayerService::class.java).apply {
        action = ShufflePlayerService.ACTION_SET_GAPLESS
        putExtra(ShufflePlayerService.EXTRA_GAPLESS_ENABLED, enabled)
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_GAPLESS", e.message)
    }
  }

  // ── Cast bridge methods ──────────────────────────────────────────────────

  @ReactMethod
  fun isCastAvailable(promise: Promise) {
    try {
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_CAST_AVAIL", e.message)
    }
  }

  @ReactMethod
  fun castLoadQueue(tracks: ReadableArray, startIndex: Int, promise: Promise) {
    try {
      val jsonArr = JSONArray()
      for (i in 0 until tracks.size()) {
        val map = tracks.getMap(i) ?: continue
        val obj = JSONObject()
        if (map.hasKey("id")) obj.put("id", map.getString("id"))
        if (map.hasKey("uri")) obj.put("uri", map.getString("uri"))
        if (map.hasKey("filename")) obj.put("filename", map.getString("filename"))
        if (map.hasKey("title")) obj.put("title", map.getString("title"))
        if (map.hasKey("artist")) obj.put("artist", map.getString("artist"))
        if (map.hasKey("album")) obj.put("album", map.getString("album"))
        if (map.hasKey("duration")) obj.put("duration", map.getDouble("duration"))
        if (map.hasKey("albumId")) obj.put("albumId", map.getString("albumId"))
        jsonArr.put(obj)
      }
      val intent = Intent(reactContext, ShufflePlayerService::class.java).apply {
        action = ShufflePlayerService.ACTION_CAST_LOAD
        putExtra(ShufflePlayerService.EXTRA_CAST_TRACKS, jsonArr.toString())
        putExtra(ShufflePlayerService.EXTRA_CAST_START_INDEX, startIndex)
      }
      startService(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_CAST_LOAD", e.message)
    }
  }

  @ReactMethod
  fun castPlay(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_CAST_PLAY)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_CAST_PLAY", e.message)
    }
  }

  @ReactMethod
  fun castPause(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_CAST_PAUSE)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_CAST_PAUSE", e.message)
    }
  }

  @ReactMethod
  fun castTogglePlay(promise: Promise) {
    try {
      sendToService(ShufflePlayerService.ACTION_CAST_TOGGLE)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_CAST_TOGGLE", e.message)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for React Native event emitter bookkeeping
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for React Native event emitter bookkeeping
  }

  private fun sendToService(action: String) {
    val intent = Intent(reactContext, ShufflePlayerService::class.java).apply {
      this.action = action
    }
    startService(intent)
  }

  private fun startService(intent: Intent) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }
}
