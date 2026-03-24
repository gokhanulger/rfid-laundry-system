package com.laundry.rfid.ui.scan

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.CreatePickupRequest
import com.laundry.rfid.data.remote.dto.ItemLookupRequest
import com.laundry.rfid.data.remote.dto.TenantDto
import com.laundry.rfid.data.repository.DataCacheRepository
import com.laundry.rfid.data.repository.ScanRepository
import com.laundry.rfid.domain.model.ScanSession
import com.laundry.rfid.domain.model.ScannedTag
import com.laundry.rfid.domain.model.SessionType
import com.laundry.rfid.rfid.RfidCallback
import com.laundry.rfid.rfid.RfidManager
import com.laundry.rfid.rfid.RfidState
import com.laundry.rfid.rfid.RfidTag
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

// Item info from API lookup
data class ScannedItemInfo(
    val rfidTag: String,
    val itemTypeName: String?,
    val tenantId: String?,
    val tenantName: String?,
    val status: String?,
    val isRegistered: Boolean = false,
    val belongsToSelectedHotel: Boolean = false
)

// Grouped items by type and hotel for display
data class GroupedItem(
    val itemTypeName: String,
    val tenantId: String?,
    val tenantName: String?,
    val count: Int,
    val tags: List<String>,
    val belongsToSelectedHotel: Boolean
)

data class ScanUiState(
    val session: ScanSession? = null,
    val scannedTags: List<ScannedTag> = emptyList(),
    val scannedItemsInfo: Map<String, ScannedItemInfo> = emptyMap(),
    val groupedItems: List<GroupedItem> = emptyList(),
    val unregisteredCount: Int = 0,
    val tagCount: Int = 0,
    val matchedCount: Int = 0,
    val unmatchedCount: Int = 0,
    val otherHotelCount: Int = 0, // Items from other hotels (registered but wrong hotel)
    val otherHotelNames: List<String> = emptyList(), // Names of other hotels with item counts
    val deviceType: String = "", // RFID device type for debugging
    val cacheCount: Int = 0, // Number of items in local cache (for debugging)
    val isScanning: Boolean = false,
    val rfidState: RfidState = RfidState.Disconnected,
    val isCompleting: Boolean = false,
    val isCompleted: Boolean = false,
    val error: String? = null,
    // Hotel selection for driver
    val tenants: List<TenantDto> = emptyList(),
    val selectedTenantId: String? = null,
    val selectedTenantName: String? = null,
    val isLoadingTenants: Boolean = false,
    val showHotelSelector: Boolean = false
)

@HiltViewModel
class ScanViewModel @Inject constructor(
    private val scanRepository: ScanRepository,
    private val rfidManager: RfidManager,
    private val apiService: ApiService,
    private val dataCacheRepository: DataCacheRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    companion object {
        private const val LOOKUP_DEBOUNCE_MS = 100L  // Wait 100ms to batch lookups (faster than 200ms)
        private const val MAX_BATCH_SIZE = 50        // Maximum tags per API call
    }

    private val _uiState = MutableStateFlow(ScanUiState())
    val uiState: StateFlow<ScanUiState> = _uiState.asStateFlow()

    private var currentSessionId: String? = null
    private var currentSessionType: SessionType? = null
    private val toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 50)
    private val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

    // Batched lookup queue
    private val pendingLookupTags = mutableSetOf<String>()
    private var lookupJob: Job? = null

    init {
        // Observe RFID state
        viewModelScope.launch {
            rfidManager.state.collect { state ->
                _uiState.update { it.copy(rfidState = state) }
            }
        }

        // Observe scanned tags
        viewModelScope.launch {
            rfidManager.scannedTags.collect { tags ->
                val scannedTags = tags.values.map { tag ->
                    ScannedTag(
                        rfidTag = tag.epc,
                        signalStrength = tag.rssi,
                        readCount = tag.readCount
                    )
                }.sortedByDescending { it.readCount }

                // Calculate matched/unmatched counts
                val itemsInfo = _uiState.value.scannedItemsInfo
                val matchedCount = scannedTags.count { tag ->
                    itemsInfo[tag.rfidTag]?.belongsToSelectedHotel == true
                }

                _uiState.update {
                    it.copy(
                        scannedTags = scannedTags,
                        tagCount = scannedTags.size,
                        matchedCount = matchedCount,
                        unmatchedCount = scannedTags.size - matchedCount
                    )
                }
            }
        }
    }

    // Load hotels for driver selection - CACHE ONLY (no auto refresh)
    fun loadTenants() {
        viewModelScope.launch {
            // Load from cache ONLY - no auto refresh
            val cached = dataCacheRepository.getCachedTenants()
            if (cached.isNotEmpty()) {
                _uiState.update { it.copy(tenants = cached, isLoadingTenants = false) }
            } else {
                // No cache - must fetch from API
                refreshTenants()
            }
        }
    }

    // Manual refresh - call when user presses refresh button
    fun refreshTenants() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingTenants = true) }
            dataCacheRepository.refreshTenants()
                .onSuccess { tenants ->
                    _uiState.update { it.copy(tenants = tenants, isLoadingTenants = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingTenants = false, error = "Oteller yüklenemedi: ${e.message}") }
                }
        }
    }

    fun selectTenant(tenantId: String, tenantName: String) {
        _uiState.update {
            it.copy(
                selectedTenantId = tenantId,
                selectedTenantName = tenantName,
                showHotelSelector = false
            )
        }
        // Re-check all scanned items against new hotel
        updateItemsForSelectedHotel()
    }

    fun showHotelSelector() {
        _uiState.update { it.copy(showHotelSelector = true) }
    }

    fun hideHotelSelector() {
        _uiState.update { it.copy(showHotelSelector = false) }
    }

    // Select tenant by QR code
    fun selectTenantByQR(qrCode: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingTenants = true) }
            try {
                val response = apiService.getTenantByQR(qrCode)
                if (response.isSuccessful && response.body() != null) {
                    val tenant = response.body()!!
                    selectTenant(tenant.id, tenant.name)
                    _uiState.update { it.copy(isLoadingTenants = false) }
                } else {
                    _uiState.update {
                        it.copy(
                            isLoadingTenants = false,
                            error = "Bu QR kodla otel bulunamadı"
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingTenants = false,
                        error = "QR kod okunamadı: ${e.message}"
                    )
                }
            }
        }
    }

    private fun updateItemsForSelectedHotel() {
        val selectedTenantId = _uiState.value.selectedTenantId
        val currentItems = _uiState.value.scannedItemsInfo.toMutableMap()

        currentItems.forEach { (tag, info) ->
            // Compare by tenantId to avoid Turkish character encoding issues
            currentItems[tag] = info.copy(
                belongsToSelectedHotel = info.tenantId != null && info.tenantId == selectedTenantId
            )
        }

        val matchedCount = currentItems.values.count { it.belongsToSelectedHotel }
        val groupedItems = calculateGroupedItems(currentItems)
        val unregisteredCount = currentItems.values.count { !it.isRegistered }
        // Count registered items from other hotels
        val otherHotelItems = currentItems.values.filter { it.isRegistered && !it.belongsToSelectedHotel }
        val otherHotelCount = otherHotelItems.size
        // Get unique hotel names with counts
        val otherHotelNames = otherHotelItems
            .groupBy { it.tenantName ?: "Bilinmeyen" }
            .map { "${it.key}: ${it.value.size}" }

        _uiState.update {
            it.copy(
                scannedItemsInfo = currentItems,
                groupedItems = groupedItems,
                unregisteredCount = unregisteredCount,
                matchedCount = matchedCount,
                unmatchedCount = _uiState.value.scannedTags.size - matchedCount,
                otherHotelCount = otherHotelCount,
                otherHotelNames = otherHotelNames
            )
        }
    }

    // Group registered items by item type and hotel
    private fun calculateGroupedItems(itemsInfo: Map<String, ScannedItemInfo>): List<GroupedItem> {
        return itemsInfo.values
            .filter { it.isRegistered } // Only registered items
            .groupBy { "${it.itemTypeName ?: "Unknown"}|${it.tenantId ?: ""}" }
            .map { (key, items) ->
                val first = items.first()
                GroupedItem(
                    itemTypeName = first.itemTypeName ?: "Bilinmeyen",
                    tenantId = first.tenantId,
                    tenantName = first.tenantName,
                    count = items.size,
                    tags = items.map { it.rfidTag },
                    belongsToSelectedHotel = first.belongsToSelectedHotel
                )
            }
            .sortedWith(compareByDescending<GroupedItem> { it.belongsToSelectedHotel }.thenByDescending { it.count })
    }

    /**
     * Lookup a tag - first try local cache (instant), then API if not found
     */
    private fun queueLookup(tag: String) {
        // Skip if already known
        if (_uiState.value.scannedItemsInfo.containsKey(tag)) return

        // Try local cache first (instant, <1ms)
        val cachedItem = dataCacheRepository.findItemByScannedTag(tag)
        if (cachedItem != null) {
            // Found in local cache - update UI immediately
            val selectedTenantId = _uiState.value.selectedTenantId
            val info = ScannedItemInfo(
                rfidTag = tag, // Use scanned tag, not DB tag
                itemTypeName = cachedItem.itemTypeName,
                tenantId = cachedItem.tenantId,
                tenantName = cachedItem.tenantName,
                status = cachedItem.status,
                isRegistered = true,
                belongsToSelectedHotel = cachedItem.tenantId == selectedTenantId
            )
            addScannedItemInfo(tag, info)
            android.util.Log.d("ScanViewModel", "Cache HIT: $tag -> ${cachedItem.itemTypeName}")
            return
        }

        // Not in cache - queue for API lookup (with debounce)
        android.util.Log.d("ScanViewModel", "Cache MISS: $tag - queuing for API")
        synchronized(pendingLookupTags) {
            pendingLookupTags.add(tag)
        }

        // Cancel existing debounce job and start new one
        lookupJob?.cancel()
        lookupJob = viewModelScope.launch {
            delay(LOOKUP_DEBOUNCE_MS)
            flushPendingLookups()
        }
    }

    /**
     * Add scanned item info and update UI state
     */
    private fun addScannedItemInfo(tag: String, info: ScannedItemInfo) {
        val currentItems = _uiState.value.scannedItemsInfo.toMutableMap()
        currentItems[tag] = info

        val matchedCount = currentItems.values.count { it.belongsToSelectedHotel }
        val groupedItems = calculateGroupedItems(currentItems)
        val unregisteredCount = currentItems.values.count { !it.isRegistered }
        val otherHotelItems = currentItems.values.filter { it.isRegistered && !it.belongsToSelectedHotel }
        val otherHotelCount = otherHotelItems.size
        val otherHotelNames = otherHotelItems
            .groupBy { it.tenantName ?: "Bilinmeyen" }
            .map { "${it.key}: ${it.value.size}" }

        _uiState.update {
            it.copy(
                scannedItemsInfo = currentItems,
                groupedItems = groupedItems,
                unregisteredCount = unregisteredCount,
                matchedCount = matchedCount,
                unmatchedCount = _uiState.value.scannedTags.size - matchedCount,
                otherHotelCount = otherHotelCount,
                otherHotelNames = otherHotelNames
            )
        }
    }

    /**
     * Flush all pending lookups in a single batched API call
     */
    private suspend fun flushPendingLookups() {
        val tagsToLookup: List<String>
        synchronized(pendingLookupTags) {
            if (pendingLookupTags.isEmpty()) return
            tagsToLookup = pendingLookupTags.toList()
            pendingLookupTags.clear()
        }

        // Process in batches if too many tags
        tagsToLookup.chunked(MAX_BATCH_SIZE).forEach { batch ->
            lookupItems(batch)
        }
    }

    // Lookup items from API - called with batched tags
    private suspend fun lookupItems(tags: List<String>) {
        if (tags.isEmpty()) return

        try {
            val response = withContext(Dispatchers.IO) {
                apiService.lookupItems(ItemLookupRequest(tags))
            }

            if (response.isSuccessful) {
                val result = response.body()
                val selectedTenantId = _uiState.value.selectedTenantId
                val newItemsInfo = mutableMapOf<String, ScannedItemInfo>()

                // Add registered items from API response
                result?.items?.forEach { item ->
                    newItemsInfo[item.rfidTag] = ScannedItemInfo(
                        rfidTag = item.rfidTag,
                        itemTypeName = item.itemType?.name,
                        tenantId = item.tenantId,
                        tenantName = item.tenant?.name,
                        status = item.status,
                        isRegistered = true,
                        // Compare by tenantId to avoid Turkish character encoding issues
                        belongsToSelectedHotel = item.tenantId == selectedTenantId
                    )
                }

                // Add unregistered items (not found in API)
                result?.notFoundTags?.forEach { tag ->
                    newItemsInfo[tag] = ScannedItemInfo(
                        rfidTag = tag,
                        itemTypeName = null,
                        tenantId = null,
                        tenantName = null,
                        status = null,
                        isRegistered = false,
                        belongsToSelectedHotel = false
                    )
                }

                // Merge with existing items info
                val mergedItemsInfo = _uiState.value.scannedItemsInfo + newItemsInfo
                val matchedCount = mergedItemsInfo.values.count { it.belongsToSelectedHotel }
                val groupedItems = calculateGroupedItems(mergedItemsInfo)
                val unregisteredCount = mergedItemsInfo.values.count { !it.isRegistered }
                val otherHotelItems = mergedItemsInfo.values.filter { it.isRegistered && !it.belongsToSelectedHotel }
                val otherHotelCount = otherHotelItems.size
                val otherHotelNames = otherHotelItems
                    .groupBy { it.tenantName ?: "Bilinmeyen" }
                    .map { "${it.key}: ${it.value.size}" }

                _uiState.update {
                    it.copy(
                        scannedItemsInfo = mergedItemsInfo,
                        groupedItems = groupedItems,
                        unregisteredCount = unregisteredCount,
                        matchedCount = matchedCount,
                        unmatchedCount = _uiState.value.scannedTags.size - matchedCount,
                        otherHotelCount = otherHotelCount,
                        otherHotelNames = otherHotelNames
                    )
                }
            }
        } catch (e: Exception) {
            // Silent fail for lookup - items will show as unregistered
        }
    }

    fun startSession(sessionTypeString: String) {
        val sessionType = SessionType.values().find { it.value == sessionTypeString }
            ?: SessionType.PICKUP

        currentSessionType = sessionType

        viewModelScope.launch {
            try {
                val session = scanRepository.createSession(sessionType = sessionType)
                currentSessionId = session.id

                // Get device type for debugging
                val deviceType = rfidManager.getDeviceType().name
                _uiState.update { it.copy(session = session, deviceType = deviceType) }

                // Initialize RFID reader
                rfidManager.initialize()

                // Load items cache to memory for fast local lookup
                val cacheCount = dataCacheRepository.loadItemsToMemory()
                _uiState.update { it.copy(cacheCount = cacheCount) }
                android.util.Log.d("ScanViewModel", "Loaded $cacheCount items to memory cache")

                // If no cache, refresh from API in background
                if (cacheCount == 0) {
                    viewModelScope.launch(Dispatchers.IO) {
                        val result = dataCacheRepository.refreshItems()
                        result.onSuccess { count ->
                            _uiState.update { it.copy(cacheCount = count) }
                        }
                    }
                }

                // Load hotels for pickup and deliver sessions
                if (sessionType == SessionType.PICKUP || sessionType == SessionType.DELIVER) {
                    loadTenants()
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun startScanning() {
        rfidManager.startScanning(object : RfidCallback {
            override fun onTagRead(tag: RfidTag) {
                // Play beep and vibrate on new tag
                playFeedback()

                // Queue item lookup - will be batched with debouncing
                queueLookup(tag.epc)

                // Save to local database with IO dispatcher
                currentSessionId?.let { sessionId ->
                    viewModelScope.launch(Dispatchers.IO) {
                        scanRepository.addScanEvent(
                            sessionId = sessionId,
                            rfidTag = tag.epc,
                            signalStrength = tag.rssi
                        )
                    }
                }
            }

            override fun onStateChanged(state: RfidState) {
                _uiState.update { it.copy(rfidState = state, isScanning = state == RfidState.Scanning) }
            }

            override fun onError(error: String) {
                _uiState.update { it.copy(error = error) }
            }
        })

        _uiState.update { it.copy(isScanning = true) }
    }

    fun stopScanning() {
        rfidManager.stopScanning()
        _uiState.update { it.copy(isScanning = false) }
    }

    fun toggleScanning() {
        if (_uiState.value.isScanning) {
            stopScanning()
        } else {
            startScanning()
        }
    }

    fun completeSession() {
        val sessionId = currentSessionId ?: return
        val sessionType = currentSessionType ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isCompleting = true) }

            try {
                // Stop scanning first
                stopScanning()

                // Save all scanned tags locally
                val tags = rfidManager.getScannedTagsList()
                scanRepository.addBulkScanEvents(
                    sessionId = sessionId,
                    tags = tags.map { tag ->
                        ScannedTag(
                            rfidTag = tag.epc,
                            signalStrength = tag.rssi,
                            readCount = tag.readCount
                        )
                    }
                )

                // For pickup sessions, send to backend
                if (sessionType == SessionType.PICKUP) {
                    val tenantId = _uiState.value.selectedTenantId
                    if (tenantId != null) {
                        // Get only registered items that belong to selected hotel
                        val matchedTags = _uiState.value.scannedItemsInfo
                            .filter { it.value.isRegistered && it.value.belongsToSelectedHotel }
                            .keys
                            .toList()

                        if (matchedTags.isNotEmpty()) {
                            val response = apiService.createPickupFromTags(
                                CreatePickupRequest(
                                    tenantId = tenantId,
                                    rfidTags = matchedTags
                                )
                            )
                            if (!response.isSuccessful) {
                                throw Exception("Toplama kaydedilemedi: ${response.code()}")
                            }
                        }
                    }
                }

                // Complete the session locally
                scanRepository.completeSession(sessionId)

                _uiState.update {
                    it.copy(
                        isCompleting = false,
                        isCompleted = true
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isCompleting = false,
                        error = e.message
                    )
                }
            }
        }
    }

    // Check if completion is allowed
    fun canComplete(): Boolean {
        val state = _uiState.value
        // If hotel selection is required, just check if hotel is selected
        if (currentSessionType == SessionType.PICKUP || currentSessionType == SessionType.DELIVER) {
            if (state.selectedTenantId == null) return false
            // Allow completion even if there are items from other hotels
            // Those items will be ignored during pickup creation
        }
        return state.tagCount > 0 && !state.isScanning && !state.isCompleting
    }

    fun clearTags() {
        rfidManager.clearScannedTags()
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun playFeedback() {
        // Run feedback on IO dispatcher to avoid blocking tag processing
        viewModelScope.launch(Dispatchers.IO) {
            try {
                // Short beep
                toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP, 50)

                // Short vibration
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(50, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(50)
                }
            } catch (e: Exception) {
                // Ignore audio/vibration errors
            }
        }
    }

    // For testing without physical RFID reader
    fun simulateScan() {
        val randomTag = "E2000011223344${(1000..9999).random()}"
        rfidManager.simulateTagRead(randomTag, (-70..-30).random())
    }

    /**
     * Manually refresh items cache from API
     * Call this if items seem outdated
     */
    fun refreshItemsCache() {
        viewModelScope.launch(Dispatchers.IO) {
            _uiState.update { it.copy(error = "Ürün listesi güncelleniyor...") }
            val result = dataCacheRepository.refreshItems()
            result.onSuccess { count ->
                _uiState.update { it.copy(error = null) }
                android.util.Log.d("ScanViewModel", "Refreshed $count items from API")
            }.onFailure { e ->
                _uiState.update { it.copy(error = "Cache güncellenemedi: ${e.message}") }
            }
        }
    }

    /**
     * Get items cache status
     */
    suspend fun getItemsCacheCount(): Int {
        return dataCacheRepository.getItemsCacheCount()
    }

    override fun onCleared() {
        super.onCleared()
        rfidManager.stopScanning()
        toneGenerator.release()
        // Don't clear memory cache here - it's shared across ViewModel instances
    }
}
