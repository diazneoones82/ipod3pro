package com.shuffleimusic.player

import android.app.ActivityManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ShuffleEqualizerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private var lastStatus = "idle"
  private var lastMessage = "DSP not synced yet"
  private var lastAppliedAt = 0.0
  private var lastBandCount = 0

  init {
    activeReactContext = reactContext
  }

  override fun getName() = "ShuffleEqualizer"

  @ReactMethod
  fun applyPeq(enabled: Boolean, preamp: Double, bands: ReadableArray, promise: Promise) {
    applyAudioEffects(
      enabled = enabled,
      preamp = preamp,
      bands = bands,
      loudnessDb = 0.0,
      stereoWidth = 1.0,
      bassBoostDb = 0.0,
      virtualizerStrength = 0.0,
      reverbPreset = -1,
      promise = promise
    )
  }

  @ReactMethod
  fun applyAudioEffects(
    enabled: Boolean,
    preamp: Double,
    bands: ReadableArray,
    loudnessDb: Double,
    stereoWidth: Double,
    bassBoostDb: Double,
    virtualizerStrength: Double,
    reverbPreset: Int,
    promise: Promise
  ) {
    try {
      val parsed = ArrayList<ShufflePeqBand>()
      for (i in 0 until bands.size()) {
        val map = bands.getMap(i) ?: continue
        parsed.add(
          ShufflePeqBand(
            enabled = if (map.hasKey("enabled")) map.getBoolean("enabled") else true,
            type = if (map.hasKey("type")) map.getString("type") ?: "PK" else "PK",
            freq = if (map.hasKey("freq")) map.getDouble("freq") else 1000.0,
            gain = if (map.hasKey("gain")) map.getDouble("gain") else 0.0,
            q = if (map.hasKey("q")) map.getDouble("q") else 1.0
          )
        )
      }
      ShufflePeqDspConfigStore.update(
        ShufflePeqConfig(
          enabled = enabled,
          preamp = preamp,
          bands = parsed,
          loudnessDb = loudnessDb,
          stereoWidth = stereoWidth,
          bassBoostDb = bassBoostDb,
          virtualizerStrength = virtualizerStrength,
          reverbPreset = reverbPreset
        )
      )

      lastStatus = if (enabled) "active" else "bypassed"
      lastMessage = if (enabled) "Native PEQ DSP synced" else "Native PEQ DSP bypassed"
      lastAppliedAt = System.currentTimeMillis().toDouble()
      lastBandCount = parsed.size
      promise.resolve(statusMap())
    } catch (e: Throwable) {
      lastStatus = "unavailable"
      lastMessage = e.cause?.message ?: e.message ?: "Native PEQ DSP unavailable"
      lastAppliedAt = System.currentTimeMillis().toDouble()
      lastBandCount = 0
      promise.resolve(statusMap())
    }
  }

  @ReactMethod
  fun release(promise: Promise) {
    applyPeq(false, 0.0, Arguments.createArray(), promise)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(statusMap())
  }

  @ReactMethod
  fun getAudioMetadata(assetIds: ReadableArray, promise: Promise) {
    try {
      val ids = ArrayList<String>()
      for (i in 0 until assetIds.size()) {
        val id = when (assetIds.getType(i).name) {
          "String" -> assetIds.getString(i)
          "Number" -> assetIds.getDouble(i).toLong().toString()
          else -> null
        }
        if (!id.isNullOrBlank() && id.toLongOrNull() != null) ids.add(id)
      }

      val result = Arguments.createMap()
      if (ids.isEmpty()) {
        promise.resolve(result)
        return
      }

      val projection = arrayOf(
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.ALBUM_ID,
        MediaStore.Audio.Media.DURATION
      )

      ids.chunked(300).forEach { chunk ->
        val placeholders = chunk.joinToString(",") { "?" }
        reactContext.contentResolver.query(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          projection,
          "${MediaStore.Audio.Media._ID} IN ($placeholders)",
          chunk.toTypedArray(),
          null
        )?.use { cursor ->
          val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
          val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
          val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
          val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
          val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
          val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
          while (cursor.moveToNext()) {
            val id = cursor.getLong(idCol).toString()
            val meta = Arguments.createMap()
            putCleanString(meta, "title", cursor.getString(titleCol))
            putCleanString(meta, "artist", cursor.getString(artistCol))
            putCleanString(meta, "contributingArtist", cursor.getString(artistCol))
            putCleanString(meta, "album", cursor.getString(albumCol))
            if (!cursor.isNull(albumIdCol)) meta.putString("albumId", cursor.getLong(albumIdCol).toString())
            if (!cursor.isNull(durationCol)) meta.putDouble("durationMs", cursor.getLong(durationCol).toDouble())
            result.putMap(id, meta)
          }
        }
      }

      promise.resolve(result)
    } catch (e: Throwable) {
      promise.reject("E_AUDIO_METADATA", e.message ?: "Audio metadata lookup failed", e)
    }
  }

  @ReactMethod
  fun updateMediaStatus(title: String, subtitle: String, isPlaying: Boolean, positionSec: Double, durationSec: Double, artworkUri: String?, promise: Promise) {
    try {
      ShuffleMediaControls.update(reactContext, title, subtitle, isPlaying, positionSec, durationSec, artworkUri)
      val result = Arguments.createMap()
      result.putBoolean("ok", true)
      promise.resolve(result)
    } catch (e: Throwable) {
      promise.reject("E_MEDIA_CONTROLS", e.message ?: "Media controls update failed", e)
    }
  }

  @ReactMethod
  fun consumePendingMediaAction(promise: Promise) {
    val action = reactContext
      .getSharedPreferences(PREFS_NAME, 0)
      .getString(PENDING_MEDIA_ACTION_KEY, null)
    if (action == null) {
      promise.resolve(null)
      return
    }
    reactContext.getSharedPreferences(PREFS_NAME, 0).edit().remove(PENDING_MEDIA_ACTION_KEY).apply()
    promise.resolve(action)
  }

  @ReactMethod
  fun appendDiagnosticsLog(line: String, promise: Promise) {
    try {
      appendDownloadsLog(reactContext, line)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_DIAGNOSTIC_LOG", e.message ?: "Could not write diagnostics log", e)
    }
  }

  @ReactMethod
  fun exportStartupLogcat(promise: Promise) {
    try {
      val pid = android.os.Process.myPid().toString()
      val process = ProcessBuilder("logcat", "-d", "--pid=$pid", "-v", "time", "*:I")
        .redirectErrorStream(true)
        .start()
      val text = process.inputStream.bufferedReader().use { it.readText() }.takeLast(180_000)
      appendDownloadsLog(reactContext, "----- app startup logcat pid=$pid -----\n$text\n----- end startup logcat -----")
      promise.resolve(true)
    } catch (e: Throwable) {
      appendDownloadsLog(reactContext, "startup logcat unavailable: ${e.message ?: e.javaClass.simpleName}")
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getBackgroundDiagnostics(promise: Promise) {
    try {
      val power = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      val connectivity = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      val activity = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val memory = ActivityManager.MemoryInfo().also { activity?.getMemoryInfo(it) }
      val map = Arguments.createMap()
      map.putBoolean("ignoringBatteryOptimizations", power?.isIgnoringBatteryOptimizations(reactContext.packageName) ?: false)
      map.putBoolean("powerSaveMode", power?.isPowerSaveMode ?: false)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        map.putInt("restrictBackgroundStatus", connectivity?.restrictBackgroundStatus ?: -1)
      }
      map.putBoolean("lowMemory", memory.lowMemory)
      map.putDouble("availMemMb", memory.availMem.toDouble() / (1024.0 * 1024.0))
      promise.resolve(map)
    } catch (e: Throwable) {
      promise.reject("E_BACKGROUND_DIAGNOSTICS", e.message ?: "Diagnostics unavailable", e)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for React Native event emitter bookkeeping.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for React Native event emitter bookkeeping.
  }

  private fun statusMap() = Arguments.createMap().apply {
    val dsp = ShufflePeqDspConfigStore.statusSnapshot()
    putString("status", lastStatus)
    putString("message", lastMessage)
    putDouble("lastAppliedAt", lastAppliedAt)
    putInt("bandCount", lastBandCount)
    putDouble("processorCreatedAt", (dsp["processorCreatedAt"] as? Number)?.toDouble() ?: 0.0)
    putDouble("lastProcessedAt", (dsp["lastProcessedAt"] as? Number)?.toDouble() ?: 0.0)
    putInt("processedBuffers", (dsp["processedBuffers"] as? Number)?.toInt() ?: 0)
    putInt("lastSampleRate", (dsp["lastSampleRate"] as? Number)?.toInt() ?: 0)
    putInt("lastChannelCount", (dsp["lastChannelCount"] as? Number)?.toInt() ?: 0)
    putInt("lastActiveBandCount", (dsp["lastActiveBandCount"] as? Number)?.toInt() ?: 0)
  }

  private fun putCleanString(map: WritableMap, key: String, value: String?) {
    val text = value?.trim().orEmpty()
    if (text.isNotEmpty() && text != "<unknown>") map.putString(key, text)
  }

  companion object {
    private const val PREFS_NAME = "shuffle_media_controls"
    private const val PENDING_MEDIA_ACTION_KEY = "pending_media_action"
    private var activeReactContext: ReactApplicationContext? = null
    private val logDate = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    fun appendDownloadsLog(context: android.content.Context, message: String) {
      val stamped = "[${logDate.format(Date())}] $message\n"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val name = "shuffle-music-logcat.txt"
        val projection = arrayOf(MediaStore.Downloads._ID)
        val selection = "${MediaStore.Downloads.DISPLAY_NAME}=? AND ${MediaStore.Downloads.RELATIVE_PATH}=?"
        val args = arrayOf(name, Environment.DIRECTORY_DOWNLOADS + "/Shuffle MuSic/")
        val uri = resolver.query(collection, projection, selection, args, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            ContentUris.withAppendedId(collection, cursor.getLong(0))
          } else null
        } ?: resolver.insert(collection, ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, name)
          put(MediaStore.Downloads.MIME_TYPE, "text/plain")
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Shuffle MuSic/")
        })
        if (uri != null) resolver.openOutputStream(uri, "wa")?.use { it.write(stamped.toByteArray()) }
        return
      }
      val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Shuffle MuSic")
      dir.mkdirs()
      File(dir, "shuffle-music-logcat.txt").appendText(stamped)
    }

    fun dispatchMediaAction(context: android.content.Context, action: String) {
      try { appendDownloadsLog(context, "media_action=$action") } catch (_: Throwable) {}
      val reactContext = activeReactContext
      if (reactContext?.hasActiveCatalystInstance() == true) {
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("ShuffleMediaAction", action)
        return
      }

      context
        .getSharedPreferences(PREFS_NAME, 0)
        .edit()
        .putString(PENDING_MEDIA_ACTION_KEY, action)
        .apply()
    }
  }
}
