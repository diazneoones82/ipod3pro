package com.shuffleimusic.player

data class ShufflePeqBand(
  val enabled: Boolean,
  val type: String,
  val freq: Double,
  val gain: Double,
  val q: Double
)

data class ShufflePeqConfig(
  val enabled: Boolean = false,
  val preamp: Double = 0.0,
  val bands: List<ShufflePeqBand> = emptyList()
)

object ShufflePeqDspConfigStore {
  @Volatile private var config = ShufflePeqConfig()
  @Volatile private var processorCreatedAt = 0.0
  @Volatile private var lastProcessedAt = 0.0
  @Volatile private var processedBuffers = 0
  @Volatile private var lastSampleRate = 0
  @Volatile private var lastChannelCount = 0
  @Volatile private var lastActiveBandCount = 0

  @JvmStatic
  fun update(next: ShufflePeqConfig) {
    config = next
  }

  @JvmStatic
  fun markProcessorCreated() {
    processorCreatedAt = System.currentTimeMillis().toDouble()
  }

  @JvmStatic
  fun markProcessed(sampleRate: Int, channelCount: Int, activeBandCount: Int) {
    processedBuffers += 1
    lastProcessedAt = System.currentTimeMillis().toDouble()
    lastSampleRate = sampleRate
    lastChannelCount = channelCount
    lastActiveBandCount = activeBandCount
  }

  @JvmStatic
  fun snapshot(): Map<String, Any> {
    val current = config
    return mapOf(
      "enabled" to current.enabled,
      "preamp" to current.preamp,
      "bands" to current.bands.map {
        mapOf(
          "enabled" to it.enabled,
          "type" to it.type,
          "freq" to it.freq,
          "gain" to it.gain,
          "q" to it.q
        )
      }
    )
  }

  @JvmStatic
  fun statusSnapshot(): Map<String, Any> {
    return mapOf(
      "processorCreatedAt" to processorCreatedAt,
      "lastProcessedAt" to lastProcessedAt,
      "processedBuffers" to processedBuffers,
      "lastSampleRate" to lastSampleRate,
      "lastChannelCount" to lastChannelCount,
      "lastActiveBandCount" to lastActiveBandCount
    )
  }
}
