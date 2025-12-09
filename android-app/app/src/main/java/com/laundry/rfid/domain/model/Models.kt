package com.laundry.rfid.domain.model

import java.util.Date
import java.util.UUID

// Session types matching backend
enum class SessionType(val value: String) {
    PICKUP("pickup"),
    RECEIVE("receive"),
    PROCESS("process"),
    CLEAN("clean"),
    PACKAGE("package"),
    DELIVER("deliver")
}

// Session status
enum class SessionStatus(val value: String) {
    IN_PROGRESS("in_progress"),
    COMPLETED("completed"),
    SYNCED("synced"),
    CANCELLED("cancelled")
}

// Sync status
enum class SyncStatus(val value: String) {
    PENDING("pending"),
    SYNCED("synced"),
    CONFLICT("conflict"),
    FAILED("failed")
}

// User model
data class User(
    val id: String,
    val email: String,
    val firstName: String,
    val lastName: String,
    val role: String,
    val tenantId: String?
) {
    val fullName: String get() = "$firstName $lastName"
}

// Scanned tag
data class ScannedTag(
    val rfidTag: String,
    val signalStrength: Int? = null,
    val readCount: Int = 1,
    val scannedAt: Date = Date()
)

// Scan session
data class ScanSession(
    val id: String = UUID.randomUUID().toString(),
    val localId: String = UUID.randomUUID().toString(),
    val sessionType: SessionType,
    val status: SessionStatus = SessionStatus.IN_PROGRESS,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val relatedEntityType: String? = null,
    val relatedEntityId: String? = null,
    val metadata: Map<String, Any>? = null,
    val latitude: String? = null,
    val longitude: String? = null,
    val itemCount: Int = 0,
    val startedAt: Date = Date(),
    val completedAt: Date? = null,
    val syncedAt: Date? = null,
    val scans: List<ScannedTag> = emptyList()
)

// Device info
data class DeviceInfo(
    val id: String? = null,
    val deviceUuid: String,
    val name: String,
    val appVersion: String,
    val isRegistered: Boolean = false
)

// API Response models
data class LoginResponse(
    val token: String,
    val user: User
)

data class DeviceRegistrationResponse(
    val device: DeviceInfo,
    val isNew: Boolean
)

data class SyncResult(
    val localId: String,
    val serverId: String?,
    val status: String,
    val conflicts: List<String>?,
    val error: String?
)

data class SyncResponse(
    val syncedAt: String,
    val results: List<SyncResult>
)

// Item from backend (for display)
data class Item(
    val id: String,
    val rfidTag: String,
    val itemType: ItemType?,
    val status: String,
    val tenantId: String
)

data class ItemType(
    val id: String,
    val name: String,
    val description: String?
)
