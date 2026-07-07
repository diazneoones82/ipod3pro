package com.shuffleimusic.player

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class CastButtonManager : SimpleViewManager<CastButtonView>() {
  override fun getName() = "CastButton"

  override fun createViewInstance(reactContext: ThemedReactContext): CastButtonView {
    return CastButtonView(reactContext)
  }
}
