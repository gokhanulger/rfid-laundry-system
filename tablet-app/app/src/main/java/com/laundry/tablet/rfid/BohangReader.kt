package com.laundry.tablet.rfid

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.suspendCancellableCoroutine
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

data class RfidTag(
    val epc: String,
    val rssi: Int = -50,
    val count: Int = 1,
    val antenna: Int = 0,
    val lastSeen: Long = System.currentTimeMillis()
)

sealed class ReaderState {
    data object Disconnected : ReaderState()
    data object Connecting : ReaderState()
    data object Connected : ReaderState()
    data object Scanning : ReaderState()
    data class Error(val message: String) : ReaderState()
}

enum class ConnectionMode { USB_SERIAL, TCP }

@Singleton
class BohangReader @Inject constructor() {

    companion object {
        private const val TAG = "BohangReader"
        private const val ACTION_USB_PERMISSION = "com.laundry.tablet.USB_PERMISSION"
        private const val DEFAULT_PORT = 20058
        private const val SERIAL_BAUD_RATE = 115200
        private const val HEADER_H = 0x43.toByte() // 'C'
        private const val HEADER_L = 0x4D.toByte() // 'M'
        private const val RECONNECT_DELAY = 5000L
        private const val HEARTBEAT_INTERVAL = 10000L
        private const val HEALTH_CHECK_INTERVAL = 30000L
        private const val CONNECTION_TIMEOUT = 120000L

        // BOHANG CM Protocol Commands
        private const val CMD_HEARTBEAT: Byte = 0x10
        private const val CMD_START_INVENTORY: Byte = 0x2A
        private const val CMD_STOP_INVENTORY: Byte = 0x2B
        private const val CMD_GET_VERSION: Byte = 0x31
        private const val CMD_START_AUTO_READ: Byte = 0x2E
        private const val CMD_SET_RF_POWER: Byte = 0x76
        private val CMD_SET_ANTENNA_POWER: Byte = 0xB6.toByte()
    }

    private val _state = MutableStateFlow<ReaderState>(ReaderState.Disconnected)
    val state: StateFlow<ReaderState> = _state.asStateFlow()

    private val _tags = MutableSharedFlow<RfidTag>(extraBufferCapacity = 100)
    val tags: SharedFlow<RfidTag> = _tags.asSharedFlow()

    private val scannedTags = ConcurrentHashMap<String, RfidTag>()
    val allTags: Map<String, RfidTag> get() = scannedTags.toMap()

    private var dataBuffer = ByteArray(0)

    // TCP fields
    private var socket: Socket? = null
    private var tcpInput: java.io.InputStream? = null
    private var tcpOutput: java.io.OutputStream? = null

    // USB Serial fields
    private var serialPort: UsbSerialPort? = null
    private var connectionMode: ConnectionMode = ConnectionMode.USB_SERIAL

    private var readerJob: Job? = null
    private var heartbeatJob: Job? = null
    private var healthCheckJob: Job? = null
    private var reconnectJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var currentIp: String = ""
    private var currentPort: Int = DEFAULT_PORT
    private var userWantsConnection = false
    private var lastDataReceived: Long = 0

    // Antenna configuration
    private val _antennaMask = MutableStateFlow(0x0F) // Default: all 4 antennas
    val antennaMask: StateFlow<Int> = _antennaMask.asStateFlow()

    private val _antennaPower = MutableStateFlow(intArrayOf(30, 30, 30, 30)) // Per-antenna power (dBm)
    val antennaPower: StateFlow<IntArray> = _antennaPower.asStateFlow()

    // Per-antenna tag count stats
    private val _antennaTagCounts = MutableStateFlow(intArrayOf(0, 0, 0, 0))
    val antennaTagCounts: StateFlow<IntArray> = _antennaTagCounts.asStateFlow()

    fun setAntennaMask(mask: Int) {
        _antennaMask.value = mask and 0x0F
        Log.i(TAG, "Antenna mask set: 0x${Integer.toHexString(mask)} -> antennas: ${maskToAntennaList(mask)}")
    }

    fun setAntennaPower(antennaIndex: Int, power: Int) {
        val p = _antennaPower.value.copyOf()
        p[antennaIndex] = power.coerceIn(0, 30)
        _antennaPower.value = p
        Log.i(TAG, "Antenna ${antennaIndex + 1} power set to ${p[antennaIndex]} dBm")
        // Send to reader if connected
        scope.launch {
            try {
                sendCommand(CMD_SET_RF_POWER, byteArrayOf(p[0].toByte(), p[1].toByte(), p[2].toByte(), p[3].toByte()))
            } catch (_: Exception) {}
        }
    }

    fun setAllAntennaPower(power: Int) {
        val p = power.coerceIn(0, 30)
        _antennaPower.value = intArrayOf(p, p, p, p)
        scope.launch {
            try {
                sendCommand(CMD_SET_RF_POWER, byteArrayOf(p.toByte(), p.toByte(), p.toByte(), p.toByte()))
            } catch (_: Exception) {}
        }
    }

    private fun maskToAntennaList(mask: Int): String {
        return (1..4).filter { (mask shr (it - 1)) and 1 == 1 }.joinToString(", ") { "Ant$it" }
    }

    // ==========================================
    // USB Serial Connection
    // ==========================================

    /**
     * Find FTDI/CH340/CP2102 USB serial devices
     */
    fun findUsbDevices(context: Context): List<UsbSerialDriver> {
        val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        return UsbSerialProber.getDefaultProber().findAllDrivers(manager)
    }

    /**
     * Connect via USB Serial (FTDI FT232R etc.)
     */
    fun connectUsb(context: Context, driver: UsbSerialDriver? = null) {
        connectionMode = ConnectionMode.USB_SERIAL
        userWantsConnection = true
        reconnectJob?.cancel()
        doConnectUsb(context, driver)
    }

    private suspend fun requestUsbPermission(context: Context, manager: UsbManager, device: UsbDevice): Boolean {
        if (manager.hasPermission(device)) return true

        return suspendCancellableCoroutine { cont ->
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    if (intent.action == ACTION_USB_PERMISSION) {
                        context.unregisterReceiver(this)
                        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                        if (cont.isActive) cont.resume(granted)
                    }
                }
            }

            val filter = IntentFilter(ACTION_USB_PERMISSION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }

            val intent = Intent(ACTION_USB_PERMISSION)
            intent.setPackage(context.packageName)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            else
                PendingIntent.FLAG_UPDATE_CURRENT

            val permissionIntent = PendingIntent.getBroadcast(context, 0, intent, flags)
            manager.requestPermission(device, permissionIntent)

            cont.invokeOnCancellation {
                try { context.unregisterReceiver(receiver) } catch (_: Exception) { }
            }
        }
    }

    private fun doConnectUsb(context: Context, driver: UsbSerialDriver? = null) {
        readerJob?.cancel()
        readerJob = scope.launch {
            try {
                _state.value = ReaderState.Connecting
                closeAll()

                val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
                val selectedDriver = driver ?: UsbSerialProber.getDefaultProber()
                    .findAllDrivers(manager).firstOrNull()

                if (selectedDriver == null) {
                    _state.value = ReaderState.Error("USB cihaz bulunamadı")
                    return@launch
                }

                Log.i(TAG, "Found USB device: ${selectedDriver.device.productName} (${selectedDriver.device.vendorId}:${selectedDriver.device.productId})")

                // Request USB permission if not already granted
                val permissionGranted = requestUsbPermission(context, manager, selectedDriver.device)
                if (!permissionGranted) {
                    _state.value = ReaderState.Error("USB izni reddedildi")
                    return@launch
                }

                val connection = manager.openDevice(selectedDriver.device)
                if (connection == null) {
                    _state.value = ReaderState.Error("USB cihaz açılamadı")
                    return@launch
                }

                val port = selectedDriver.ports[0]
                port.open(connection)
                port.setParameters(SERIAL_BAUD_RATE, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
                port.dtr = true
                port.rts = true

                serialPort = port
                dataBuffer = ByteArray(0)
                lastDataReceived = System.currentTimeMillis()

                _state.value = ReaderState.Connected
                Log.i(TAG, "USB Serial connected: ${selectedDriver.device.productName}")

                // BOHANG initialization (no auto inventory)
                initBohang()

                // Stay Connected until user starts inventory
                startHeartbeat()
                startHealthCheck()

                // Read loop
                Log.i(TAG, "USB read loop starting...")
                val buffer = ByteArray(4096)
                while (isActive) {
                    val bytesRead = try {
                        port.read(buffer, 500)
                    } catch (e: Exception) {
                        Log.e(TAG, "USB read error: ${e.message}", e)
                        break
                    }
                    if (bytesRead > 0) {
                        lastDataReceived = System.currentTimeMillis()
                        Log.d(TAG, "USB received $bytesRead bytes")
                        handleData(buffer.copyOf(bytesRead))
                    }
                }
                Log.w(TAG, "USB read loop ended, isActive=$isActive")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "USB connection error: ${e.message}")
                _state.value = ReaderState.Error(e.message ?: "USB bağlantı hatası")
            } finally {
                closeAll()
                if (_state.value !is ReaderState.Disconnected) {
                    _state.value = ReaderState.Disconnected
                }
                if (userWantsConnection && connectionMode == ConnectionMode.USB_SERIAL) {
                    scheduleReconnectUsb(context)
                }
            }
        }
    }

    private fun scheduleReconnectUsb(context: Context) {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(RECONNECT_DELAY)
            if (userWantsConnection) {
                Log.i(TAG, "USB reconnecting...")
                doConnectUsb(context)
            }
        }
    }

    // ==========================================
    // TCP Connection (for network antenna)
    // ==========================================

    fun connectTcp(ip: String, port: Int = DEFAULT_PORT) {
        connectionMode = ConnectionMode.TCP
        currentIp = ip
        currentPort = port
        userWantsConnection = true
        reconnectJob?.cancel()
        doConnectTcp()
    }

    private fun doConnectTcp() {
        readerJob?.cancel()
        readerJob = scope.launch {
            try {
                _state.value = ReaderState.Connecting
                closeAll()

                val sock = Socket()
                sock.soTimeout = 0
                sock.keepAlive = true
                sock.tcpNoDelay = true
                sock.connect(InetSocketAddress(currentIp, currentPort), 10000)

                socket = sock
                tcpInput = sock.getInputStream()
                tcpOutput = sock.getOutputStream()
                dataBuffer = ByteArray(0)
                lastDataReceived = System.currentTimeMillis()

                _state.value = ReaderState.Connected
                Log.i(TAG, "TCP connected to $currentIp:$currentPort")

                initBohang()

                // Stay Connected until user starts inventory
                startHeartbeat()
                startHealthCheck()

                val buffer = ByteArray(4096)
                while (isActive && socket?.isConnected == true) {
                    val bytesRead = tcpInput?.read(buffer) ?: -1
                    if (bytesRead == -1) break
                    if (bytesRead > 0) {
                        lastDataReceived = System.currentTimeMillis()
                        handleData(buffer.copyOf(bytesRead))
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "TCP connection error: ${e.message}")
                _state.value = ReaderState.Error(e.message ?: "TCP bağlantı hatası")
            } finally {
                closeAll()
                if (_state.value !is ReaderState.Disconnected) {
                    _state.value = ReaderState.Disconnected
                }
                if (userWantsConnection && connectionMode == ConnectionMode.TCP) {
                    scheduleReconnectTcp()
                }
            }
        }
    }

    private fun scheduleReconnectTcp() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(RECONNECT_DELAY)
            if (userWantsConnection) {
                Log.i(TAG, "TCP reconnecting...")
                doConnectTcp()
            }
        }
    }

    fun scanNetwork(
        networkPrefix: String = "192.168.1",
        onProgress: (Int) -> Unit = {},
        onFound: (String) -> Unit = {}
    ): Job {
        return scope.launch {
            Log.i(TAG, "Scanning network $networkPrefix.*...")
            val priorityPorts = listOf(20058, 4001, 6000)
            var scanned = 0
            val semaphore = kotlinx.coroutines.sync.Semaphore(30)
            val jobs = (1..254).map { i ->
                launch {
                    semaphore.acquire()
                    try {
                        val ip = "$networkPrefix.$i"
                        for (port in priorityPorts) {
                            try {
                                val sock = Socket()
                                sock.connect(InetSocketAddress(ip, port), 800)
                                try {
                                    sock.soTimeout = 1000
                                    sock.getOutputStream().write(buildCommand(CMD_HEARTBEAT))
                                    val buf = ByteArray(64)
                                    val n = sock.getInputStream().read(buf)
                                    if (n > 0 && buf[0] == HEADER_H && buf[1] == HEADER_L) {
                                        withContext(Dispatchers.Main) { onFound(ip) }
                                    }
                                } finally { sock.close() }
                                break
                            } catch (_: Exception) { }
                        }
                    } finally {
                        scanned++
                        if (scanned % 10 == 0) {
                            withContext(Dispatchers.Main) { onProgress((scanned * 100) / 254) }
                        }
                        semaphore.release()
                    }
                }
            }
            jobs.forEach { it.join() }
            withContext(Dispatchers.Main) { onProgress(100) }
        }
    }

    // ==========================================
    // Common
    // ==========================================

    fun stopInventory() {
        scope.launch {
            try {
                // Send multiple times - BOHANG sometimes ignores single command
                sendCommand(CMD_STOP_INVENTORY)
                delay(100)
                sendCommand(CMD_STOP_INVENTORY)
                delay(100)
                sendCommand(CMD_STOP_INVENTORY)
                Log.i(TAG, "STOP_INVENTORY sent (3x)")
                _state.value = ReaderState.Connected
            } catch (e: Exception) {
                Log.e(TAG, "Failed to stop inventory: ${e.message}")
            }
        }
    }

    fun startInventory() {
        scope.launch {
            try {
                val mask = _antennaMask.value.toByte()
                sendCommand(CMD_START_AUTO_READ)
                delay(200)
                sendCommand(CMD_START_INVENTORY, byteArrayOf(mask))
                delay(300)
                sendCommand(CMD_START_INVENTORY)
                Log.i(TAG, "START_INVENTORY sent (antenna mask=0x${Integer.toHexString(_antennaMask.value)}, antennas: ${maskToAntennaList(_antennaMask.value)})")
                _state.value = ReaderState.Scanning
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start inventory: ${e.message}")
            }
        }
    }

    fun disconnect() {
        userWantsConnection = false
        reconnectJob?.cancel()
        heartbeatJob?.cancel()
        healthCheckJob?.cancel()
        // Send STOP_INVENTORY before closing connection
        try {
            sendCommand(CMD_STOP_INVENTORY)
            Log.i(TAG, "Sent STOP_INVENTORY")
        } catch (_: Exception) { }
        readerJob?.cancel()
        closeAll()
        _state.value = ReaderState.Disconnected
    }

    fun clearTags() {
        scannedTags.clear()
        _antennaTagCounts.value = intArrayOf(0, 0, 0, 0)
    }

    fun destroy() {
        userWantsConnection = false
        scope.cancel()
        closeAll()
    }

    private suspend fun initBohang() {
        delay(100)
        sendCommand(CMD_HEARTBEAT)
        delay(200)
        sendCommand(CMD_GET_VERSION)
        delay(200)
        val p = _antennaPower.value
        sendCommand(CMD_SET_RF_POWER, byteArrayOf(p[0].toByte(), p[1].toByte(), p[2].toByte(), p[3].toByte()))
        delay(200)
        sendCommand(CMD_SET_ANTENNA_POWER, byteArrayOf(p[0].toByte()))
        delay(200)
        Log.i(TAG, "BOHANG initialized - RF power [${p[0]},${p[1]},${p[2]},${p[3]}] dBm, antenna mask=0x${Integer.toHexString(_antennaMask.value)}")
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(HEARTBEAT_INTERVAL)
                try { sendCommand(CMD_HEARTBEAT) } catch (_: Exception) { }
            }
        }
    }

    private fun startHealthCheck() {
        healthCheckJob?.cancel()
        healthCheckJob = scope.launch {
            while (isActive) {
                delay(HEALTH_CHECK_INTERVAL)
                if (lastDataReceived > 0 &&
                    System.currentTimeMillis() - lastDataReceived > CONNECTION_TIMEOUT
                ) {
                    Log.w(TAG, "No data timeout, reconnecting")
                    closeAll()
                    break
                }
            }
        }
    }

    private fun sendCommand(cmd: Byte, data: ByteArray = ByteArray(0)) {
        val frame = buildCommand(cmd, data)
        try {
            when (connectionMode) {
                ConnectionMode.USB_SERIAL -> serialPort?.write(frame, 100)
                ConnectionMode.TCP -> { tcpOutput?.write(frame); tcpOutput?.flush() }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Send error: ${e.message}")
        }
    }

    private fun closeAll() {
        heartbeatJob?.cancel()
        healthCheckJob?.cancel()
        try { serialPort?.close() } catch (_: Exception) { }
        try { tcpInput?.close() } catch (_: Exception) { }
        try { tcpOutput?.close() } catch (_: Exception) { }
        try { socket?.close() } catch (_: Exception) { }
        serialPort = null
        socket = null
        tcpInput = null
        tcpOutput = null
    }

    // ==========================================
    // BOHANG CM Protocol
    // ==========================================

    private fun buildCommand(cmd: Byte, data: ByteArray = ByteArray(0)): ByteArray {
        val frame = ByteArray(5 + data.size + 2)
        frame[0] = HEADER_H
        frame[1] = HEADER_L
        frame[2] = cmd
        frame[3] = 0x00
        frame[4] = data.size.toByte()
        data.copyInto(frame, 5)
        frame[frame.size - 2] = 0x00
        frame[frame.size - 1] = 0x00
        return frame
    }

    private fun parseResponse(buffer: ByteArray): Pair<List<CmFrame>, ByteArray> {
        val results = mutableListOf<CmFrame>()
        var offset = 0
        while (offset < buffer.size) {
            if (buffer[offset] != HEADER_H ||
                (offset + 1 < buffer.size && buffer[offset + 1] != HEADER_L)
            ) { offset++; continue }
            if (buffer.size - offset < 5) break
            val cmd = buffer[offset + 2]
            val dataLen = buffer[offset + 4].toInt() and 0xFF
            val frameLen = 5 + dataLen
            if (buffer.size - offset < frameLen) break
            val data = buffer.copyOfRange(offset + 5, offset + 5 + dataLen)
            results.add(CmFrame(cmd, data))
            offset += frameLen
            while (offset < buffer.size && buffer[offset] == 0x00.toByte() &&
                (offset + 1 >= buffer.size || buffer[offset + 1] != HEADER_L)) { offset++ }
        }
        val remaining = if (offset < buffer.size) buffer.copyOfRange(offset, buffer.size) else ByteArray(0)
        return Pair(results, remaining)
    }

    private fun handleData(data: ByteArray) {
        dataBuffer = dataBuffer + data
        if (dataBuffer.size > 8192) {
            dataBuffer = dataBuffer.copyOfRange(dataBuffer.size - 4096, dataBuffer.size)
        }
        val (frames, remaining) = parseResponse(dataBuffer)
        dataBuffer = remaining
        val foundInPacket = mutableSetOf<String>()
        for (frame in frames) {
            if (frame.cmd == CMD_HEARTBEAT) {
                try { sendCommand(CMD_HEARTBEAT) } catch (_: Exception) { }
                continue
            }
            if (frame.data.size >= 12) {
                val epc = extractEpc(frame.data)
                if (epc != null && epc !in foundInPacket) {
                    foundInPacket.add(epc)
                    val existing = scannedTags[epc]
                    // BOHANG: first byte of inventory response is often antenna number
                    val antenna = if (frame.data.isNotEmpty()) (frame.data[0].toInt() and 0x0F) else 0
                    val rssi = if (frame.data.size >= 2) (frame.data[frame.data.size - 1].toInt()) else -50
                    val tag = RfidTag(epc, rssi, (existing?.count ?: 0) + 1, antenna, System.currentTimeMillis())
                    scannedTags[epc] = tag
                    _tags.tryEmit(tag)
                    // Update per-antenna tag count
                    if (antenna in 1..4) {
                        val counts = _antennaTagCounts.value.copyOf()
                        counts[antenna - 1]++
                        _antennaTagCounts.value = counts
                    }
                }
            }
        }
    }

    private fun extractEpc(data: ByteArray): String? {
        if (data.size < 12) return null
        try {
            val rawHex = data.toHexString()
            val knownPrefixes = listOf("9034", "903425", "E200", "E280", "3000", "3400", "AD00")
            for (prefix in knownPrefixes) {
                val idx = rawHex.indexOf(prefix)
                if (idx != -1 && rawHex.length >= idx + 24) return rawHex.substring(idx, idx + 24)
            }
            var epcStartOffset = 0
            if (data.size >= 16) {
                val pc = ((data[1].toInt() and 0xFF) shl 8) or (data[2].toInt() and 0xFF)
                if ((pc and 0xF800) in 0x1000..0x7800) epcStartOffset = 3
            }
            if (epcStartOffset == 0 && data.size >= 14) {
                val pc = ((data[0].toInt() and 0xFF) shl 8) or (data[1].toInt() and 0xFF)
                if ((pc and 0xF800) in 0x1000..0x7800) epcStartOffset = 2
            }
            if (data.size - epcStartOffset >= 12) {
                val epcHex = data.copyOfRange(epcStartOffset, epcStartOffset + 12).toHexString()
                if (epcHex != "000000000000000000000000" && epcHex != "FFFFFFFFFFFFFFFFFFFFFFFF") return epcHex
            }
            if (rawHex.length >= 24) {
                for (startPos in 2..6 step 2) {
                    if (startPos + 24 <= rawHex.length) {
                        val candidate = rawHex.substring(startPos, startPos + 24)
                        if (candidate != "000000000000000000000000" && candidate != "FFFFFFFFFFFFFFFFFFFFFFFF" && !candidate.all { it == '0' })
                            return candidate
                    }
                }
            }
            return null
        } catch (e: Exception) {
            Log.e(TAG, "EPC extraction error: ${e.message}")
            return null
        }
    }

    private data class CmFrame(val cmd: Byte, val data: ByteArray)
}

private fun ByteArray.toHexString(): String = joinToString("") { "%02X".format(it) }
