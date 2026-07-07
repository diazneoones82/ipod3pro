package com.shuffleimusic.player

import android.content.Context
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions

class CastOptionsProvider : OptionsProvider {
  override fun getCastOptions(context: Context): CastOptions {
    return CastOptions.Builder()
      .setReceiverApplicationId("CC1AD845")
      .setCastMediaOptions(CastMediaOptions.Builder().build())
      .setEnableReconnectionService(true)
      .build()
  }

  override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
