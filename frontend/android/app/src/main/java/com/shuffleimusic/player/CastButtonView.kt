package com.shuffleimusic.player

import android.content.Context
import android.graphics.Color
import android.graphics.PorterDuff
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory

class CastButtonView(context: Context) : FrameLayout(context) {
  private val mediaRouteButton: MediaRouteButton

  init {
    mediaRouteButton = MediaRouteButton(context).apply {
      layoutParams = LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
    }
    addView(mediaRouteButton)
    try {
      CastButtonFactory.setUpMediaRouteButton(context, mediaRouteButton)
    } catch (_: Exception) {
      // Cast framework unavailable — button stays but won't function
    }
    // Always show the button even if no Cast devices are on the network
    mediaRouteButton.visibility = View.VISIBLE
  }
}
