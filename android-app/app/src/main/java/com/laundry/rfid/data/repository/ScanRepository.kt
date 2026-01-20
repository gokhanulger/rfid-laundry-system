package com.laundry.rfid.data.repository

import android.util.Log
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
import com.laundry.rfid.network.NetworkMonitor
import com.laundry.rfid.network.OperationType
import com.laundry.rfid.util.PreferencesManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "ScanRepository"
private const val MAX_RETRIES = 5

@Singleton
class ScanRepository @Inject constructor(
    private val sessionDao: ScanSessionDao,
    private val eventDao: ScanEventDao,
    private val syncQueueDao: SyncQueueDao,
    private val apiService: ApiService,
    private val preferencesManager: PreferencesManager,
    private val networkMonitor: NetworkMonitor
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
        if (tags.isEmpty()) return

        // Get existing tags in this session for deduplication
        val existingTags = eventDao.getEventsBySessionSync(sessionId)
            .associateBy { it.rfidTag }

        val eventsToInsert = mutableListOf<ScanEventEntity>()
        val eventsToUpdate = mutableListOf<Pair<String, Int?>>() // id to signalStrength

        for (tag in tags) {
            val existing = existingTags[tag.rfidTag]
            if (existing != null) {
                // Queue for update (increment read count)
                eventsToUpdate.add(existing.id to tag.signalStrength)
            } else {
                // Queue for insert
                eventsToInsert.add(
                    ScanEventEntity(
                        id = UUID.randomUUID().toString(),
                        sessionId = sessionId,
                        rfidTag = tag.rfidTag,
                        signalStrength = tag.signalStrength,
                        readCount = tag.readCount,
                        scannedAt = System.currentTimeMillis()
                    )
                )
            }
        }

        // Batch insert new events
        if (eventsToInsert.isNotEmpty()) {
            eventDao.insertEvents(eventsToInsert)
            Log.d(TAG, "Batch inserted ${eventsToInsert.size} scan events")
        }

        // Update existing events (still need individual updates due to increment logic)
        for ((id, signalStrength) in eventsToUpdate) {
            eventDao.incrementReadCount(id, signalStrength)
        }

        if (eventsToUpdate.isNotEmpty()) {
            Log.d(TAG, "Updated ${eventsToUpdate.size} existing scan events")
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
            operationType = OperationType.SCAN_SESSION_SYNC.name,
            payload = gson.toJson(payload),
            status = "pending",
            priority = 3, // Medium-high priority for scan syncs
            retryCount = 0,
            errorMessage = null,
            processedAt = null
        )

        syncQueueDao.insert(queueItem)
        Log.d(TAG, "Added session $sessionId to sync queue")
    }

    suspend fun syncPendingSessions(): Result<SyncResponse> {
        // Check network first
        if (!networkMonitor.isCurrentlyOnline()) {
            Log.d(TAG, "Offline, skipping sync")
            return Result.failure(Exception("Device is offline"))
        }

        val pendingItems = syncQueueDao.getPendingItemsWithRetryLimit(MAX_RETRIES)
        if (pendingItems.isEmpty()) {
            Log.d(TAG, "No pending items to sync")
            return Result.success(SyncResponse(
                syncedAt = dateFormat.format(Date()),
                results = emptyList()
            ))
        }

        Log.d(TAG, "Syncing ${pendingItems.size} pending sessions")

        val deviceUuid = preferencesManager.deviceUuid.first()
            ?: return Result.failure(Exception("Device not registered"))

        // Cache deserialized DTOs to avoid repeated JSON parsing
        val sessionDtoCache = mutableMapOf<String, OfflineSessionDto>()
        val localIdToQueueItem = mutableMapOf<String, SyncQueueEntity>()

        val sessions = pendingItems.map { item ->
            val dto = gson.fromJson(item.payload, OfflineSessionDto::class.java)
            sessionDtoCache[item.id] = dto
            localIdToQueueItem[dto.localId] = item
            dto
        }

        return try {
            val response = apiService.syncOfflineSessions(
                SyncRequest(deviceUuid = deviceUuid, sessions = sessions)
            )

            if (response.isSuccessful && response.body() != null) {
                val syncResponse = response.body()!!

                // Update sync status for each session - using cached lookup instead of re-parsing
                for (result in syncResponse.results) {
                    val queueItem = localIdToQueueItem[result.localId]

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
                            Log.d(TAG, "Session ${queueItem.sessionId} synced successfully")
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
                Log.w(TAG, "Sync API returned error: ${response.code()}")
                Result.failure(Exception("Sync failed: ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Sync failed with exception: ${e.message}", e)

            // Update retry counts for failed items
            for (item in pendingItems) {
                val newRetryCount = item.retryCount + 1
                if (newRetryCount < MAX_RETRIES) {
                    syncQueueDao.updateStatusWithRetry(
                        id = item.id,
                        status = "pending",
                        retryCount = newRetryCount,
                        errorMessage = e.message
                    )
                    Log.d(TAG, "Item ${item.id} will retry (attempt $newRetryCount/$MAX_RETRIES)")
                } else {
                    syncQueueDao.updateStatus(
                        id = item.id,
                        status = "failed",
                        processedAt = System.currentTimeMillis(),
                        errorMessage = "Max retries ($MAX_RETRIES) exceeded: ${e.message}"
                    )
                    Log.w(TAG, "Item ${item.id} moved to failed queue after $MAX_RETRIES retries")
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
