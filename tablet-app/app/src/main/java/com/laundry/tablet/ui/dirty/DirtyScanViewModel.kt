package com.laundry.tablet.ui.dirty

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.tablet.data.MatchedItem
import com.laundry.tablet.data.Repository
import com.laundry.tablet.rfid.BohangReader
import com.laundry.tablet.rfid.ReaderState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class DirtyScanUiState(
    val groupedItems: Map<String, List<MatchedItem>> = emptyMap(),
    val totalMatched: Int = 0,
    val unregisteredCount: Int = 0,
    val otherHotelCount: Int = 0,
    val scannedTagCount: Int = 0,
    val isSubmitting: Boolean = false,
    val isCompleted: Boolean = false,
    val isPaused: Boolean = true,
    val hasStarted: Boolean = false,
    val whatsappIntent: WhatsAppMessage? = null,
    val error: String? = null
)

data class WhatsAppMessage(
    val phone: String,
    val message: String
)

@HiltViewModel
class DirtyScanViewModel @Inject constructor(
    private val repository: Repository,
    val reader: BohangReader
) : ViewModel() {

    companion object {
        private const val TAG = "DirtyScanVM"
    }

    private val _uiState = MutableStateFlow(DirtyScanUiState())
    val uiState: StateFlow<DirtyScanUiState> = _uiState.asStateFlow()

    private var tenantId: String = ""
    private var initialized = false

    // Track state
    private val lookedUpTags = mutableSetOf<String>()
    private val allMatchedItems = mutableMapOf<String, MatchedItem>() // rfidTag -> MatchedItem
    private var totalUnregistered = 0
    private var totalOtherHotel = 0
    private var isPaused = false

    private var tagCollectionJob: Job? = null

    fun initialize(tenantId: String) {
        if (this.tenantId == tenantId && initialized) return
        this.tenantId = tenantId
        initialized = true
        Log.i(TAG, "Initializing for tenant: $tenantId")
        reader.clearTags()
        // Start paused - wait for user to press "Taramaya Başla"
        isPaused = true
        _uiState.update { it.copy(isPaused = true) }
        reader.stopInventory()
        startTagCollection()
    }

    fun togglePause() {
        isPaused = !isPaused
        _uiState.update { it.copy(isPaused = isPaused, hasStarted = true) }
        if (isPaused) {
            reader.stopInventory()
        } else {
            reader.startInventory()
        }
        Log.i(TAG, "Tarama ${if (isPaused) "duraklatildi" else "devam ediyor"}")
    }

    private fun startTagCollection() {
        tagCollectionJob?.cancel()
        tagCollectionJob = viewModelScope.launch {
            reader.tags.collect { tag ->
                if (isPaused) return@collect

                _uiState.update { it.copy(scannedTagCount = reader.allTags.size) }

                // Skip already looked up tags
                if (tag.epc in lookedUpTags) return@collect

                // Instant local lookup
                val epc = tag.epc.uppercase()
                lookedUpTags.add(epc)

                val entity = repository.lookupTag(epc)
                if (entity == null) {
                    totalUnregistered++
                    Log.d(TAG, "Unregistered tag: $epc")
                } else if (entity.tenantId != tenantId) {
                    totalOtherHotel++
                    Log.d(TAG, "Other hotel tag: $epc -> ${entity.tenantName}")
                } else {
                    // Match!
                    val item = MatchedItem(
                        itemId = entity.id,
                        rfidTag = entity.rfidTag,
                        tenantId = entity.tenantId,
                        tenantName = entity.tenantName,
                        itemTypeName = entity.itemTypeName.ifEmpty { "Bilinmeyen" },
                        itemTypeId = entity.itemTypeId
                    )
                    allMatchedItems[epc] = item
                    Log.d(TAG, "Matched: $epc -> ${entity.itemTypeName}")
                }

                // Update UI
                val grouped = allMatchedItems.values.groupBy { it.itemTypeName }
                _uiState.update {
                    it.copy(
                        groupedItems = grouped,
                        totalMatched = allMatchedItems.size,
                        unregisteredCount = totalUnregistered,
                        otherHotelCount = totalOtherHotel
                    )
                }
            }
        }
    }

    fun submitPickup() {
        if (allMatchedItems.isEmpty()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            try {
                val result = repository.createPickup(
                    tenantId = tenantId,
                    items = allMatchedItems.values.toList()
                )
                if (result.status == "pending_sync") {
                    // Offline - queued for later
                    _uiState.update {
                        it.copy(isSubmitting = false, isCompleted = true,
                            error = "Offline - kayit yerel olarak saklandi, internet gelince gonderilecek")
                    }
                } else {
                    _uiState.update { it.copy(isSubmitting = false, isCompleted = true) }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isSubmitting = false, error = "Kayit hatasi: ${e.message}")
                }
            }
        }
    }

    fun prepareWhatsApp() {
        if (allMatchedItems.isEmpty()) return

        viewModelScope.launch {
            val phone = repository.getTenantPhone(tenantId)
            if (phone.isNullOrBlank()) {
                _uiState.update { it.copy(error = "Otelin telefon numarasi bulunamadi") }
                return@launch
            }

            val tenantName = repository.getTenantName(tenantId) ?: "Otel"
            val grouped = allMatchedItems.values.groupBy { it.itemTypeName }

            val message = buildString {
                append("Merhaba, $tenantName icin kirli urun teslim alindi:\n\n")
                append("Toplam ${allMatchedItems.size} urun\n\n")
                for ((typeName, items) in grouped) {
                    append("$typeName: ${items.size} adet\n")
                }
                append("\nIyi gunler!")
            }

            val cleanPhone = phone.replace("+", "").replace(" ", "").replace("-", "")
            _uiState.update { it.copy(whatsappIntent = WhatsAppMessage(cleanPhone, message)) }
            Log.i(TAG, "WhatsApp prepared for $cleanPhone")
        }
    }

    fun clearWhatsAppIntent() {
        _uiState.update { it.copy(whatsappIntent = null) }
    }

    fun reset() {
        reader.clearTags()
        lookedUpTags.clear()
        allMatchedItems.clear()
        totalUnregistered = 0
        totalOtherHotel = 0
        isPaused = false
        _uiState.value = DirtyScanUiState()
    }

    override fun onCleared() {
        super.onCleared()
        tagCollectionJob?.cancel()
    }
}
