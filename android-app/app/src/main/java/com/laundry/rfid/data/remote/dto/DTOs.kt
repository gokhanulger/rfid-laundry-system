package com.laundry.rfid.data.remote.dto

import com.google.gson.annotations.SerializedName

// Request DTOs
data class LoginRequest(
    val email: String,
    val password: String
)

data class DeviceRegistrationRequest(
    val deviceUuid: String,
    val name: String,
    val appVersion: String
)

data class HeartbeatRequest(
    val appVersion: String
)

data class StartSessionRequest(
    val deviceUuid: String?,
    val sessionType: String,
    val relatedEntityType: String?,
    val relatedEntityId: String?,
    val metadata: Map<String, Any>?,
    val latitude: String?,
    val longitude: String?
)

data class EndSessionRequest(
    val itemCount: Int?,
    val metadata: Map<String, Any>?
)

data class BulkScanRequest(
    val sessionId: String,
    val scans: List<ScanDto>
)

data class ScanDto(
    val rfidTag: String,
    val signalStrength: Int?,
    val scannedAt: String?
)

data class SyncRequest(
    val deviceUuid: String,
    val sessions: List<OfflineSessionDto>
)

data class OfflineSessionDto(
    val localId: String,
    val sessionType: String,
    val relatedEntityType: String?,
    val relatedEntityId: String?,
    val metadata: Map<String, Any>?,
    val latitude: String?,
    val longitude: String?,
    val startedAt: String,
    val completedAt: String?,
    val scans: List<OfflineScanDto>
)

data class OfflineScanDto(
    val rfidTag: String,
    val signalStrength: Int?,
    val readCount: Int?,
    val scannedAt: String
)

data class ItemLookupRequest(
    val rfidTags: List<String>
)

// Response DTOs
// API returns flat structure, not nested user object
data class LoginResponseDto(
    val id: String,
    val email: String,
    @SerializedName("firstName") val firstName: String,
    @SerializedName("lastName") val lastName: String,
    val role: String,
    @SerializedName("tenantId") val tenantId: String?,
    @SerializedName("tenantName") val tenantName: String?,
    val token: String
)

data class UserDto(
    val id: String,
    val email: String,
    @SerializedName("firstName") val firstName: String,
    @SerializedName("lastName") val lastName: String,
    val role: String,
    @SerializedName("tenantId") val tenantId: String?
)

data class DeviceRegistrationResponseDto(
    val device: DeviceDto,
    val isNew: Boolean
)

data class DeviceDto(
    val id: String,
    @SerializedName("deviceUuid") val deviceUuid: String,
    val name: String,
    @SerializedName("appVersion") val appVersion: String?,
    @SerializedName("isActive") val isActive: Boolean
)

data class HeartbeatResponseDto(
    val status: String,
    @SerializedName("lastSeenAt") val lastSeenAt: String
)

data class SessionResponseDto(
    val id: String,
    @SerializedName("deviceId") val deviceId: String?,
    @SerializedName("userId") val userId: String,
    @SerializedName("tenantId") val tenantId: String,
    @SerializedName("sessionType") val sessionType: String,
    val status: String,
    @SerializedName("itemCount") val itemCount: Int,
    @SerializedName("startedAt") val startedAt: String,
    @SerializedName("completedAt") val completedAt: String?
)

data class BulkScanResponseDto(
    val added: Int,
    val updated: Int,
    val total: Int
)

data class SyncResponseDto(
    @SerializedName("syncedAt") val syncedAt: String,
    val results: List<SyncResultDto>
)

data class SyncResultDto(
    @SerializedName("localId") val localId: String,
    @SerializedName("serverId") val serverId: String?,
    val status: String,
    val conflicts: List<String>?,
    val error: String?
)

data class SyncStatusResponseDto(
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("lastSyncAt") val lastSyncAt: String?,
    @SerializedName("lastSeenAt") val lastSeenAt: String?,
    @SerializedName("pendingSyncs") val pendingSyncs: Int
)

data class ItemLookupResponseDto(
    val items: List<ItemDto>,
    val found: Int,
    val notFound: Int,
    val notFoundTags: List<String>
)

data class ItemDto(
    val id: String,
    @SerializedName("rfidTag") val rfidTag: String,
    @SerializedName("itemType") val itemType: ItemTypeDto?,
    val status: String,
    @SerializedName("tenantId") val tenantId: String,
    val tenant: TenantDto?
)

data class ItemTypeDto(
    val id: String,
    val name: String,
    val description: String?
)

data class TenantDto(
    val id: String,
    val name: String,
    val email: String?,
    val phone: String?,
    val address: String?,
    val qrCode: String? = null
)

// Request DTOs for Item Creation
data class CreateItemRequest(
    val rfidTag: String,
    val itemTypeId: String,
    val tenantId: String,
    val status: String = "at_hotel"
)

data class BulkItemCreateRequest(
    val items: List<CreateItemRequest>
)

data class BulkItemCreateResponseDto(
    val created: Int,
    val failed: Int,
    val errors: List<BulkItemErrorDto>?
)

data class BulkItemErrorDto(
    val rfidTag: String,
    val error: String
)

// Pickup DTOs
data class CreatePickupRequest(
    val tenantId: String,
    val rfidTags: List<String>,
    val notes: String? = null
)

data class PickupResponseDto(
    val id: String,
    @SerializedName("tenantId") val tenantId: String,
    @SerializedName("driverId") val driverId: String,
    @SerializedName("bagCode") val bagCode: String,
    val status: String,
    @SerializedName("itemCount") val itemCount: Int?,
    @SerializedName("scannedTags") val scannedTags: Int?,
    @SerializedName("registeredItems") val registeredItems: Int?,
    @SerializedName("unregisteredTags") val unregisteredTags: Int?
)

// Delivery DTOs
data class DeliveriesResponseDto(
    val data: List<DeliveryDto>,
    val pagination: PaginationDto?
)

data class PaginationDto(
    val page: Int,
    val limit: Int,
    val total: Int,
    val totalPages: Int
)

data class DeliveryDto(
    val id: String,
    @SerializedName("tenantId") val tenantId: String,
    @SerializedName("driverId") val driverId: String?,
    val barcode: String,
    @SerializedName("packageCount") val packageCount: Int,
    val status: String,
    val notes: String?,
    @SerializedName("labelPrintedAt") val labelPrintedAt: String?,
    @SerializedName("packagedAt") val packagedAt: String?,
    @SerializedName("pickedUpAt") val pickedUpAt: String?,
    @SerializedName("deliveredAt") val deliveredAt: String?,
    @SerializedName("createdAt") val createdAt: String,
    val tenant: TenantDto?,
    val driver: UserDto?,
    @SerializedName("deliveryItems") val deliveryItems: List<DeliveryItemDto>?
)

data class DeliveryItemDto(
    val id: String,
    @SerializedName("deliveryId") val deliveryId: String,
    @SerializedName("itemId") val itemId: String,
    val item: ItemDto?
)

// Bag DTOs
data class BagResponseDto(
    @SerializedName("bagCode") val bagCode: String,
    @SerializedName("deliveryCount") val deliveryCount: Int,
    val deliveries: List<DeliveryDto>
)

data class BagDeliverResponseDto(
    @SerializedName("bagCode") val bagCode: String,
    @SerializedName("deliveredCount") val deliveredCount: Int,
    @SerializedName("totalCount") val totalCount: Int,
    @SerializedName("deliveredIds") val deliveredIds: List<String>,
    val errors: List<String>?
)
