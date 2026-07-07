package com.shuffleimusic.player

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

@UnstableApi
class PeqRenderersFactory(context: Context) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioTrackPlaybackParams: Boolean
  ) = DefaultAudioSink.Builder(context)
    .setAudioProcessors(arrayOf(PeqAudioProcessor()))
    .setEnableFloatOutput(false)
    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
    .build()
}

class PeqAudioProcessor : BaseAudioProcessor() {
  private var sampleRate = 48000
  private var channelCount = 2
  private var activeKey = ""
  private var filters: Array<Array<Biquad>> = emptyArray()
  private var bassBoostFilters: Array<Biquad> = emptyArray()
  private var preampLinear = 1.0
  private var loudnessLinear = 1.0
  private var stereoWidth = 1.0
  private var virtualizerStrength = 0.0
  private var activeBandCount = 0

  init {
    ShufflePeqDspConfigStore.markProcessorCreated()
  }

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    }
    sampleRate = inputAudioFormat.sampleRate
    channelCount = inputAudioFormat.channelCount
    rebuildFilters(true)
    return inputAudioFormat
  }

  override fun isActive(): Boolean = true

  override fun queueInput(inputBuffer: ByteBuffer) {
    rebuildFilters(false)
    val output = replaceOutputBuffer(inputBuffer.remaining()).order(ByteOrder.nativeOrder())
    val input = inputBuffer.order(ByteOrder.nativeOrder())

    val invSqrt2 = 1.0 / sqrt(2.0)

    while (input.remaining() >= 2 * channelCount) {
      var l = input.short.toDouble() / 32768.0 * preampLinear
      var r = if (channelCount > 1) input.short.toDouble() / 32768.0 * preampLinear else l

      filters.getOrNull(0)?.forEach { l = it.process(l) }
      filters.getOrNull(1)?.forEach { r = it.process(r) }

      if (bassBoostFilters.isNotEmpty()) {
        l = bassBoostFilters[0].process(l)
        r = bassBoostFilters[1].process(r)
      }

      if (channelCount > 1 && (stereoWidth != 1.0 || virtualizerStrength > 0)) {
        val mid = (l + r) * invSqrt2
        val side = (l - r) * invSqrt2
        val adjustedSide = side * stereoWidth
        l = (mid + adjustedSide) * invSqrt2
        r = (mid - adjustedSide) * invSqrt2
      }

      l *= loudnessLinear
      r *= loudnessLinear

      output.putShort((softLimit(l) * 32767.0).toInt().coerceIn(-32768, 32767).toShort())
      if (channelCount > 1) {
        output.putShort((softLimit(r) * 32767.0).toInt().coerceIn(-32768, 32767).toShort())
      }
    }
    ShufflePeqDspConfigStore.markProcessed(sampleRate, channelCount, activeBandCount)
    inputBuffer.position(inputBuffer.limit())
    output.flip()
  }

  override fun onFlush() {
    filters.forEach { c -> c.forEach { it.reset() } }
    bassBoostFilters.forEach { it.reset() }
  }

  override fun onReset() {
    filters = emptyArray()
    bassBoostFilters = emptyArray()
    activeKey = ""
  }

  private fun rebuildFilters(force: Boolean) {
    val cfg = ShufflePeqDspConfigStore.snapshot()
    val key = buildString {
      append(cfg["enabled"]).append('|').append(cfg["preamp"]).append('|').append(sampleRate).append('|').append(channelCount)
      append('|').append(cfg["loudnessDb"]).append('|').append(cfg["stereoWidth"]).append('|').append(cfg["bassBoostDb"]).append('|').append(cfg["virtualizerStrength"])
      (cfg["bands"] as? List<*>)?.forEach {
        val b = it as? Map<*, *>
        append('|').append(b?.get("enabled")).append(',').append(b?.get("type")).append(',').append(b?.get("freq")).append(',').append(b?.get("gain")).append(',').append(b?.get("q"))
      }
    }
    if (!force && key == activeKey) return
    activeKey = key

    val enabled = cfg["enabled"] as? Boolean ?: false
    val preamp = (cfg["preamp"] as? Number)?.toDouble() ?: 0.0
    val ld = (cfg["loudnessDb"] as? Number)?.toDouble() ?: 0.0
    val sw = (cfg["stereoWidth"] as? Number)?.toDouble() ?: 1.0
    val vs = (cfg["virtualizerStrength"] as? Number)?.toDouble() ?: 0.0
    val bb = (cfg["bassBoostDb"] as? Number)?.toDouble() ?: 0.0
    val rawBands = (cfg["bands"] as? List<*>) ?: emptyList<Any>()

    preampLinear = if (enabled) dbToLinear(preamp) else 1.0
    loudnessLinear = if (enabled) dbToLinear(ld) else 1.0
    stereoWidth = if (enabled) sw else 1.0
    virtualizerStrength = if (enabled) vs else 0.0

    val activeBands = if (enabled) {
      rawBands.filterIsInstance<Map<*, *>>().filter { it["enabled"] == true }
    } else emptyList()
    activeBandCount = activeBands.size
    filters = Array(channelCount) {
      activeBands.mapNotNull { band ->
        val type = band["type"] as? String ?: "PK"
        val freq = (band["freq"] as? Number)?.toDouble() ?: 1000.0
        val gain = (band["gain"] as? Number)?.toDouble() ?: 0.0
        val q = (band["q"] as? Number)?.toDouble() ?: 1.0
        Biquad.from(type, freq, gain, q, sampleRate.toDouble())
      }.toTypedArray()
    }

    bassBoostFilters = if (enabled && bb > 0) {
      Array(channelCount) {
        Biquad.from("LSC", 100.0, bb, 1.0, sampleRate.toDouble())!!
      }
    } else {
      emptyArray()
    }
  }

  private fun softLimit(x: Double): Double {
    if (abs(x) <= 0.9) return x
    return if (x > 0) 1.0 - exp(-(x - 0.9) * 10.0) * 0.1
    else -1.0 + exp((x + 0.9) * 10.0) * 0.1
  }

  private class Biquad(
    private val b0: Double, private val b1: Double, private val b2: Double,
    private val a1: Double, private val a2: Double
  ) {
    private var z1 = 0.0
    private var z2 = 0.0
    fun process(x: Double): Double {
      val y = b0 * x + z1
      z1 = b1 * x - a1 * y + z2
      z2 = b2 * x - a2 * y
      return y
    }
    fun reset() { z1 = 0.0; z2 = 0.0 }

    companion object {
      fun from(type: String, freq: Double, gain: Double, q: Double, sampleRate: Double): Biquad? {
        val f = freq.coerceIn(10.0, sampleRate * 0.45)
        val qv = max(0.05, q)
        val a = 10.0.pow(gain / 40.0)
        val w0 = 2.0 * PI * f / sampleRate
        val c = cos(w0)
        val s = sin(w0)
        val alpha = s / (2.0 * qv)
        var b0 = 1.0; var b1 = 0.0; var b2 = 0.0
        var a0 = 1.0; var a1 = 0.0; var a2 = 0.0
        when (type.uppercase()) {
          "PK" -> { b0 = 1.0 + alpha * a; b1 = -2.0 * c; b2 = 1.0 - alpha * a; a0 = 1.0 + alpha / a; a1 = -2.0 * c; a2 = 1.0 - alpha / a }
          "LSC" -> { val r = sqrt(a); b0 = a * (a + 1.0 - (a - 1.0) * c + 2.0 * r * alpha); b1 = 2.0 * a * (a - 1.0 - (a + 1.0) * c); b2 = a * (a + 1.0 - (a - 1.0) * c - 2.0 * r * alpha); a0 = a + 1.0 + (a - 1.0) * c + 2.0 * r * alpha; a1 = -2.0 * (a - 1.0 + (a + 1.0) * c); a2 = a + 1.0 + (a - 1.0) * c - 2.0 * r * alpha }
          "HSC" -> { val r = sqrt(a); b0 = a * (a + 1.0 + (a - 1.0) * c + 2.0 * r * alpha); b1 = -2.0 * a * (a - 1.0 + (a + 1.0) * c); b2 = a * (a + 1.0 + (a - 1.0) * c - 2.0 * r * alpha); a0 = a + 1.0 - (a - 1.0) * c + 2.0 * r * alpha; a1 = 2.0 * (a - 1.0 - (a + 1.0) * c); a2 = a + 1.0 - (a - 1.0) * c - 2.0 * r * alpha }
          "LP" -> { b0 = (1.0 - c) / 2.0; b1 = 1.0 - c; b2 = (1.0 - c) / 2.0; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha }
          "HP" -> { b0 = (1.0 + c) / 2.0; b1 = -(1.0 + c); b2 = (1.0 + c) / 2.0; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha }
          "NO" -> { b0 = 1.0; b1 = -2.0 * c; b2 = 1.0; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha }
          "BP" -> { b0 = alpha; b1 = 0.0; b2 = -alpha; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha }
          "AP" -> { b0 = 1.0 - alpha; b1 = -2.0 * c; b2 = 1.0 + alpha; a0 = 1.0 + alpha; a1 = -2.0 * c; a2 = 1.0 - alpha }
          else -> return null
        }
        return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
      }
    }
  }
}

private fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)
