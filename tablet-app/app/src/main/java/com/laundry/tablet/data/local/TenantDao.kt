package com.laundry.tablet.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface TenantDao {

    @Query("SELECT * FROM tenants WHERE isActive = 1 ORDER BY name")
    suspend fun getAll(): List<TenantEntity>

    @Query("SELECT * FROM tenants WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): TenantEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(tenants: List<TenantEntity>)

    @Query("SELECT COUNT(*) FROM tenants")
    suspend fun getCount(): Int

    @Query("DELETE FROM tenants")
    suspend fun deleteAll()
}
