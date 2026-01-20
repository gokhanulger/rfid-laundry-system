package com.laundry.rfid.ui.tagassign

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.BulkItemCreateRequest
import com.laundry.rfid.data.remote.dto.CreateItemRequest
import com.laundry.rfid.data.remote.dto.ItemTypeDto
import com.laundry.rfid.data.remote.dto.TenantDto
import com.laundry.rfid.data.repository.DataCacheRepository
import com.laundry.rfid.rfid.BarcodeManager
import com.laundry.rfid.rfid.RfidCallback
import com.laundry.rfid.rfid.RfidManager
import com.laundry.rfid.rfid.RfidState
import com.laundry.rfid.rfid.RfidTag
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TagAssignUiState(
    val scannedTags: List<RfidTag> = emptyList(),
    val itemTypes: List<ItemTypeDto> = emptyList(),
    val tenants: List<TenantDto> = emptyList(),
    val selectedItemTypeId: String? = null,
    val selectedTenantId: String? = null,
    val isScanning: Boolean = false,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val rfidState: RfidState = RfidState.Disconnected,
    val error: String? = null,
    val successMessage: String? = null,
    val saveResult: SaveResult? = null,
    val isBarcodeScanningForHotel: Boolean = false
)

data class SaveResult(
    val created: Int,
    val failed: Int,
    val errors: List<String>
)

@HiltViewModel
class TagAssignViewModel @Inject constructor(
    private val rfidManager: RfidManager,
    private val apiService: ApiService,
    private val barcodeManager: BarcodeManager,
    private val dataCacheRepository: DataCacheRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TagAssignUiState())
    val uiState: StateFlow<TagAssignUiState> = _uiState.asStateFlow()

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
        }

        override fun onStateChanged(state: RfidState) {
            _uiState.update { it.copy(rfidState = state) }
        }

        override fun onError(error: String) {
            _uiState.update { it.copy(error = error) }
        }
    }

    init {
        loadSettings()

        viewModelScope.launch {
            rfidManager.state.collect { state ->
                _uiState.update { it.copy(rfidState = state) }
            }
        }

        // Listen for barcode scans
        viewModelScope.launch {
            barcodeManager.barcodeFlow.collect { barcode ->
                if (_uiState.value.isBarcodeScanningForHotel) {
                    selectTenantByQrCode(barcode)
                    stopBarcodeScanForHotel()
                }
            }
        }
    }

    private fun loadSettings() {
        viewModelScope.launch {
            try {
                // Load from cache ONLY - no auto refresh
                val cachedItemTypes = dataCacheRepository.getCachedItemTypes()
                val cachedTenants = dataCacheRepository.getCachedTenants()

                if (cachedItemTypes.isNotEmpty() || cachedTenants.isNotEmpty()) {
                    // Use cached data instantly
                    _uiState.update {
                        it.copy(
                            itemTypes = cachedItemTypes.sortedBy { type -> type.sortOrder },
                            tenants = cachedTenants,
                            isLoading = false
                        )
                    }
                } else {
                    // No cache - must fetch from API
                    refreshData()
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = "Veriler yüklenemedi: ${e.message}") }
            }
        }
    }

    /**
     * Manual refresh - call when user presses refresh button
     */
    fun refreshData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                // Fetch fresh data from API
                var hasError = false

                dataCacheRepository.refreshItemTypes()
                    .onSuccess { itemTypes ->
                        _uiState.update { it.copy(itemTypes = itemTypes.sortedBy { type -> type.sortOrder }) }
                    }
                    .onFailure { hasError = true }

                dataCacheRepository.refreshTenants()
                    .onSuccess { tenants ->
                        _uiState.update { it.copy(tenants = tenants) }
                    }
                    .onFailure { hasError = true }

                if (hasError && _uiState.value.tenants.isEmpty()) {
                    _uiState.update { it.copy(error = "Veriler yüklenemedi") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Yenileme başarısız: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun toggleScanning() {
        if (_uiState.value.isScanning) {
            stopScanning()
        } else {
            startScanning()
        }
    }

    private fun startScanning() {
        rfidManager.startScanning(rfidCallback)
        _uiState.update { it.copy(isScanning = true) }
    }

    private fun stopScanning() {
        rfidManager.stopScanning()
        _uiState.update { it.copy(isScanning = false) }
    }

    fun selectItemType(itemTypeId: String) {
        _uiState.update { it.copy(selectedItemTypeId = itemTypeId) }
    }

    fun selectTenant(tenantId: String) {
        _uiState.update { it.copy(selectedTenantId = tenantId) }
    }

    fun selectTenantByQrCode(qrCode: String) {
        val tenant = _uiState.value.tenants.find { it.qrCode == qrCode }
        if (tenant != null) {
            _uiState.update { it.copy(selectedTenantId = tenant.id) }
        } else {
            _uiState.update { it.copy(error = "Bu QR kod için otel bulunamadı: $qrCode") }
        }
    }

    fun startBarcodeScanForHotel() {
        barcodeManager.startListening()
        _uiState.update { it.copy(isBarcodeScanningForHotel = true) }
    }

    fun stopBarcodeScanForHotel() {
        barcodeManager.stopListening()
        _uiState.update { it.copy(isBarcodeScanningForHotel = false) }
    }

    fun clearTags() {
        rfidManager.clearScannedTags()
        _uiState.update { it.copy(scannedTags = emptyList()) }
    }

    fun removeTag(epc: String) {
        val currentTags = _uiState.value.scannedTags.filter { it.epc != epc }
        _uiState.update { it.copy(scannedTags = currentTags) }
    }

    fun saveItems() {
        val state = _uiState.value

        if (state.selectedItemTypeId == null) {
            _uiState.update { it.copy(error = "Lütfen ürün tipi seçin") }
            return
        }
        if (state.selectedTenantId == null) {
            _uiState.update { it.copy(error = "Lütfen otel seçin") }
            return
        }
        if (state.scannedTags.isEmpty()) {
            _uiState.update { it.copy(error = "Lütfen en az bir etiket tarayın") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }

            try {
                val items = state.scannedTags.map { tag ->
                    CreateItemRequest(
                        rfidTag = tag.epc,
                        itemTypeId = state.selectedItemTypeId,
                        tenantId = state.selectedTenantId,
                        status = "at_hotel"
                    )
                }

                val response = apiService.createBulkItems(BulkItemCreateRequest(items))

                if (response.isSuccessful) {
                    val result = response.body()
                    val saveResult = SaveResult(
                        created = result?.created ?: 0,
                        failed = result?.failed ?: 0,
                        errors = result?.errors?.map { "${it.rfidTag}: ${it.error}" } ?: emptyList()
                    )

                    _uiState.update {
                        it.copy(
                            isSaving = false,
                            saveResult = saveResult,
                            successMessage = "${saveResult.created} ürün başarıyla kaydedildi"
                        )
                    }

                    // Clear tags if all succeeded
                    if (saveResult.failed == 0) {
                        clearTags()
                    }
                } else {
                    // Try individual creation as fallback
                    var created = 0
                    var failed = 0
                    val errors = mutableListOf<String>()

                    for (item in items) {
                        try {
                            val itemResponse = apiService.createItem(item)
                            if (itemResponse.isSuccessful) {
                                created++
                            } else {
                                failed++
                                val errorBody = itemResponse.errorBody()?.string() ?: "Bilinmeyen hata"
                                errors.add("${item.rfidTag}: $errorBody")
                            }
                        } catch (e: Exception) {
                            failed++
                            errors.add("${item.rfidTag}: ${e.message}")
                        }
                    }

                    val saveResult = SaveResult(created, failed, errors)
                    _uiState.update {
                        it.copy(
                            isSaving = false,
                            saveResult = saveResult,
                            successMessage = if (created > 0) "$created ürün başarıyla kaydedildi" else null,
                            error = if (failed > 0) "$failed ürün kaydedilemedi" else null
                        )
                    }

                    if (failed == 0) {
                        clearTags()
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isSaving = false,
                        error = "Kayıt hatası: ${e.message}"
                    )
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

    fun clearSaveResult() {
        _uiState.update { it.copy(saveResult = null) }
    }

    override fun onCleared() {
        super.onCleared()
        rfidManager.stopScanning()
        barcodeManager.stopListening()
    }
}
