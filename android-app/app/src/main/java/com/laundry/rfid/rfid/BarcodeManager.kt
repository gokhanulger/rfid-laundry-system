package com.laundry.rfid.rfid

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import android.view.KeyEvent
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manager for built-in barcode/QR scanners on Chainway and Handheld devices
 *
 * Supports:
 * - Chainway C72: Uses broadcast receiver for scan results
 * - Handheld C6: Uses broadcast receiver for scan results
 */
@Singleton
class BarcodeManager @Inject constructor(
    private val context: Context
) {
    companion object {
        private const val TAG = "BarcodeManager"

        // Chainway scanner intents
        private const val CHAINWAY_SCAN_ACTION = "com.scanner.broadcast"
        private const val CHAINWAY_DATA_KEY = "data"

        // Handheld/Generic scanner intents
        private const val HANDHELD_SCAN_ACTION = "android.intent.ACTION_DECODE_DATA"
        private const val HANDHELD_DATA_KEY = "barcode_string"

        // Alternative broadcast actions (different firmware versions)
        private const val SCAN_ACTION_1 = "com.android.scanner.ACTION_DATA_CODE_RECEIVED"
        private const val SCAN_ACTION_2 = "android.intent.action.SCANRESULT"
        private const val SCAN_ACTION_3 = "com.barcodescanner.BARCODE_SCANNED"
        private const val SCAN_ACTION_4 = "xltech.ACTION_SEND_BARCODE"
    }

    private val _barcodeFlow = MutableSharedFlow<String>(extraBufferCapacity = 10)
    val barcodeFlow: SharedFlow<String> = _barcodeFlow.asSharedFlow()

    private var isRegistered = false
    private var scanCallback: ((String) -> Unit)? = null

    private val scanReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.let { processIntent(it) }
        }
    }

    private fun processIntent(intent: Intent) {
        val barcode = extractBarcode(intent)
        if (barcode != null && barcode.isNotBlank()) {
            Log.d(TAG, "Barcode scanned: $barcode")
            _barcodeFlow.tryEmit(barcode)
            scanCallback?.invoke(barcode)
        }
    }

    private fun extractBarcode(intent: Intent): String? {
        // Try different keys used by various scanner implementations
        val keys = listOf(
            CHAINWAY_DATA_KEY,
            HANDHELD_DATA_KEY,
            "barcode",
            "BARCODE",
            "scannerdata",
            "SCAN_BARCODE1",
            "data",
            "DATA"
        )

        for (key in keys) {
            intent.getStringExtra(key)?.let { return it }
        }

        // Try byte array
        intent.getByteArrayExtra("barocode")?.let {
            return String(it, Charsets.UTF_8).trim()
        }
        intent.getByteArrayExtra("barcode")?.let {
            return String(it, Charsets.UTF_8).trim()
        }

        return null
    }

    fun startListening(callback: ((String) -> Unit)? = null) {
        if (isRegistered) return

        scanCallback = callback

        val filter = IntentFilter().apply {
            addAction(CHAINWAY_SCAN_ACTION)
            addAction(HANDHELD_SCAN_ACTION)
            addAction(SCAN_ACTION_1)
            addAction(SCAN_ACTION_2)
            addAction(SCAN_ACTION_3)
            addAction(SCAN_ACTION_4)
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(scanReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(scanReceiver, filter)
            }
            isRegistered = true
            Log.d(TAG, "Barcode scanner receiver registered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register barcode receiver", e)
        }
    }

    fun stopListening() {
        if (!isRegistered) return

        try {
            context.unregisterReceiver(scanReceiver)
            isRegistered = false
            scanCallback = null
            Log.d(TAG, "Barcode scanner receiver unregistered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister barcode receiver", e)
        }
    }

    fun setCallback(callback: (String) -> Unit) {
        scanCallback = callback
    }

    fun clearCallback() {
        scanCallback = null
    }

    /**
     * Handle hardware key events for triggering scan
     * Some devices use KeyEvent to trigger scanning
     */
    fun handleKeyEvent(keyCode: Int, event: KeyEvent?): Boolean {
        // Common scan trigger keys
        val scanKeys = listOf(
            KeyEvent.KEYCODE_BUTTON_L1,
            KeyEvent.KEYCODE_BUTTON_R1,
            KeyEvent.KEYCODE_F1,
            KeyEvent.KEYCODE_F2,
            KeyEvent.KEYCODE_F3,
            KeyEvent.KEYCODE_F4,
            293, // Custom scan key on some devices
            294,
            295
        )

        return keyCode in scanKeys
    }
}
