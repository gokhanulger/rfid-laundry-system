package com.laundry.tablet.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface DeliveryDao {

    @Query("SELECT * FROM deliveries WHERE status = :status ORDER BY createdAt DESC")
    suspend fun getByStatus(status: String): List<DeliveryEntity>

    @Query("SELECT * FROM deliveries WHERE tenantId = :tenantId AND status = :status ORDER BY createdAt DESC")
    suspend fun getByTenantAndStatus(tenantId: String, status: String): List<DeliveryEntity>

    @Query("SELECT * FROM deliveries WHERE barcode = :barcode LIMIT 1")
    suspend fun findByBarcode(barcode: String): DeliveryEntity?

    @Query("SELECT * FROM deliveries WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): DeliveryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(deliveries: List<DeliveryEntity>)

    @Query("UPDATE deliveries SET status = :status, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateStatus(id: String, status: String, updatedAt: Long = System.currentTimeMillis())

    @Query("SELECT COUNT(*) FROM deliveries")
    suspend fun getCount(): Int

    @Query("DELETE FROM deliveries WHERE status NOT IN ('packaged', 'label_printed')")
    suspend fun cleanOldDeliveries()
}
