package com.shuffleimusic.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ShuffleMediaActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ShuffleMediaControls.ACTION_MEDIA_CONTROL) return
    val action = intent.getStringExtra(ShuffleMediaControls.EXTRA_MEDIA_ACTION) ?: return
    ShuffleMediaControls.dispatchMediaAction(context, action)
  }
}
