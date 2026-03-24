package com.laundry.rfid.data.repository

import android.util.Log
import com.laundry.rfid.data.local.dao.CachedItemDao
import com.laundry.rfid.data.local.dao.CachedItemTypeDao
import com.laundry.rfid.data.local.dao.CachedTenantDao
import com.laundry.rfid.data.local.entity.CachedItemEntity
import com.laundry.rfid.data.local.entity.CachedItemTypeEntity
import com.laundry.rfid.data.local.entity.CachedTenantEntity
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.ItemTypeDto
import com.laundry.rfid.data.remote.dto.TenantDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap
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
    private val cachedItemDao: CachedItemDao,
    private val apiService: ApiService
) {
    // In-memory cache for fast partial RFID matching
    // Key: rfidTag (uppercase), Value: CachedItemEntity
    private val itemsMemoryCache = ConcurrentHashMap<String, CachedItemEntity>()
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

            // Load items to memory from existing cache (don't refresh from API on startup)
            val itemsCount = loadItemsToMemory()
            if (itemsCount == 0) {
                Log.d(TAG, "No items in cache, will refresh from API...")
                refreshItems()
            }

            Log.d(TAG, "Cache preload complete")
        } catch (e: Exception) {
            // Silently ignore - cache preload is optional
            Log.w(TAG, "Cache preload failed (will retry later): ${e.message}")
        }
    }

    // =====================
    // Items (RFID Products)
    // =====================

    /**
     * Check if items are cached
     */
    suspend fun hasItemsCache(): Boolean = withContext(Dispatchers.IO) {
        try {
            cachedItemDao.getCount() > 0
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Get cached items count
     */
    suspend fun getItemsCacheCount(): Int = withContext(Dispatchers.IO) {
        try {
            cachedItemDao.getCount()
        } catch (e: Exception) {
            0
        }
    }

    /**
     * Load all items from SQLite to memory for fast partial matching
     * Call this at scan start
     */
    suspend fun loadItemsToMemory(): Int = withContext(Dispatchers.IO) {
        try {
            val items = cachedItemDao.getAllItems()
            itemsMemoryCache.clear()
            items.forEach { item ->
                // Store with uppercase key for case-insensitive matching
                itemsMemoryCache[item.rfidTag.uppercase()] = item
            }
            Log.d(TAG, "Loaded ${items.size} items to memory cache")
            items.size
        } catch (e: Exception) {
            Log.e(TAG, "Error loading items to memory", e)
            0
        }
    }

    /**
     * Clear memory cache (call when scan ends or on logout)
     */
    fun clearMemoryCache() {
        itemsMemoryCache.clear()
        Log.d(TAG, "Memory cache cleared")
    }

    /**
     * Find item by scanned RFID tag using partial matching
     * Scanned tag (long) contains database rfidTag (short)
     * Returns the best match (longest rfidTag)
     */
    fun findItemByScannedTag(scannedTag: String): CachedItemEntity? {
        val normalizedTag = scannedTag.uppercase()

        // First try exact match (fastest)
        itemsMemoryCache[normalizedTag]?.let { return it }

        // Partial match: find all items where scannedTag contains item.rfidTag
        val matches = itemsMemoryCache.values.filter { item ->
            normalizedTag.contains(item.rfidTag.uppercase())
        }

        if (matches.isEmpty()) return null

        // Return longest match (most specific)
        return matches.maxByOrNull { it.rfidTag.length }
    }

    /**
     * Batch lookup for multiple tags
     * Returns map of scannedTag -> CachedItemEntity
     */
    fun findItemsByScannedTags(scannedTags: List<String>): Map<String, CachedItemEntity> {
        val result = mutableMapOf<String, CachedItemEntity>()
        for (tag in scannedTags) {
            findItemByScannedTag(tag)?.let { item ->
                result[tag] = item
            }
        }
        return result
    }

    /**
     * Refresh items cache from API
     * Fetches all items and stores in SQLite + memory
     */
    suspend fun refreshItems(): Result<Int> = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Refreshing items cache from API...")

            // Fetch all items from API (paginated)
            val allItems = mutableListOf<CachedItemEntity>()
            var page = 1
            val pageSize = 500

            while (true) {
                val response = apiService.getItems(page = page, limit = pageSize)
                if (!response.isSuccessful) {
                    return@withContext Result.failure(Exception("API error: ${response.code()}"))
                }

                val body = response.body()
                Log.d(TAG, "API Response - data size: ${body?.data?.size}, pagination: ${body?.pagination}")
                val items = body?.items ?: emptyList()

                if (items.isEmpty()) {
                    Log.d(TAG, "No more items, stopping pagination")
                    break
                }

                // Convert to entities
                items.forEach { item ->
                    allItems.add(
                        CachedItemEntity(
                            id = item.id,
                            rfidTag = item.rfidTag.uppercase(),
                            itemTypeId = item.itemType?.id,
                            itemTypeName = item.itemType?.name,
                            status = item.status,
                            tenantId = item.tenantId,
                            tenantName = item.tenant?.name
                        )
                    )
                }

                Log.d(TAG, "Fetched page $page: ${items.size} items")

                // Check if more pages
                val total = body?.total ?: 0
                if (allItems.size >= total) break
                page++
            }

            // Save to SQLite
            cachedItemDao.deleteAll()
            cachedItemDao.insertItems(allItems)

            // Load to memory
            itemsMemoryCache.clear()
            allItems.forEach { item ->
                itemsMemoryCache[item.rfidTag.uppercase()] = item
            }

            Log.d(TAG, "Cached ${allItems.size} items (SQLite + memory)")
            Result.success(allItems.size)

        } catch (e: Exception) {
            Log.e(TAG, "Error refreshing items cache", e)
            Result.failure(e)
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
