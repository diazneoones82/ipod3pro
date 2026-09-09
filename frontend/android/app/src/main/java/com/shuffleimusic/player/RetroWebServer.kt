package com.shuffleimusic.player

import android.content.Context
import android.net.Uri
import android.net.wifi.WifiManager
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class RetroWebServer(private val context: Context, port: Int = 9090) {
  private var serverSocket: ServerSocket? = null
  private var running = false
  private var thread: Thread? = null
  private val trackUris = ConcurrentHashMap<String, String>()
  val port: Int = if (isPortAvailable(port)) port else findAvailablePort(port)

  private val server by lazy {
    object : Thread("RetroWebServer") {
      override fun run() {
        try {
          serverSocket = ServerSocket(port)
          running = true
          while (running) {
            val client = serverSocket?.accept() ?: break
            handleClient(client)
          }
        } catch (e: IOException) {
          if (running) Log.e(TAG, "Server error", e)
        }
      }
    }
  }

  fun start() {
    if (!running) {
      server.start()
      thread = server
    }
  }

  fun stop() {
    running = false
    try { serverSocket?.close() } catch (_: IOException) {}
    thread?.interrupt()
    thread = null
  }

  fun getUrl(): String = "http://${getLocalIpAddress(context)}:$port"

  fun registerTracks(tracksJson: String) {
    try {
      val arr = org.json.JSONArray(tracksJson)
      for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        val id = obj.optString("id", "")
        val uri = obj.optString("uri", "")
        if (id.isNotBlank() && uri.isNotBlank()) trackUris[id] = uri
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not register cast track URIs", e)
    }
  }

  private fun handleClient(client: java.net.Socket) {
    try {
      val reader = java.io.BufferedReader(java.io.InputStreamReader(client.getInputStream()))
      val requestLine = reader.readLine() ?: return
      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val method = parts[0]
      val path = parts[1]
      var rangeHeader: String? = null
      while (true) {
        val header = reader.readLine() ?: break
        if (header.isBlank()) break
        if (header.startsWith("Range:", ignoreCase = true)) {
          rangeHeader = header.substringAfter(':').trim()
        }
      }

      if (method != "GET" && method != "HEAD") {
        sendResponse(client, "405 Method Not Allowed", "text/plain", "Only GET/HEAD supported")
        return
      }

      val query = Uri.parse("http://localhost$path")
      val songId = query.getQueryParameter("id")
      val coverArt = query.getQueryParameter("coverart")

      if (coverArt != null) {
        serveCoverArt(client, coverArt, method == "HEAD")
      } else if (songId != null) {
        serveSong(client, songId, rangeHeader, method == "HEAD")
      } else {
        sendResponse(client, "400 Bad Request", "text/plain", "Missing id or coverart parameter")
      }
    } catch (e: Exception) {
      Log.e(TAG, "handleClient error", e)
    } finally {
      try { client.close() } catch (_: IOException) {}
    }
  }

  private fun serveSong(client: java.net.Socket, songId: String, rangeHeader: String?, headOnly: Boolean) {
    val uri = resolveSongUri(songId) ?: run {
      sendResponse(client, "404 Not Found", "text/plain", "Song not found")
      return
    }
    if (uri.scheme == null || uri.scheme == "file") {
      val file = File(uri.path ?: uri.toString())
      if (!file.exists()) {
        sendResponse(client, "404 Not Found", "text/plain", "File not found")
        return
      }
      sendFileResponse(client, file, mimeForName(file.name), rangeHeader, headOnly)
    } else {
      sendUriResponse(client, uri, mimeForName(uri.lastPathSegment ?: ""), headOnly)
    }
  }

  private fun mimeForName(name: String): String {
    return when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> "audio/mpeg"
      "flac" -> "audio/flac"
      "wav" -> "audio/wav"
      "ogg", "oga" -> "audio/ogg"
      "m4a", "aac" -> "audio/mp4"
      "wma" -> "audio/x-ms-wma"
      else -> "audio/mpeg"
    }
  }

  private fun serveCoverArt(client: java.net.Socket, songId: String, headOnly: Boolean) {
    val uri = resolveArtworkUri(songId)
    if (uri == null) {
      sendResponse(client, "404 Not Found", "text/plain", "Artwork not found")
      return
    }
    val file = File(uri.path ?: uri.toString())
    if (!file.exists()) {
      sendResponse(client, "404 Not Found", "text/plain", "Artwork not found")
      return
    }
    sendFileResponse(client, file, "image/jpeg", null, headOnly)
  }

  private fun resolveSongUri(songId: String): Uri? {
    trackUris[songId]?.takeIf { it.isNotBlank() }?.let { return Uri.parse(it) }
    val projection = arrayOf(android.provider.MediaStore.Audio.Media.DATA)
    val cursor = context.contentResolver.query(
      android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
      projection,
      "${android.provider.MediaStore.Audio.Media._ID}=?",
      arrayOf(songId),
      null
    )
    val path = cursor?.use { if (it.moveToFirst()) it.getString(0) else null }
    return path?.let { Uri.fromFile(File(it)) }
  }

  private fun resolveArtworkUri(songId: String): Uri? {
    val projection = arrayOf(android.provider.MediaStore.Audio.Albums.ALBUM_ART)
    val cursor = context.contentResolver.query(
      android.provider.MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI,
      projection,
      "${android.provider.MediaStore.Audio.Albums._ID}=?",
      arrayOf(songId),
      null
    )
    val path = cursor?.use { if (it.moveToFirst()) it.getString(0) else null }
    return path?.let { Uri.fromFile(File(it)) }
  }

  private fun sendFileResponse(client: java.net.Socket, file: File, mimeType: String, rangeHeader: String?, headOnly: Boolean) {
    try {
      val len = file.length()
      val range = parseRange(rangeHeader, len)
      val start = range?.first ?: 0L
      val end = range?.second ?: (len - 1)
      val bodyLen = (end - start + 1).coerceAtLeast(0)
      val out = client.getOutputStream()
      val status = if (range != null) "206 Partial Content" else "200 OK"
      val contentRange = if (range != null) "Content-Range: bytes $start-$end/$len\r\n" else ""
      val header = "HTTP/1.1 $status\r\nContent-Type: $mimeType\r\nContent-Length: $bodyLen\r\n${contentRange}Accept-Ranges: bytes\r\nConnection: close\r\n\r\n"
      out.write(header.toByteArray())
      if (!headOnly) {
        FileInputStream(file).use { fis ->
          fis.skip(start)
          fis.copyRangeTo(out, bodyLen, 8192)
        }
      }
      out.flush()
    } catch (e: Exception) {
      Log.e(TAG, "sendFileResponse error", e)
    }
  }

  private fun sendUriResponse(client: java.net.Socket, uri: Uri, mimeType: String, headOnly: Boolean) {
    try {
      val afd = context.contentResolver.openAssetFileDescriptor(uri, "r")
      val len = afd?.length?.takeIf { it >= 0 } ?: -1L
      val out = client.getOutputStream()
      val lengthHeader = if (len >= 0) "Content-Length: $len\r\n" else ""
      val header = "HTTP/1.1 200 OK\r\nContent-Type: $mimeType\r\n${lengthHeader}Accept-Ranges: bytes\r\nConnection: close\r\n\r\n"
      out.write(header.toByteArray())
      if (!headOnly) {
        (afd?.createInputStream() ?: context.contentResolver.openInputStream(uri))?.use { it.copyTo(out, 8192) }
      }
      afd?.close()
      out.flush()
    } catch (e: Exception) {
      Log.e(TAG, "sendUriResponse error", e)
      sendResponse(client, "404 Not Found", "text/plain", "File not found")
    }
  }

  private fun parseRange(rangeHeader: String?, len: Long): Pair<Long, Long>? {
    if (rangeHeader.isNullOrBlank() || !rangeHeader.startsWith("bytes=") || len <= 0) return null
    val parts = rangeHeader.removePrefix("bytes=").split("-", limit = 2)
    val start = parts.getOrNull(0)?.toLongOrNull() ?: return null
    val requestedEnd = parts.getOrNull(1)?.toLongOrNull()
    val end = (requestedEnd ?: (len - 1)).coerceAtMost(len - 1)
    if (start > end || start < 0) return null
    return start to end
  }

  private fun sendResponse(client: java.net.Socket, status: String, mimeType: String, body: String) {
    try {
      val out = client.getOutputStream()
      val header = "HTTP/1.1 $status\r\nContent-Type: $mimeType\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n"
      out.write(header.toByteArray())
      out.write(body.toByteArray())
      out.flush()
    } catch (_: Exception) {}
  }

  companion object {
    private const val TAG = "RetroWebServer"

    fun getLocalIpAddress(context: Context): String {
      try {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val ip = wifi?.connectionInfo?.ipAddress ?: 0
        if (ip != 0) {
          val bytes = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(ip).array()
          val host = InetAddress.getByAddress(bytes).hostAddress
          if (!host.isNullOrBlank() && host != "0.0.0.0") return host
        }
      } catch (_: Exception) {}
      try {
        val interfaces = NetworkInterface.getNetworkInterfaces()
        while (interfaces.hasMoreElements()) {
          val intf = interfaces.nextElement()
          if (!intf.isUp || intf.isLoopback || intf.name.startsWith("rmnet", ignoreCase = true)) continue
          val addrs = intf.inetAddresses
          while (addrs.hasMoreElements()) {
            val addr = addrs.nextElement()
            if (!addr.isLoopbackAddress && addr is InetAddress) {
              val host = addr.hostAddress ?: continue
              if (host.contains('.')) return host
            }
          }
        }
      } catch (_: Exception) {}
      return "127.0.0.1"
    }

    private fun isPortAvailable(port: Int): Boolean {
      return try {
        ServerSocket(port).use { true }
      } catch (_: IOException) { false }
    }

    private fun findAvailablePort(start: Int): Int {
      for (p in start until start + 100) {
        if (isPortAvailable(p)) return p
      }
      return start
    }
  }
}

private fun java.io.InputStream.copyRangeTo(out: java.io.OutputStream, bytesToCopy: Long, bufferSize: Int) {
  val buffer = ByteArray(bufferSize)
  var remaining = bytesToCopy
  while (remaining > 0) {
    val bytesRead = this.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
    if (bytesRead < 0) break
    out.write(buffer, 0, bytesRead)
    remaining -= bytesRead
  }
}
