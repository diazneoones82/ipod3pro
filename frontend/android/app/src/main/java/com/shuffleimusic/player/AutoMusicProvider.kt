package com.shuffleimusic.player

import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.util.Log
import java.io.File

class AutoMusicProvider(private val context: Context) {
  companion object {
    private const val TAG = "AutoMusicProvider"

    const val CONTENT_STYLE_SUPPORTED = "android.media.browse.CONTENT_STYLE_SUPPORTED"
    const val CONTENT_STYLE_BROWSABLE_HINT = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT"
    const val CONTENT_STYLE_PLAYABLE_HINT = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT"
    const val CONTENT_STYLE_LIST_ITEM_HINT_VALUE = 1
    const val CONTENT_STYLE_GRID_ITEM_HINT_VALUE = 2

    private val PROJECTION_AUDIO = arrayOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.ALBUM_ID,
      MediaStore.Audio.Media.DURATION,
      MediaStore.Audio.Media.DATA
    )
    private val SORT_ORDER = "${MediaStore.Audio.Media.TITLE} ASC"
  }

  fun getChildren(parentId: String, serviceTracks: List<ShufflePlayerService.TrackData>): List<MediaBrowserCompat.MediaItem> {
    return when (parentId) {
      AutoMediaIDHelper.MEDIA_ID_ROOT -> getRootChildren()
      AutoMediaIDHelper.MEDIA_ID_QUEUE -> getQueueChildren(serviceTracks)
      AutoMediaIDHelper.MEDIA_ID_SHUFFLE_ALL -> getAllSongs(true)
      AutoMediaIDHelper.MEDIA_ID_BY_ALBUM -> getAlbumList()
      AutoMediaIDHelper.MEDIA_ID_BY_ARTIST -> getArtistList()
      AutoMediaIDHelper.MEDIA_ID_BY_GENRE -> getGenreList()
      AutoMediaIDHelper.MEDIA_ID_RECENT -> getRecentChildren(serviceTracks)
      else -> {
        val category = AutoMediaIDHelper.getCategory(parentId)
        val value = AutoMediaIDHelper.getValue(parentId)
        when (category) {
          AutoMediaIDHelper.MEDIA_ID_BY_ALBUM -> getSongsForAlbum(value)
          AutoMediaIDHelper.MEDIA_ID_BY_ARTIST -> getSongsForArtist(value)
          AutoMediaIDHelper.MEDIA_ID_BY_GENRE -> getSongsForGenre(value)
          else -> emptyList()
        }
      }
    }
  }

  private fun getRootChildren(): List<MediaBrowserCompat.MediaItem> {
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()

    items.add(browseItem(
      id = AutoMediaIDHelper.MEDIA_ID_SHUFFLE_ALL,
      title = "Shuffle All",
      subtitle = "All songs shuffled",
      iconUri = null,
      playable = true
    ))
    items.add(browseItem(
      id = AutoMediaIDHelper.MEDIA_ID_QUEUE,
      title = "Current Queue",
      subtitle = "Now playing list",
      iconUri = null,
      playable = false
    ))
    items.add(browseItem(
      id = AutoMediaIDHelper.MEDIA_ID_RECENT,
      title = "Recently Played",
      subtitle = null,
      iconUri = null,
      playable = false
    ))
    items.add(browseItem(
      id = AutoMediaIDHelper.MEDIA_ID_BY_ALBUM,
      title = "Albums",
      subtitle = null,
      iconUri = null,
      playable = false
    ))
    items.add(browseItem(
      id = AutoMediaIDHelper.MEDIA_ID_BY_ARTIST,
      title = "Artists",
      subtitle = null,
      iconUri = null,
      playable = false
    ))
    items.add(browseItem(
      id = AutoMediaIDHelper.MEDIA_ID_BY_GENRE,
      title = "Genres",
      subtitle = null,
      iconUri = null,
      playable = false
    ))
    return items
  }

  private fun getQueueChildren(tracks: List<ShufflePlayerService.TrackData>): List<MediaBrowserCompat.MediaItem> {
    return if (tracks.isEmpty()) {
      listOf(browseItem("empty", "No tracks in queue", null, null, false))
    } else {
      tracks.mapIndexed { idx, track ->
        playableItem(
          id = AutoMediaIDHelper.createMediaID("queue", track.id),
          title = track.title,
          subtitle = track.artist,
          iconUri = track.artworkUri,
          durationMs = track.durationMs
        )
      }
    }
  }

  private fun getRecentChildren(tracks: List<ShufflePlayerService.TrackData>): List<MediaBrowserCompat.MediaItem> {
    val recent = tracks.takeLast(20).takeIf { it.isNotEmpty() } ?: tracks
    return if (recent.isEmpty()) {
      listOf(browseItem("empty_recent", "No recently played", null, null, false))
    } else {
      recent.mapIndexed { idx, track ->
        playableItem(
          id = AutoMediaIDHelper.createMediaID("recent", track.id),
          title = track.title,
          subtitle = track.artist,
          iconUri = track.artworkUri,
          durationMs = track.durationMs
        )
      }
    }
  }

  private fun getAlbumList(): List<MediaBrowserCompat.MediaItem> {
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    val uri = MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI
    val projection = arrayOf(
      MediaStore.Audio.Albums._ID,
      MediaStore.Audio.Albums.ALBUM,
      MediaStore.Audio.Albums.ARTIST,
      MediaStore.Audio.Albums.ALBUM_ART
    )
    var cursor: Cursor? = null
    try {
      cursor = context.contentResolver.query(uri, projection, null, null, "${MediaStore.Audio.Albums.ALBUM} ASC")
      while (cursor?.moveToNext() == true) {
        val id = cursor.getLong(0)
        val album = cursor.getString(1) ?: "Unknown Album"
        val artist = cursor.getString(2) ?: "Unknown Artist"
        val albumArt = cursor.getString(3)
        items.add(browseItem(
          id = AutoMediaIDHelper.createMediaID(AutoMediaIDHelper.MEDIA_ID_BY_ALBUM, "$id"),
          title = album,
          subtitle = artist,
          iconUri = albumArt?.let { Uri.parse(it).toString() }
        ))
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying albums", e)
    } finally {
      cursor?.close()
    }
    return items
  }

  private fun getArtistList(): List<MediaBrowserCompat.MediaItem> {
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    val uri = MediaStore.Audio.Artists.EXTERNAL_CONTENT_URI
    val projection = arrayOf(
      MediaStore.Audio.Artists._ID,
      MediaStore.Audio.Artists.ARTIST,
      MediaStore.Audio.Artists.NUMBER_OF_ALBUMS
    )
    var cursor: Cursor? = null
    try {
      cursor = context.contentResolver.query(uri, projection, null, null, "${MediaStore.Audio.Artists.ARTIST} ASC")
      while (cursor?.moveToNext() == true) {
        val id = cursor.getLong(0)
        val artist = cursor.getString(1) ?: "Unknown Artist"
        items.add(browseItem(
          id = AutoMediaIDHelper.createMediaID(AutoMediaIDHelper.MEDIA_ID_BY_ARTIST, "$id"),
          title = artist,
          subtitle = null,
          iconUri = null
        ))
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying artists", e)
    } finally {
      cursor?.close()
    }
    return items
  }

  private fun getGenreList(): List<MediaBrowserCompat.MediaItem> {
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    val uri = MediaStore.Audio.Genres.EXTERNAL_CONTENT_URI
    val projection = arrayOf(
      MediaStore.Audio.Genres._ID,
      MediaStore.Audio.Genres.NAME
    )
    var cursor: Cursor? = null
    try {
      cursor = context.contentResolver.query(uri, projection, null, null, "${MediaStore.Audio.Genres.NAME} ASC")
      while (cursor?.moveToNext() == true) {
        val id = cursor.getLong(0)
        val name = cursor.getString(1) ?: "Unknown Genre"
        items.add(browseItem(
          id = AutoMediaIDHelper.createMediaID(AutoMediaIDHelper.MEDIA_ID_BY_GENRE, "$id"),
          title = name,
          subtitle = null,
          iconUri = null
        ))
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying genres", e)
    } finally {
      cursor?.close()
    }
    return items
  }

  private fun getSongsForAlbum(albumIdStr: String?): List<MediaBrowserCompat.MediaItem> {
    if (albumIdStr == null) return emptyList()
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    val selection = "${MediaStore.Audio.Media.ALBUM_ID} = ? AND ${MediaStore.Audio.Media.IS_MUSIC} = 1"
    var cursor: Cursor? = null
    try {
      cursor = context.contentResolver.query(uri, PROJECTION_AUDIO, selection, arrayOf(albumIdStr), SORT_ORDER)
      while (cursor?.moveToNext() == true) {
        items.add(readSongFromCursor(cursor))
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying songs for album", e)
    } finally {
      cursor?.close()
    }
    return items
  }

  private fun getSongsForArtist(artistIdStr: String?): List<MediaBrowserCompat.MediaItem> {
    if (artistIdStr == null) return emptyList()
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    val selection = "${MediaStore.Audio.Media.ARTIST_ID} = ? AND ${MediaStore.Audio.Media.IS_MUSIC} = 1"
    var cursor: Cursor? = null
    try {
      cursor = context.contentResolver.query(uri, PROJECTION_AUDIO, selection, arrayOf(artistIdStr), SORT_ORDER)
      while (cursor?.moveToNext() == true) {
        items.add(readSongFromCursor(cursor))
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying songs for artist", e)
    } finally {
      cursor?.close()
    }
    return items
  }

  private fun getSongsForGenre(genreIdStr: String?): List<MediaBrowserCompat.MediaItem> {
    if (genreIdStr == null) return emptyList()
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    try {
      val genreUri = Uri.withAppendedPath(MediaStore.Audio.Genres.EXTERNAL_CONTENT_URI, "$genreIdStr/members")
      var cursor: Cursor? = null
      try {
        cursor = context.contentResolver.query(genreUri, PROJECTION_AUDIO, "${MediaStore.Audio.Media.IS_MUSIC} = 1", null, SORT_ORDER)
        while (cursor?.moveToNext() == true) {
          items.add(readSongFromCursor(cursor))
        }
      } finally {
        cursor?.close()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying songs for genre", e)
    }
    return items
  }

  private fun getAllSongs(shuffled: Boolean): List<MediaBrowserCompat.MediaItem> {
    val items = mutableListOf<MediaBrowserCompat.MediaItem>()
    val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    val selection = "${MediaStore.Audio.Media.IS_MUSIC} = 1"
    var cursor: Cursor? = null
    try {
      cursor = context.contentResolver.query(uri, PROJECTION_AUDIO, selection, null, SORT_ORDER)
      while (cursor?.moveToNext() == true) {
        items.add(readSongFromCursor(cursor))
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error querying all songs", e)
    } finally {
      cursor?.close()
    }
    if (shuffled) items.shuffle()
    return items
  }

  private fun readSongFromCursor(cursor: Cursor): MediaBrowserCompat.MediaItem {
    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID))
    val title = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)) ?: "Unknown"
    val artist = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)) ?: "Unknown"
    val album = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM))
    val albumId = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID))
    val durationMs = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION))
    val data = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA))
    val artUri = resolveAlbumArt(data, albumId)

    return playableItem(
      id = AutoMediaIDHelper.createMediaID("song", "$id"),
      title = title,
      subtitle = artist,
      iconUri = artUri,
      durationMs = durationMs
    )
  }

  private fun resolveAlbumArt(data: String?, albumId: Long): String? {
    if (data == null) return null
    try {
      val mmr = MediaMetadataRetriever()
      mmr.setDataSource(data)
      val art = mmr.embeddedPicture
      mmr.release()
      if (art != null) return data
    } catch (_: Exception) {}
    val albumArtUri = Uri.withAppendedPath(
      Uri.parse("content://media/external/audio/albumart"), albumId.toString()
    )
    return try {
      val fis = context.contentResolver.openInputStream(albumArtUri)
      if (fis != null) {
        fis.close()
        albumArtUri.toString()
      } else null
    } catch (_: Exception) { null }
  }

  private fun browseItem(
    id: String, title: String, subtitle: String?,
    iconUri: String?, playable: Boolean = false
  ): MediaBrowserCompat.MediaItem {
    val flags = if (playable) {
      MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
    } else {
      MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
    }
    val desc = MediaDescriptionCompat.Builder()
      .setMediaId(id)
      .setTitle(title)
      .apply { if (subtitle != null) setSubtitle(subtitle) }
      .apply { if (iconUri != null) setIconUri(Uri.parse(iconUri)) }
      .build()
    return MediaBrowserCompat.MediaItem(desc, flags)
  }

  private fun playableItem(
    id: String, title: String, subtitle: String?,
    iconUri: String?, durationMs: Long
  ): MediaBrowserCompat.MediaItem {
    val extras = Bundle().apply {
      putLong("duration_ms", durationMs)
    }
    val desc = MediaDescriptionCompat.Builder()
      .setMediaId(id)
      .setTitle(title)
      .apply { if (subtitle != null) setSubtitle(subtitle) }
      .apply { if (iconUri != null) setIconUri(Uri.parse(iconUri)) }
      .setExtras(extras)
      .build()
    return MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE)
  }
}