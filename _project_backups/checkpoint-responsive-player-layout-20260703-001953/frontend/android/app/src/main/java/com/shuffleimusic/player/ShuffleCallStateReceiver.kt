package com.shuffleimusic.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

class ShuffleCallStateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
    when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
      TelephonyManager.EXTRA_STATE_RINGING,
      TelephonyManager.EXTRA_STATE_OFFHOOK -> ShuffleMediaControls.dispatchMediaAction(context, "phone_pause")
      TelephonyManager.EXTRA_STATE_IDLE -> ShuffleMediaControls.dispatchMediaAction(context, "phone_resume")
    }
  }
}
