package com.laundry.tablet.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "deliveries",
    indices = [
        Index(value = ["barcode"]),
        Index(value = ["status"]),
        Index(value = ["tenantId"])
    ]
)
data class DeliveryEntity(
    @PrimaryKey val id: String,
    val barcode: String = "",
    val tenantId: String,
    val tenantName: String = "",
    val status: String,
    val notes: String? = null,
    val itemCount: Int = 0,
    val packageCount: Int = 1,
    val createdAt: String? = null,
    val deliveryItemsJson: String? = null,
    val updatedAt: Long = System.currentTimeMillis()
)
