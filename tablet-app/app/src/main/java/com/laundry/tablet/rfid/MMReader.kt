package com.laundry.tablet.rfid

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import com.hoho.android.usbserial.driver.UsbSerialDriver
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.suspendCancellableCoroutine
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * MW-8817 UHF RFID Reader over USB HID.
 * Uses CM protocol (same as Bohang): Header 'C''M', BCC checksum.
 * Supports StartAutoRead (0x2E) for continuous inventory.
 */
@Singleton
class MMReader @Inject constructor() : RfidReader {

    companion object {
        private const val TAG = "MMReader"
        private const val ACTION_USB_PERMISSION = "com.laundry.tablet.USB_PERMISSION_MM"
        private const val DEFAULT_TCP_PORT = 20058
        private const val RECONNECT_DELAY = 5000L
        private const val USB_TIMEOUT = 30

        const val MW8817_VID = 0x04D8
        const val MW8817_PID = 0x033F

        // CM Protocol - same as Bohang
        private const val HEADER_H = 0x43.toByte() // 'C'
        private const val HEADER_L = 0x4D.toByte() // 'M'

        // Command codes (from EraLink SDK)
        private const val CMD_HEARTBEAT: Byte = 0x10
        private const val CMD_START_INVENTORY: Byte = 0x2A
        private const val CMD_STOP_INVENTORY: Byte = 0x2B
        private const val CMD_START_AUTO_READ: Byte = 0x2E
        private const val CMD_STOP_AUTO_READ: Byte = 0x2F
        private const val CMD_GET_VERSION: Byte = 0x31
        private const val CMD_SET_ANT_CONFIG: Byte = 0x33
        private const val CMD_GET_ANT_CONFIG: Byte = 0x32
        private const val CMD_SET_RF_POWER: Byte = 0x76
    }

    private val _state = MutableStateFlow<ReaderState>(ReaderState.Disconnected)
    override val state: StateFlow<ReaderState> = _state.asStateFlow()

    private val _tags = MutableSharedFlow<RfidTag>(extraBufferCapacity = 100)
    override val tags: SharedFlow<RfidTag> = _tags.asSharedFlow()

    private val scannedTags = ConcurrentHashMap<String, RfidTag>()
    override val allTags: Map<String, RfidTag> get() = scannedTags.toMap()

    private val _antennaMask = MutableStateFlow(0x03)
    override val antennaMask: StateFlow<Int> = _antennaMask.asStateFlow()

    private val _antennaPower = MutableStateFlow(intArrayOf(30, 30, 30, 30))
    override val antennaPower: StateFlow<IntArray> = _antennaPower.asStateFlow()

    private val _antennaTagCounts = MutableStateFlow(intArrayOf(0, 0, 0, 0))
    override val antennaTagCounts: StateFlow<IntArray> = _antennaTagCounts.asStateFlow()

    private var dataBuffer = ByteArray(0)

    // TCP fields
    private var socket: Socket? = null
    private var tcpInput: java.io.InputStream? = null
    private var tcpOutput: java.io.OutputStream? = null

    // USB HID fields
    private var usbConnection: UsbDeviceConnection? = null
    private var usbInterface: UsbInterface? = null
    private var endpointIn: UsbEndpoint? = null
    private var endpointOut: UsbEndpoint? = null
    private var connectionMode: ConnectionMode = ConnectionMode.USB_SERIAL

    private var readerJob: Job? = null
    private var reconnectJob: Job? = null
    private var inventoryPollJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var currentIp: String = ""
    private var currentPort: Int = DEFAULT_TCP_PORT
    private var userWantsConnection = false
    private var lastDataReceived: Long = 0
    private var isInventoryRunning = false

    // ==========================================
    // Antenna Configuration
    // ==========================================

    override fun setAntennaMask(mask: Int) {
        _antennaMask.value = mask and 0x0F
        Log.i(TAG, "Antenna mask set: 0x${Integer.toHexString(mask)} -> ${maskToAntennaList(mask)}")
    }

    override fun setAntennaPower(antennaIndex: Int, power: Int) {
        val p = _antennaPower.value.copyOf()
        p[antennaIndex] = power.coerceIn(0, 33)
        _antennaPower.value = p
        scope.launch { try { sendSetRfPower() } catch (_: Exception) {} }
    }

    override fun setAllAntennaPower(power: Int) {
        val p = power.coerceIn(0, 33)
        _antennaPower.value = intArrayOf(p, p, p, p)
        scope.launch { try { sendSetRfPower() } catch (_: Exception) {} }
    }

    private fun maskToAntennaList(mask: Int): String {
        return (1..4).filter { (mask shr (it - 1)) and 1 == 1 }.joinToString(", ") { "Ant$it" }
    }

    // ==========================================
    // USB HID Connection
    // ==========================================

    override fun findUsbDevices(context: Context): List<UsbSerialDriver> {
        val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        return ReaderManager.findAllDrivers(manager)
    }

    override fun connectUsb(context: Context, driver: UsbSerialDriver?) {
        connectionMode = ConnectionMode.USB_SERIAL
        userWantsConnection = true
        reconnectJob?.cancel()
        doConnectUsb(context)
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
            else PendingIntent.FLAG_UPDATE_CURRENT
            manager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
            cont.invokeOnCancellation {
                try { context.unregisterReceiver(receiver) } catch (_: Exception) { }
            }
        }
    }

    private fun doConnectUsb(context: Context) {
        readerJob?.cancel()
        readerJob = scope.launch {
            try {
                _state.value = ReaderState.Connecting
                closeAll()

                val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
                val device = manager.deviceList.values.find {
                    it.vendorId == MW8817_VID && it.productId == MW8817_PID
                }
                if (device == null) {
                    _state.value = ReaderState.Error("MW-8817 USB cihaz bulunamadi")
                    return@launch
                }

                val permissionGranted = requestUsbPermission(context, manager, device)
                if (!permissionGranted) {
                    _state.value = ReaderState.Error("USB izni reddedildi")
                    return@launch
                }

                val connection = manager.openDevice(device) ?: run {
                    _state.value = ReaderState.Error("USB cihaz acilamadi")
                    return@launch
                }

                // Find HID interface with interrupt endpoints
                var foundInterface: UsbInterface? = null
                var foundIn: UsbEndpoint? = null
                var foundOut: UsbEndpoint? = null

                for (i in 0 until device.interfaceCount) {
                    val intf = device.getInterface(i)
                    var tmpIn: UsbEndpoint? = null
                    var tmpOut: UsbEndpoint? = null
                    for (j in 0 until intf.endpointCount) {
                        val ep = intf.getEndpoint(j)
                        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_INT) {
                            if (ep.direction == UsbConstants.USB_DIR_IN) tmpIn = ep
                            else tmpOut = ep
                        }
                    }
                    if (tmpIn != null && tmpOut != null) {
                        foundInterface = intf; foundIn = tmpIn; foundOut = tmpOut; break
                    }
                }

                if (foundInterface == null || foundIn == null || foundOut == null) {
                    connection.close()
                    _state.value = ReaderState.Error("USB HID endpoint bulunamadi")
                    return@launch
                }

                if (!connection.claimInterface(foundInterface, true)) {
                    connection.close()
                    _state.value = ReaderState.Error("USB interface alinamadi")
                    return@launch
                }

                usbConnection = connection
                usbInterface = foundInterface
                endpointIn = foundIn
                endpointOut = foundOut
                dataBuffer = ByteArray(0)
                lastDataReceived = System.currentTimeMillis()

                _state.value = ReaderState.Connected
                Log.i(TAG, "USB HID connected: ${device.productName}")

                // Initialize with CM protocol
                initReader()

                // USB HID read loop
                val maxPkt = foundIn.maxPacketSize
                val buffer = ByteArray(maxPkt)
                while (isActive) {
                    val bytesRead = connection.bulkTransfer(foundIn, buffer, maxPkt, USB_TIMEOUT)
                    if (bytesRead > 0) {
                        lastDataReceived = System.currentTimeMillis()
                        // HID framing: first byte = data length
                        val dataLen = buffer[0].toInt() and 0xFF
                        if (dataLen > 0 && dataLen < bytesRead) {
                            handleData(buffer.copyOfRange(1, 1 + dataLen))
                        }
                    } else if (bytesRead < 0 && usbConnection == null) {
                        break
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "USB error: ${e.message}", e)
                _state.value = ReaderState.Error("USB baglanti hatasi: ${e.message}")
            } finally {
                closeAll()
                if (_state.value !is ReaderState.Disconnected) _state.value = ReaderState.Disconnected
                if (userWantsConnection && connectionMode == ConnectionMode.USB_SERIAL) {
                    reconnectJob = scope.launch { delay(RECONNECT_DELAY); if (userWantsConnection) doConnectUsb(context) }
                }
            }
        }
    }

    private fun usbWrite(data: ByteArray) {
        val conn = usbConnection ?: return
        val ep = endpointOut ?: return
        val maxPkt = ep.maxPacketSize
        val padded = ByteArray(maxPkt)
        padded[0] = data.size.toByte()
        data.copyInto(padded, 1, 0, minOf(data.size, maxPkt - 1))
        conn.bulkTransfer(ep, padded, padded.size, USB_TIMEOUT)
    }

    // ==========================================
    // TCP Connection
    // ==========================================

    override fun connectTcp(ip: String, port: Int) {
        connectionMode = ConnectionMode.TCP
        currentIp = ip; currentPort = port
        userWantsConnection = true; reconnectJob?.cancel()
        doConnectTcp()
    }

    private fun doConnectTcp() {
        readerJob?.cancel()
        readerJob = scope.launch {
            try {
                _state.value = ReaderState.Connecting; closeAll()
                val sock = Socket().apply { soTimeout = 0; keepAlive = true; tcpNoDelay = true }
                sock.connect(InetSocketAddress(currentIp, currentPort), 10000)
                socket = sock; tcpInput = sock.getInputStream(); tcpOutput = sock.getOutputStream()
                dataBuffer = ByteArray(0); lastDataReceived = System.currentTimeMillis()
                _state.value = ReaderState.Connected
                initReader()
                val buffer = ByteArray(4096)
                while (isActive && socket?.isConnected == true) {
                    val n = tcpInput?.read(buffer) ?: -1
                    if (n == -1) break
                    if (n > 0) { lastDataReceived = System.currentTimeMillis(); handleData(buffer.copyOf(n)) }
                }
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                _state.value = ReaderState.Error("Anten baglantisi kurulamadi")
            } finally {
                closeAll()
                if (_state.value !is ReaderState.Disconnected) _state.value = ReaderState.Disconnected
                if (userWantsConnection && connectionMode == ConnectionMode.TCP) {
                    reconnectJob = scope.launch { delay(RECONNECT_DELAY); if (userWantsConnection) doConnectTcp() }
                }
            }
        }
    }

    override fun scanNetwork(networkPrefix: String, onProgress: (Int) -> Unit, onFound: (String) -> Unit): Job {
        return scope.launch {
            val semaphore = kotlinx.coroutines.sync.Semaphore(30)
            var scanned = 0
            val jobs = (1..254).map { i ->
                launch {
                    semaphore.acquire()
                    try {
                        val ip = "$networkPrefix.$i"
                        for (port in listOf(20058, 4001, 6000)) {
                            try {
                                val sock = Socket(); sock.connect(InetSocketAddress(ip, port), 800)
                                try {
                                    sock.soTimeout = 1000
                                    sock.getOutputStream().write(buildCmCommand(CMD_HEARTBEAT))
                                    val buf = ByteArray(64); val n = sock.getInputStream().read(buf)
                                    if (n > 0 && buf[0] == HEADER_H && buf[1] == HEADER_L) {
                                        withContext(Dispatchers.Main) { onFound(ip) }
                                    }
                                } finally { sock.close() }
                                break
                            } catch (_: Exception) {}
                        }
                    } finally {
                        scanned++
                        if (scanned % 10 == 0) withContext(Dispatchers.Main) { onProgress((scanned * 100) / 254) }
                        semaphore.release()
                    }
                }
            }
            jobs.forEach { it.join() }
            withContext(Dispatchers.Main) { onProgress(100) }
        }
    }

    // ==========================================
    // Inventory - CM Protocol (continuous auto-read)
    // ==========================================

    override fun startInventory() {
        isInventoryRunning = true
        _state.value = ReaderState.Scanning
        scope.launch {
            // Send StartAutoRead - reader continuously sends tag data
            sendCmCommand(CMD_START_AUTO_READ)
            Log.i(TAG, "START_AUTO_READ sent")
        }
    }

    override fun stopInventory() {
        isInventoryRunning = false
        inventoryPollJob?.cancel()
        scope.launch {
            // Send stop 3x to ensure it stops
            sendCmCommand(CMD_STOP_INVENTORY)
            delay(50)
            sendCmCommand(CMD_STOP_INVENTORY)
            delay(50)
            sendCmCommand(CMD_STOP_INVENTORY)
        }
        _state.value = ReaderState.Connected
        Log.i(TAG, "STOP_INVENTORY sent")
    }

    override fun clearTags() {
        scannedTags.clear()
        _antennaTagCounts.value = intArrayOf(0, 0, 0, 0)
    }

    override fun disconnect() {
        userWantsConnection = false; isInventoryRunning = false
        reconnectJob?.cancel(); inventoryPollJob?.cancel()
        try { sendCmCommand(CMD_STOP_INVENTORY) } catch (_: Exception) {}
        readerJob?.cancel(); closeAll()
        _state.value = ReaderState.Disconnected
    }

    override fun destroy() {
        userWantsConnection = false; isInventoryRunning = false
        scope.cancel(); closeAll()
    }

    // ==========================================
    // CM Protocol: Commands
    // ==========================================

    private suspend fun initReader() {
        delay(200)
        sendCmCommand(CMD_HEARTBEAT)
        delay(200)
        sendCmCommand(CMD_GET_VERSION)
        delay(200)
        sendSetRfPower()
        delay(200)
        Log.i(TAG, "Reader initialized (CM protocol) - RF power ${_antennaPower.value[0]} dBm")
    }

    /**
     * CM protocol frame: 'C' 'M' CMD ADDR LEN_LO LEN_HI [PAYLOAD] BCC
     * BCC = XOR of all payload bytes
     */
    private fun buildCmCommand(cmd: Byte, payload: ByteArray = ByteArray(0)): ByteArray {
        val frame = ByteArray(7 + payload.size)
        frame[0] = HEADER_H               // 'C'
        frame[1] = HEADER_L               // 'M'
        frame[2] = cmd                     // Command code
        frame[3] = 0x00                    // Address
        frame[4] = (payload.size and 0xFF).toByte()  // Length LSB
        frame[5] = ((payload.size shr 8) and 0xFF).toByte() // Length MSB
        payload.copyInto(frame, 6)
        // BCC: XOR of payload bytes
        var bcc: Byte = 0
        for (b in payload) { bcc = (bcc.toInt() xor b.toInt()).toByte() }
        frame[frame.size - 1] = bcc
        return frame
    }

    private fun sendCmCommand(cmd: Byte, payload: ByteArray = ByteArray(0)) {
        val frame = buildCmCommand(cmd, payload)
        Log.d(TAG, "TX cmd=0x${"%02X".format(cmd)} len=${frame.size}")
        when (connectionMode) {
            ConnectionMode.USB_SERIAL -> usbWrite(frame)
            ConnectionMode.TCP -> { tcpOutput?.write(frame); tcpOutput?.flush() }
        }
    }

    private fun sendSetRfPower() {
        val p = _antennaPower.value
        sendCmCommand(CMD_SET_RF_POWER, byteArrayOf(p[0].toByte(), p[1].toByte(), p[2].toByte(), p[3].toByte()))
    }

    // ==========================================
    // CM Protocol: Response Parsing
    // ==========================================

    private fun handleData(data: ByteArray) {
        lastDataReceived = System.currentTimeMillis()
        dataBuffer = dataBuffer + data
        if (dataBuffer.size > 8192) {
            dataBuffer = dataBuffer.copyOfRange(dataBuffer.size - 4096, dataBuffer.size)
        }
        val (frames, remaining) = parseCmFrames(dataBuffer)
        dataBuffer = remaining
        for (frame in frames) {
            processCmFrame(frame)
        }
    }

    private fun parseCmFrames(buffer: ByteArray): Pair<List<CmFrame>, ByteArray> {
        val results = mutableListOf<CmFrame>()
        var offset = 0
        while (offset < buffer.size) {
            if (buffer[offset] != HEADER_H || (offset + 1 < buffer.size && buffer[offset + 1] != HEADER_L)) {
                offset++; continue
            }
            if (buffer.size - offset < 7) break
            val cmd = buffer[offset + 2]
            val lenLo = buffer[offset + 4].toInt() and 0xFF
            val lenHi = buffer[offset + 5].toInt() and 0xFF
            val dataLen = lenLo or (lenHi shl 8)
            val frameLen = 7 + dataLen
            if (buffer.size - offset < frameLen) break
            val payload = if (dataLen > 0) buffer.copyOfRange(offset + 6, offset + 6 + dataLen) else ByteArray(0)
            results.add(CmFrame(cmd, payload))
            offset += frameLen
            // Skip trailing zeros
            while (offset < buffer.size && buffer[offset] == 0x00.toByte() &&
                (offset + 1 >= buffer.size || buffer[offset + 1] != HEADER_L)) { offset++ }
        }
        val remaining = if (offset < buffer.size) buffer.copyOfRange(offset, buffer.size) else ByteArray(0)
        return Pair(results, remaining)
    }

    private fun processCmFrame(frame: CmFrame) {
        if (frame.cmd == CMD_HEARTBEAT || frame.cmd == CMD_GET_VERSION) return

        // Tag data - same parsing as BohangReader
        if (frame.data.size >= 12) {
            val epc = extractEpc(frame.data)
            if (epc != null) {
                val antenna = if (frame.data.isNotEmpty()) (frame.data[0].toInt() and 0x0F) else 0
                val rssi = if (frame.data.size >= 2) frame.data[frame.data.size - 1].toInt() else -50
                emitTag(epc, rssi, antenna)
            }
        }
    }

    private fun extractEpc(data: ByteArray): String? {
        if (data.size < 12) return null
        try {
            val rawHex = data.joinToString("") { "%02X".format(it) }
            val knownPrefixes = listOf("9034", "903425", "E200", "E280", "3000", "3400", "AD00")
            for (prefix in knownPrefixes) {
                val idx = rawHex.indexOf(prefix)
                if (idx != -1 && rawHex.length >= idx + 24) return rawHex.substring(idx, idx + 24)
            }
            // Try PC word parsing
            if (data.size >= 16) {
                val pc = ((data[1].toInt() and 0xFF) shl 8) or (data[2].toInt() and 0xFF)
                if ((pc and 0xF800) in 0x1000..0x7800) {
                    val epcHex = data.copyOfRange(3, 3 + 12).joinToString("") { "%02X".format(it) }
                    if (!epcHex.all { it == '0' }) return epcHex
                }
            }
            if (data.size >= 14) {
                val pc = ((data[0].toInt() and 0xFF) shl 8) or (data[1].toInt() and 0xFF)
                if ((pc and 0xF800) in 0x1000..0x7800) {
                    val epcHex = data.copyOfRange(2, 2 + 12).joinToString("") { "%02X".format(it) }
                    if (!epcHex.all { it == '0' }) return epcHex
                }
            }
            // Fallback: scan for 12-byte sequences
            for (startPos in 2..6 step 2) {
                if (startPos + 24 <= rawHex.length) {
                    val candidate = rawHex.substring(startPos, startPos + 24)
                    if (!candidate.all { it == '0' } && !candidate.all { it == 'F' }) return candidate
                }
            }
            return null
        } catch (_: Exception) { return null }
    }

    private fun emitTag(epc: String, rssi: Int, antenna: Int) {
        if (epc.isEmpty() || epc.all { it == '0' } || epc.all { it == 'F' }) return
        val existing = scannedTags[epc]
        val isNew = existing == null
        val antNum = if (antenna == 0) 1 else antenna
        val tag = RfidTag(epc, rssi, (existing?.count ?: 0) + 1, antNum, System.currentTimeMillis())
        scannedTags[epc] = tag
        _tags.tryEmit(tag)
        if (antNum in 1..4) {
            val counts = _antennaTagCounts.value.copyOf()
            counts[antNum - 1]++
            _antennaTagCounts.value = counts
        }
        if (isNew) Log.i(TAG, "New tag: $epc ANT=$antNum")
    }

    private fun closeAll() {
        inventoryPollJob?.cancel()
        try { usbInterface?.let { usbConnection?.releaseInterface(it) } } catch (_: Exception) {}
        try { usbConnection?.close() } catch (_: Exception) {}
        try { tcpInput?.close() } catch (_: Exception) {}
        try { tcpOutput?.close() } catch (_: Exception) {}
        try { socket?.close() } catch (_: Exception) {}
        usbConnection = null; usbInterface = null; endpointIn = null; endpointOut = null
        socket = null; tcpInput = null; tcpOutput = null
    }

    private data class CmFrame(val cmd: Byte, val data: ByteArray)
}
