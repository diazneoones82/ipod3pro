#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const audioRoot = path.join(root, 'node_modules', 'expo-audio');

function read(rel) {
  return fs.readFileSync(path.join(audioRoot, rel), 'utf8');
}

function write(rel, text) {
  const file = path.join(audioRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function patch(rel, updater) {
  const before = read(rel);
  const after = updater(before);
  if (after !== before) write(rel, after);
}

if (!fs.existsSync(audioRoot)) {
  console.warn('[peq-patch] expo-audio not installed; skipping');
  process.exit(0);
}

const moduleConfigPath = path.join(audioRoot, 'expo-module.config.json');
if (fs.existsSync(moduleConfigPath)) {
  const config = JSON.parse(fs.readFileSync(moduleConfigPath, 'utf8'));
  if (config.android?.publication) {
    delete config.android.publication;
    fs.writeFileSync(moduleConfigPath, JSON.stringify(config, null, 2) + '\n');
  }
}

write('android/src/main/java/expo/modules/audio/PeqDsp.kt', `package expo.modules.audio

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

class PeqBand(
  @Field val enabled: Boolean = true,
  @Field val type: String = "PK",
  @Field val freq: Double = 1000.0,
  @Field val gain: Double = 0.0,
  @Field val q: Double = 1.0
) : Record

class PeqConfig(
  @Field val enabled: Boolean = false,
  @Field val preamp: Double = 0.0,
  @Field val bands: List<PeqBand> = emptyList(),
  @Field val loudnessDb: Double = 0.0,
  @Field val stereoWidth: Double = 1.0,
  @Field val bassBoostDb: Double = 0.0,
  @Field val virtualizerStrength: Double = 0.0,
  @Field val reverbPreset: Int = -1
) : Record

object PeqDspConfigStore {
  @Volatile private var config = PeqConfig()
  fun update(next: PeqConfig) { config = next }
  fun current(): PeqConfig = config
}

private object AppPeqConfigSource {
  fun markProcessorCreated() {
    try {
      Class.forName("com.shuffleimusic.player.ShufflePeqDspConfigStore")
        .getMethod("markProcessorCreated")
        .invoke(null)
    } catch (_: Throwable) {}
  }

  fun markProcessed(sampleRate: Int, channelCount: Int, activeBandCount: Int) {
    try {
      Class.forName("com.shuffleimusic.player.ShufflePeqDspConfigStore")
        .getMethod("markProcessed", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        .invoke(null, sampleRate, channelCount, activeBandCount)
    } catch (_: Throwable) {}
  }

  fun current(): PeqConfig {
    return try {
      val snapshot = Class.forName("com.shuffleimusic.player.ShufflePeqDspConfigStore")
        .getMethod("snapshot")
        .invoke(null) as? Map<*, *> ?: return PeqDspConfigStore.current()
      val enabled = snapshot["enabled"] as? Boolean ?: false
      val preamp = (snapshot["preamp"] as? Number)?.toDouble() ?: 0.0
      val bands = (snapshot["bands"] as? List<*>)?.mapNotNull { rawBand ->
        val band = rawBand as? Map<*, *> ?: return@mapNotNull null
        PeqBand(
          enabled = band["enabled"] as? Boolean ?: true,
          type = band["type"] as? String ?: "PK",
          freq = (band["freq"] as? Number)?.toDouble() ?: 1000.0,
          gain = (band["gain"] as? Number)?.toDouble() ?: 0.0,
          q = (band["q"] as? Number)?.toDouble() ?: 1.0
        )
      } ?: emptyList()
      PeqConfig(
        enabled = enabled,
        preamp = preamp,
        bands = bands,
        loudnessDb = (snapshot["loudnessDb"] as? Number)?.toDouble() ?: 0.0,
        stereoWidth = (snapshot["stereoWidth"] as? Number)?.toDouble() ?: 1.0,
        bassBoostDb = (snapshot["bassBoostDb"] as? Number)?.toDouble() ?: 0.0,
        virtualizerStrength = (snapshot["virtualizerStrength"] as? Number)?.toDouble() ?: 0.0,
        reverbPreset = (snapshot["reverbPreset"] as? Number)?.toInt() ?: -1
      )
    } catch (_: Throwable) {
      PeqDspConfigStore.current()
    }
  }
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
    AppPeqConfigSource.markProcessorCreated()
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

      // EQ
      filters.getOrNull(0)?.forEach { l = it.process(l) }
      filters.getOrNull(1)?.forEach { r = it.process(r) }

      // Bass Boost
      if (bassBoostFilters.isNotEmpty()) {
        l = bassBoostFilters[0].process(l)
        r = bassBoostFilters[1].process(r)
      }

      // Stereo Width & Virtualizer
      if (channelCount > 1 && (stereoWidth != 1.0 || virtualizerStrength > 0)) {
        val mid = (l + r) * invSqrt2
        val side = (l - r) * invSqrt2

        val adjustedSide = side * stereoWidth

        l = (mid + adjustedSide) * invSqrt2
        r = (mid - adjustedSide) * invSqrt2
      }

      // Loudness
      l *= loudnessLinear
      r *= loudnessLinear

      output.putShort((softLimit(l) * 32767.0).toInt().coerceIn(-32768, 32767).toShort())
      if (channelCount > 1) {
        output.putShort((softLimit(r) * 32767.0).toInt().coerceIn(-32768, 32767).toShort())
      }
    }
    AppPeqConfigSource.markProcessed(sampleRate, channelCount, activeBandCount)
    inputBuffer.position(inputBuffer.limit())
    output.flip()
  }

  override fun onFlush() {
    filters.forEach { c -> c.forEach { it.reset() } }
    bassBoostFilters.forEach { it.reset() }
  }
  override fun onReset() { filters = emptyArray(); bassBoostFilters = emptyArray(); activeKey = "" }

  private fun rebuildFilters(force: Boolean) {
    val cfg = AppPeqConfigSource.current()
    val key = buildString {
      append(cfg.enabled).append('|').append(cfg.preamp).append('|').append(sampleRate).append('|').append(channelCount)
      append('|').append(cfg.loudnessDb).append('|').append(cfg.stereoWidth).append('|').append(cfg.bassBoostDb).append('|').append(cfg.virtualizerStrength)
      cfg.bands.forEach { append('|').append(it.enabled).append(',').append(it.type).append(',').append(it.freq).append(',').append(it.gain).append(',').append(it.q) }
    }
    if (!force && key == activeKey) return
    activeKey = key

    preampLinear = if (cfg.enabled) dbToLinear(cfg.preamp) else 1.0
    loudnessLinear = if (cfg.enabled) dbToLinear(cfg.loudnessDb) else 1.0
    stereoWidth = if (cfg.enabled) cfg.stereoWidth else 1.0
    virtualizerStrength = if (cfg.enabled) cfg.virtualizerStrength else 0.0

    val activeBands = if (cfg.enabled) cfg.bands.filter { it.enabled } else emptyList()
    activeBandCount = activeBands.size
    filters = Array(channelCount) { activeBands.mapNotNull { Biquad.from(it, sampleRate.toDouble()) }.toTypedArray() }

    bassBoostFilters = if (cfg.enabled && cfg.bassBoostDb > 0) {
      val bb = PeqBand(enabled = true, type = "LSC", freq = 100.0, gain = cfg.bassBoostDb, q = 1.0)
      Array(channelCount) { Biquad.from(bb, sampleRate.toDouble())!! }
    } else {
      emptyArray()
    }
  }

  private fun softLimit(x: Double): Double {
    if (abs(x) <= 0.9) return x
    return if (x > 0) 1.0 - exp(-(x - 0.9) * 10.0) * 0.1 else -1.0 + exp((x + 0.9) * 10.0) * 0.1
  }

  private class Biquad(private val b0: Double, private val b1: Double, private val b2: Double, private val a1: Double, private val a2: Double) {
    private var z1 = 0.0
    private var z2 = 0.0
    fun process(x: Double): Double { val y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y }
    fun reset() { z1 = 0.0; z2 = 0.0 }
    companion object {
      fun from(band: PeqBand, sampleRate: Double): Biquad? {
        val freq = band.freq.coerceIn(10.0, sampleRate * 0.45)
        val q = max(0.05, band.q)
        val a = 10.0.pow(band.gain / 40.0)
        val w0 = 2.0 * PI * freq / sampleRate
        val c = cos(w0)
        val s = sin(w0)
        val alpha = s / (2.0 * q)
        var b0 = 1.0; var b1 = 0.0; var b2 = 0.0; var a0 = 1.0; var a1 = 0.0; var a2 = 0.0
        when (band.type.uppercase()) {
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
`);

patch('android/src/main/java/expo/modules/audio/AudioPlayer.kt', (text) => {
  if (!text.includes('import androidx.media3.exoplayer.DefaultRenderersFactory')) {
    text = text.replace('import androidx.media3.common.util.UnstableApi\n', 'import androidx.media3.common.util.UnstableApi\nimport androidx.media3.exoplayer.DefaultRenderersFactory\n');
  }
  if (!text.includes('import androidx.media3.exoplayer.audio.DefaultAudioSink')) {
    text = text.replace('import androidx.media3.exoplayer.ExoPlayer\n', 'import androidx.media3.exoplayer.ExoPlayer\nimport androidx.media3.exoplayer.audio.DefaultAudioSink\n');
  }
  if (!text.includes('.setRenderersFactory(PeqRenderersFactory(context))')) {
    text = text.replace('ExoPlayer.Builder(context)\n', 'ExoPlayer.Builder(context)\n    .setRenderersFactory(PeqRenderersFactory(context))\n');
  }
  if (!text.includes('private class PeqRenderersFactory')) {
    text += `

@UnstableApi
private class PeqRenderersFactory(context: Context) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean) =
    DefaultAudioSink.Builder(context)
      .setAudioProcessors(arrayOf(PeqAudioProcessor()))
      .setEnableFloatOutput(false)
      .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
      .build()
}
`;
  }
  return text;
});

patch('android/src/main/java/expo/modules/audio/AudioModule.kt', (text) => {
  if (!text.includes('AsyncFunction("setPeqConfigAsync")')) {
    text = text.replace(
      '    AsyncFunction("requestRecordingPermissionsAsync") { promise: Promise ->',
      '    AsyncFunction("setPeqConfigAsync") { config: PeqConfig ->\n      PeqDspConfigStore.update(config)\n    }\n\n    AsyncFunction("requestRecordingPermissionsAsync") { promise: Promise ->'
    );
  }
  return text;
});

const peqType = `  setPeqConfigAsync(config: {
    enabled: boolean;
    preamp: number;
    bands: Array<{
      enabled: boolean;
      type: string;
      freq: number;
      gain: number;
      q: number;
    }>;
    loudnessDb?: number;
    stereoWidth?: number;
    bassBoostDb?: number;
    virtualizerStrength?: number;
    reverbPreset?: number;
  }): Promise<void>;
`;

patch('src/AudioModule.types.ts', (text) => {
  if (!text.includes('setPeqConfigAsync(config')) {
    text = text.replace('  setAudioModeAsync(category: Partial<AudioMode>): Promise<void>;\n', `  setAudioModeAsync(category: Partial<AudioMode>): Promise<void>;\n${peqType}`);
  } else if (!text.includes('loudnessDb?: number;')) {
    text = text.replace(/setPeqConfigAsync\(config: \{[^}]+\}\): Promise<void>;/s, peqType);
  }
  return text;
});

const peqDtsType = `    setPeqConfigAsync(config: {
        enabled: boolean;
        preamp: number;
        bands: Array<{
            enabled: boolean;
            type: string;
            freq: number;
            gain: number;
            q: number;
        }>;
        loudnessDb?: number;
        stereoWidth?: number;
        bassBoostDb?: number;
        virtualizerStrength?: number;
        reverbPreset?: number;
    }): Promise<void>;
`;

patch('build/AudioModule.types.d.ts', (text) => {
  if (!text.includes('setPeqConfigAsync(config')) {
    text = text.replace('    setAudioModeAsync(category: Partial<AudioMode>): Promise<void>;\n', `    setAudioModeAsync(category: Partial<AudioMode>): Promise<void>;\n${peqDtsType}`);
  } else if (!text.includes('loudnessDb?: number;')) {
    text = text.replace(/setPeqConfigAsync\(config: \{[^}]+\}\): Promise<void>;/s, peqDtsType);
  }
  return text;
});

console.log('[peq-patch] expo-audio native PEQ DSP patch updated with audio effects');
