package com.laundry.tablet.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tenants")
data class TenantEntity(
    @PrimaryKey val id: String,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val address: String? = null,
    val qrCode: String? = null,
    val isActive: Boolean = true,
    val updatedAt: Long = System.currentTimeMillis()
)
