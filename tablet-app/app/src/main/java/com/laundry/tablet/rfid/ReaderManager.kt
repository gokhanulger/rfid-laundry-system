package com.laundry.tablet.rfid

import android.content.Context
import android.hardware.usb.UsbManager
import android.util.Log
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.FtdiSerialDriver
import com.hoho.android.usbserial.driver.ProbeTable
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialProber
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class ReaderType {
    BOHANG,   // BOHANG CM protocol - FT232R/CH340, 115200 baud
    MW8817    // MW-8817 MM protocol - CDC ACM, 57600 baud
}

/**
 * Manages RFID reader auto-detection and delegates to the appropriate protocol handler.
 *
 * Detection logic:
 * - FTDI (FT232R) / CH340 drivers -> Bohang CM protocol (115200 baud)
 * - CDC ACM driver -> MW-8817 MM protocol (57600 baud)
 * - TCP connection -> tries Bohang first (legacy), can be overridden
 */
@Singleton
class ReaderManager @Inject constructor(
    private val bohangReader: BohangReader,
    private val mmReader: MMReader
) : RfidReader {

    companion object {
        private const val TAG = "ReaderManager"

        // MW-8817 USB VID/PID (Microchip CDC ACM)
        private const val MW8817_VID = 0x04D8
        private const val MW8817_PID = 0x033F

        /**
         * Custom prober that includes both default drivers AND CDC ACM for MW-8817.
         * The default prober only supports FTDI, CH34x, CP210x, Prolific.
         */
        fun createProber(): UsbSerialProber {
            val table = ProbeTable()
            // Add MW-8817 as CDC ACM
            table.addProduct(MW8817_VID, MW8817_PID, CdcAcmSerialDriver::class.java)
            return UsbSerialProber(table)
        }

        fun findAllDrivers(manager: UsbManager): List<UsbSerialDriver> {
            // Try default prober first (FTDI, CH340, CP210x, Prolific)
            val defaultDrivers = UsbSerialProber.getDefaultProber().findAllDrivers(manager)
            // Then try custom prober for CDC ACM devices (MW-8817)
            val customDrivers = createProber().findAllDrivers(manager)
            // Merge, avoiding duplicates
            val allDrivers = defaultDrivers.toMutableList()
            for (d in customDrivers) {
                if (allDrivers.none { it.device.deviceId == d.device.deviceId }) {
                    allDrivers.add(d)
                }
            }
            return allDrivers
        }
    }

    private var activeReader: RfidReader = bohangReader
    private var _detectedType: ReaderType = ReaderType.BOHANG

    val detectedType: ReaderType get() = _detectedType

    // Delegate all StateFlow/SharedFlow to active reader
    override val state: StateFlow<ReaderState> get() = activeReader.state
    override val tags: SharedFlow<RfidTag> get() = activeReader.tags
    override val allTags: Map<String, RfidTag> get() = activeReader.allTags
    override val antennaMask: StateFlow<Int> get() = activeReader.antennaMask
    override val antennaPower: StateFlow<IntArray> get() = activeReader.antennaPower
    override val antennaTagCounts: StateFlow<IntArray> get() = activeReader.antennaTagCounts

    override fun setAntennaMask(mask: Int) = activeReader.setAntennaMask(mask)
    override fun setAntennaPower(antennaIndex: Int, power: Int) = activeReader.setAntennaPower(antennaIndex, power)
    override fun setAllAntennaPower(power: Int) = activeReader.setAllAntennaPower(power)

    override fun findUsbDevices(context: Context): List<UsbSerialDriver> {
        val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        return findAllDrivers(manager)
    }

    /**
     * Auto-detect reader type and connect.
     * First checks for MW-8817 by VID/PID (USB HID device, not serial).
     * Then checks serial drivers for Bohang.
     */
    override fun connectUsb(context: Context, driver: UsbSerialDriver?) {
        val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        // First check: MW-8817 by VID/PID (USB HID, not serial driver)
        val mw8817Device = manager.deviceList.values.find {
            it.vendorId == MMReader.MW8817_VID && it.productId == MMReader.MW8817_PID
        }
        if (mw8817Device != null) {
            switchReader(ReaderType.MW8817)
            Log.i(TAG, "Auto-detected: MW8817 by VID/PID (${mw8817Device.productName})")
            mmReader.connectUsb(context, null) // MMReader finds device by VID/PID itself
            return
        }

        // Second check: serial drivers (Bohang, etc.)
        val selectedDriver = driver ?: findAllDrivers(manager).firstOrNull()
        if (selectedDriver == null) {
            Log.w(TAG, "No USB reader found")
            activeReader = bohangReader
            _detectedType = ReaderType.BOHANG
            bohangReader.connectUsb(context, null)
            return
        }

        val type = detectReaderType(selectedDriver)
        switchReader(type)
        Log.i(TAG, "Auto-detected: $type (driver: ${selectedDriver.javaClass.simpleName}, device: ${selectedDriver.device.productName})")
        activeReader.connectUsb(context, selectedDriver)
    }

    override fun connectTcp(ip: String, port: Int) {
        // TCP: default to Bohang (legacy), user can override via forceReaderType
        Log.i(TAG, "TCP connect to $ip:$port using $_detectedType")
        activeReader.connectTcp(ip, port)
    }

    override fun disconnect() = activeReader.disconnect()
    override fun startInventory() = activeReader.startInventory()
    override fun stopInventory() = activeReader.stopInventory()
    override fun clearTags() = activeReader.clearTags()
    override fun destroy() {
        bohangReader.destroy()
        mmReader.destroy()
    }

    override fun scanNetwork(
        networkPrefix: String,
        onProgress: (Int) -> Unit,
        onFound: (String) -> Unit
    ): Job = activeReader.scanNetwork(networkPrefix, onProgress, onFound)

    /**
     * Force a specific reader type (e.g., for TCP connections or manual override).
     */
    fun forceReaderType(type: ReaderType) {
        if (_detectedType != type) {
            activeReader.disconnect()
            switchReader(type)
            Log.i(TAG, "Reader type forced to: $type")
        }
    }

    private fun switchReader(type: ReaderType) {
        _detectedType = type
        activeReader = when (type) {
            ReaderType.BOHANG -> bohangReader
            ReaderType.MW8817 -> mmReader
        }
    }

    /**
     * Detect reader type based on USB serial driver class.
     * - FtdiSerialDriver -> Bohang (FT232R chip)
     * - CdcAcmSerialDriver -> MW-8817 (CDC ACM / USB modem)
     * - Others -> check VID/PID, default to Bohang
     */
    private fun detectReaderType(driver: UsbSerialDriver): ReaderType {
        // Check driver class
        return when (driver) {
            is FtdiSerialDriver -> {
                Log.i(TAG, "FTDI driver detected -> Bohang CM protocol")
                ReaderType.BOHANG
            }
            is CdcAcmSerialDriver -> {
                Log.i(TAG, "CDC ACM driver detected -> MW-8817 MM protocol")
                ReaderType.MW8817
            }
            else -> {
                // Fallback: check VID/PID
                val vid = driver.device.vendorId
                val pid = driver.device.productId
                Log.i(TAG, "Unknown driver: ${driver.javaClass.simpleName} VID=0x${"%04X".format(vid)} PID=0x${"%04X".format(pid)}")

                // FTDI VID=0x0403, CH340 VID=0x1A86
                if (vid == 0x0403 || vid == 0x1A86) {
                    ReaderType.BOHANG
                } else {
                    // Default to MW-8817 for unknown CDC-like devices
                    ReaderType.MW8817
                }
            }
        }
    }
}
