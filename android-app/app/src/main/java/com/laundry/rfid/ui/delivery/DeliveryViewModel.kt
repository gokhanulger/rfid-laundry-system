package com.laundry.rfid.ui.delivery

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.remote.api.ApiService
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
    val showSuccessDialog: Boolean = false
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
    private val apiService: ApiService
) : ViewModel() {

    private val _uiState = MutableStateFlow(DeliveryUiState())
    val uiState: StateFlow<DeliveryUiState> = _uiState.asStateFlow()

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
        val delivery = _uiState.value.deliveries.find {
            it.barcode == trimmedCode || it.barcode == baseBarcode
        }
        if (delivery != null) {
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
        _uiState.update { it.copy(error = "Tanınmayan kod: $trimmedCode") }
    }

    // Deliver all packages in a bag
    fun deliverBag(bagCode: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val response = apiService.deliverBag(bagCode)

                // Remove delivered packages from list
                val deliveredIds = response.deliveredIds.toSet()
                _uiState.update { state ->
                    val updatedDeliveries = state.deliveries.filter { it.id !in deliveredIds }

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
                        isLoading = false,
                        deliveries = updatedDeliveries,
                        hotels = updatedHotels,
                        error = if (response.errors?.isNotEmpty() == true)
                            "Bazı paketler teslim edilemedi"
                        else null
                    )
                }

                Log.d("DeliveryViewModel", "Bag delivered: ${response.deliveredCount}/${response.totalCount} packages")
            } catch (e: Exception) {
                Log.e("DeliveryViewModel", "Failed to deliver bag", e)
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        error = "Çuval teslim başarısız: ${e.message}"
                    )
                }
            }
        }
    }

    fun deliverPackage(deliveryId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(deliveringIds = it.deliveringIds + deliveryId) }

            try {
                apiService.deliverDelivery(deliveryId)

                // Remove from list and show success
                _uiState.update { state ->
                    val updatedDeliveries = state.deliveries.filter { it.id != deliveryId }

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
                        deliveringIds = state.deliveringIds - deliveryId
                    )
                }
            } catch (e: Exception) {
                Log.e("DeliveryViewModel", "Failed to deliver package", e)
                _uiState.update { state ->
                    state.copy(
                        deliveringIds = state.deliveringIds - deliveryId,
                        error = "Teslim başarısız: ${e.message}"
                    )
                }
            }
        }
    }

    fun dismissSuccessDialog() {
        _uiState.update { it.copy(showSuccessDialog = false) }
    }
}
