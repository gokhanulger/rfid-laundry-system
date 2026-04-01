package com.laundry.tablet.rfid

import android.content.Context
import com.hoho.android.usbserial.driver.UsbSerialDriver
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Common interface for UHF RFID readers (Bohang CM, MW-8817 MM, etc.)
 */
interface RfidReader {

    val state: StateFlow<ReaderState>
    val tags: SharedFlow<RfidTag>
    val allTags: Map<String, RfidTag>

    val antennaMask: StateFlow<Int>
    val antennaPower: StateFlow<IntArray>
    val antennaTagCounts: StateFlow<IntArray>

    fun setAntennaMask(mask: Int)
    fun setAntennaPower(antennaIndex: Int, power: Int)
    fun setAllAntennaPower(power: Int)

    fun findUsbDevices(context: Context): List<UsbSerialDriver>
    fun connectUsb(context: Context, driver: UsbSerialDriver? = null)
    fun connectTcp(ip: String, port: Int = 20058)
    fun disconnect()

    fun startInventory()
    fun stopInventory()
    fun clearTags()
    fun destroy()

    fun scanNetwork(
        networkPrefix: String = "192.168.1",
        onProgress: (Int) -> Unit = {},
        onFound: (String) -> Unit = {}
    ): Job
}
