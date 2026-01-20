package com.laundry.rfid.network

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min
import kotlin.math.pow

/**
 * OkHttp Interceptor that implements automatic retry with exponential backoff.
 *
 * Retry conditions:
 * - Network errors (timeout, connection failed, unknown host)
 * - Server errors (5xx status codes)
 *
 * Does NOT retry:
 * - Client errors (4xx status codes) - these are intentional responses
 * - Successful responses (2xx, 3xx)
 */
@Singleton
class RetryInterceptor @Inject constructor(
    private val circuitBreaker: CircuitBreaker
) : Interceptor {

    companion object {
        private const val TAG = "RetryInterceptor"
        private const val MAX_RETRIES = 3
        private const val INITIAL_DELAY_MS = 1000L  // 1 second
        private const val MAX_DELAY_MS = 10000L     // 10 seconds
        private const val BACKOFF_MULTIPLIER = 2.0
        private const val JITTER_FACTOR = 0.2       // 20% jitter
    }

    @Throws(IOException::class)
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val endpoint = "${request.method} ${request.url.encodedPath}"

        // Check circuit breaker before making request
        if (!circuitBreaker.allowRequest(endpoint)) {
            throw CircuitBreakerOpenException(
                "Circuit breaker is open for endpoint: $endpoint. " +
                "Too many recent failures. Please try again later."
            )
        }

        var lastException: IOException? = null
        var attempt = 0

        while (attempt <= MAX_RETRIES) {
            try {
                if (attempt > 0) {
                    val delay = calculateDelay(attempt)
                    Log.d(TAG, "Retry attempt $attempt for $endpoint after ${delay}ms")
                    Thread.sleep(delay)
                }

                val response = chain.proceed(request)

                // Check for server errors (5xx) - these should be retried
                if (response.code in 500..599 && attempt < MAX_RETRIES) {
                    Log.w(TAG, "Server error ${response.code} for $endpoint, will retry")
                    response.close()
                    circuitBreaker.recordFailure(endpoint)
                    attempt++
                    continue
                }

                // Success - record it and return
                if (response.isSuccessful) {
                    circuitBreaker.recordSuccess(endpoint)
                }

                return response

            } catch (e: IOException) {
                lastException = e

                if (shouldRetry(e) && attempt < MAX_RETRIES) {
                    Log.w(TAG, "Network error for $endpoint: ${e.message}, will retry", e)
                    circuitBreaker.recordFailure(endpoint)
                    attempt++
                } else {
                    circuitBreaker.recordFailure(endpoint)
                    throw e
                }
            }
        }

        // Max retries exceeded
        circuitBreaker.recordFailure(endpoint)
        throw lastException ?: IOException("Max retries exceeded for $endpoint")
    }

    /**
     * Determines if the given exception should trigger a retry
     */
    private fun shouldRetry(e: IOException): Boolean {
        return when (e) {
            is SocketTimeoutException -> true
            is UnknownHostException -> true
            is java.net.ConnectException -> true
            is java.net.NoRouteToHostException -> true
            is javax.net.ssl.SSLHandshakeException -> false // SSL errors shouldn't be retried
            else -> {
                // Check common retryable error messages
                val message = e.message?.lowercase() ?: ""
                message.contains("timeout") ||
                message.contains("connection reset") ||
                message.contains("connection refused") ||
                message.contains("network is unreachable")
            }
        }
    }

    /**
     * Calculates delay with exponential backoff and jitter
     */
    private fun calculateDelay(attempt: Int): Long {
        // Exponential backoff: initial * (multiplier ^ attempt)
        val exponentialDelay = INITIAL_DELAY_MS * BACKOFF_MULTIPLIER.pow(attempt.toDouble())
        val boundedDelay = min(exponentialDelay.toLong(), MAX_DELAY_MS)

        // Add jitter to prevent thundering herd
        val jitter = (boundedDelay * JITTER_FACTOR * (Math.random() * 2 - 1)).toLong()

        return boundedDelay + jitter
    }
}

/**
 * Exception thrown when circuit breaker is open
 */
class CircuitBreakerOpenException(message: String) : IOException(message)
