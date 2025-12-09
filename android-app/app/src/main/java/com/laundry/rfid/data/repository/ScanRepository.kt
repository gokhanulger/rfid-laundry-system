package com.laundry.rfid.data.repository

import com.google.gson.Gson
import com.laundry.rfid.data.local.dao.ScanEventDao
import com.laundry.rfid.data.local.dao.ScanSessionDao
import com.laundry.rfid.data.local.dao.SyncQueueDao
import com.laundry.rfid.data.local.entity.ScanEventEntity
import com.laundry.rfid.data.local.entity.ScanSessionEntity
import com.laundry.rfid.data.local.entity.SyncQueueEntity
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.*
import com.laundry.rfid.domain.model.*
import com.laundry.rfid.util.PreferencesManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ScanRepository @Inject constructor(
    private val sessionDao: ScanSessionDao,
    private val eventDao: ScanEventDao,
    private val syncQueueDao: SyncQueueDao,
    private val apiService: ApiService,
    private val preferencesManager: PreferencesManager
) {
    private val gson = Gson()
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    // =====================
    // Session Management
    // =====================

    suspend fun createSession(
        sessionType: SessionType,
        relatedEntityType: String? = null,
        relatedEntityId: String? = null,
        metadata: Map<String, Any>? = null,
        latitude: String? = null,
        longitude: String? = null
    ): ScanSession {
        val session = ScanSession(
            sessionType = sessionType,
            relatedEntityType = relatedEntityType,
            relatedEntityId = relatedEntityId,
            metadata = metadata,
            latitude = latitude,
            longitude = longitude
        )

        val entity = ScanSessionEntity(
            id = session.id,
            localId = session.localId,
            sessionType = sessionType.value,
            status = SessionStatus.IN_PROGRESS.value,
            syncStatus = SyncStatus.PENDING.value,
            relatedEntityType = relatedEntityType,
            relatedEntityId = relatedEntityId,
            metadata = metadata?.let { gson.toJson(it) },
            latitude = latitude,
            longitude = longitude,
            itemCount = 0,
            startedAt = session.startedAt.time,
            completedAt = null,
            syncedAt = null
        )

        sessionDao.insertSession(entity)
        return session
    }

    suspend fun completeSession(sessionId: String): ScanSession? {
        val entity = sessionDao.getSessionById(sessionId) ?: return null
        val itemCount = eventDao.getUniqueTagCount(sessionId)

        sessionDao.completeSession(
            id = sessionId,
            status = SessionStatus.COMPLETED.value,
            completedAt = System.currentTimeMillis(),
            itemCount = itemCount
        )

        // Add to sync queue
        addToSyncQueue(sessionId)

        return sessionDao.getSessionById(sessionId)?.toSession()
    }

    suspend fun getActiveSession(): ScanSession? {
        return sessionDao.getActiveSession()?.toSession()
    }

    fun getAllSessions(): Flow<List<ScanSession>> {
        return sessionDao.getAllSessions().map { entities ->
            entities.map { it.toSession() }
        }
    }

    fun getPendingSyncCount(): Flow<Int> {
        return sessionDao.getPendingSyncCount()
    }

    // =====================
    // Scan Events
    // =====================

    suspend fun addScanEvent(
        sessionId: String,
        rfidTag: String,
        signalStrength: Int? = null
    ) {
        val existingEvent = eventDao.getEventByTag(sessionId, rfidTag)

        if (existingEvent != null) {
            eventDao.incrementReadCount(existingEvent.id, signalStrength)
        } else {
            val event = ScanEventEntity(
                id = UUID.randomUUID().toString(),
                sessionId = sessionId,
                rfidTag = rfidTag,
                signalStrength = signalStrength,
                readCount = 1,
                scannedAt = System.currentTimeMillis()
            )
            eventDao.insertEvent(event)
        }
    }

    suspend fun addBulkScanEvents(
        sessionId: String,
        tags: List<ScannedTag>
    ) {
        for (tag in tags) {
            addScanEvent(sessionId, tag.rfidTag, tag.signalStrength)
        }
    }

    fun getEventsBySession(sessionId: String): Flow<List<ScannedTag>> {
        return eventDao.getEventsBySession(sessionId).map { entities ->
            entities.map { it.toScannedTag() }
        }
    }

    fun getEventCount(sessionId: String): Flow<Int> {
        return eventDao.getEventCount(sessionId)
    }

    // =====================
    // Sync Queue
    // =====================

    private suspend fun addToSyncQueue(sessionId: String) {
        val session = sessionDao.getSessionById(sessionId) ?: return
        val events = eventDao.getEventsBySessionSync(sessionId)

        val payload = OfflineSessionDto(
            localId = session.localId,
            sessionType = session.sessionType,
            relatedEntityType = session.relatedEntityType,
            relatedEntityId = session.relatedEntityId,
            metadata = session.metadata?.let { gson.fromJson(it, Map::class.java) as Map<String, Any>? },
            latitude = session.latitude,
            longitude = session.longitude,
            startedAt = dateFormat.format(Date(session.startedAt)),
            completedAt = session.completedAt?.let { dateFormat.format(Date(it)) },
            scans = events.map { event ->
                OfflineScanDto(
                    rfidTag = event.rfidTag,
                    signalStrength = event.signalStrength,
                    readCount = event.readCount,
                    scannedAt = dateFormat.format(Date(event.scannedAt))
                )
            }
        )

        val queueItem = SyncQueueEntity(
            id = UUID.randomUUID().toString(),
            sessionId = sessionId,
            payload = gson.toJson(payload),
            status = "pending",
            retryCount = 0,
            errorMessage = null,
            processedAt = null
        )

        syncQueueDao.insert(queueItem)
    }

    suspend fun syncPendingSessions(): Result<SyncResponse> {
        val pendingItems = syncQueueDao.getPendingItems()
        if (pendingItems.isEmpty()) {
            return Result.success(SyncResponse(
                syncedAt = dateFormat.format(Date()),
                results = emptyList()
            ))
        }

        val deviceUuid = preferencesManager.deviceUuid.first()
            ?: return Result.failure(Exception("Device not registered"))

        val sessions = pendingItems.map { item ->
            gson.fromJson(item.payload, OfflineSessionDto::class.java)
        }

        return try {
            val response = apiService.syncOfflineSessions(
                SyncRequest(deviceUuid = deviceUuid, sessions = sessions)
            )

            if (response.isSuccessful && response.body() != null) {
                val syncResponse = response.body()!!

                // Update sync status for each session
                for (result in syncResponse.results) {
                    val queueItem = pendingItems.find {
                        gson.fromJson(it.payload, OfflineSessionDto::class.java).localId == result.localId
                    }

                    if (queueItem != null) {
                        val status = if (result.status == "synced" || result.status == "conflict") {
                            "completed"
                        } else {
                            "failed"
                        }

                        syncQueueDao.updateStatus(
                            id = queueItem.id,
                            status = status,
                            processedAt = System.currentTimeMillis(),
                            errorMessage = result.error
                        )

                        // Update session sync status
                        if (status == "completed") {
                            sessionDao.updateSyncStatus(
                                id = queueItem.sessionId,
                                syncStatus = SyncStatus.SYNCED.value,
                                syncedAt = System.currentTimeMillis()
                            )
                        }
                    }
                }

                // Clean up completed queue items
                syncQueueDao.deleteCompleted()

                Result.success(SyncResponse(
                    syncedAt = syncResponse.syncedAt,
                    results = syncResponse.results.map { dto ->
                        SyncResult(
                            localId = dto.localId,
                            serverId = dto.serverId,
                            status = dto.status,
                            conflicts = dto.conflicts,
                            error = dto.error
                        )
                    }
                ))
            } else {
                Result.failure(Exception("Sync failed: ${response.code()}"))
            }
        } catch (e: Exception) {
            // Mark items as failed but keep for retry
            for (item in pendingItems) {
                if (item.retryCount < 3) {
                    syncQueueDao.updateStatus(
                        id = item.id,
                        status = "pending",
                        processedAt = null,
                        errorMessage = e.message
                    )
                } else {
                    syncQueueDao.updateStatus(
                        id = item.id,
                        status = "failed",
                        processedAt = System.currentTimeMillis(),
                        errorMessage = "Max retries exceeded: ${e.message}"
                    )
                }
            }
            Result.failure(e)
        }
    }

    // =====================
    // Entity Conversions
    // =====================

    private fun ScanSessionEntity.toSession(): ScanSession {
        return ScanSession(
            id = id,
            localId = localId,
            sessionType = SessionType.values().find { it.value == sessionType } ?: SessionType.PICKUP,
            status = SessionStatus.values().find { it.value == status } ?: SessionStatus.IN_PROGRESS,
            syncStatus = SyncStatus.values().find { it.value == syncStatus } ?: SyncStatus.PENDING,
            relatedEntityType = relatedEntityType,
            relatedEntityId = relatedEntityId,
            metadata = metadata?.let { gson.fromJson(it, Map::class.java) as Map<String, Any>? },
            latitude = latitude,
            longitude = longitude,
            itemCount = itemCount,
            startedAt = Date(startedAt),
            completedAt = completedAt?.let { Date(it) },
            syncedAt = syncedAt?.let { Date(it) }
        )
    }

    private fun ScanEventEntity.toScannedTag(): ScannedTag {
        return ScannedTag(
            rfidTag = rfidTag,
            signalStrength = signalStrength,
            readCount = readCount,
            scannedAt = Date(scannedAt)
        )
    }
}
