package com.laundry.rfid.rfid

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Multi-device RFID Manager
 *
 * Supports:
 * - Chainway C72 (uses RFIDWithUHFUART SDK)
 * - Handheld-Wireless C6 (uses UHFRManager SDK)
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

enum class DeviceType {
    CHAINWAY,
    HANDHELD,
    UNKNOWN
}

@Singleton
class RfidManager @Inject constructor(
    private val context: Context
) {
    companion object {
        private const val TAG = "RfidManager"
        private const val TAG_UPDATE_DEBOUNCE_MS = 100L  // Debounce UI updates to every 100ms
        private const val HANDHELD_SCAN_INTERVAL_MS = 10L

        /**
         * Detect device type based on manufacturer and model
         */
        fun detectDeviceType(): DeviceType {
            val manufacturer = Build.MANUFACTURER.lowercase()
            val model = Build.MODEL.lowercase()

            Log.d(TAG, "Device: manufacturer=$manufacturer, model=$model")

            return when {
                manufacturer.contains("chainway") -> DeviceType.CHAINWAY
                manufacturer.contains("handheld") -> DeviceType.HANDHELD
                model.contains("c72") -> DeviceType.CHAINWAY
                model.contains("c6") && !model.contains("c60") -> DeviceType.HANDHELD
                model.startsWith("c6") -> DeviceType.HANDHELD
                else -> {
                    // Try to detect by available classes
                    if (isChainwayAvailable()) DeviceType.CHAINWAY
                    else if (isHandheldAvailable()) DeviceType.HANDHELD
                    else DeviceType.UNKNOWN
                }
            }
        }

        private fun isChainwayAvailable(): Boolean {
            return try {
                Class.forName("com.rscja.deviceapi.RFIDWithUHFUART")
                true
            } catch (e: ClassNotFoundException) {
                false
            }
        }

        private fun isHandheldAvailable(): Boolean {
            return try {
                Class.forName("com.handheld.uhfr.UHFRManager")
                true
            } catch (e: ClassNotFoundException) {
                false
            }
        }
    }

    private val deviceType = detectDeviceType()

    private val _state = MutableStateFlow<RfidState>(RfidState.Disconnected)
    val state: StateFlow<RfidState> = _state.asStateFlow()

    private val _scannedTags = MutableStateFlow<Map<String, RfidTag>>(emptyMap())
    val scannedTags: StateFlow<Map<String, RfidTag>> = _scannedTags.asStateFlow()

    private var callback: RfidCallback? = null

    // Coroutine scope for background operations
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var scanJob: Job? = null
    private var updateJob: Job? = null

    // Thread-safe pending tags buffer for batched updates
    private val pendingTags = ConcurrentHashMap<String, RfidTag>()
    private val tagsBuffer = ConcurrentHashMap<String, RfidTag>()

    // SDK instances - only one will be used based on device type
    private var chainwayReader: com.rscja.deviceapi.RFIDWithUHFUART? = null
    private var handheldManager: com.handheld.uhfr.UHFRManager? = null

    private var isInitialized = false
    private var isScanning = false

    fun getDeviceType(): DeviceType = deviceType

    /**
     * Initialize the RFID reader
     */
    fun initialize(): Boolean {
        if (isInitialized) return true

        Log.d(TAG, "Initializing RFID reader for device type: $deviceType")

        return when (deviceType) {
            DeviceType.CHAINWAY -> initializeChainway()
            DeviceType.HANDHELD -> initializeHandheld()
            DeviceType.UNKNOWN -> {
                _state.value = RfidState.Error("Unknown device type - RFID not supported")
                false
            }
        }
    }

    private fun initializeChainway(): Boolean {
        try {
            _state.value = RfidState.Connecting

            chainwayReader = com.rscja.deviceapi.RFIDWithUHFUART.getInstance()
            val result = chainwayReader?.init(context)

            if (result == true) {
                isInitialized = true
                _state.value = RfidState.Connected

                // Gücü maksimuma ayarla (30 dBm) - bazı etiketler düşük güçte okunamıyor
                chainwayReader?.setPower(30)

                // Session ve Target ayarları - SDK bu metodları desteklemiyor olabilir
                // Varsayılan değerler kullanılacak

                Log.d(TAG, "Chainway RFID reader initialized successfully with power=30dBm")
                return true
            } else {
                _state.value = RfidState.Error("Failed to initialize Chainway RFID reader")
                Log.e(TAG, "Failed to initialize Chainway RFID reader")
                return false
            }

        } catch (e: Exception) {
            _state.value = RfidState.Error(e.message ?: "Unknown error")
            Log.e(TAG, "Error initializing Chainway RFID reader", e)
            return false
        }
    }

    private fun initializeHandheld(): Boolean {
        try {
            _state.value = RfidState.Connecting

            // New SDK uses getInstance() (typo fixed)
            handheldManager = com.handheld.uhfr.UHFRManager.getInstance()

            if (handheldManager != null) {
                isInitialized = true
                _state.value = RfidState.Connected

                // Gücü maksimuma ayarla (30 dBm) - daha geniş okuma alanı için
                try {
                    handheldManager?.setPower(30, 30) // ant1=30, ant2=30
                    Log.d(TAG, "Handheld power set to 30 dBm")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to set Handheld power", e)
                }

                Log.d(TAG, "Handheld RFID reader initialized successfully with power=30dBm")
                return true
            } else {
                _state.value = RfidState.Error("Failed to initialize Handheld RFID reader")
                Log.e(TAG, "Failed to initialize Handheld RFID reader")
                return false
            }

        } catch (e: Exception) {
            _state.value = RfidState.Error(e.message ?: "Unknown error")
            Log.e(TAG, "Error initializing Handheld RFID reader", e)
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

        when (deviceType) {
            DeviceType.CHAINWAY -> startChainwayScanning(callback)
            DeviceType.HANDHELD -> startHandheldScanning(callback)
            DeviceType.UNKNOWN -> callback?.onError("Unknown device type")
        }
    }

    private fun startChainwayScanning(callback: RfidCallback?) {
        try {
            // Set up inventory callback
            chainwayReader?.setInventoryCallback(object : com.rscja.deviceapi.interfaces.IUHFInventoryCallback {
                override fun callback(tagInfo: com.rscja.deviceapi.entity.UHFTAGInfo?) {
                    tagInfo?.let {
                        val epc = it.epc ?: return
                        val rssi = it.rssi?.toIntOrNull() ?: -50
                        handleTagRead(epc, rssi)
                    }
                }
            })

            // Start continuous inventory
            val success = chainwayReader?.startInventoryTag() ?: false

            if (success) {
                isScanning = true
                _state.value = RfidState.Scanning
                callback?.onStateChanged(RfidState.Scanning)

                // Start debounced UI update job
                startDebouncedUpdates()

                Log.d(TAG, "Started Chainway RFID scanning")
            } else {
                _state.value = RfidState.Error("Failed to start inventory")
                callback?.onError("Failed to start scanning")
            }

        } catch (e: Exception) {
            _state.value = RfidState.Error(e.message ?: "Unknown error")
            callback?.onError(e.message ?: "Failed to start scanning")
            Log.e(TAG, "Error starting Chainway scan", e)
        }
    }

    private fun startHandheldScanning(callback: RfidCallback?) {
        try {
            isScanning = true
            _state.value = RfidState.Scanning
            callback?.onStateChanged(RfidState.Scanning)

            // Start debounced UI update job
            startDebouncedUpdates()

            // Start inventory using coroutines instead of bare Thread
            scanJob = scope.launch(Dispatchers.IO) {
                Log.d(TAG, "Starting Handheld inventory scan coroutine")
                while (isActive && isScanning) {
                    try {
                        val tagList = handheldManager?.tagInventoryByTimer(100.toShort()) // 100ms timeout for better range
                        tagList?.forEach { tagInfo ->
                            // Reader.TAGINFO has EpcId (byte[]) and RSSI (int)
                            val epcBytes = tagInfo?.EpcId
                            val rssi = tagInfo?.RSSI ?: -50
                            if (epcBytes != null && epcBytes.isNotEmpty()) {
                                val epc = epcBytes.joinToString("") { "%02X".format(it) }
                                if (epc.isNotEmpty()) {
                                    handleTagRead(epc, rssi)
                                }
                            }
                        }
                        delay(HANDHELD_SCAN_INTERVAL_MS)
                    } catch (e: CancellationException) {
                        // Coroutine was cancelled, exit gracefully
                        Log.d(TAG, "Handheld scan coroutine cancelled")
                        break
                    } catch (e: Exception) {
                        Log.e(TAG, "Error during Handheld inventory", e)
                    }
                }
                Log.d(TAG, "Handheld inventory scan coroutine stopped")
            }

            Log.d(TAG, "Started Handheld RFID scanning")

        } catch (e: Exception) {
            isScanning = false
            _state.value = RfidState.Error(e.message ?: "Unknown error")
            callback?.onError(e.message ?: "Failed to start scanning")
            Log.e(TAG, "Error starting Handheld scan", e)
        }
    }

    /**
     * Stop scanning
     */
    fun stopScanning() {
        if (!isScanning) return

        try {
            // Stop the debounced update job
            updateJob?.cancel()
            updateJob = null

            when (deviceType) {
                DeviceType.CHAINWAY -> {
                    chainwayReader?.stopInventory()
                }
                DeviceType.HANDHELD -> {
                    isScanning = false
                    scanJob?.cancel()
                    scanJob = null
                    handheldManager?.stopTagInventory()
                }
                DeviceType.UNKNOWN -> {}
            }

            // Flush any remaining pending tags to the state
            flushPendingTags()

            isScanning = false
            _state.value = RfidState.Connected
            callback?.onStateChanged(RfidState.Connected)

            Log.d(TAG, "Stopped RFID scanning. Total tags: ${_scannedTags.value.size}")

        } catch (e: Exception) {
            Log.e(TAG, "Error stopping scan", e)
        }
    }

    /**
     * Handle a tag read from the SDK - uses batched updates to avoid blocking main thread
     */
    private fun handleTagRead(epc: String, rssi: Int) {
        val cleanEpc = epc.trim().uppercase()

        // Update the buffer atomically - no main thread blocking
        val existingTag = tagsBuffer[cleanEpc]
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

        tagsBuffer[cleanEpc] = tag
        pendingTags[cleanEpc] = tag

        // Callback is still triggered per tag but state update is debounced
        callback?.onTagRead(tag)
    }

    /**
     * Start the debounced update job that flushes pending tags to StateFlow periodically
     */
    private fun startDebouncedUpdates() {
        updateJob?.cancel()
        updateJob = scope.launch {
            while (isActive && isScanning) {
                delay(TAG_UPDATE_DEBOUNCE_MS)
                if (pendingTags.isNotEmpty()) {
                    flushPendingTags()
                }
            }
        }
    }

    /**
     * Flush pending tags to the StateFlow - called on debounce interval or when stopping
     */
    private fun flushPendingTags() {
        if (pendingTags.isEmpty()) return

        // Create a snapshot and clear pending
        val snapshot = HashMap(tagsBuffer)
        pendingTags.clear()

        // Update StateFlow with the complete buffer snapshot
        _scannedTags.value = snapshot

        Log.d(TAG, "Flushed ${snapshot.size} tags to StateFlow")
    }

    /**
     * Clear scanned tags
     */
    fun clearScannedTags() {
        tagsBuffer.clear()
        pendingTags.clear()
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
            when (deviceType) {
                DeviceType.CHAINWAY -> chainwayReader?.setPower(power)
                DeviceType.HANDHELD -> handheldManager?.setPower(power, power) // ant1, ant2
                DeviceType.UNKNOWN -> {}
            }
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
            when (deviceType) {
                DeviceType.CHAINWAY -> chainwayReader?.power ?: 20
                DeviceType.HANDHELD -> handheldManager?.power?.firstOrNull() ?: 20
                DeviceType.UNKNOWN -> 20
            }
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
            // Cancel all coroutines
            scope.cancel()

            when (deviceType) {
                DeviceType.CHAINWAY -> {
                    chainwayReader?.free()
                    chainwayReader = null
                }
                DeviceType.HANDHELD -> {
                    handheldManager?.close()
                    handheldManager = null
                }
                DeviceType.UNKNOWN -> {}
            }
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

        scope.launch {
            repeat(count) { index ->
                val epc = "E200001122334455667788${String.format("%04X", index)}"
                val rssi = (-70..-30).random()
                handleTagRead(epc, rssi)
                delay(100)
            }
        }
    }
}
