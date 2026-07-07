package com.shuffleimusic.player

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import android.os.Process
import android.util.Base64
import android.util.Log
import java.security.MessageDigest
import java.security.NoSuchAlgorithmException

class PackageValidator(private val context: Context) {
  companion object {
    private const val TAG = "PackageValidator"
  }

  private var knownCallers: Set<String>? = null

  fun isKnownCaller(packageName: String, uid: Int): Boolean {
    if (uid == Process.myUid()) return true
    if (uid == Process.SYSTEM_UID) return true
    val signatures = getSignatures(packageName)
    if (signatures == null || signatures.isEmpty()) return false
    val known = getKnownCallers()
    val sha1 = sha1(signatures[0]) ?: return false
    return known.contains(sha1)
  }

  private fun getSignatures(packageName: String): List<ByteArray>? {
    return try {
      val pm = context.packageManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        info.signingInfo?.apkContentsSigners?.map { it.toByteArray() }
      } else {
        @Suppress("DEPRECATION")
        val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
        info.signatures?.toList()?.map { it.toByteArray() }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to get signatures for $packageName", e)
      null
    }
  }

  private fun sha1(input: ByteArray): String? {
    return try {
      val digest = MessageDigest.getInstance("SHA-1")
      val bytes = digest.digest(input)
      bytes.joinToString(":") { "%02x".format(it) }
    } catch (e: NoSuchAlgorithmException) {
      null
    }
  }

  private fun getKnownCallers(): Set<String> {
    if (knownCallers == null) {
      knownCallers = setOf(
        "19:75:b2:f1:71:77:bc:89:a5:df:f3:1f:9e:64:a6:ca:e2:81:a5:3d:c1:d1:d5:9b:1d:14:7f:e1:c8:2a:fa:00",
        "70:81:1a:3e:ac:fd:2e:83:e1:8d:a9:bf:ed:e5:2d:f1:6c:e9:1f:2e:69:a4:4d:21:f1:8a:b6:69:91:13:07:71",
        "fd:b0:0c:43:db:de:8b:51:cb:31:2a:a8:1d:3b:5f:a1:77:13:ad:b9:4b:28:f5:98:d7:7f:8e:b8:9d:ac:ee:df",
        "a2:44:1f:e9:9e:1a:ef:00:0b:09:41:41:09:a7:d9:1d:58:68:65:11:5e:c8:52:a7:18:cd:e1:ef:ed:4c:0b:aa"
      )
    }
    return knownCallers!!
  }
}