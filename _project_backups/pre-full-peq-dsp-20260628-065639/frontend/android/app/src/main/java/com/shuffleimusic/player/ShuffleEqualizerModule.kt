package com.shuffleimusic.player

import android.media.audiofx.Equalizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class ShuffleEqualizerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private var equalizer: Equalizer? = null
  private var sessionId: Int? = null

  override fun getName() = "ShuffleEqualizer"

  @ReactMethod
  fun getCapabilities(requestedSessionId: Int, promise: Promise) {
    var probe: Equalizer? = null
    try {
      val eq = equalizer?.takeIf { sessionId == requestedSessionId } ?: Equalizer(0, requestedSessionId).also {
        probe = it
      }
      val bandCount = eq.numberOfBands.toInt()
      val centers = Arguments.createArray()
      for (i in 0 until bandCount) {
        centers.pushDouble(eq.getCenterFreq(i.toShort()) / 1000.0)
      }
      val range = eq.bandLevelRange
      val result = Arguments.createMap()
      result.putBoolean("available", true)
      result.putArray("centersHz", centers)
      result.putDouble("minDb", range[0] / 100.0)
      result.putDouble("maxDb", range[1] / 100.0)
      promise.resolve(result)
    } catch (e: Throwable) {
      val result = Arguments.createMap()
      result.putBoolean("available", false)
      result.putString("message", e.message ?: "Equalizer unavailable")
      promise.resolve(result)
    } finally {
      probe?.release()
    }
  }

  @ReactMethod
  fun applyGains(requestedSessionId: Int, enabled: Boolean, gainsDb: ReadableArray, promise: Promise) {
    try {
      val eq = ensureEqualizer(requestedSessionId)
      val range = eq.bandLevelRange
      val bandCount = eq.numberOfBands.toInt()
      for (i in 0 until bandCount) {
        val gain = if (i < gainsDb.size()) gainsDb.getDouble(i) else 0.0
        val milliBel = (gain * 100.0).toInt().coerceIn(range[0].toInt(), range[1].toInt())
        eq.setBandLevel(i.toShort(), milliBel.toShort())
      }
      eq.enabled = enabled
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_SHUFFLE_EQ", e.message, e)
    }
  }

  @ReactMethod
  fun release(promise: Promise) {
    try {
      equalizer?.enabled = false
      equalizer?.release()
      equalizer = null
      sessionId = null
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_SHUFFLE_EQ_RELEASE", e.message, e)
    }
  }

  private fun ensureEqualizer(requestedSessionId: Int): Equalizer {
    if (equalizer == null || sessionId != requestedSessionId) {
      equalizer?.release()
      equalizer = Equalizer(0, requestedSessionId)
      sessionId = requestedSessionId
    }
    return equalizer ?: throw IllegalStateException("Equalizer unavailable")
  }
}
