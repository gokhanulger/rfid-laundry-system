package com.laundry.rfid.ui.tagtransfer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.BulkTransferRequest
import com.laundry.rfid.data.remote.dto.ItemTypeDto
import com.laundry.rfid.data.remote.dto.TenantDto
import com.laundry.rfid.data.remote.dto.TransferredItemDto
import com.laundry.rfid.data.repository.DataCacheRepository
import com.laundry.rfid.rfid.RfidCallback
import com.laundry.rfid.rfid.RfidManager
import com.laundry.rfid.rfid.RfidState
import com.laundry.rfid.rfid.RfidTag
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class TransferItemInfo(
    val rfidTag: String,
    val itemTypeName: String?,
    val currentTenantId: String?,
    val currentTenantName: String?,
    val isRegistered: Boolean
)

data class TagTransferUiState(
    val scannedTags: List<RfidTag> = emptyList(),
    val scannedItemsInfo: Map<String, TransferItemInfo> = emptyMap(),
    val tenants: List<TenantDto> = emptyList(),
    val itemTypes: List<ItemTypeDto> = emptyList(),
    val selectedTargetTenantId: String? = null,
    val selectedTargetTenantName: String? = null,
    val selectedItemTypeId: String? = null,
    val selectedItemTypeName: String? = null,
    val isScanning: Boolean = false,
    val isLoading: Boolean = false,
    val isTransferring: Boolean = false,
    val rfidState: RfidState = RfidState.Disconnected,
    val error: String? = null,
    val successMessage: String? = null,
    val transferResult: TransferResult? = null,
    val showHotelSelector: Boolean = false,
    val showItemTypeSelector: Boolean = false
)

data class TransferResult(
    val transferred: Int,
    val alreadyCorrect: Int,
    val notFound: Int,
    val total: Int,
    val transferredItems: List<TransferredItemDto>
)

@HiltViewModel
class TagTransferViewModel @Inject constructor(
    private val rfidManager: RfidManager,
    private val apiService: ApiService,
    private val dataCacheRepository: DataCacheRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TagTransferUiState())
    val uiState: StateFlow<TagTransferUiState> = _uiState.asStateFlow()

    private val pendingLookupTags = mutableSetOf<String>()
    private var lookupJob: Job? = null

    private val rfidCallback = object : RfidCallback {
        override fun onTagRead(tag: RfidTag) {
            val currentTags = _uiState.value.scannedTags.toMutableList()
            val existingIndex = currentTags.indexOfFirst { it.epc == tag.epc }
            if (existingIndex >= 0) {
                currentTags[existingIndex] = tag
            } else {
                currentTags.add(0, tag)
            }
            _uiState.update { it.copy(scannedTags = currentTags) }
            queueLookup(tag.epc)
        }

        override fun onStateChanged(state: RfidState) {
            _uiState.update { it.copy(rfidState = state) }
        }

        override fun onError(error: String) {
            _uiState.update { it.copy(error = error) }
        }
    }

    init {
        viewModelScope.launch {
            rfidManager.state.collect { state ->
                _uiState.update { it.copy(rfidState = state) }
            }
        }

        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val cachedTenants = dataCacheRepository.getCachedTenants()
                val cachedItemTypes = dataCacheRepository.getCachedItemTypes()
                if (cachedTenants.isNotEmpty()) {
                    _uiState.update { it.copy(tenants = cachedTenants, itemTypes = cachedItemTypes, isLoading = false) }
                } else {
                    refreshData()
                }

                // Load items cache for local lookup
                dataCacheRepository.loadItemsToMemory()

                // Initialize RFID
                rfidManager.initialize()
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = "Veriler yuklenemedi: ${e.message}") }
            }
        }
    }

    fun refreshData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            dataCacheRepository.refreshTenants()
                .onSuccess { tenants ->
                    _uiState.update { it.copy(tenants = tenants, isLoading = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoading = false, error = "Oteller yuklenemedi: ${e.message}") }
                }
            // Also refresh item types
            dataCacheRepository.refreshItemTypes()
                .onSuccess { itemTypes ->
                    _uiState.update { it.copy(itemTypes = itemTypes) }
                }
        }
    }

    fun toggleScanning() {
        if (_uiState.value.isScanning) {
            rfidManager.stopScanning()
            _uiState.update { it.copy(isScanning = false) }
        } else {
            rfidManager.startScanning(rfidCallback)
            _uiState.update { it.copy(isScanning = true) }
        }
    }

    fun selectTargetTenant(tenantId: String, tenantName: String) {
        _uiState.update {
            it.copy(
                selectedTargetTenantId = tenantId,
                selectedTargetTenantName = tenantName,
                showHotelSelector = false
            )
        }
    }

    fun showHotelSelector() {
        _uiState.update { it.copy(showHotelSelector = true) }
    }

    fun hideHotelSelector() {
        _uiState.update { it.copy(showHotelSelector = false) }
    }

    fun selectItemType(itemTypeId: String, itemTypeName: String) {
        _uiState.update {
            it.copy(
                selectedItemTypeId = itemTypeId,
                selectedItemTypeName = itemTypeName,
                showItemTypeSelector = false
            )
        }
    }

    fun clearItemType() {
        _uiState.update {
            it.copy(selectedItemTypeId = null, selectedItemTypeName = null)
        }
    }

    fun showItemTypeSelector() {
        _uiState.update { it.copy(showItemTypeSelector = true) }
    }

    fun hideItemTypeSelector() {
        _uiState.update { it.copy(showItemTypeSelector = false) }
    }

    fun clearTags() {
        rfidManager.clearScannedTags()
        _uiState.update { it.copy(scannedTags = emptyList(), scannedItemsInfo = emptyMap()) }
    }

    fun removeTag(epc: String) {
        val currentTags = _uiState.value.scannedTags.filter { it.epc != epc }
        val currentInfo = _uiState.value.scannedItemsInfo.toMutableMap()
        currentInfo.remove(epc)
        _uiState.update { it.copy(scannedTags = currentTags, scannedItemsInfo = currentInfo) }
    }

    private fun queueLookup(tag: String) {
        if (_uiState.value.scannedItemsInfo.containsKey(tag)) return

        // Try local cache first
        val cachedItem = dataCacheRepository.findItemByScannedTag(tag)
        if (cachedItem != null) {
            val info = TransferItemInfo(
                rfidTag = tag,
                itemTypeName = cachedItem.itemTypeName,
                currentTenantId = cachedItem.tenantId,
                currentTenantName = cachedItem.tenantName,
                isRegistered = true
            )
            val currentInfo = _uiState.value.scannedItemsInfo.toMutableMap()
            currentInfo[tag] = info
            _uiState.update { it.copy(scannedItemsInfo = currentInfo) }
            return
        }

        synchronized(pendingLookupTags) {
            pendingLookupTags.add(tag)
        }
        lookupJob?.cancel()
        lookupJob = viewModelScope.launch {
            delay(200L)
            flushPendingLookups()
        }
    }

    private suspend fun flushPendingLookups() {
        val tagsToLookup: List<String>
        synchronized(pendingLookupTags) {
            if (pendingLookupTags.isEmpty()) return
            tagsToLookup = pendingLookupTags.toList()
            pendingLookupTags.clear()
        }

        try {
            val response = withContext(Dispatchers.IO) {
                apiService.lookupItems(com.laundry.rfid.data.remote.dto.ItemLookupRequest(tagsToLookup))
            }
            if (response.isSuccessful) {
                val result = response.body()
                val newInfo = mutableMapOf<String, TransferItemInfo>()

                result?.items?.forEach { item ->
                    newInfo[item.rfidTag] = TransferItemInfo(
                        rfidTag = item.rfidTag,
                        itemTypeName = item.itemType?.name,
                        currentTenantId = item.tenantId,
                        currentTenantName = item.tenant?.name,
                        isRegistered = true
                    )
                }
                result?.notFoundTags?.forEach { tag ->
                    newInfo[tag] = TransferItemInfo(
                        rfidTag = tag,
                        itemTypeName = null,
                        currentTenantId = null,
                        currentTenantName = null,
                        isRegistered = false
                    )
                }

                val merged = _uiState.value.scannedItemsInfo + newInfo
                _uiState.update { it.copy(scannedItemsInfo = merged) }
            }
        } catch (_: Exception) {
            // Silent fail - items show as unknown
        }
    }

    fun transferItems() {
        val state = _uiState.value
        if (state.selectedTargetTenantId == null) {
            _uiState.update { it.copy(error = "Hedef otel secin") }
            return
        }
        if (state.scannedTags.isEmpty()) {
            _uiState.update { it.copy(error = "En az bir etiket tarayin") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isTransferring = true, error = null) }
            try {
                val response = withContext(Dispatchers.IO) {
                    apiService.bulkTransferItems(
                        BulkTransferRequest(
                            rfidTags = state.scannedTags.map { it.epc },
                            targetTenantId = state.selectedTargetTenantId,
                            targetItemTypeId = state.selectedItemTypeId
                        )
                    )
                }

                if (response.isSuccessful) {
                    val result = response.body()
                    val transferResult = TransferResult(
                        transferred = result?.transferred ?: 0,
                        alreadyCorrect = result?.alreadyCorrect ?: 0,
                        notFound = result?.notFound ?: 0,
                        total = result?.total ?: 0,
                        transferredItems = result?.transferredItems ?: emptyList()
                    )

                    _uiState.update {
                        it.copy(
                            isTransferring = false,
                            transferResult = transferResult,
                            successMessage = "${transferResult.transferred} urun basariyla transfer edildi"
                        )
                    }

                    // Refresh items cache after transfer
                    viewModelScope.launch(Dispatchers.IO) {
                        dataCacheRepository.refreshItems()
                    }

                    if (transferResult.transferred > 0) {
                        clearTags()
                    }
                } else {
                    val errorMsg = when (response.code()) {
                        401 -> "Oturum suresi dolmus. Lutfen cikis yapip tekrar giris yapin."
                        403 -> "Bu islem icin yetkiniz yok."
                        else -> {
                            val errorBody = response.errorBody()?.string() ?: "Bilinmeyen hata"
                            "Transfer hatasi: $errorBody"
                        }
                    }
                    _uiState.update {
                        it.copy(isTransferring = false, error = errorMsg)
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isTransferring = false, error = "Transfer hatasi: ${e.message}")
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearSuccessMessage() {
        _uiState.update { it.copy(successMessage = null) }
    }

    fun clearTransferResult() {
        _uiState.update { it.copy(transferResult = null) }
    }

    fun simulateScan() {
        val randomTag = "E2000011223344${(1000..9999).random()}"
        rfidManager.simulateTagRead(randomTag, (-70..-30).random())
    }

    override fun onCleared() {
        super.onCleared()
        rfidManager.stopScanning()
    }
}
