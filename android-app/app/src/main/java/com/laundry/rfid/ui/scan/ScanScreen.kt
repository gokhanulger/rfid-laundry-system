package com.laundry.rfid.ui.scan

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.material3.LocalTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laundry.rfid.domain.model.ScannedTag
import com.laundry.rfid.domain.model.SessionType
import com.laundry.rfid.rfid.RfidState
import com.laundry.rfid.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    viewModel: ScanViewModel,
    sessionType: String,
    onBack: () -> Unit,
    onComplete: () -> Unit,
    onScanQR: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var showCompleteDialog by remember { mutableStateOf(false) }

    // Start session on first composition
    LaunchedEffect(sessionType) {
        viewModel.startSession(sessionType)
    }

    // Navigate back when completed
    LaunchedEffect(uiState.isCompleted) {
        if (uiState.isCompleted) {
            onComplete()
        }
    }

    val sessionTypeEnum = SessionType.values().find { it.value == sessionType } ?: SessionType.PICKUP
    val color = when (sessionTypeEnum) {
        SessionType.PICKUP -> PickupColor
        SessionType.RECEIVE -> ProcessColor
        SessionType.PROCESS -> ProcessColor
        SessionType.CLEAN -> PackageColor
        SessionType.PACKAGE -> PackageColor
        SessionType.DELIVER -> DeliverColor
    }

    val title = when (sessionTypeEnum) {
        SessionType.PICKUP -> "Toplama"
        SessionType.RECEIVE -> "Teslim Alma"
        SessionType.PROCESS -> "İşleme"
        SessionType.CLEAN -> "Temiz İşaretle"
        SessionType.PACKAGE -> "Paketleme"
        SessionType.DELIVER -> "Teslimat"
    }

    // Check if this is a driver session (pickup/deliver) that needs hotel selection
    val needsHotelSelection = sessionTypeEnum == SessionType.PICKUP || sessionTypeEnum == SessionType.DELIVER

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Clear button
                    if (uiState.tagCount > 0) {
                        IconButton(onClick = { viewModel.clearTags() }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                    // Simulate scan (for testing)
                    IconButton(onClick = { viewModel.simulateScan() }) {
                        Icon(Icons.Default.Add, contentDescription = "Simulate")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = color.copy(alpha = 0.2f)
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Hotel selection for driver (pickup/deliver)
            if (needsHotelSelection) {
                HotelSelectionBar(
                    selectedTenantName = uiState.selectedTenantName,
                    tenants = uiState.tenants,
                    isLoading = uiState.isLoadingTenants,
                    showSelector = uiState.showHotelSelector,
                    onShowSelector = { viewModel.showHotelSelector() },
                    onHideSelector = { viewModel.hideHotelSelector() },
                    onSelectTenant = { id, name -> viewModel.selectTenant(id, name) },
                    onScanQR = onScanQR
                )
            }

            // Compact header with count and scan button side by side
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(color.copy(alpha = 0.1f))
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Tag count - left side
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "${uiState.tagCount}",
                            fontSize = 48.sp,
                            fontWeight = FontWeight.Bold,
                            color = color
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Ürün",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Medium,
                                color = color
                            )
                            StatusIndicator(state = uiState.rfidState, isScanning = uiState.isScanning)
                        }
                    }
                    // Show matched/unmatched counts if hotel is selected
                    if (needsHotelSelection && uiState.selectedTenantId != null && uiState.tagCount > 0) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(
                                text = "✓ ${uiState.matchedCount} eşleşen",
                                fontSize = 14.sp,
                                color = SuccessColor,
                                fontWeight = FontWeight.Medium
                            )
                            if (uiState.unmatchedCount > 0) {
                                Text(
                                    text = "✗ ${uiState.unmatchedCount} diğer otel",
                                    fontSize = 14.sp,
                                    color = WarningColor,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }

                // Scan button - right side, smaller
                Button(
                    onClick = { viewModel.toggleScanning() },
                    modifier = Modifier.size(80.dp),
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (uiState.isScanning) Error else color
                    )
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = if (uiState.isScanning) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = if (uiState.isScanning) "Durdur" else "Başlat",
                            modifier = Modifier.size(28.dp)
                        )
                        Text(
                            text = if (uiState.isScanning) "DUR" else "TARA",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }

            // Scanned items list header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Taranan Ürünler",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                if (uiState.scannedTags.isNotEmpty()) {
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = "${uiState.tagCount} ürün",
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (needsHotelSelection && uiState.unregisteredCount > 0) {
                            Text(
                                text = "(${uiState.unregisteredCount} kayıtsız)",
                                fontSize = 12.sp,
                                color = WarningColor
                            )
                        }
                    }
                }
            }

            // Grouped items list - shows "3x Nevresim" style for driver
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
            ) {
                // Show grouped items (registered only for driver sessions)
                items(uiState.groupedItems) { group ->
                    GroupedItemCard(
                        group = group,
                        color = color,
                        showHotelMatch = needsHotelSelection && uiState.selectedTenantId != null
                    )
                }

                if (uiState.scannedTags.isEmpty()) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(48.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Default.QrCodeScanner,
                                    contentDescription = null,
                                    modifier = Modifier.size(80.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    text = if (needsHotelSelection && uiState.selectedTenantId == null)
                                        "Önce otel seçin, sonra taramaya başlayın"
                                    else
                                        "Taramak için TARA butonuna basın",
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "veya cihazın yan tuşunu kullanın",
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                                )
                            }
                        }
                    }
                } else if (uiState.groupedItems.isEmpty() && uiState.scannedTags.isNotEmpty()) {
                    // All items are unregistered
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Default.Warning,
                                    contentDescription = null,
                                    modifier = Modifier.size(48.dp),
                                    tint = WarningColor
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = "${uiState.tagCount} kayıtsız ürün tarandı",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = WarningColor
                                )
                                Text(
                                    text = "Bu ürünler henüz tanımlanmamış",
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }

            // Warning for other hotel items
            if (needsHotelSelection && uiState.otherHotelCount > 0) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = Error.copy(alpha = 0.1f)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = null,
                            tint = Error,
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "${uiState.otherHotelCount} ürün farklı otele ait!",
                                fontWeight = FontWeight.Bold,
                                color = Error
                            )
                            Text(
                                text = "İşlemi tamamlamak için bu ürünleri çıkarın",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // Complete button
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                val canComplete = viewModel.canComplete()
                Button(
                    onClick = { showCompleteDialog = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    enabled = canComplete,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (canComplete) SuccessColor else MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    if (uiState.isCompleting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = Color.White
                        )
                    } else {
                        Icon(Icons.Default.Check, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (needsHotelSelection && uiState.otherHotelCount > 0)
                                "Farklı otel ürünleri var!"
                            else
                                "Tamamla (${uiState.matchedCount} ürün)",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }

    // Complete confirmation dialog
    if (showCompleteDialog) {
        AlertDialog(
            onDismissRequest = { showCompleteDialog = false },
            title = { Text("$title Tamamlansın mı?") },
            text = {
                Column {
                    Text("${uiState.tagCount} ürün tarandı.")
                    if (needsHotelSelection && uiState.selectedTenantId != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Otel: ${uiState.selectedTenantName}",
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            "Eşleşen: ${uiState.matchedCount}, Diğer otel: ${uiState.unmatchedCount}",
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Bu oturumu tamamlamak istiyor musunuz?")
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showCompleteDialog = false
                    viewModel.completeSession()
                }) {
                    Text("Tamamla")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCompleteDialog = false }) {
                    Text("İptal")
                }
            }
        )
    }

    // Error snackbar
    uiState.error?.let { error ->
        LaunchedEffect(error) {
            // Auto-clear error after showing
            kotlinx.coroutines.delay(3000)
            viewModel.clearError()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun HotelSelectionBar(
    selectedTenantName: String?,
    tenants: List<com.laundry.rfid.data.remote.dto.TenantDto>,
    isLoading: Boolean,
    showSelector: Boolean,
    onShowSelector: () -> Unit,
    onHideSelector: () -> Unit,
    onSelectTenant: (String, String) -> Unit,
    onScanQR: () -> Unit = {}
) {
    var qrInput by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current

    // Auto-focus for hardware scanner but hide keyboard
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
        keyboardController?.hide()
    }

    // Auto-search after input stops (debounce 300ms)
    LaunchedEffect(qrInput) {
        if (qrInput.isNotBlank()) {
            kotlinx.coroutines.delay(300)
            // Find tenant by QR code
            val tenant = tenants.find { it.qrCode == qrInput.trim() }
            if (tenant != null) {
                onSelectTenant(tenant.id, tenant.name)
            } else {
                // Try partial name match
                val tenantByName = tenants.find {
                    it.name.lowercase().contains(qrInput.trim().lowercase()) ||
                    qrInput.trim().lowercase().contains(it.name.lowercase())
                }
                if (tenantByName != null) {
                    onSelectTenant(tenantByName.id, tenantByName.name)
                }
            }
            qrInput = ""
            focusRequester.requestFocus()
            keyboardController?.hide()
        }
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selectedTenantName != null) InfoColor.copy(alpha = 0.1f) else WarningColor.copy(alpha = 0.1f)
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Hidden QR Scanner Input - for hardware scanner only (invisible)
            BasicTextField(
                value = qrInput,
                onValueChange = { qrInput = it },
                modifier = Modifier
                    .size(1.dp)
                    .focusRequester(focusRequester),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done)
            )

            // Hotel dropdown
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Business,
                    contentDescription = null,
                    tint = if (selectedTenantName != null) InfoColor else WarningColor,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))

                // Dropdown menu
                ExposedDropdownMenuBox(
                    expanded = showSelector,
                    onExpandedChange = { if (it) onShowSelector() else onHideSelector() },
                    modifier = Modifier.weight(1f)
                ) {
                    OutlinedTextField(
                        value = selectedTenantName ?: "",
                        onValueChange = {},
                        readOnly = true,
                        placeholder = {
                            Text(
                                "Otel seçin...",
                                color = WarningColor
                            )
                        },
                        trailingIcon = {
                            if (isLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp
                                )
                            } else {
                                ExposedDropdownMenuDefaults.TrailingIcon(expanded = showSelector)
                            }
                        },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = if (selectedTenantName != null) InfoColor else WarningColor,
                            unfocusedBorderColor = if (selectedTenantName != null) InfoColor.copy(alpha = 0.5f) else WarningColor.copy(alpha = 0.5f),
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent
                        ),
                        modifier = Modifier
                            .menuAnchor()
                            .fillMaxWidth(),
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontWeight = FontWeight.Medium,
                            color = if (selectedTenantName != null) InfoColor else MaterialTheme.colorScheme.onSurface
                        )
                    )

                    ExposedDropdownMenu(
                        expanded = showSelector && !isLoading,
                        onDismissRequest = onHideSelector
                    ) {
                        tenants.forEach { tenant ->
                            DropdownMenuItem(
                                text = {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            Icons.Default.Business,
                                            contentDescription = null,
                                            modifier = Modifier.size(20.dp),
                                            tint = if (tenant.name == selectedTenantName) InfoColor else MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        Spacer(modifier = Modifier.width(12.dp))
                                        Text(
                                            tenant.name,
                                            fontWeight = if (tenant.name == selectedTenantName) FontWeight.Bold else FontWeight.Normal
                                        )
                                    }
                                },
                                onClick = {
                                    onSelectTenant(tenant.id, tenant.name)
                                    onHideSelector()
                                },
                                leadingIcon = if (tenant.name == selectedTenantName) {
                                    {
                                        Icon(
                                            Icons.Default.Check,
                                            contentDescription = null,
                                            tint = InfoColor
                                        )
                                    }
                                } else null
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun GroupedItemCard(
    group: GroupedItem,
    color: Color,
    showHotelMatch: Boolean
) {
    val isMatched = group.belongsToSelectedHotel

    val cardColor = when {
        showHotelMatch && isMatched -> SuccessColor.copy(alpha = 0.15f)
        showHotelMatch && !isMatched -> WarningColor.copy(alpha = 0.15f)
        else -> color.copy(alpha = 0.08f)
    }

    val iconColor = when {
        showHotelMatch && isMatched -> SuccessColor
        showHotelMatch && !isMatched -> WarningColor
        else -> SuccessColor
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = cardColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status icon
            Icon(
                when {
                    showHotelMatch && isMatched -> Icons.Default.CheckCircle
                    showHotelMatch && !isMatched -> Icons.Default.Warning
                    else -> Icons.Default.CheckCircle
                },
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(32.dp)
            )

            Spacer(modifier = Modifier.width(16.dp))

            // Count and item type
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Count badge
                    Box(
                        modifier = Modifier
                            .background(iconColor.copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = "${group.count}x",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = iconColor
                        )
                    }
                    Spacer(modifier = Modifier.width(12.dp))
                    // Item type name
                    Text(
                        text = group.itemTypeName,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                // Hotel name
                group.tenantName?.let { hotelName ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = hotelName,
                        fontSize = 14.sp,
                        color = if (isMatched) SuccessColor else WarningColor,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            // Match indicator for hotel selection mode
            if (showHotelMatch) {
                if (isMatched) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = "Eşleşen",
                        tint = SuccessColor,
                        modifier = Modifier.size(24.dp)
                    )
                } else {
                    Text(
                        text = "Farklı otel",
                        fontSize = 12.sp,
                        color = WarningColor
                    )
                }
            }
        }
    }
}

@Composable
fun StatusIndicator(state: RfidState, isScanning: Boolean) {
    val (text, color) = when {
        isScanning -> "Taranıyor..." to SuccessColor
        state is RfidState.Connected -> "Hazır" to InfoColor
        state is RfidState.Connecting -> "Bağlanıyor..." to WarningColor
        state is RfidState.Error -> "Hata: ${state.message}" to Error
        else -> "Bağlı Değil" to MaterialTheme.colorScheme.onSurfaceVariant
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(color, CircleShape)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = text,
            fontSize = 14.sp,
            color = color
        )
    }
}

@Composable
fun ScannedTagItem(
    tag: ScannedTag,
    color: Color,
    itemInfo: ScannedItemInfo?,
    showHotelMatch: Boolean
) {
    val isMatched = itemInfo?.belongsToSelectedHotel == true
    val isRegistered = itemInfo?.isRegistered == true

    // Determine card color based on match status
    val cardColor = when {
        showHotelMatch && isMatched -> SuccessColor.copy(alpha = 0.15f)
        showHotelMatch && isRegistered && !isMatched -> WarningColor.copy(alpha = 0.15f)
        showHotelMatch && !isRegistered -> Error.copy(alpha = 0.1f)
        else -> color.copy(alpha = 0.08f)
    }

    val iconColor = when {
        showHotelMatch && isMatched -> SuccessColor
        showHotelMatch && isRegistered && !isMatched -> WarningColor
        showHotelMatch && !isRegistered -> Error
        else -> SuccessColor
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = cardColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status icon - left
            Icon(
                when {
                    showHotelMatch && isMatched -> Icons.Default.CheckCircle
                    showHotelMatch && isRegistered && !isMatched -> Icons.Default.Warning
                    showHotelMatch && !isRegistered -> Icons.Default.Help
                    else -> Icons.Default.CheckCircle
                },
                contentDescription = when {
                    isMatched -> "Eşleşen"
                    isRegistered && !isMatched -> "Başka otel"
                    !isRegistered -> "Kayıtsız"
                    else -> "Tarandı"
                },
                tint = iconColor,
                modifier = Modifier.size(28.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            // Item info - show hotel name and item type for registered items, tag for unregistered
            Column(modifier = Modifier.weight(1f)) {
                if (isRegistered && itemInfo != null) {
                    // Show item type name as main text for registered items
                    Text(
                        text = itemInfo.itemTypeName ?: "Bilinmeyen Ürün",
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 16.sp,
                        color = iconColor
                    )
                    // Show hotel name and status
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        itemInfo.tenantName?.let { hotelName ->
                            Text(
                                text = hotelName,
                                fontSize = 13.sp,
                                color = if (isMatched) SuccessColor else WarningColor,
                                fontWeight = FontWeight.Medium
                            )
                        }
                        if (showHotelMatch && !isMatched) {
                            Text(
                                text = "• Farklı otel",
                                fontSize = 12.sp,
                                color = WarningColor
                            )
                        }
                    }
                    // Show tag ID in smaller text
                    Text(
                        text = tag.rfidTag,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                } else {
                    // Unregistered item - show tag as main text
                    Text(
                        text = tag.rfidTag,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 14.sp
                    )
                    Text(
                        text = "Kayıtsız ürün",
                        fontSize = 12.sp,
                        color = Error
                    )
                }
            }

            // Signal strength badge
            tag.signalStrength?.let { rssi ->
                Box(
                    modifier = Modifier
                        .background(
                            color = when {
                                rssi > -40 -> SuccessColor.copy(alpha = 0.2f)
                                rssi > -60 -> WarningColor.copy(alpha = 0.2f)
                                else -> Error.copy(alpha = 0.2f)
                            },
                            shape = RoundedCornerShape(8.dp)
                        )
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = "${rssi}dB",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = when {
                            rssi > -40 -> SuccessColor
                            rssi > -60 -> WarningColor
                            else -> Error
                        }
                    )
                }
            }
        }
    }
}
