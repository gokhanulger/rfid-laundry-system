package com.laundry.tablet.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingOperationDao {

    @Insert
    suspend fun insert(op: PendingOperationEntity): Long

    @Query("SELECT * FROM pending_operations ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingOperationEntity>

    @Query("SELECT COUNT(*) FROM pending_operations")
    suspend fun getCount(): Int

    @Query("DELETE FROM pending_operations WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE pending_operations SET retryCount = retryCount + 1, lastError = :error WHERE id = :id")
    suspend fun updateError(id: Long, error: String)
}
