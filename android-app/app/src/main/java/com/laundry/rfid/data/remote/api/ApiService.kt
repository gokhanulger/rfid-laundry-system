package com.laundry.rfid.data.remote.api

import com.laundry.rfid.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // Auth
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponseDto>

    @GET("auth/me")
    suspend fun getCurrentUser(): Response<UserDto>

    // Devices
    @POST("devices/register")
    suspend fun registerDevice(@Body request: DeviceRegistrationRequest): Response<DeviceRegistrationResponseDto>

    @POST("devices/{deviceUuid}/heartbeat")
    suspend fun sendHeartbeat(
        @Path("deviceUuid") deviceUuid: String,
        @Body request: HeartbeatRequest
    ): Response<HeartbeatResponseDto>

    // Scan
    @POST("scan/session/start")
    suspend fun startSession(@Body request: StartSessionRequest): Response<SessionResponseDto>

    @POST("scan/session/{id}/end")
    suspend fun endSession(
        @Path("id") sessionId: String,
        @Body request: EndSessionRequest
    ): Response<SessionResponseDto>

    @POST("scan/bulk")
    suspend fun submitBulkScans(@Body request: BulkScanRequest): Response<BulkScanResponseDto>

    @POST("scan/sync")
    suspend fun syncOfflineSessions(@Body request: SyncRequest): Response<SyncResponseDto>

    @GET("scan/sync/status")
    suspend fun getSyncStatus(@Query("deviceUuid") deviceUuid: String): Response<SyncStatusResponseDto>

    // Items (for caching/lookup)
    @POST("items/scan")
    suspend fun lookupItems(@Body request: ItemLookupRequest): Response<ItemLookupResponseDto>

    // Settings - Item Types and Tenants
    @GET("settings/item-types")
    suspend fun getItemTypes(): Response<List<ItemTypeDto>>

    @GET("settings/tenants")
    suspend fun getTenants(): Response<List<TenantDto>>

    // Get tenant by QR code
    @GET("settings/tenants/qr/{qrCode}")
    suspend fun getTenantByQR(@Path("qrCode") qrCode: String): Response<TenantDto>

    // Items - Create
    @POST("items")
    suspend fun createItem(@Body request: CreateItemRequest): Response<ItemDto>

    // Bulk Item Creation
    @POST("items/bulk")
    suspend fun createBulkItems(@Body request: BulkItemCreateRequest): Response<BulkItemCreateResponseDto>

    // Pickups - Create from RFID tags
    @POST("pickups/from-tags")
    suspend fun createPickupFromTags(@Body request: CreatePickupRequest): Response<PickupResponseDto>
}
