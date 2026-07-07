package com.shuffleimusic.player

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.util.*

class RetroWebServer(private val context: Context, port: Int = 9090) {
  private var serverSocket: ServerSocket? = null
  private var running = false
  private var thread: Thread? = null
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

  fun getUrl(): String = "http://${getLocalIpAddress()}:$port"

  private fun handleClient(client: java.net.Socket) {
    try {
      val reader = java.io.BufferedReader(java.io.InputStreamReader(client.getInputStream()))
      val requestLine = reader.readLine() ?: return
      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val method = parts[0]
      val path = parts[1]

      if (method != "GET") {
        sendResponse(client, "405 Method Not Allowed", "text/plain", "Only GET supported")
        return
      }

      val query = Uri.parse("http://localhost$path")
      val songId = query.getQueryParameter("id")
      val coverArt = query.getQueryParameter("coverart")

      if (coverArt != null) {
        serveCoverArt(client, coverArt)
      } else if (songId != null) {
        serveSong(client, songId)
      } else {
        sendResponse(client, "400 Bad Request", "text/plain", "Missing id or coverart parameter")
      }
    } catch (e: Exception) {
      Log.e(TAG, "handleClient error", e)
    } finally {
      try { client.close() } catch (_: IOException) {}
    }
  }

  private fun serveSong(client: java.net.Socket, songId: String) {
    val uri = resolveSongUri(songId) ?: run {
      sendResponse(client, "404 Not Found", "text/plain", "Song not found")
      return
    }
    val file = File(uri.path ?: uri.toString())
    if (!file.exists()) {
      sendResponse(client, "404 Not Found", "text/plain", "File not found")
      return
    }
    val mime = when (file.extension.lowercase()) {
      "mp3" -> "audio/mpeg"
      "flac" -> "audio/flac"
      "wav" -> "audio/wav"
      "ogg", "oga" -> "audio/ogg"
      "m4a", "aac" -> "audio/mp4"
      "wma" -> "audio/x-ms-wma"
      else -> "audio/mpeg"
    }
    sendFileResponse(client, file, mime)
  }

  private fun serveCoverArt(client: java.net.Socket, songId: String) {
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
    sendFileResponse(client, file, "image/jpeg")
  }

  private fun resolveSongUri(songId: String): Uri? {
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

  private fun sendFileResponse(client: java.net.Socket, file: File, mimeType: String) {
    try {
      val fis = FileInputStream(file)
      val len = file.length()
      val out = client.getOutputStream()
      val header = "HTTP/1.1 200 OK\r\nContent-Type: $mimeType\r\nContent-Length: $len\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
      out.write(header.toByteArray())
      fis.copyTo(out, 8192)
      fis.close()
      out.flush()
    } catch (e: Exception) {
      Log.e(TAG, "sendFileResponse error", e)
    }
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

    fun getLocalIpAddress(): String {
      try {
        val interfaces = NetworkInterface.getNetworkInterfaces()
        while (interfaces.hasMoreElements()) {
          val intf = interfaces.nextElement()
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

private fun java.io.InputStream.copyTo(out: java.io.OutputStream, bufferSize: Int) {
  val buffer = ByteArray(bufferSize)
  var bytesRead: Int
  while (this.read(buffer).also { bytesRead = it } >= 0) {
    out.write(buffer, 0, bytesRead)
  }
}
