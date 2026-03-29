package com.laundry.tablet.data

import android.util.Log
import com.google.gson.Gson
import com.laundry.tablet.data.local.DeliveryDao
import com.laundry.tablet.data.local.DeliveryEntity
import com.laundry.tablet.data.local.ItemDao
import com.laundry.tablet.data.local.ItemEntity
import com.laundry.tablet.data.local.PendingOperationDao
import com.laundry.tablet.data.local.PendingOperationEntity
import com.laundry.tablet.data.local.TenantDao
import com.laundry.tablet.data.local.TenantEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class Repository @Inject constructor(
    private val api: ApiService,
    private val itemDao: ItemDao,
    private val tenantDao: TenantDao,
    private val deliveryDao: DeliveryDao,
    private val pendingOpDao: PendingOperationDao
) {
    companion object {
        private const val TAG = "Repository"
    }

    private val gson = Gson()

    private val _syncState = MutableStateFlow<SyncState>(SyncState.Idle)
    val syncState: StateFlow<SyncState> = _syncState.asStateFlow()

    private val _itemCount = MutableStateFlow(0)
    val itemCount: StateFlow<Int> = _itemCount.asStateFlow()

    private val _isOnline = MutableStateFlow(true)
    val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private val _pendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    suspend fun login(email: String, password: String): LoginResponse {
        return api.login(LoginRequest(email, password))
    }

    // ==========================================
    // Tenants - Offline-first
    // ==========================================

    suspend fun getTenants(forceRefresh: Boolean = false): List<TenantDto> {
        // Always try local first
        val localTenants = tenantDao.getAll().map { it.toDto() }

        if (localTenants.isNotEmpty() && !forceRefresh) {
            // Background refresh from API
            try {
                val apiTenants = api.getTenants().filter { it.isActive }
                tenantDao.upsertAll(apiTenants.map { it.toEntity() })
                _isOnline.value = true
                return tenantDao.getAll().map { it.toDto() }
            } catch (e: Exception) {
                Log.w(TAG, "API tenant refresh failed (offline?): ${e.message}")
                _isOnline.value = false
            }
            return localTenants
        }

        // No local data - must fetch from API
        return try {
            val apiTenants = api.getTenants().filter { it.isActive }
            tenantDao.upsertAll(apiTenants.map { it.toEntity() })
            _isOnline.value = true
            apiTenants
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch tenants: ${e.message}")
            _isOnline.value = false
            localTenants // Return whatever we have locally (might be empty)
        }
    }

    private fun TenantDto.toEntity() = TenantEntity(
        id = id, name = name, email = email, phone = phone,
        address = address, qrCode = qrCode, isActive = isActive
    )

    private fun TenantEntity.toDto() = TenantDto(
        id = id, name = name, email = email, phone = phone,
        address = address, qrCode = qrCode, isActive = isActive
    )

    // ==========================================
    // Items Sync (like ütücü SQLite)
    // ==========================================

    suspend fun syncItems(force: Boolean = false) {
        val existingCount = itemDao.getCount()
        _itemCount.value = existingCount

        if (existingCount > 0 && !force) {
            _syncState.value = SyncState.Done(existingCount)
            Log.i(TAG, "DB already has $existingCount items, skipping full sync")
            incrementalSync()
            return
        }

        fullSync()
    }

    private suspend fun fullSync() {
        _syncState.value = SyncState.Syncing(0, 0)
        Log.i(TAG, "Starting full sync...")

        try {
            // 1. Sync tenants
            try {
                val tenants = api.getTenants().filter { it.isActive }
                tenantDao.upsertAll(tenants.map { it.toEntity() })
                Log.i(TAG, "Synced ${tenants.size} tenants")
            } catch (e: Exception) {
                Log.w(TAG, "Tenant sync failed: ${e.message}")
            }

            // 2. Sync items (paginated)
            var page = 1
            var totalSynced = 0
            var totalPages = 1

            while (page <= totalPages) {
                _syncState.value = SyncState.Syncing(page, totalPages)
                val response = api.getItems(page = page, limit = 1000)
                val items = response.data

                if (response.pagination != null) {
                    totalPages = response.pagination.totalPages
                }

                if (items.isNotEmpty()) {
                    val entities = items.map { it.toEntity() }
                    itemDao.upsertAll(entities)
                    totalSynced += entities.size
                }

                page++
                if (page > 500) break
            }

            // 3. Sync active deliveries
            try {
                syncDeliveriesFromApi()
            } catch (e: Exception) {
                Log.w(TAG, "Delivery sync failed: ${e.message}")
            }

            _isOnline.value = true
            _itemCount.value = itemDao.getCount()
            _syncState.value = SyncState.Done(totalSynced)
            Log.i(TAG, "Full sync complete: $totalSynced items")
        } catch (e: Exception) {
            Log.e(TAG, "Sync failed: ${e.message}", e)
            _isOnline.value = false
            _syncState.value = SyncState.Error(e.message ?: "Sync hatasi")
            _itemCount.value = itemDao.getCount()
        }
    }

    private suspend fun incrementalSync() {
        try {
            val response = api.getItems(page = 1, limit = 1000)
            val items = response.data
            if (items.isNotEmpty()) {
                itemDao.upsertAll(items.map { it.toEntity() })
            }
            // Also sync tenants and deliveries
            try {
                val tenants = api.getTenants().filter { it.isActive }
                tenantDao.upsertAll(tenants.map { it.toEntity() })
            } catch (_: Exception) {}
            try {
                syncDeliveriesFromApi()
            } catch (_: Exception) {}

            _isOnline.value = true
            _itemCount.value = itemDao.getCount()
            _syncState.value = SyncState.Done(_itemCount.value)

            // Process pending operations while we're online
            processPendingOperations()
        } catch (e: Exception) {
            Log.w(TAG, "Incremental sync failed (offline?): ${e.message}")
            _isOnline.value = false
        }
    }

    private fun ItemDto.toEntity() = ItemEntity(
        id = id,
        rfidTag = rfidTag.uppercase(),
        tenantId = tenantId,
        tenantName = tenant?.name ?: "",
        itemTypeId = itemType?.id ?: "",
        itemTypeName = itemType?.name ?: "",
        status = status
    )

    // ==========================================
    // Deliveries - Offline-first
    // ==========================================

    private suspend fun syncDeliveriesFromApi() {
        for (status in listOf("packaged", "label_printed")) {
            try {
                val response = api.getDeliveries(status = status, limit = 1000)
                val deliveries = response.data
                if (deliveries.isNotEmpty()) {
                    deliveryDao.upsertAll(deliveries.map { it.toEntity() })
                    Log.i(TAG, "Synced ${deliveries.size} $status deliveries")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to sync $status deliveries: ${e.message}")
            }
        }
        deliveryDao.cleanOldDeliveries()
    }

    private fun DeliveryDto.toEntity() = DeliveryEntity(
        id = id,
        barcode = barcode ?: "",
        tenantId = tenantId,
        tenantName = tenant?.name ?: "",
        status = status,
        notes = notes,
        itemCount = deliveryItems?.size ?: itemCount,
        packageCount = packageCount,
        createdAt = createdAt,
        deliveryItemsJson = if (deliveryItems != null) gson.toJson(deliveryItems) else null
    )

    fun DeliveryEntity.toDto() = DeliveryDto(
        id = id,
        barcode = barcode,
        tenantId = tenantId,
        tenant = TenantDto(id = tenantId, name = tenantName),
        status = status,
        notes = notes,
        itemCount = itemCount,
        packageCount = packageCount,
        createdAt = createdAt,
        deliveryItems = if (deliveryItemsJson != null) {
            try { gson.fromJson(deliveryItemsJson, Array<DeliveryItemDto>::class.java).toList() }
            catch (_: Exception) { null }
        } else null
    )

    suspend fun getDeliveries(tenantId: String? = null): List<DeliveryDto> {
        // Try API first if online
        try {
            val response = api.getDeliveries(status = "packaged", tenantId = tenantId)
            val deliveries = response.data
            // Update local cache
            if (deliveries.isNotEmpty()) {
                deliveryDao.upsertAll(deliveries.map { it.toEntity() })
            }
            _isOnline.value = true
            Log.i(TAG, "Deliveries fetched from API: ${deliveries.size}")
            return deliveries
        } catch (e: Exception) {
            Log.w(TAG, "API delivery fetch failed, using local: ${e.message}")
            _isOnline.value = false
        }

        // Fallback: local DB
        val localDeliveries = if (tenantId != null) {
            deliveryDao.getByTenantAndStatus(tenantId, "packaged")
        } else {
            deliveryDao.getByStatus("packaged")
        }
        Log.i(TAG, "Deliveries from local DB: ${localDeliveries.size}")
        return localDeliveries.map { it.toDto() }
    }

    // ==========================================
    // Local Lookup (instant, like ütücü)
    // ==========================================

    suspend fun lookupTag(rfidTag: String): ItemEntity? {
        return itemDao.findByRfidTag(rfidTag.uppercase())
    }

    suspend fun getLocalItemCount(): Int {
        return itemDao.getCount()
    }

    // ==========================================
    // Pickup - Offline queue support
    // ==========================================

    suspend fun createPickup(
        tenantId: String,
        items: List<MatchedItem>,
        notes: String? = null
    ): PickupResponse {
        val itemTypeGroups = items.groupBy { it.itemTypeName }
        val notesText = notes ?: buildString {
            append("Tablet Tarama (${items.size} urun)")
            if (itemTypeGroups.isNotEmpty()) {
                append(": ")
                append(itemTypeGroups.entries.joinToString(", ") { "${it.key}: ${it.value.size}" })
            }
        }

        val bagCode = "TB-${System.currentTimeMillis().toString().takeLast(8)}"
        val request = PickupRequest(
            tenantId = tenantId,
            bagCode = bagCode,
            itemIds = items.map { it.itemId },
            notes = notesText
        )

        return try {
            val response = api.createPickup(request)
            _isOnline.value = true
            response
        } catch (e: Exception) {
            Log.w(TAG, "Pickup API failed, queuing: ${e.message}")
            _isOnline.value = false
            // Queue for later
            queueOperation("create_pickup", gson.toJson(request))
            // Return a fake success so UI can proceed
            PickupResponse(
                id = "offline-${System.currentTimeMillis()}",
                status = "pending_sync",
                tenantId = tenantId,
                itemCount = items.size
            )
        }
    }

    // ==========================================
    // Delivery confirmation - Offline queue support
    // ==========================================

    suspend fun confirmDelivery(deliveryId: String): DeliveryDto {
        try {
            // Try online first
            try {
                api.pickupDelivery(deliveryId)
            } catch (_: Exception) {
                // May already be picked_up
            }
            val result = api.deliverDelivery(deliveryId)
            _isOnline.value = true
            // Update local DB
            deliveryDao.updateStatus(deliveryId, "delivered")
            return result
        } catch (e: Exception) {
            Log.w(TAG, "Delivery confirm API failed, queuing: ${e.message}")
            _isOnline.value = false
            // Update local DB immediately
            deliveryDao.updateStatus(deliveryId, "delivered")
            // Queue for later
            queueOperation("confirm_delivery", gson.toJson(mapOf("deliveryId" to deliveryId)))
            // Return local entity as dto
            val local = deliveryDao.findById(deliveryId)
            return local?.toDto() ?: DeliveryDto(
                id = deliveryId, status = "delivered", tenantId = ""
            )
        }
    }

    suspend fun sendWaybillEmail(deliveryId: String): SendWaybillResponse {
        return api.sendWaybillEmail(deliveryId)
    }

    // ==========================================
    // Pending Operations Queue
    // ==========================================

    private suspend fun queueOperation(type: String, payload: String) {
        pendingOpDao.insert(PendingOperationEntity(operationType = type, payload = payload))
        _pendingCount.value = pendingOpDao.getCount()
        Log.i(TAG, "Queued offline operation: $type (${_pendingCount.value} pending)")
    }

    suspend fun processPendingOperations() {
        val ops = pendingOpDao.getAll()
        if (ops.isEmpty()) return

        Log.i(TAG, "Processing ${ops.size} pending operations...")
        var processed = 0

        for (op in ops) {
            try {
                when (op.operationType) {
                    "create_pickup" -> {
                        val request = gson.fromJson(op.payload, PickupRequest::class.java)
                        api.createPickup(request)
                    }
                    "confirm_delivery" -> {
                        val data = gson.fromJson(op.payload, Map::class.java)
                        val deliveryId = data["deliveryId"] as String
                        try { api.pickupDelivery(deliveryId) } catch (_: Exception) {}
                        api.deliverDelivery(deliveryId)
                    }
                }
                pendingOpDao.delete(op.id)
                processed++
                Log.i(TAG, "Processed pending op ${op.id}: ${op.operationType}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to process op ${op.id}: ${e.message}")
                pendingOpDao.updateError(op.id, e.message ?: "Unknown error")
                // Stop if offline
                _isOnline.value = false
                break
            }
        }

        _pendingCount.value = pendingOpDao.getCount()
        Log.i(TAG, "Processed $processed/${ops.size} pending operations, ${_pendingCount.value} remaining")
    }

    suspend fun getPendingOperationsCount(): Int {
        val count = pendingOpDao.getCount()
        _pendingCount.value = count
        return count
    }

    // ==========================================
    // Helpers
    // ==========================================

    suspend fun getTenantPhone(tenantId: String): String? {
        return tenantDao.findById(tenantId)?.phone
    }

    suspend fun getTenantName(tenantId: String): String? {
        return tenantDao.findById(tenantId)?.name
    }
}

data class MatchedItem(
    val itemId: String,
    val rfidTag: String,
    val tenantId: String,
    val tenantName: String,
    val itemTypeName: String,
    val itemTypeId: String
)

sealed class SyncState {
    data object Idle : SyncState()
    data class Syncing(val page: Int, val totalPages: Int) : SyncState()
    data class Done(val totalSynced: Int) : SyncState()
    data class Error(val message: String) : SyncState()
}
