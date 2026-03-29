package com.laundry.tablet.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        ItemEntity::class,
        TenantEntity::class,
        DeliveryEntity::class,
        PendingOperationEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun itemDao(): ItemDao
    abstract fun tenantDao(): TenantDao
    abstract fun deliveryDao(): DeliveryDao
    abstract fun pendingOperationDao(): PendingOperationDao
}
