package com.laundry.rfid.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Monitors network connectivity state and provides reactive updates.
 *
 * Features:
 * - Real-time connectivity monitoring
 * - Network type detection (WiFi, Cellular, etc.)
 * - Bandwidth estimation
 * - StateFlow for easy observation
 */
@Singleton
class NetworkMonitor @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "NetworkMonitor"
    }

    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE)
            as ConnectivityManager

    private val _networkState = MutableStateFlow(getCurrentNetworkState())
    val networkState: StateFlow<NetworkState> = _networkState.asStateFlow()

    private val _isOnline = MutableStateFlow(isCurrentlyOnline())
    val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        startMonitoring()
    }

    /**
     * Check if device is currently online
     */
    fun isCurrentlyOnline(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false

        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
               capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /**
     * Get current network state
     */
    fun getCurrentNetworkState(): NetworkState {
        val network = connectivityManager.activeNetwork
        val capabilities = network?.let { connectivityManager.getNetworkCapabilities(it) }

        if (network == null || capabilities == null) {
            return NetworkState(
                isConnected = false,
                networkType = NetworkType.NONE,
                isMetered = true,
                downloadSpeedKbps = 0,
                uploadSpeedKbps = 0
            )
        }

        val networkType = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkType.WIFI
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkType.CELLULAR
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkType.ETHERNET
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> NetworkType.BLUETOOTH
            else -> NetworkType.UNKNOWN
        }

        val isValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        val isMetered = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

        // Get bandwidth estimates
        val downloadSpeedKbps = capabilities.linkDownstreamBandwidthKbps
        val uploadSpeedKbps = capabilities.linkUpstreamBandwidthKbps

        return NetworkState(
            isConnected = isValidated,
            networkType = networkType,
            isMetered = isMetered,
            downloadSpeedKbps = downloadSpeedKbps,
            uploadSpeedKbps = uploadSpeedKbps
        )
    }

    /**
     * Start monitoring network changes
     */
    private fun startMonitoring() {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d(TAG, "Network available")
                updateState()
            }

            override fun onLost(network: Network) {
                Log.d(TAG, "Network lost")
                updateState()
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                Log.d(TAG, "Network capabilities changed")
                updateState()
            }
        }

        try {
            connectivityManager.registerNetworkCallback(request, networkCallback!!)
            Log.d(TAG, "Network monitoring started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback", e)
        }
    }

    /**
     * Stop monitoring (call when no longer needed)
     */
    fun stopMonitoring() {
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
                Log.d(TAG, "Network monitoring stopped")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to unregister network callback", e)
            }
        }
        networkCallback = null
    }

    private fun updateState() {
        val newState = getCurrentNetworkState()
        _networkState.value = newState
        _isOnline.value = newState.isConnected

        Log.d(TAG, "Network state updated: connected=${newState.isConnected}, type=${newState.networkType}")
    }

    /**
     * Flow that emits when network becomes available after being offline
     */
    fun observeNetworkRecovery(): Flow<Unit> = callbackFlow {
        var wasOffline = !isCurrentlyOnline()

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (wasOffline) {
                    Log.i(TAG, "Network recovered!")
                    trySend(Unit)
                }
                wasOffline = false
            }

            override fun onLost(network: Network) {
                wasOffline = true
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, callback)

        awaitClose {
            connectivityManager.unregisterNetworkCallback(callback)
        }
    }.distinctUntilChanged()

    /**
     * Check if current connection is suitable for large data transfers
     */
    fun isSuitableForSync(): Boolean {
        val state = _networkState.value
        return state.isConnected && !state.isMetered && state.downloadSpeedKbps > 1000
    }

    /**
     * Check if we should defer operations to WiFi
     */
    fun shouldDeferToWifi(): Boolean {
        val state = _networkState.value
        return state.isConnected && state.isMetered
    }
}

/**
 * Represents current network state
 */
data class NetworkState(
    val isConnected: Boolean,
    val networkType: NetworkType,
    val isMetered: Boolean,
    val downloadSpeedKbps: Int,
    val uploadSpeedKbps: Int
) {
    val isWifi: Boolean get() = networkType == NetworkType.WIFI
    val isCellular: Boolean get() = networkType == NetworkType.CELLULAR
    val hasGoodConnection: Boolean get() = isConnected && downloadSpeedKbps > 500
}

/**
 * Network connection types
 */
enum class NetworkType {
    NONE,
    WIFI,
    CELLULAR,
    ETHERNET,
    BLUETOOTH,
    UNKNOWN
}
