package com.laundry.rfid.util

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import com.laundry.rfid.domain.model.DeviceInfo
import com.laundry.rfid.domain.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "laundry_rfid_prefs")

@Singleton
class PreferencesManager @Inject constructor(
    private val context: Context
) {
    private val gson = Gson()

    companion object {
        private val AUTH_TOKEN = stringPreferencesKey("auth_token")
        private val USER_DATA = stringPreferencesKey("user_data")
        private val DEVICE_INFO = stringPreferencesKey("device_info")
        private val DEVICE_UUID = stringPreferencesKey("device_uuid")
    }

    // Auth Token
    val authToken: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[AUTH_TOKEN]
    }

    suspend fun setAuthToken(token: String) {
        context.dataStore.edit { prefs ->
            prefs[AUTH_TOKEN] = token
        }
    }

    fun getAuthTokenSync(): String? = runBlocking {
        context.dataStore.data.first()[AUTH_TOKEN]
    }

    suspend fun clearAuthToken() {
        context.dataStore.edit { prefs ->
            prefs.remove(AUTH_TOKEN)
        }
    }

    // User Data
    val user: Flow<User?> = context.dataStore.data.map { prefs ->
        prefs[USER_DATA]?.let { json ->
            try {
                gson.fromJson(json, User::class.java)
            } catch (e: Exception) {
                null
            }
        }
    }

    suspend fun setUser(user: User) {
        context.dataStore.edit { prefs ->
            prefs[USER_DATA] = gson.toJson(user)
        }
    }

    suspend fun clearUser() {
        context.dataStore.edit { prefs ->
            prefs.remove(USER_DATA)
        }
    }

    // Device Info
    val deviceInfo: Flow<DeviceInfo?> = context.dataStore.data.map { prefs ->
        prefs[DEVICE_INFO]?.let { json ->
            try {
                gson.fromJson(json, DeviceInfo::class.java)
            } catch (e: Exception) {
                null
            }
        }
    }

    suspend fun setDeviceInfo(device: DeviceInfo) {
        context.dataStore.edit { prefs ->
            prefs[DEVICE_INFO] = gson.toJson(device)
        }
    }

    // Device UUID (persistent across reinstalls)
    val deviceUuid: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[DEVICE_UUID]
    }

    suspend fun setDeviceUuid(uuid: String) {
        context.dataStore.edit { prefs ->
            prefs[DEVICE_UUID] = uuid
        }
    }

    fun getDeviceUuidSync(): String? = runBlocking {
        context.dataStore.data.first()[DEVICE_UUID]
    }

    // Check if logged in
    val isLoggedIn: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[AUTH_TOKEN] != null
    }

    // Logout - clear all data
    suspend fun logout() {
        context.dataStore.edit { prefs ->
            prefs.remove(AUTH_TOKEN)
            prefs.remove(USER_DATA)
        }
    }
}
