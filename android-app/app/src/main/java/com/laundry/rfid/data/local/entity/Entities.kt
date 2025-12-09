package com.laundry.rfid.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.Date

@Entity(tableName = "scan_sessions")
data class ScanSessionEntity(
    @PrimaryKey
    val id: String,
    val localId: String,
    val sessionType: String,
    val status: String,
    val syncStatus: String,
    val relatedEntityType: String?,
    val relatedEntityId: String?,
    val metadata: String?, // JSON string
    val latitude: String?,
    val longitude: String?,
    val itemCount: Int,
    val startedAt: Long,
    val completedAt: Long?,
    val syncedAt: Long?,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "scan_events",
    foreignKeys = [
        ForeignKey(
            entity = ScanSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("sessionId"), Index("rfidTag")]
)
data class ScanEventEntity(
    @PrimaryKey
    val id: String,
    val sessionId: String,
    val rfidTag: String,
    val signalStrength: Int?,
    val readCount: Int,
    val scannedAt: Long,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "cached_items")
data class CachedItemEntity(
    @PrimaryKey
    val id: String,
    val rfidTag: String,
    val itemTypeName: String?,
    val status: String,
    val tenantId: String,
    val cachedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "sync_queue")
data class SyncQueueEntity(
    @PrimaryKey
    val id: String,
    val sessionId: String,
    val payload: String, // JSON string
    val status: String, // pending, processing, completed, failed
    val retryCount: Int = 0,
    val errorMessage: String?,
    val createdAt: Long = System.currentTimeMillis(),
    val processedAt: Long?
)
