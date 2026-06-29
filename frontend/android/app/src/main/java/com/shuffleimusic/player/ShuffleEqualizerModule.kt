package com.shuffleimusic.player

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class ShuffleEqualizerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private var lastStatus = "idle"
  private var lastMessage = "DSP not synced yet"
  private var lastAppliedAt = 0.0
  private var lastBandCount = 0

  override fun getName() = "ShuffleEqualizer"

  @ReactMethod
  fun applyPeq(enabled: Boolean, preamp: Double, bands: ReadableArray, promise: Promise) {
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
      ShufflePeqDspConfigStore.update(ShufflePeqConfig(enabled, preamp, parsed))

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
}
