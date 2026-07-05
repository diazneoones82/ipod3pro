package com.shuffleimusic.player

import android.appwidget.AppWidgetProvider
import android.appwidget.AppWidgetManager
import android.content.Context

class ShuffleMusicWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    ShuffleMediaControls.updateWidgets(context)
  }
}
