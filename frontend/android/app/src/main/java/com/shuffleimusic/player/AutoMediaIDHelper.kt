package com.shuffleimusic.player

object AutoMediaIDHelper {
  const val MEDIA_ID_EMPTY_ROOT = "__EMPTY_ROOT__"
  const val MEDIA_ID_ROOT = "__ROOT__"
  const val MEDIA_ID_QUEUE = "__QUEUE__"
  const val MEDIA_ID_SHUFFLE_ALL = "__SHUFFLE_ALL__"
  const val MEDIA_ID_BY_ALBUM = "__BY_ALBUM__"
  const val MEDIA_ID_BY_ARTIST = "__BY_ARTIST__"
  const val MEDIA_ID_BY_GENRE = "__BY_GENRE__"
  const val MEDIA_ID_RECENT = "__RECENT__"

  private const val CATEGORY_SEPARATOR = "/"
  private const val ITEM_SEPARATOR = "|"

  fun createMediaID(category: String, value: String?): String {
    return if (value != null) "$category$CATEGORY_SEPARATOR$value" else category
  }

  fun getCategory(mediaId: String): String {
    val idx = mediaId.indexOf(CATEGORY_SEPARATOR)
    return if (idx > 0) mediaId.substring(0, idx) else mediaId
  }

  fun getValue(mediaId: String): String? {
    val idx = mediaId.indexOf(CATEGORY_SEPARATOR)
    return if (idx > 0) mediaId.substring(idx + 1) else null
  }
}