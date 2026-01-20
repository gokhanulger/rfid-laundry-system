package com.laundry.rfid.data.repository

import android.util.Log
import com.laundry.rfid.data.local.dao.CachedItemTypeDao
import com.laundry.rfid.data.local.dao.CachedTenantDao
import com.laundry.rfid.data.local.entity.CachedItemTypeEntity
import com.laundry.rfid.data.local.entity.CachedTenantEntity
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.ItemTypeDto
import com.laundry.rfid.data.remote.dto.TenantDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "DataCacheRepository"

/**
 * Repository that provides cache-first loading for tenants and item types.
 * Data is loaded instantly from local cache, then refreshed from API in background.
 */
@Singleton
class DataCacheRepository @Inject constructor(
    private val cachedTenantDao: CachedTenantDao,
    private val cachedItemTypeDao: CachedItemTypeDao,
    private val apiService: ApiService
) {
    // =====================
    // Tenants (Hotels)
    // =====================

    /**
     * Get tenants from cache immediately, returns empty list if no cache
     */
    suspend fun getCachedTenants(): List<TenantDto> = withContext(Dispatchers.IO) {
        try {
            cachedTenantDao.getAllTenants().map { it.toDto() }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading cached tenants", e)
            emptyList()
        }
    }

    /**
     * Fetch tenants from API and update cache
     */
    suspend fun refreshTenants(): Result<List<TenantDto>> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getTenants()
            if (response.isSuccessful) {
                val tenants = response.body() ?: emptyList()
                // Update cache
                val entities = tenants.map { it.toEntity() }
                cachedTenantDao.deleteAll()
                cachedTenantDao.insertTenants(entities)
                Log.d(TAG, "Cached ${entities.size} tenants")
                Result.success(tenants)
            } else {
                Result.failure(Exception("API error: ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error refreshing tenants", e)
            Result.failure(e)
        }
    }

    /**
     * Get tenants - cache first, then refresh
     * Returns cached data immediately, callback for fresh data
     */
    suspend fun getTenantsCacheFirst(
        onCacheLoaded: (List<TenantDto>) -> Unit,
        onFreshLoaded: (List<TenantDto>) -> Unit
    ) {
        // 1. Load from cache immediately
        val cached = getCachedTenants()
        if (cached.isNotEmpty()) {
            onCacheLoaded(cached)
        }

        // 2. Refresh from API in background
        val result = refreshTenants()
        result.onSuccess { fresh ->
            onFreshLoaded(fresh)
        }
    }

    // =====================
    // Item Types
    // =====================

    /**
     * Get item types from cache immediately
     */
    suspend fun getCachedItemTypes(): List<ItemTypeDto> = withContext(Dispatchers.IO) {
        try {
            cachedItemTypeDao.getAllItemTypes().map { it.toDto() }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading cached item types", e)
            emptyList()
        }
    }

    /**
     * Fetch item types from API and update cache
     */
    suspend fun refreshItemTypes(): Result<List<ItemTypeDto>> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getItemTypes()
            if (response.isSuccessful) {
                val itemTypes = response.body() ?: emptyList()
                // Update cache
                val entities = itemTypes.map { it.toEntity() }
                cachedItemTypeDao.deleteAll()
                cachedItemTypeDao.insertItemTypes(entities)
                Log.d(TAG, "Cached ${entities.size} item types")
                Result.success(itemTypes)
            } else {
                Result.failure(Exception("API error: ${response.code()}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error refreshing item types", e)
            Result.failure(e)
        }
    }

    /**
     * Get item types - cache first, then refresh
     */
    suspend fun getItemTypesCacheFirst(
        onCacheLoaded: (List<ItemTypeDto>) -> Unit,
        onFreshLoaded: (List<ItemTypeDto>) -> Unit
    ) {
        // 1. Load from cache immediately
        val cached = getCachedItemTypes()
        if (cached.isNotEmpty()) {
            onCacheLoaded(cached)
        }

        // 2. Refresh from API
        val result = refreshItemTypes()
        result.onSuccess { fresh ->
            onFreshLoaded(fresh)
        }
    }

    /**
     * Preload all data into cache (call on app startup)
     * Silently handles errors - cache is optional optimization
     */
    suspend fun preloadCache() {
        try {
            Log.d(TAG, "Preloading cache...")
            refreshTenants()
            refreshItemTypes()
            Log.d(TAG, "Cache preload complete")
        } catch (e: Exception) {
            // Silently ignore - cache preload is optional
            Log.w(TAG, "Cache preload failed (will retry later): ${e.message}")
        }
    }

    // =====================
    // Entity Conversions
    // =====================

    private fun CachedTenantEntity.toDto() = TenantDto(
        id = id,
        name = name,
        qrCode = qrCode,
        email = email,
        phone = phone,
        address = address
    )

    private fun TenantDto.toEntity() = CachedTenantEntity(
        id = id,
        name = name,
        qrCode = qrCode,
        email = email,
        phone = phone,
        address = address,
        isActive = true // Default to active
    )

    private fun CachedItemTypeEntity.toDto() = ItemTypeDto(
        id = id,
        name = name,
        description = description,
        sortOrder = sortOrder
    )

    private fun ItemTypeDto.toEntity() = CachedItemTypeEntity(
        id = id,
        name = name,
        description = description,
        sortOrder = sortOrder ?: 0
    )
}
