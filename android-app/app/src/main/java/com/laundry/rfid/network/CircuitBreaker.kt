package com.laundry.rfid.network

import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Circuit Breaker pattern implementation to prevent cascading failures.
 *
 * States:
 * - CLOSED: Normal operation, requests are allowed
 * - OPEN: Too many failures, requests are blocked
 * - HALF_OPEN: Testing if service has recovered, limited requests allowed
 *
 * Each endpoint has its own circuit breaker state.
 */
@Singleton
class CircuitBreaker @Inject constructor() {

    companion object {
        private const val TAG = "CircuitBreaker"
        private const val FAILURE_THRESHOLD = 5           // Failures before opening
        private const val SUCCESS_THRESHOLD = 3           // Successes to close from half-open
        private const val OPEN_DURATION_MS = 30_000L      // 30 seconds
        private const val HALF_OPEN_MAX_REQUESTS = 3      // Max requests in half-open state
        private const val FAILURE_WINDOW_MS = 60_000L     // 1 minute sliding window
    }

    private val circuitStates = ConcurrentHashMap<String, CircuitState>()

    /**
     * Check if a request is allowed for the given endpoint
     */
    fun allowRequest(endpoint: String): Boolean {
        val state = getOrCreateState(endpoint)

        return when (state.status) {
            Status.CLOSED -> true
            Status.OPEN -> {
                // Check if we should transition to half-open
                if (System.currentTimeMillis() - state.openedAt.get() > OPEN_DURATION_MS) {
                    transitionToHalfOpen(endpoint, state)
                    true
                } else {
                    Log.d(TAG, "Circuit OPEN for $endpoint, blocking request")
                    false
                }
            }
            Status.HALF_OPEN -> {
                // Allow limited requests in half-open state
                val currentRequests = state.halfOpenRequests.incrementAndGet()
                if (currentRequests <= HALF_OPEN_MAX_REQUESTS) {
                    Log.d(TAG, "Circuit HALF_OPEN for $endpoint, allowing test request $currentRequests")
                    true
                } else {
                    Log.d(TAG, "Circuit HALF_OPEN for $endpoint, max test requests reached")
                    false
                }
            }
        }
    }

    /**
     * Record a successful request
     */
    fun recordSuccess(endpoint: String) {
        val state = getOrCreateState(endpoint)

        when (state.status) {
            Status.CLOSED -> {
                // Reset failure count on success
                state.failureCount.set(0)
                state.recentFailures.clear()
            }
            Status.HALF_OPEN -> {
                val successes = state.successCount.incrementAndGet()
                Log.d(TAG, "Success in HALF_OPEN for $endpoint ($successes/$SUCCESS_THRESHOLD)")

                if (successes >= SUCCESS_THRESHOLD) {
                    transitionToClosed(endpoint, state)
                }
            }
            Status.OPEN -> {
                // Shouldn't happen, but handle gracefully
                Log.w(TAG, "Success recorded while OPEN for $endpoint")
            }
        }
    }

    /**
     * Record a failed request
     */
    fun recordFailure(endpoint: String) {
        val state = getOrCreateState(endpoint)
        val now = System.currentTimeMillis()

        when (state.status) {
            Status.CLOSED -> {
                // Add to recent failures with timestamp
                state.recentFailures[now] = true

                // Clean old failures outside the window
                val windowStart = now - FAILURE_WINDOW_MS
                state.recentFailures.keys.filter { it < windowStart }.forEach {
                    state.recentFailures.remove(it)
                }

                val recentCount = state.recentFailures.size
                state.failureCount.set(recentCount)

                Log.d(TAG, "Failure recorded for $endpoint ($recentCount/$FAILURE_THRESHOLD in window)")

                if (recentCount >= FAILURE_THRESHOLD) {
                    transitionToOpen(endpoint, state)
                }
            }
            Status.HALF_OPEN -> {
                Log.d(TAG, "Failure in HALF_OPEN for $endpoint, reopening circuit")
                transitionToOpen(endpoint, state)
            }
            Status.OPEN -> {
                // Already open, just log
                Log.d(TAG, "Failure recorded while OPEN for $endpoint")
            }
        }
    }

    /**
     * Get current state for an endpoint (for monitoring/debugging)
     */
    fun getState(endpoint: String): CircuitInfo {
        val state = circuitStates[endpoint] ?: return CircuitInfo(
            endpoint = endpoint,
            status = Status.CLOSED,
            failureCount = 0,
            successCount = 0,
            openedAt = null
        )

        return CircuitInfo(
            endpoint = endpoint,
            status = state.status,
            failureCount = state.failureCount.get(),
            successCount = state.successCount.get(),
            openedAt = if (state.status != Status.CLOSED) state.openedAt.get() else null
        )
    }

    /**
     * Get all circuit breaker states (for monitoring)
     */
    fun getAllStates(): List<CircuitInfo> {
        return circuitStates.map { (endpoint, state) ->
            CircuitInfo(
                endpoint = endpoint,
                status = state.status,
                failureCount = state.failureCount.get(),
                successCount = state.successCount.get(),
                openedAt = if (state.status != Status.CLOSED) state.openedAt.get() else null
            )
        }
    }

    /**
     * Reset circuit breaker for an endpoint (useful for testing or manual recovery)
     */
    fun reset(endpoint: String) {
        circuitStates.remove(endpoint)
        Log.i(TAG, "Circuit breaker reset for $endpoint")
    }

    /**
     * Reset all circuit breakers
     */
    fun resetAll() {
        circuitStates.clear()
        Log.i(TAG, "All circuit breakers reset")
    }

    private fun getOrCreateState(endpoint: String): CircuitState {
        return circuitStates.getOrPut(endpoint) {
            CircuitState()
        }
    }

    private fun transitionToOpen(endpoint: String, state: CircuitState) {
        state.status = Status.OPEN
        state.openedAt.set(System.currentTimeMillis())
        state.successCount.set(0)
        state.halfOpenRequests.set(0)
        Log.w(TAG, "Circuit OPENED for $endpoint after ${state.failureCount.get()} failures")
    }

    private fun transitionToHalfOpen(endpoint: String, state: CircuitState) {
        state.status = Status.HALF_OPEN
        state.successCount.set(0)
        state.halfOpenRequests.set(0)
        Log.i(TAG, "Circuit transitioned to HALF_OPEN for $endpoint")
    }

    private fun transitionToClosed(endpoint: String, state: CircuitState) {
        state.status = Status.CLOSED
        state.failureCount.set(0)
        state.successCount.set(0)
        state.halfOpenRequests.set(0)
        state.recentFailures.clear()
        Log.i(TAG, "Circuit CLOSED for $endpoint after recovery")
    }

    private class CircuitState {
        @Volatile var status: Status = Status.CLOSED
        val failureCount = AtomicInteger(0)
        val successCount = AtomicInteger(0)
        val openedAt = AtomicLong(0)
        val halfOpenRequests = AtomicInteger(0)
        val recentFailures = ConcurrentHashMap<Long, Boolean>()
    }

    enum class Status {
        CLOSED,     // Normal operation
        OPEN,       // Blocking requests
        HALF_OPEN   // Testing recovery
    }

    data class CircuitInfo(
        val endpoint: String,
        val status: Status,
        val failureCount: Int,
        val successCount: Int,
        val openedAt: Long?
    )
}
