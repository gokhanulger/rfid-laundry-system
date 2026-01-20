package com.laundry.rfid.ui.delivery

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.network.NetworkMonitor
import com.laundry.rfid.network.NetworkState
import com.laundry.rfid.network.OfflineQueueManager
import com.laundry.rfid.network.OperationType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import javax.inject.Inject

data class DeliveryUiState(
    val isLoading: Boolean = false,
    val deliveries: List<DeliveryItem> = emptyList(),
    val hotels: List<HotelInfo> = emptyList(),
    val selectedHotelId: String? = null,
    val error: String? = null,
    val deliveringIds: Set<String> = emptySet(),
    val showSuccessDialog: Boolean = false,
    val isOnline: Boolean = true,
    val pendingCount: Int = 0
) {
    val filteredDeliveries: List<DeliveryItem>
        get() = if (selectedHotelId != null) {
            deliveries.filter { it.tenantId == selectedHotelId }
        } else {
            emptyList()
        }
}

@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val apiService: ApiService,
    private val networkMonitor: NetworkMonitor,
    private val offlineQueueManager: OfflineQueueManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(DeliveryUiState())
    val uiState: StateFlow<DeliveryUiState> = _uiState.asStateFlow()

    // Offline queue - must be initialized before init block
    private val pendingDeliveries = mutableSetOf<String>()
    private val pendingBags = mutableSetOf<String>()

    init {
        // Monitor network state
        viewModelScope.launch {
            networkMonitor.networkState.collect { state ->
                _uiState.update { it.copy(isOnline = state.isConnected) }

                // Auto-sync when network becomes available
                if (state.isConnected && pendingDeliveries.isNotEmpty()) {
                    Log.i("DeliveryViewModel", "Network recovered, syncing ${pendingDeliveries.size} pending deliveries")
                    syncPendingDeliveries()
                }
            }
        }

        // Monitor pending count
        viewModelScope.launch {
            offlineQueueManager.getPendingCount().collect { count ->
                _uiState.update { it.copy(pendingCount = count) }
            }
        }
    }

    fun loadDeliveries() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val response = apiService.getDeliveries(status = "picked_up", limit = 100)
                val deliveries = response.data.map { delivery ->
                    // Parse items from notes field (JSON array)
                    val items = parseItemsFromNotes(delivery.notes)
                    val itemCount = if (items.isNotEmpty()) {
                        items.sumOf { it.count }
                    } else {
                        delivery.deliveryItems?.size ?: 0
                    }

                    DeliveryItem(
                        id = delivery.id,
                        barcode = delivery.barcode,
                        tenantId = delivery.tenantId,
                        tenantName = delivery.tenant?.name,
                        tenantQrCode = delivery.tenant?.qrCode,
                        itemCount = itemCount,
                        items = items
                    )
                }

                // Group by hotel to create hotel list
                val hotels = deliveries
                    .groupBy { Triple(it.tenantId, it.tenantName, it.tenantQrCode) }
                    .map { (key, items) ->
                        HotelInfo(
                            id = key.first,
                            name = key.second ?: "Bilinmeyen Otel",
                            packageCount = items.size,
                            qrCode = key.third
                        )
                    }
                    .sortedBy { it.name }

                // Auto-select first hotel if only one
                val autoSelectedHotelId = if (hotels.size == 1) hotels.first().id else _uiState.value.selectedHotelId

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        deliveries = deliveries,
                        hotels = hotels,
                        selectedHotelId = autoSelectedHotelId
                    )
                }
            } catch (e: Exception) {
                Log.e("DeliveryViewModel", "Failed to load deliveries", e)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Teslimatlar yüklenemedi: ${e.message}"
                    )
                }
            }
        }
    }

    private fun parseItemsFromNotes(notes: String?): List<ItemContent> {
        if (notes.isNullOrBlank()) return emptyList()

        return try {
            val jsonArray = JSONArray(notes)
            val items = mutableListOf<ItemContent>()
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                val typeName = obj.optString("typeName", "Bilinmeyen")
                val count = obj.optInt("count", 0)
                if (count > 0) {
                    items.add(ItemContent(typeName, count))
                }
            }
            items
        } catch (e: Exception) {
            Log.w("DeliveryViewModel", "Failed to parse notes: $notes", e)
            emptyList()
        }
    }

    fun selectHotel(hotelId: String?) {
        _uiState.update { it.copy(selectedHotelId = hotelId, error = null) }
    }

    fun selectHotelByQR(qrCode: String) {
        // Find hotel by QR code (qrCode field in tenant)
        val hotel = _uiState.value.hotels.find { it.qrCode == qrCode }
        if (hotel != null) {
            _uiState.update { it.copy(selectedHotelId = hotel.id, error = null) }
        } else {
            // Try to find by name (partial match)
            val hotelByName = _uiState.value.hotels.find {
                it.name.lowercase().contains(qrCode.lowercase()) ||
                qrCode.lowercase().contains(it.name.lowercase())
            }
            if (hotelByName != null) {
                _uiState.update { it.copy(selectedHotelId = hotelByName.id, error = null) }
            } else {
                _uiState.update { it.copy(error = "Otel bulunamadı: $qrCode") }
            }
        }
    }

    // Handle scanned code - can be hotel QR, package barcode, or bag code
    fun handleScannedCode(code: String) {
        val trimmedCode = code.trim()
        Log.d("DeliveryViewModel", "Scanned code: $trimmedCode")
        Log.d("DeliveryViewModel", "Available deliveries: ${_uiState.value.deliveries.map { it.barcode }}")

        // Check if it's a bag code (BAG-xxx format)
        if (trimmedCode.startsWith("BAG-")) {
            deliverBag(trimmedCode)
            return
        }

        // Check if it's a hotel QR
        val hotel = _uiState.value.hotels.find { it.qrCode == trimmedCode }
        if (hotel != null) {
            _uiState.update { it.copy(selectedHotelId = hotel.id, error = null) }
            return
        }

        // Check if it's a package barcode (handle both DEL-xxx and DEL-xxx-PKG1 formats)
        val baseBarcode = if (trimmedCode.contains("-PKG")) {
            trimmedCode.substringBefore("-PKG")
        } else {
            trimmedCode
        }

        // More flexible matching - check if barcode contains scanned code or vice versa
        val delivery = _uiState.value.deliveries.find {
            it.barcode == trimmedCode ||
            it.barcode == baseBarcode ||
            it.barcode.contains(trimmedCode) ||
            trimmedCode.contains(it.barcode)
        }

        if (delivery != null) {
            Log.d("DeliveryViewModel", "Found delivery: ${delivery.id} with barcode: ${delivery.barcode}")
            // Auto-select hotel if not selected
            if (_uiState.value.selectedHotelId == null) {
                _uiState.update { it.copy(selectedHotelId = delivery.tenantId) }
            }
            // Deliver the package
            deliverPackage(delivery.id)
            return
        }

        // Try hotel name partial match
        val hotelByName = _uiState.value.hotels.find {
            it.name.lowercase().contains(trimmedCode.lowercase()) ||
            trimmedCode.lowercase().contains(it.name.lowercase())
        }
        if (hotelByName != null) {
            _uiState.update { it.copy(selectedHotelId = hotelByName.id, error = null) }
            return
        }

        // Not found
        Log.w("DeliveryViewModel", "Code not found: $trimmedCode")
        _uiState.update { it.copy(error = "Tanınmayan kod: $trimmedCode") }
    }

    // Deliver all packages in a bag
    fun deliverBag(bagCode: String) {
        Log.d("DeliveryViewModel", "Delivering bag: $bagCode")

        // Seçili otelin tüm paketlerini bul
        val selectedHotelId = _uiState.value.selectedHotelId
        val packagesToDeliver = if (selectedHotelId != null) {
            _uiState.value.deliveries.filter { it.tenantId == selectedHotelId }
        } else {
            _uiState.value.deliveries
        }

        val deliveryIds = packagesToDeliver.map { it.id }.toSet()

        // OPTIMISTIC UPDATE: Önce UI'dan hemen kaldır
        _uiState.update { state ->
            val updatedDeliveries = state.deliveries.filter { it.id !in deliveryIds }
            Log.d("DeliveryViewModel", "Optimistic bag remove. Remaining: ${updatedDeliveries.size}")

            // Update hotel counts
            val updatedHotels = updatedDeliveries
                .groupBy { Triple(it.tenantId, it.tenantName, it.tenantQrCode) }
                .map { (key, items) ->
                    HotelInfo(
                        id = key.first,
                        name = key.second ?: "Bilinmeyen Otel",
                        packageCount = items.size,
                        qrCode = key.third
                    )
                }
                .sortedBy { it.name }

            state.copy(
                deliveries = updatedDeliveries,
                hotels = updatedHotels,
                error = null
            )
        }

        // Arka planda API'yi çağır
        viewModelScope.launch {
            try {
                val response = apiService.deliverBag(bagCode)
                pendingBags.remove(bagCode)
                Log.d("DeliveryViewModel", "Bag delivered: ${response.deliveredCount}/${response.totalCount} packages")
            } catch (e: Exception) {
                Log.e("DeliveryViewModel", "Failed to deliver bag (offline queue): $bagCode", e)

                // Her paketi ayrı ayrı pending queue'ya ekle
                deliveryIds.forEach { pendingDeliveries.add(it) }
                pendingBags.add(bagCode)

                Log.w("DeliveryViewModel", "Added bag to pending queue. Pending deliveries: ${pendingDeliveries.size}")
            }
        }
    }

    fun deliverPackage(deliveryId: String) {
        Log.d("DeliveryViewModel", "Delivering package: $deliveryId")

        // Check if already delivering
        if (_uiState.value.deliveringIds.contains(deliveryId)) {
            Log.w("DeliveryViewModel", "Package already being delivered: $deliveryId")
            return
        }

        // OPTIMISTIC UPDATE: Önce UI'dan hemen kaldır
        _uiState.update { state ->
            val updatedDeliveries = state.deliveries.filter { it.id != deliveryId }
            Log.d("DeliveryViewModel", "Optimistic remove. Remaining: ${updatedDeliveries.size}")

            // Update hotel counts
            val updatedHotels = updatedDeliveries
                .groupBy { Triple(it.tenantId, it.tenantName, it.tenantQrCode) }
                .map { (key, items) ->
                    HotelInfo(
                        id = key.first,
                        name = key.second ?: "Bilinmeyen Otel",
                        packageCount = items.size,
                        qrCode = key.third
                    )
                }
                .sortedBy { it.name }

            state.copy(
                deliveries = updatedDeliveries,
                hotels = updatedHotels,
                deliveringIds = state.deliveringIds + deliveryId,
                error = null
            )
        }

        // Check if online before making API call
        if (!networkMonitor.isCurrentlyOnline()) {
            Log.w("DeliveryViewModel", "Offline - queueing delivery: $deliveryId")
            viewModelScope.launch {
                offlineQueueManager.queueOperation(
                    operationType = OperationType.DELIVERY_CONFIRM,
                    payload = DeliveryPayload(deliveryId),
                    priority = 1 // High priority for deliveries
                )
            }
            pendingDeliveries.add(deliveryId)
            _uiState.update { it.copy(deliveringIds = it.deliveringIds - deliveryId) }
            return
        }

        // Online - make API call with retry (handled by RetryInterceptor)
        viewModelScope.launch {
            try {
                Log.d("DeliveryViewModel", "Calling API to deliver: $deliveryId")
                apiService.deliverDelivery(deliveryId)
                Log.d("DeliveryViewModel", "API call successful for: $deliveryId")

                // Başarılı - pending'den çıkar
                pendingDeliveries.remove(deliveryId)
                _uiState.update { it.copy(deliveringIds = it.deliveringIds - deliveryId) }
            } catch (e: Exception) {
                Log.e("DeliveryViewModel", "Failed to deliver package after retries: $deliveryId", e)

                // Queue for later retry via OfflineQueueManager
                offlineQueueManager.queueOperation(
                    operationType = OperationType.DELIVERY_CONFIRM,
                    payload = DeliveryPayload(deliveryId),
                    priority = 1
                )
                pendingDeliveries.add(deliveryId)
                _uiState.update { it.copy(deliveringIds = it.deliveringIds - deliveryId) }

                Log.w("DeliveryViewModel", "Queued for retry: $deliveryId. Queue size: ${pendingDeliveries.size}")
            }
        }
    }

    // Payload class for serialization
    private data class DeliveryPayload(val deliveryId: String)

    // Bekleyen teslimatları senkronize et (internet geldiğinde çağrılacak)
    fun syncPendingDeliveries() {
        if (pendingDeliveries.isEmpty() && !networkMonitor.isCurrentlyOnline()) {
            Log.d("DeliveryViewModel", "No pending deliveries or offline, skipping sync")
            return
        }

        Log.d("DeliveryViewModel", "Syncing ${pendingDeliveries.size} pending deliveries")

        // Also trigger OfflineQueueManager to process its queue
        viewModelScope.launch {
            offlineQueueManager.processQueue()
        }

        val pending = pendingDeliveries.toList()
        pending.forEach { deliveryId ->
            viewModelScope.launch {
                try {
                    apiService.deliverDelivery(deliveryId)
                    pendingDeliveries.remove(deliveryId)
                    Log.d("DeliveryViewModel", "Synced pending delivery: $deliveryId")
                } catch (e: Exception) {
                    Log.e("DeliveryViewModel", "Sync failed for: $deliveryId - ${e.message}")
                    // Will be retried on next network recovery
                }
            }
        }
    }

    fun getPendingCount(): Int = pendingDeliveries.size + _uiState.value.pendingCount

    fun dismissSuccessDialog() {
        _uiState.update { it.copy(showSuccessDialog = false) }
    }
}
