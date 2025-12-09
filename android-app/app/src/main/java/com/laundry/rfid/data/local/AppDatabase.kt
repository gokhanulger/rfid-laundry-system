package com.laundry.rfid.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.laundry.rfid.data.local.dao.CachedItemDao
import com.laundry.rfid.data.local.dao.ScanEventDao
import com.laundry.rfid.data.local.dao.ScanSessionDao
import com.laundry.rfid.data.local.dao.SyncQueueDao
import com.laundry.rfid.data.local.entity.CachedItemEntity
import com.laundry.rfid.data.local.entity.ScanEventEntity
import com.laundry.rfid.data.local.entity.ScanSessionEntity
import com.laundry.rfid.data.local.entity.SyncQueueEntity

@Database(
    entities = [
        ScanSessionEntity::class,
        ScanEventEntity::class,
        CachedItemEntity::class,
        SyncQueueEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun scanSessionDao(): ScanSessionDao
    abstract fun scanEventDao(): ScanEventDao
    abstract fun cachedItemDao(): CachedItemDao
    abstract fun syncQueueDao(): SyncQueueDao
}
