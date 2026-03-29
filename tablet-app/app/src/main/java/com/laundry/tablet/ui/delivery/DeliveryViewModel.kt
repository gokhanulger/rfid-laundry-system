package com.laundry.tablet.ui.delivery

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.tablet.data.DeliveryDto
import com.laundry.tablet.data.Repository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class DeliveryUiState(
    val pendingDeliveries: List<DeliveryDto> = emptyList(),
    val selectedDeliveryIds: Set<String> = emptySet(),
    val deliveredCount: Int = 0,
    val isDelivering: Boolean = false,
    val isCompleted: Boolean = false,
    val isLoadingDeliveries: Boolean = false,
    val lastScannedBarcode: String? = null,
    val scanNotFound: String? = null,
    val whatsappIntent: WhatsAppMessage? = null,
    val error: String? = null
)

data class WhatsAppMessage(
    val phone: String,
    val message: String
)

@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val repository: Repository
) : ViewModel() {

    companion object {
        private const val TAG = "DeliveryVM"
    }

    private val _uiState = MutableStateFlow(DeliveryUiState())
    val uiState: StateFlow<DeliveryUiState> = _uiState.asStateFlow()

    private var tenantId: String = ""
    private var initialized = false

    fun initialize(tenantId: String) {
        if (this.tenantId == tenantId && initialized) return
        this.tenantId = tenantId
        initialized = true
        loadDeliveries()
    }

    fun toggleDeliverySelection(deliveryId: String) {
        _uiState.update { state ->
            val newSet = state.selectedDeliveryIds.toMutableSet()
            if (deliveryId in newSet) newSet.remove(deliveryId) else newSet.add(deliveryId)
            state.copy(selectedDeliveryIds = newSet)
        }
    }

    fun onBarcodeScanned(barcode: String) {
        val trimmed = barcode.trim()
        if (trimmed.isEmpty()) return
        Log.i(TAG, "Barcode scanned: $trimmed")

        val delivery = _uiState.value.pendingDeliveries.find {
            it.barcode?.equals(trimmed, ignoreCase = true) == true
        }

        if (delivery != null) {
            _uiState.update { state ->
                state.copy(
                    selectedDeliveryIds = state.selectedDeliveryIds + delivery.id,
                    lastScannedBarcode = trimmed,
                    scanNotFound = null
                )
            }
            Log.i(TAG, "Barcode matched delivery: ${delivery.id}")
        } else {
            _uiState.update { it.copy(scanNotFound = trimmed, lastScannedBarcode = null) }
            Log.w(TAG, "Barcode not found in deliveries: $trimmed")
        }
    }

    fun selectAllDeliveries() {
        _uiState.update { state ->
            state.copy(selectedDeliveryIds = state.pendingDeliveries.map { it.id }.toSet())
        }
    }

    private fun loadDeliveries() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingDeliveries = true) }
            try {
                val deliveries = repository.getDeliveries(tenantId)
                Log.i(TAG, "Loaded ${deliveries.size} deliveries for tenant $tenantId")
                _uiState.update {
                    it.copy(pendingDeliveries = deliveries, isLoadingDeliveries = false)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load deliveries: ${e.message}")
                _uiState.update { it.copy(isLoadingDeliveries = false, error = "Teslimatlar yuklenemedi") }
            }
        }
    }

    fun prepareWhatsApp() {
        val selected = _uiState.value.selectedDeliveryIds
        val deliveries = _uiState.value.pendingDeliveries.filter { it.id in selected }
        if (deliveries.isEmpty()) return

        viewModelScope.launch {
            val phone = repository.getTenantPhone(tenantId)
            if (phone.isNullOrBlank()) {
                _uiState.update { it.copy(error = "Otelin telefon numarasi bulunamadi") }
                return@launch
            }

            val tenantName = repository.getTenantName(tenantId) ?: "Otel"

            // Build delivery summary message
            val totalItems = deliveries.sumOf { delivery ->
                if (delivery.itemCount > 0) delivery.itemCount
                else parseNotesCount(delivery.notes)
            }

            val message = buildString {
                append("Merhaba, $tenantName icin temiz teslimat bilgisi:\n\n")
                append("${deliveries.size} paket, toplam $totalItems urun\n\n")
                for (delivery in deliveries) {
                    val barcode = delivery.barcode ?: "-"
                    val count = if (delivery.itemCount > 0) delivery.itemCount else parseNotesCount(delivery.notes)
                    append("Paket: $barcode ($count urun)\n")
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

    private fun parseNotesCount(notes: String?): Int {
        if (notes.isNullOrEmpty()) return 0
        return try {
            val counts = Regex("\"count\"\\s*:\\s*(\\d+)").findAll(notes)
            counts.sumOf { it.groupValues[1].toInt() }
        } catch (_: Exception) { 0 }
    }

    fun confirmDelivery() {
        val selected = _uiState.value.selectedDeliveryIds
        val deliveries = _uiState.value.pendingDeliveries.filter { it.id in selected }
        if (deliveries.isEmpty()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isDelivering = true, error = null) }
            try {
                for (delivery in deliveries) {
                    repository.confirmDelivery(delivery.id)
                    Log.i(TAG, "Confirmed delivery ${delivery.id}")
                }
                _uiState.update {
                    it.copy(
                        isDelivering = false,
                        isCompleted = true,
                        deliveredCount = deliveries.size
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Delivery failed: ${e.message}")
                _uiState.update {
                    it.copy(isDelivering = false, error = "Teslimat hatasi: ${e.message}")
                }
            }
        }
    }

    fun reset() {
        _uiState.value = DeliveryUiState()
    }
}
