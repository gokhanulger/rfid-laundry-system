package com.laundry.rfid.data.local.dao

import androidx.room.*
import com.laundry.rfid.data.local.entity.ScanEventEntity
import com.laundry.rfid.data.local.entity.ScanSessionEntity
import com.laundry.rfid.data.local.entity.SyncQueueEntity
import com.laundry.rfid.data.local.entity.CachedItemEntity
import com.laundry.rfid.data.local.entity.CachedTenantEntity
import com.laundry.rfid.data.local.entity.CachedItemTypeEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ScanSessionDao {
    @Query("SELECT * FROM scan_sessions ORDER BY startedAt DESC")
    fun getAllSessions(): Flow<List<ScanSessionEntity>>

    @Query("SELECT * FROM scan_sessions WHERE syncStatus = 'pending' ORDER BY startedAt ASC")
    suspend fun getPendingSessions(): List<ScanSessionEntity>

    @Query("SELECT * FROM scan_sessions WHERE id = :id")
    suspend fun getSessionById(id: String): ScanSessionEntity?

    @Query("SELECT * FROM scan_sessions WHERE status = 'in_progress' LIMIT 1")
    suspend fun getActiveSession(): ScanSessionEntity?

    @Query("SELECT COUNT(*) FROM scan_sessions WHERE syncStatus = 'pending'")
    fun getPendingSyncCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSession(session: ScanSessionEntity)

    @Update
    suspend fun updateSession(session: ScanSessionEntity)

    @Query("UPDATE scan_sessions SET syncStatus = :syncStatus, syncedAt = :syncedAt WHERE id = :id")
    suspend fun updateSyncStatus(id: String, syncStatus: String, syncedAt: Long?)

    @Query("UPDATE scan_sessions SET status = :status, completedAt = :completedAt, itemCount = :itemCount WHERE id = :id")
    suspend fun completeSession(id: String, status: String, completedAt: Long, itemCount: Int)

    @Delete
    suspend fun deleteSession(session: ScanSessionEntity)

    @Query("DELETE FROM scan_sessions WHERE syncStatus = 'synced' AND syncedAt < :beforeTime")
    suspend fun deleteOldSyncedSessions(beforeTime: Long)
}

@Dao
interface ScanEventDao {
    @Query("SELECT * FROM scan_events WHERE sessionId = :sessionId ORDER BY scannedAt DESC")
    fun getEventsBySession(sessionId: String): Flow<List<ScanEventEntity>>

    @Query("SELECT * FROM scan_events WHERE sessionId = :sessionId")
    suspend fun getEventsBySessionSync(sessionId: String): List<ScanEventEntity>

    @Query("SELECT * FROM scan_events WHERE sessionId = :sessionId AND rfidTag = :rfidTag LIMIT 1")
    suspend fun getEventByTag(sessionId: String, rfidTag: String): ScanEventEntity?

    @Query("SELECT COUNT(*) FROM scan_events WHERE sessionId = :sessionId")
    fun getEventCount(sessionId: String): Flow<Int>

    @Query("SELECT COUNT(DISTINCT rfidTag) FROM scan_events WHERE sessionId = :sessionId")
    suspend fun getUniqueTagCount(sessionId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvent(event: ScanEventEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvents(events: List<ScanEventEntity>)

    @Query("UPDATE scan_events SET readCount = readCount + 1, signalStrength = CASE WHEN :signalStrength > signalStrength THEN :signalStrength ELSE signalStrength END WHERE id = :id")
    suspend fun incrementReadCount(id: String, signalStrength: Int?)

    @Query("DELETE FROM scan_events WHERE sessionId = :sessionId")
    suspend fun deleteEventsBySession(sessionId: String)
}

@Dao
interface SyncQueueDao {
    @Query("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY priority ASC, createdAt ASC")
    suspend fun getPendingItems(): List<SyncQueueEntity>

    @Query("SELECT * FROM sync_queue WHERE status = 'pending' AND retryCount < :maxRetries ORDER BY priority ASC, createdAt ASC")
    suspend fun getPendingItemsWithRetryLimit(maxRetries: Int): List<SyncQueueEntity>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'")
    fun getPendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status = 'failed'")
    fun getFailedCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: SyncQueueEntity)

    @Query("UPDATE sync_queue SET status = :status WHERE id = :id")
    suspend fun updateStatusOnly(id: String, status: String)

    @Query("UPDATE sync_queue SET status = :status, processedAt = :processedAt, errorMessage = :errorMessage WHERE id = :id")
    suspend fun updateStatus(id: String, status: String, processedAt: Long?, errorMessage: String?)

    @Query("UPDATE sync_queue SET status = :status, retryCount = :retryCount, errorMessage = :errorMessage WHERE id = :id")
    suspend fun updateStatusWithRetry(id: String, status: String, retryCount: Int, errorMessage: String?)

    @Query("UPDATE sync_queue SET status = 'pending', retryCount = 0 WHERE status = 'failed'")
    suspend fun resetFailedItems()

    @Query("DELETE FROM sync_queue WHERE status = 'completed'")
    suspend fun deleteCompleted()

    @Query("DELETE FROM sync_queue WHERE status = 'failed'")
    suspend fun deleteFailed()

    @Query("DELETE FROM sync_queue WHERE id = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface CachedItemDao {
    @Query("SELECT * FROM cached_items WHERE rfidTag = :rfidTag LIMIT 1")
    suspend fun getItemByTag(rfidTag: String): CachedItemEntity?

    @Query("SELECT * FROM cached_items WHERE rfidTag IN (:rfidTags)")
    suspend fun getItemsByTags(rfidTags: List<String>): List<CachedItemEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItem(item: CachedItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<CachedItemEntity>)

    @Query("DELETE FROM cached_items WHERE cachedAt < :beforeTime")
    suspend fun deleteOldCache(beforeTime: Long)
}

@Dao
interface CachedTenantDao {
    @Query("SELECT * FROM cached_tenants WHERE isActive = 1 ORDER BY name ASC")
    suspend fun getAllTenants(): List<CachedTenantEntity>

    @Query("SELECT * FROM cached_tenants WHERE id = :id")
    suspend fun getTenantById(id: String): CachedTenantEntity?

    @Query("SELECT * FROM cached_tenants WHERE qrCode = :qrCode LIMIT 1")
    suspend fun getTenantByQrCode(qrCode: String): CachedTenantEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTenants(tenants: List<CachedTenantEntity>)

    @Query("DELETE FROM cached_tenants")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM cached_tenants")
    suspend fun getCount(): Int
}

@Dao
interface CachedItemTypeDao {
    @Query("SELECT * FROM cached_item_types ORDER BY sortOrder ASC")
    suspend fun getAllItemTypes(): List<CachedItemTypeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItemTypes(itemTypes: List<CachedItemTypeEntity>)

    @Query("DELETE FROM cached_item_types")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM cached_item_types")
    suspend fun getCount(): Int
}
