package com.laundry.rfid.rfid

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.UHFTAGInfo
import com.rscja.deviceapi.interfaces.IUHFInventoryCallback
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * RFID Manager for Chainway C72
 *
 * Uses the Chainway DeviceAPI SDK (RFIDWithUHFUART)
 */

data class RfidTag(
    val epc: String,          // Tag ID (EPC)
    val rssi: Int,            // Signal strength
    val readCount: Int = 1,   // How many times read
    val timestamp: Long = System.currentTimeMillis()
)

sealed class RfidState {
    object Disconnected : RfidState()
    object Connecting : RfidState()
    object Connected : RfidState()
    object Scanning : RfidState()
    data class Error(val message: String) : RfidState()
}

interface RfidCallback {
    fun onTagRead(tag: RfidTag)
    fun onStateChanged(state: RfidState)
    fun onError(error: String)
}

@Singleton
class RfidManager @Inject constructor(
    private val context: Context
) {
    companion object {
        private const val TAG = "RfidManager"
    }

    private val _state = MutableStateFlow<RfidState>(RfidState.Disconnected)
    val state: StateFlow<RfidState> = _state.asStateFlow()

    private val _scannedTags = MutableStateFlow<Map<String, RfidTag>>(emptyMap())
    val scannedTags: StateFlow<Map<String, RfidTag>> = _scannedTags.asStateFlow()

    private var callback: RfidCallback? = null
    private val handler = Handler(Looper.getMainLooper())

    // Chainway SDK instance
    private var rfidReader: RFIDWithUHFUART? = null

    private var isInitialized = false
    private var isScanning = false

    /**
     * Initialize the RFID reader
     */
    fun initialize(): Boolean {
        if (isInitialized) return true

        try {
            _state.value = RfidState.Connecting

            // Get the RFID reader instance
            rfidReader = RFIDWithUHFUART.getInstance()

            // Initialize the reader - this connects to the UHF module
            val result = rfidReader?.init(context)

            if (result == true) {
                isInitialized = true
                _state.value = RfidState.Connected
                Log.d(TAG, "RFID reader initialized successfully")
                return true
            } else {
                _state.value = RfidState.Error("Failed to initialize RFID reader")
                Log.e(TAG, "Failed to initialize RFID reader")
                return false
            }

        } catch (e: Exception) {
            _state.value = RfidState.Error(e.message ?: "Unknown error")
            Log.e(TAG, "Error initializing RFID reader", e)
            return false
        }
    }

    /**
     * Start scanning for RFID tags
     */
    fun startScanning(callback: RfidCallback? = null) {
        if (!isInitialized) {
            if (!initialize()) {
                callback?.onError("Failed to initialize RFID reader")
                return
            }
        }

        if (isScanning) return

        this.callback = callback
        _scannedTags.value = emptyMap()

        try {
            // Set up inventory callback
            rfidReader?.setInventoryCallback(object : IUHFInventoryCallback {
                override fun callback(tagInfo: UHFTAGInfo?) {
                    tagInfo?.let {
                        val epc = it.epc ?: return
                        val rssi = it.rssi?.toIntOrNull() ?: -50
                        handleTagRead(epc, rssi)
                    }
                }
            })

            // Start continuous inventory
            val success = rfidReader?.startInventoryTag() ?: false

            if (success) {
                isScanning = true
                _state.value = RfidState.Scanning
                callback?.onStateChanged(RfidState.Scanning)
                Log.d(TAG, "Started RFID scanning")
            } else {
                _state.value = RfidState.Error("Failed to start inventory")
                callback?.onError("Failed to start scanning")
            }

        } catch (e: Exception) {
            _state.value = RfidState.Error(e.message ?: "Unknown error")
            callback?.onError(e.message ?: "Failed to start scanning")
            Log.e(TAG, "Error starting scan", e)
        }
    }

    /**
     * Stop scanning
     */
    fun stopScanning() {
        if (!isScanning) return

        try {
            rfidReader?.stopInventory()

            isScanning = false
            _state.value = RfidState.Connected
            callback?.onStateChanged(RfidState.Connected)

            Log.d(TAG, "Stopped RFID scanning. Total tags: ${_scannedTags.value.size}")

        } catch (e: Exception) {
            Log.e(TAG, "Error stopping scan", e)
        }
    }

    /**
     * Handle a tag read from the SDK
     */
    private fun handleTagRead(epc: String, rssi: Int) {
        val cleanEpc = epc.trim().uppercase()

        handler.post {
            val currentTags = _scannedTags.value.toMutableMap()
            val existingTag = currentTags[cleanEpc]

            val tag = if (existingTag != null) {
                existingTag.copy(
                    rssi = maxOf(existingTag.rssi, rssi),
                    readCount = existingTag.readCount + 1,
                    timestamp = System.currentTimeMillis()
                )
            } else {
                RfidTag(
                    epc = cleanEpc,
                    rssi = rssi,
                    readCount = 1,
                    timestamp = System.currentTimeMillis()
                )
            }

            currentTags[cleanEpc] = tag
            _scannedTags.value = currentTags

            callback?.onTagRead(tag)
        }
    }

    /**
     * Clear scanned tags
     */
    fun clearScannedTags() {
        _scannedTags.value = emptyMap()
    }

    /**
     * Get current tag count
     */
    fun getTagCount(): Int = _scannedTags.value.size

    /**
     * Get all scanned tags as list
     */
    fun getScannedTagsList(): List<RfidTag> = _scannedTags.value.values.toList()

    /**
     * Set reader power (0-30 dBm typically)
     */
    fun setPower(power: Int) {
        try {
            rfidReader?.setPower(power)
            Log.d(TAG, "Set power to $power dBm")
        } catch (e: Exception) {
            Log.e(TAG, "Error setting power", e)
        }
    }

    /**
     * Get current power level
     */
    fun getPower(): Int {
        return try {
            rfidReader?.power ?: 20
        } catch (e: Exception) {
            20
        }
    }

    /**
     * Release resources
     */
    fun release() {
        stopScanning()
        try {
            rfidReader?.free()
            rfidReader = null
            isInitialized = false
            _state.value = RfidState.Disconnected
            Log.d(TAG, "RFID manager released")
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing RFID reader", e)
        }
    }

    // ============================================
    // SIMULATION METHODS FOR TESTING WITHOUT DEVICE
    // These can be removed in production builds
    // ============================================

    /**
     * Simulate a tag read (for testing on emulator/non-RFID devices)
     */
    fun simulateTagRead(epc: String, rssi: Int = -50) {
        if (isScanning || _state.value == RfidState.Connected) {
            handleTagRead(epc, rssi)
        }
    }

    /**
     * Simulate multiple tag reads
     */
    fun simulateBulkRead(count: Int = 10) {
        if (_state.value != RfidState.Scanning && _state.value != RfidState.Connected) return

        repeat(count) { index ->
            val epc = "E200001122334455667788${String.format("%04X", index)}"
            val rssi = (-70..-30).random()
            handler.postDelayed({
                handleTagRead(epc, rssi)
            }, (index * 100).toLong())
        }
    }
}
