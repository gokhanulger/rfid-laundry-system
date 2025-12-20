package com.laundry.rfid.data.repository

import android.os.Build
import android.provider.Settings
import com.laundry.rfid.BuildConfig
import com.laundry.rfid.data.remote.api.ApiService
import com.laundry.rfid.data.remote.dto.DeviceRegistrationRequest
import com.laundry.rfid.data.remote.dto.HeartbeatRequest
import com.laundry.rfid.data.remote.dto.LoginRequest
import com.laundry.rfid.domain.model.DeviceInfo
import com.laundry.rfid.domain.model.User
import com.laundry.rfid.util.PreferencesManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val apiService: ApiService,
    private val preferencesManager: PreferencesManager
) {
    val isLoggedIn: Flow<Boolean> = preferencesManager.isLoggedIn
    val currentUser: Flow<User?> = preferencesManager.user
    val deviceInfo: Flow<DeviceInfo?> = preferencesManager.deviceInfo

    suspend fun login(email: String, password: String): Result<User> {
        return try {
            val response = apiService.login(LoginRequest(email, password))

            if (response.isSuccessful && response.body() != null) {
                val loginResponse = response.body()!!

                // API returns flat structure, not nested user object
                val user = User(
                    id = loginResponse.id,
                    email = loginResponse.email,
                    firstName = loginResponse.firstName,
                    lastName = loginResponse.lastName,
                    role = loginResponse.role,
                    tenantId = loginResponse.tenantId
                )

                preferencesManager.setAuthToken(loginResponse.token)
                preferencesManager.setUser(user)

                Result.success(user)
            } else {
                val errorBody = response.errorBody()?.string() ?: "Login failed"
                Result.failure(Exception(errorBody))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout() {
        preferencesManager.logout()
    }

    suspend fun registerDevice(deviceName: String? = null): Result<DeviceInfo> {
        return try {
            // Get or generate device UUID
            var deviceUuid = preferencesManager.deviceUuid.first()
            if (deviceUuid == null) {
                deviceUuid = UUID.randomUUID().toString()
                preferencesManager.setDeviceUuid(deviceUuid)
            }

            val name = deviceName ?: "${Build.MANUFACTURER} ${Build.MODEL}"

            val response = apiService.registerDevice(
                DeviceRegistrationRequest(
                    deviceUuid = deviceUuid,
                    name = name,
                    appVersion = BuildConfig.VERSION_NAME
                )
            )

            if (response.isSuccessful && response.body() != null) {
                val regResponse = response.body()!!

                val device = DeviceInfo(
                    id = regResponse.device.id,
                    deviceUuid = regResponse.device.deviceUuid,
                    name = regResponse.device.name,
                    appVersion = regResponse.device.appVersion ?: BuildConfig.VERSION_NAME,
                    isRegistered = true
                )

                preferencesManager.setDeviceInfo(device)
                Result.success(device)
            } else {
                Result.failure(Exception("Device registration failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun sendHeartbeat(): Result<Unit> {
        return try {
            val deviceUuid = preferencesManager.deviceUuid.first()
                ?: return Result.failure(Exception("Device not registered"))

            val response = apiService.sendHeartbeat(
                deviceUuid = deviceUuid,
                request = HeartbeatRequest(appVersion = BuildConfig.VERSION_NAME)
            )

            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                Result.failure(Exception("Heartbeat failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCurrentUser(): Result<User> {
        return try {
            val response = apiService.getCurrentUser()

            if (response.isSuccessful && response.body() != null) {
                val userDto = response.body()!!
                val user = User(
                    id = userDto.id,
                    email = userDto.email,
                    firstName = userDto.firstName,
                    lastName = userDto.lastName,
                    role = userDto.role,
                    tenantId = userDto.tenantId
                )
                preferencesManager.setUser(user)
                Result.success(user)
            } else {
                Result.failure(Exception("Failed to get user"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun setOfflineLogin(role: String) {
        val user = User(
            id = "offline-${UUID.randomUUID()}",
            email = if (role == "DRIVER") "driver@laundry.com" else "admin@laundry.com",
            firstName = if (role == "DRIVER") "Şoför" else "Admin",
            lastName = "",
            role = if (role == "DRIVER") "driver" else "system_admin",
            tenantId = null
        )
        preferencesManager.setUser(user)
        preferencesManager.setAuthToken("offline-token")
    }
}
