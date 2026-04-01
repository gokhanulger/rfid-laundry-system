package com.laundry.tablet.ui.home

import android.content.Context
import android.util.Log
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.tablet.data.Repository
import com.laundry.tablet.data.SyncState
import com.laundry.tablet.data.TenantDto
import com.laundry.tablet.data.friendlyError
import com.laundry.tablet.di.AppModule
import com.laundry.tablet.rfid.ReaderManager
import com.laundry.tablet.rfid.ReaderState
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// ==========================================
// HomeViewModel
// ==========================================
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: Repository,
    val reader: ReaderManager,
    @dagger.hilt.android.qualifiers.ApplicationContext private val appContext: Context
) : ViewModel() {

    private val _tenants = MutableStateFlow<List<TenantDto>>(emptyList())
    val tenants: StateFlow<List<TenantDto>> = _tenants.asStateFlow()

    private val _loadedTenantIds = MutableStateFlow<Set<String>>(emptySet())
    val loadedTenantIds: StateFlow<Set<String>> = _loadedTenantIds.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isLoggedIn = MutableStateFlow(AppModule.authToken != null)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    private val _loginError = MutableStateFlow<String?>(null)
    val loginError: StateFlow<String?> = _loginError.asStateFlow()

    private val _readerIp = MutableStateFlow("192.168.1.155")
    val readerIp: StateFlow<String> = _readerIp.asStateFlow()

    val syncState = repository.syncState
    val itemCount = repository.itemCount
    val isOnline = repository.isOnline
    val pendingCount = repository.pendingCount

    private var autoSyncJob: Job? = null

    private val prefs = appContext.getSharedPreferences("reader_settings", Context.MODE_PRIVATE)

    init {
        // Restore saved antenna mask
        val savedMask = prefs.getInt("antenna_mask", 0x03)
        reader.setAntennaMask(savedMask)

        if (AppModule.authToken != null) {
            _isLoggedIn.value = true
            loadTenants()
            syncItemsToLocal()
        } else {
            autoLogin()
        }
        startAutoSync()
        autoConnectUsb()
        watchNetwork()
    }

    fun saveAntennaMask(mask: Int) {
        reader.setAntennaMask(mask)
        prefs.edit().putInt("antenna_mask", mask).apply()
    }

    private fun autoConnectUsb() {
        viewModelScope.launch {
            // Wait a moment for USB subsystem to be ready
            delay(1000)
            val state = reader.state.value
            if (state is ReaderState.Disconnected || state is ReaderState.Error) {
                val drivers = reader.findUsbDevices(appContext)
                if (drivers.isNotEmpty()) {
                    Log.i("HomeVM", "Auto-connecting USB: ${drivers[0].device.productName}")
                    reader.connectUsb(appContext, drivers[0])
                }
            }
        }
    }

    private fun watchNetwork() {
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i("HomeVM", "Network available - triggering auto sync")
                viewModelScope.launch {
                    delay(2000) // Wait for connection to stabilize
                    if (_isLoggedIn.value) {
                        repository.syncItems(force = false)
                    } else {
                        autoLogin()
                    }
                }
            }
        })
    }

    private fun startAutoSync() {
        autoSyncJob?.cancel()
        autoSyncJob = viewModelScope.launch {
            while (true) {
                delay(6 * 60 * 60 * 1000L) // 6 hours
                if (_isLoggedIn.value) {
                    android.util.Log.i("HomeVM", "Auto-sync triggered (6h interval)")
                    repository.syncItems(force = true)
                }
            }
        }
    }

    fun syncItemsToLocal(force: Boolean = false) {
        viewModelScope.launch {
            repository.syncItems(force = force)
        }
    }

    private fun autoLogin() {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val response = repository.login("driver@laundry.com", "driver123")
                AppModule.authToken = response.token
                _isLoggedIn.value = true
                loadTenants()
                syncItemsToLocal()
            } catch (e: Exception) {
                Log.w("HomeVM", "Login failed (offline?): ${e.message}")
                // Offline mode: check if we have local data
                val localItemCount = try { repository.getLocalItemCount() } catch (_: Exception) { 0 }
                if (localItemCount > 0) {
                    Log.i("HomeVM", "Offline mode: $localItemCount items in local DB")
                    _isLoggedIn.value = true // Allow access with local data
                    loadTenants() // Will load from local DB
                    _loginError.value = null
                } else {
                    _loginError.value = "${friendlyError(e)}\nHenuz yerel veri yok - ilk kullanim icin internet gerekli."
                }
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun retryLogin() {
        autoLogin()
    }

    fun loadTenants() {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                _tenants.value = repository.getTenants(forceRefresh = true)
                _loadedTenantIds.value = repository.getLoadedTenantIds().toSet()
            } catch (e: Exception) {
                // Keep cached
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun refreshLoadedTenants() {
        viewModelScope.launch {
            try {
                _loadedTenantIds.value = repository.getLoadedTenantIds().toSet()
            } catch (_: Exception) {}
        }
    }

    fun connectReaderUsb(context: Context) {
        reader.connectUsb(context)
    }

    fun connectReaderTcp(ip: String) {
        _readerIp.value = ip
        reader.connectTcp(ip)
    }

    fun disconnectReader() {
        reader.disconnect()
    }
}

// ==========================================
// HomeScreen
// ==========================================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToDirtyScan: (tenantId: String, tenantName: String) -> Unit,
    onNavigateToDelivery: (tenantId: String, tenantName: String) -> Unit,
    onNavigateToVehicleLoad: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel()
) {
    val isLoggedIn by viewModel.isLoggedIn.collectAsState()
    val loginError by viewModel.loginError.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val tenants by viewModel.tenants.collectAsState()
    val readerState by viewModel.reader.state.collectAsState()
    val readerIp by viewModel.readerIp.collectAsState()
    val syncState by viewModel.syncState.collectAsState()
    val itemCount by viewModel.itemCount.collectAsState()
    val isOnline by viewModel.isOnline.collectAsState()
    val pendingOpsCount by viewModel.pendingCount.collectAsState()
    val loadedTenantIds by viewModel.loadedTenantIds.collectAsState()

    var selectedMode by remember { mutableStateOf<String?>(null) } // "dirty" or "delivery"
    var searchQuery by remember { mutableStateOf("") }
    var showReaderSettings by remember { mutableStateOf(false) }
    var ipInput by remember { mutableStateOf(readerIp) }

    // Loading/connecting screen
    if (!isLoggedIn) {
        Box(
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.LocalLaundryService,
                    contentDescription = null,
                    modifier = Modifier.size(80.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text("Camasirhane Tablet", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(24.dp))
                if (loginError != null) {
                    Text(loginError!!, color = Color(0xFFC62828), fontSize = 18.sp)
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = { viewModel.retryLogin() },
                        modifier = Modifier.height(56.dp)
                    ) {
                        Text("Tekrar Dene", fontSize = 20.sp)
                    }
                } else {
                    CircularProgressIndicator(modifier = Modifier.size(48.dp))
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Baglaniyor...", fontSize = 20.sp, color = Color.Gray)
                }
            }
        }
        return
    }

    // Main screen
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Çamaşırhane Tablet",
                        fontWeight = FontWeight.Bold
                    )
                },
                actions = {
                    // Reader status indicator
                    ReaderStatusChip(
                        state = readerState,
                        onClick = { showReaderSettings = true }
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // Offline banner
            if (!isOnline) {
                Surface(
                    color = Color(0xFFE53935),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(Icons.Default.CloudOff, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            buildString {
                                append("Internet baglantisi yok - Yerel veriden calisiyor")
                                if (pendingOpsCount > 0) append(" ($pendingOpsCount bekleyen islem)")
                            },
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

        if (selectedMode == null) {
            // Mode selection
            ModeSelectionContent(
                modifier = Modifier,
                onSelectDirty = { selectedMode = "dirty" },
                onSelectDelivery = { selectedMode = "delivery" },
                onSelectVehicleLoad = onNavigateToVehicleLoad,
                syncState = syncState,
                itemCount = itemCount,
                onSync = { viewModel.syncItemsToLocal(force = true) }
            )
        } else {
            // Refresh loaded tenants when entering delivery mode
            LaunchedEffect(selectedMode) {
                if (selectedMode == "delivery") {
                    viewModel.refreshLoadedTenants()
                }
            }

            // For delivery mode, only show hotels that have loaded packages
            val displayTenants = if (selectedMode == "delivery") {
                tenants.filter { it.id in loadedTenantIds }
            } else {
                tenants
            }

            // Hotel selection
            HotelSelectionContent(
                modifier = Modifier,
                mode = selectedMode!!,
                tenants = displayTenants,
                searchQuery = searchQuery,
                isLoading = isLoading,
                onSearchChanged = { searchQuery = it },
                onSelectHotel = { tenant ->
                    if (selectedMode == "dirty") {
                        onNavigateToDirtyScan(tenant.id, tenant.name)
                    } else {
                        onNavigateToDelivery(tenant.id, tenant.name)
                    }
                },
                onBack = {
                    selectedMode = null
                    searchQuery = ""
                },
                onRefresh = { viewModel.loadTenants() }
            )
        }
        } // end Column
    }

    // Reader settings dialog
    var isScanning by remember { mutableStateOf(false) }
    var scanProgress by remember { mutableIntStateOf(0) }
    var foundIps by remember { mutableStateOf(listOf<String>()) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val antennaMask by viewModel.reader.antennaMask.collectAsState()
    val antennaPower by viewModel.reader.antennaPower.collectAsState()
    val antennaTagCounts by viewModel.reader.antennaTagCounts.collectAsState()

    if (showReaderSettings) {
        AlertDialog(
            onDismissRequest = { if (!isScanning) showReaderSettings = false },
            title = { Text("Anten Ayarları") },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.heightIn(max = 500.dp).verticalScroll(rememberScrollState())
                ) {
                    Text(
                        "Durum: ${readerStateText(readerState)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = readerStateColor(readerState)
                    )
                    val readerTypeName = when (viewModel.reader.detectedType) {
                        com.laundry.tablet.rfid.ReaderType.BOHANG -> "Bohang CM"
                        com.laundry.tablet.rfid.ReaderType.MW8817 -> "MW-8817 MM"
                    }
                    Text(
                        "Reader: $readerTypeName",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.Gray
                    )

                    // USB Serial connect button
                    Button(
                        onClick = {
                            viewModel.connectReaderUsb(context)
                            showReaderSettings = false
                        },
                        enabled = readerState is ReaderState.Disconnected || readerState is ReaderState.Error,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                    ) {
                        Icon(Icons.Default.Usb, null, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("USB ile Bağlan", fontSize = 16.sp)
                    }

                    Divider()
                    Text("veya TCP/IP ile bağlan:", style = MaterialTheme.typography.bodySmall, color = Color.Gray)

                    OutlinedTextField(
                        value = ipInput,
                        onValueChange = { ipInput = it },
                        label = { Text("IP Adresi") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    // Network scan
                    Button(
                        onClick = {
                            isScanning = true
                            scanProgress = 0
                            foundIps = emptyList()
                            viewModel.reader.scanNetwork(
                                onProgress = { scanProgress = it },
                                onFound = { ip ->
                                    foundIps = foundIps + ip
                                    ipInput = ip
                                    isScanning = false
                                }
                            )
                        },
                        enabled = !isScanning,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (isScanning) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Taranıyor... %$scanProgress")
                        } else {
                            Icon(Icons.Default.WifiFind, null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Ağda Anten Ara")
                        }
                    }

                    for (ip in foundIps) {
                        Surface(
                            color = Color(0xFF2E7D32).copy(alpha = 0.1f),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth().clickable { ipInput = ip }
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(Icons.Default.Sensors, null, tint = Color(0xFF2E7D32))
                                Text("Anten bulundu: $ip", fontWeight = FontWeight.Bold, color = Color(0xFF2E7D32))
                            }
                        }
                    }

                    // ==========================================
                    // Antenna Configuration
                    // ==========================================
                    Divider()
                    Text("Anten Secimi", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Text("Aktif antenleri secin (birden fazla secilebilir)", style = MaterialTheme.typography.bodySmall, color = Color.Gray)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        for (i in 0..3) {
                            val isEnabled = (antennaMask shr i) and 1 == 1
                            val tagCount = antennaTagCounts[i]
                            FilterChip(
                                selected = isEnabled,
                                onClick = {
                                    val newMask = antennaMask xor (1 shl i)
                                    if (newMask > 0) viewModel.saveAntennaMask(newMask)
                                },
                                label = {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text("Ant ${i + 1}", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                        if (tagCount > 0) {
                                            Text("$tagCount tag", fontSize = 10.sp, color = Color.Gray)
                                        }
                                    }
                                },
                                leadingIcon = if (isEnabled) {
                                    { Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp)) }
                                } else null,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    // RF Power slider
                    Text("RF Guc: ${antennaPower[0]} dBm", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                    Slider(
                        value = antennaPower[0].toFloat(),
                        onValueChange = { viewModel.reader.setAllAntennaPower(it.toInt()) },
                        valueRange = 5f..30f,
                        steps = 24,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("5 dBm", fontSize = 10.sp, color = Color.Gray)
                        Text("30 dBm (Max)", fontSize = 10.sp, color = Color.Gray)
                    }
                }
            },
            confirmButton = {
                if (readerState is ReaderState.Disconnected || readerState is ReaderState.Error) {
                    Button(onClick = {
                        viewModel.connectReaderTcp(ipInput)
                        showReaderSettings = false
                    }) {
                        Text("TCP Bağlan")
                    }
                } else {
                    Button(
                        onClick = {
                            viewModel.disconnectReader()
                            showReaderSettings = false
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                    ) {
                        Text("Bağlantıyı Kes")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { if (!isScanning) showReaderSettings = false }) {
                    Text("Kapat")
                }
            }
        )
    }
}

@Composable
private fun LoginContent(
    isLoading: Boolean,
    error: String?,
    onLogin: (String) -> Unit
) {
    var pin by remember { mutableStateOf("") }

    Box(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 360.dp).padding(32.dp),
            elevation = CardDefaults.cardElevation(8.dp)
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Icon(
                    Icons.Default.LocalLaundryService,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    "Çamaşırhane Tablet",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Şoför Girişi",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.Gray
                )

                OutlinedTextField(
                    value = pin,
                    onValueChange = { if (it.length <= 4 && it.all { c -> c.isDigit() }) pin = it },
                    label = { Text("Şifre (4 haneli)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = LocalTextStyle.current.copy(
                        textAlign = TextAlign.Center,
                        fontSize = 24.sp,
                        letterSpacing = 8.sp
                    )
                )

                if (error != null) {
                    Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }

                Button(
                    onClick = { onLogin(pin) },
                    enabled = !isLoading && pin.length == 4,
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White)
                    } else {
                        Text("Giriş Yap", fontSize = 16.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ModeSelectionContent(
    modifier: Modifier = Modifier,
    onSelectDirty: () -> Unit,
    onSelectDelivery: () -> Unit,
    onSelectVehicleLoad: () -> Unit = {},
    syncState: SyncState = SyncState.Idle,
    itemCount: Int = 0,
    onSync: () -> Unit = {}
) {
    Column(modifier = modifier.fillMaxSize().padding(32.dp)) {
        // Sync status bar
        Surface(
            color = when (syncState) {
                is SyncState.Syncing -> Color(0xFFFFF3E0)
                is SyncState.Done -> Color(0xFFE8F5E9)
                is SyncState.Error -> Color(0xFFFFEBEE)
                else -> Color(0xFFF5F5F5)
            },
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                when (syncState) {
                    is SyncState.Syncing -> {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                        Text("Urunler yukleniyor... (${syncState.page}/${syncState.totalPages})", fontSize = 18.sp)
                    }
                    is SyncState.Done -> {
                        Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF2E7D32), modifier = Modifier.size(24.dp))
                        Text("$itemCount urun hazir", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                    is SyncState.Error -> {
                        Icon(Icons.Default.Error, null, tint = Color(0xFFC62828), modifier = Modifier.size(24.dp))
                        Text("Senkronizasyon basarisiz. Internet baglantinizi kontrol edin.", fontSize = 16.sp)
                    }
                    else -> {
                        Icon(Icons.Default.Storage, null, tint = Color.Gray, modifier = Modifier.size(24.dp))
                        Text(if (itemCount > 0) "$itemCount urun mevcut" else "Henuz sync yapilmadi", fontSize = 18.sp)
                    }
                }
                Spacer(modifier = Modifier.weight(1f))
                if (syncState !is SyncState.Syncing) {
                    IconButton(onClick = onSync) {
                        Icon(Icons.Default.Sync, "Sync", modifier = Modifier.size(28.dp))
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Row(
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically
        ) {
            ModeCard(
                title = "Kirli Urun\nTarama",
                color = Color(0xFFC62828),
                modifier = Modifier.weight(1f).fillMaxHeight(0.9f),
                onClick = onSelectDirty,
                iconContent = {
                    Icon(
                        Icons.Default.LocalShipping,
                        contentDescription = null,
                        modifier = Modifier.size(100.dp),
                        tint = Color.White
                    )
                }
            )
            ModeCard(
                title = "Araca\nYukle",
                color = Color(0xFF1565C0),
                modifier = Modifier.weight(1f).fillMaxHeight(0.9f),
                onClick = onSelectVehicleLoad,
                iconContent = {
                    Icon(
                        Icons.Default.DirectionsCar,
                        contentDescription = null,
                        modifier = Modifier.size(100.dp),
                        tint = Color.White
                    )
                }
            )
            ModeCard(
                title = "Temiz\nTeslim",
                color = Color(0xFF2E7D32),
                modifier = Modifier.weight(1f).fillMaxHeight(0.9f),
                onClick = onSelectDelivery,
                iconContent = { StackedTowelsIcon(modifier = Modifier.size(100.dp)) }
            )
        }
    }
}

@Composable
private fun ModeCard(
    title: String,
    color: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    iconContent: @Composable () -> Unit
) {
    Card(
        modifier = modifier.clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = color),
        elevation = CardDefaults.cardElevation(8.dp),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            iconContent()
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                title,
                color = Color.White,
                fontSize = 36.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                lineHeight = 46.sp
            )
        }
    }
}

/** Custom icon: 4 stacked folded towels */
@Composable
private fun StackedTowelsIcon(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val towelH = h * 0.18f
        val gap = h * 0.04f
        val totalH = 4 * towelH + 3 * gap
        val startY = (h - totalH) / 2f
        val cornerR = CornerRadius(towelH * 0.35f, towelH * 0.35f)
        val foldR = CornerRadius(towelH * 0.5f, towelH * 0.5f)
        val white = Color.White
        val shadow = Color(0x40000000)
        val foldColor = Color(0xFFE0E0E0)

        for (i in 0 until 4) {
            val y = startY + i * (towelH + gap)
            // Shadow
            drawRoundRect(
                color = shadow,
                topLeft = Offset(w * 0.08f, y + 3f),
                size = Size(w * 0.84f, towelH),
                cornerRadius = cornerR
            )
            // Main towel body
            drawRoundRect(
                color = white,
                topLeft = Offset(w * 0.08f, y),
                size = Size(w * 0.84f, towelH),
                cornerRadius = cornerR
            )
            // Fold on right side (rolled edge)
            drawRoundRect(
                color = foldColor,
                topLeft = Offset(w * 0.72f, y + towelH * 0.1f),
                size = Size(w * 0.18f, towelH * 0.8f),
                cornerRadius = foldR
            )
            // Subtle line on towel
            drawLine(
                color = foldColor,
                start = Offset(w * 0.15f, y + towelH * 0.5f),
                end = Offset(w * 0.65f, y + towelH * 0.5f),
                strokeWidth = 1.5f
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HotelSelectionContent(
    modifier: Modifier = Modifier,
    mode: String,
    tenants: List<TenantDto>,
    searchQuery: String,
    isLoading: Boolean,
    onSearchChanged: (String) -> Unit,
    onSelectHotel: (TenantDto) -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit
) {
    val filteredTenants = remember(tenants, searchQuery) {
        if (searchQuery.isBlank()) tenants
        else tenants.filter { it.name.contains(searchQuery, ignoreCase = true) }
    }

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        // Header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, "Geri", modifier = Modifier.size(32.dp))
            }
            Text(
                when (mode) {
                    "dirty" -> "Kirli Tarama - Otel Secin"
                    else -> "Temiz Teslim - Otel Secin"
                },
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = onRefresh) {
                Icon(Icons.Default.Refresh, "Yenile", modifier = Modifier.size(32.dp))
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Search
        OutlinedTextField(
            value = searchQuery,
            onValueChange = onSearchChanged,
            label = { Text("Otel Ara...", fontSize = 18.sp) },
            leadingIcon = { Icon(Icons.Default.Search, null, modifier = Modifier.size(28.dp)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            textStyle = LocalTextStyle.current.copy(fontSize = 20.sp)
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (isLoading && tenants.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(modifier = Modifier.size(48.dp))
            }
        } else if (filteredTenants.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (mode == "delivery") {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.LocalShipping, null,
                            modifier = Modifier.size(80.dp),
                            tint = Color.Gray.copy(alpha = 0.4f)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "Teslimata hazir otel yok",
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.Gray
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            "Once \"Araca Yukle\" ekranindan teslim edilecek\notellerin paket barkodlarini okutarak\nteslimata hazir hale getirin.",
                            fontSize = 20.sp,
                            color = Color(0xFF777777),
                            textAlign = TextAlign.Center,
                            lineHeight = 28.sp
                        )
                    }
                } else {
                    Text("Otel bulunamadi", fontSize = 24.sp)
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(filteredTenants, key = { it.id }) { tenant ->
                    val cardColor = if (mode == "dirty") Color(0xFFC62828) else Color(0xFF2E7D32)
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .clickable { onSelectHotel(tenant) },
                        elevation = CardDefaults.cardElevation(6.dp),
                        shape = RoundedCornerShape(20.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = cardColor.copy(alpha = 0.12f)
                        )
                    ) {
                        Column(
                            modifier = Modifier.fillMaxSize().padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                Icons.Default.Hotel,
                                contentDescription = null,
                                tint = cardColor,
                                modifier = Modifier.size(48.dp)
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                tenant.name,
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                                color = cardColor
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReaderStatusChip(state: ReaderState, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.clickable { onClick() },
        shape = RoundedCornerShape(16.dp),
        color = readerStateColor(state).copy(alpha = 0.15f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Box(
                modifier = Modifier.size(10.dp)
                    .clip(CircleShape)
                    .background(readerStateColor(state))
            )
            Text(
                readerStateText(state),
                fontSize = 12.sp,
                color = Color.White,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

private fun readerStateText(state: ReaderState): String = when (state) {
    is ReaderState.Disconnected -> "Anten Bağlı Değil"
    is ReaderState.Connecting -> "Bağlanıyor..."
    is ReaderState.Connected -> "Anten Bağlı"
    is ReaderState.Scanning -> "Tarama Aktif"
    is ReaderState.Error -> "Hata"
}

private fun readerStateColor(state: ReaderState): Color = when (state) {
    is ReaderState.Disconnected -> Color(0xFF9E9E9E)
    is ReaderState.Connecting -> Color(0xFFFFA000)
    is ReaderState.Connected -> Color(0xFF2E7D32)
    is ReaderState.Scanning -> Color(0xFF2E7D32)
    is ReaderState.Error -> Color(0xFFC62828)
}
