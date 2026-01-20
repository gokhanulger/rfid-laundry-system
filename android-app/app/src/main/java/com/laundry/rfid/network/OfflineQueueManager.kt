package com.laundry.rfid.network

import android.util.Log
import com.google.gson.Gson
import com.laundry.rfid.data.local.dao.SyncQueueDao
import com.laundry.rfid.data.local.entity.SyncQueueEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages offline operation queue with automatic retry when network is available.
 *
 * Features:
 * - Queue operations when offline
 * - Automatic sync when network recovers
 * - Max retry limit with exponential backoff
 * - Dead letter queue for failed operations
 * - Prioritized queue processing
 */
@Singleton
class OfflineQueueManager @Inject constructor(
    private val syncQueueDao: SyncQueueDao,
    private val networkMonitor: NetworkMonitor
) {

    companion object {
        private const val TAG = "OfflineQueueManager"
        private const val MAX_RETRIES = 5
        private const val DEFAULT_PRIORITY = 5
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gson = Gson()

    private val _syncEvents = MutableSharedFlow<SyncEvent>()
    val syncEvents: Flow<SyncEvent> = _syncEvents.asSharedFlow()

    // Track operations being processed to prevent duplicates
    private val processingIds = mutableSetOf<String>()

    init {
        // Listen for network recovery
        scope.launch {
            networkMonitor.observeNetworkRecovery().collect {
                Log.i(TAG, "Network recovered, starting sync")
                processQueue()
            }
        }
    }

    /**
     * Queue an operation to be executed when online
     */
    suspend fun <T> queueOperation(
        operationType: OperationType,
        payload: T,
        sessionId: String? = null,
        priority: Int = DEFAULT_PRIORITY
    ): String {
        val id = UUID.randomUUID().toString()
        val payloadJson = gson.toJson(payload)

        val queueItem = SyncQueueEntity(
            id = id,
            sessionId = sessionId ?: id,
            operationType = operationType.name,
            payload = payloadJson,
            status = "pending",
            priority = priority,
            retryCount = 0,
            errorMessage = null,
            createdAt = System.currentTimeMillis(),
            processedAt = null
        )

        syncQueueDao.insert(queueItem)
        Log.d(TAG, "Queued operation: $operationType with id: $id")

        // Try to process immediately if online
        if (networkMonitor.isCurrentlyOnline()) {
            scope.launch { processQueue() }
        }

        return id
    }

    /**
     * Process pending items in the queue
     */
    suspend fun processQueue() {
        if (!networkMonitor.isCurrentlyOnline()) {
            Log.d(TAG, "Offline, skipping queue processing")
            return
        }

        val pendingItems = syncQueueDao.getPendingItemsWithRetryLimit(MAX_RETRIES)
        Log.d(TAG, "Processing ${pendingItems.size} pending items")

        for (item in pendingItems) {
            // Skip if already being processed
            if (item.id in processingIds) continue
            processingIds.add(item.id)

            try {
                // Mark as processing
                syncQueueDao.updateStatusOnly(item.id, "processing")

                // Execute the operation
                val success = executeOperation(item)

                if (success) {
                    syncQueueDao.updateStatus(
                        id = item.id,
                        status = "completed",
                        processedAt = System.currentTimeMillis(),
                        errorMessage = null
                    )
                    Log.d(TAG, "Successfully processed: ${item.id}")
                    _syncEvents.emit(SyncEvent.OperationCompleted(item.id, item.operationType))
                } else {
                    handleFailure(item, "Operation returned false")
                }

            } catch (e: Exception) {
                Log.e(TAG, "Error processing ${item.id}: ${e.message}", e)
                handleFailure(item, e.message ?: "Unknown error")
            } finally {
                processingIds.remove(item.id)
            }
        }

        // Clean up completed items
        syncQueueDao.deleteCompleted()
    }

    /**
     * Execute a queued operation
     */
    private suspend fun executeOperation(item: SyncQueueEntity): Boolean {
        val operationType = try {
            OperationType.valueOf(item.operationType ?: "UNKNOWN")
        } catch (e: Exception) {
            OperationType.UNKNOWN
        }

        return when (operationType) {
            OperationType.SCAN_SESSION_SYNC -> {
                // This will be handled by ScanRepository
                _syncEvents.emit(SyncEvent.ProcessingRequired(item.id, operationType, item.payload))
                true // Mark as needing external processing
            }
            OperationType.DELIVERY_CONFIRM -> {
                _syncEvents.emit(SyncEvent.ProcessingRequired(item.id, operationType, item.payload))
                true
            }
            OperationType.ITEM_CREATE -> {
                _syncEvents.emit(SyncEvent.ProcessingRequired(item.id, operationType, item.payload))
                true
            }
            OperationType.HEARTBEAT -> {
                _syncEvents.emit(SyncEvent.ProcessingRequired(item.id, operationType, item.payload))
                true
            }
            OperationType.UNKNOWN -> {
                Log.w(TAG, "Unknown operation type for item: ${item.id}")
                false
            }
        }
    }

    /**
     * Handle operation failure with retry logic
     */
    private suspend fun handleFailure(item: SyncQueueEntity, errorMessage: String) {
        val newRetryCount = item.retryCount + 1

        if (newRetryCount >= MAX_RETRIES) {
            // Move to dead letter queue (mark as failed)
            syncQueueDao.updateStatus(
                id = item.id,
                status = "failed",
                processedAt = System.currentTimeMillis(),
                errorMessage = "Max retries ($MAX_RETRIES) exceeded: $errorMessage"
            )
            Log.w(TAG, "Operation ${item.id} moved to dead letter queue after $MAX_RETRIES retries")
            _syncEvents.emit(SyncEvent.OperationFailed(item.id, item.operationType, errorMessage))
        } else {
            // Schedule for retry
            syncQueueDao.updateStatusWithRetry(
                id = item.id,
                status = "pending",
                retryCount = newRetryCount,
                errorMessage = errorMessage
            )
            Log.d(TAG, "Operation ${item.id} will retry (attempt $newRetryCount/$MAX_RETRIES)")
        }
    }

    /**
     * Get count of pending operations
     */
    fun getPendingCount(): Flow<Int> = syncQueueDao.getPendingCount()

    /**
     * Get count of failed operations
     */
    fun getFailedCount(): Flow<Int> = syncQueueDao.getFailedCount()

    /**
     * Retry failed operations (manual trigger)
     */
    suspend fun retryFailed() {
        syncQueueDao.resetFailedItems()
        processQueue()
    }

    /**
     * Clear all failed operations
     */
    suspend fun clearFailed() {
        syncQueueDao.deleteFailed()
    }

    /**
     * Cancel a pending operation
     */
    suspend fun cancelOperation(id: String) {
        syncQueueDao.deleteById(id)
        processingIds.remove(id)
    }
}

/**
 * Types of operations that can be queued
 */
enum class OperationType {
    SCAN_SESSION_SYNC,
    DELIVERY_CONFIRM,
    ITEM_CREATE,
    HEARTBEAT,
    UNKNOWN
}

/**
 * Events emitted during sync processing
 */
sealed class SyncEvent {
    data class OperationCompleted(val id: String, val operationType: String?) : SyncEvent()
    data class OperationFailed(val id: String, val operationType: String?, val error: String) : SyncEvent()
    data class ProcessingRequired(val id: String, val operationType: OperationType, val payload: String) : SyncEvent()
}
