package com.laundry.rfid.ui.tagtransfer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.laundry.rfid.rfid.RfidState
import com.laundry.rfid.ui.theme.*

private val TransferColor = Color(0xFFE67E22) // Orange for transfer

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TagTransferScreen(
    viewModel: TagTransferViewModel,
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var showTransferDialog by remember { mutableStateOf(false) }

    // Error snackbar
    uiState.error?.let { error ->
        LaunchedEffect(error) {
            kotlinx.coroutines.delay(3000)
            viewModel.clearError()
        }
    }

    // Success message
    uiState.successMessage?.let { msg ->
        LaunchedEffect(msg) {
            kotlinx.coroutines.delay(3000)
            viewModel.clearSuccessMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Etiket Transfer") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Geri")
                    }
                },
                actions = {
                    if (uiState.scannedTags.isNotEmpty()) {
                        IconButton(onClick = { viewModel.clearTags() }) {
                            Icon(Icons.Default.Clear, contentDescription = "Temizle")
                        }
                    }
                    IconButton(onClick = { viewModel.simulateScan() }) {
                        Icon(Icons.Default.Add, contentDescription = "Test")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = TransferColor.copy(alpha = 0.2f)
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Target hotel selection
            TargetHotelBar(
                selectedTenantName = uiState.selectedTargetTenantName,
                tenants = uiState.tenants,
                isLoading = uiState.isLoading,
                showSelector = uiState.showHotelSelector,
                onShowSelector = { viewModel.showHotelSelector() },
                onHideSelector = { viewModel.hideHotelSelector() },
                onSelectTenant = { id, name -> viewModel.selectTargetTenant(id, name) },
                onRefresh = { viewModel.refreshData() }
            )

            // Optional item type change
            ItemTypeBar(
                selectedItemTypeName = uiState.selectedItemTypeName,
                itemTypes = uiState.itemTypes,
                isLoading = uiState.isLoading,
                showSelector = uiState.showItemTypeSelector,
                onShowSelector = { viewModel.showItemTypeSelector() },
                onHideSelector = { viewModel.hideItemTypeSelector() },
                onSelectItemType = { id, name -> viewModel.selectItemType(id, name) },
                onClear = { viewModel.clearItemType() }
            )

            // Scan header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TransferColor.copy(alpha = 0.1f))
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "${uiState.scannedTags.size}",
                            fontSize = 48.sp,
                            fontWeight = FontWeight.Bold,
                            color = TransferColor
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Etiket",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Medium,
                                color = TransferColor
                            )
                            // Status
                            val statusText = when {
                                uiState.isScanning -> "Taraniyor..."
                                uiState.rfidState is RfidState.Connected -> "Hazir"
                                uiState.rfidState is RfidState.Connecting -> "Baglaniyor..."
                                else -> "Bagli Degil"
                            }
                            val statusColor = when {
                                uiState.isScanning -> SuccessColor
                                uiState.rfidState is RfidState.Connected -> InfoColor
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .background(statusColor, CircleShape)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(text = statusText, fontSize = 14.sp, color = statusColor)
                            }
                        }
                    }

                    // Summary counts
                    if (uiState.scannedItemsInfo.isNotEmpty()) {
                        val registered = uiState.scannedItemsInfo.values.count { it.isRegistered }
                        val unregistered = uiState.scannedItemsInfo.values.count { !it.isRegistered }
                        val alreadyCorrect = uiState.selectedTargetTenantId?.let { targetId ->
                            uiState.scannedItemsInfo.values.count { it.currentTenantId == targetId }
                        } ?: 0
                        val toTransfer = registered - alreadyCorrect

                        Spacer(modifier = Modifier.height(4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (toTransfer > 0) {
                                Text(
                                    text = "$toTransfer transfer edilecek",
                                    fontSize = 14.sp,
                                    color = TransferColor,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                            if (alreadyCorrect > 0) {
                                Text(
                                    text = "$alreadyCorrect zaten dogru",
                                    fontSize = 14.sp,
                                    color = SuccessColor,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                            if (unregistered > 0) {
                                Text(
                                    text = "$unregistered kayitsiz",
                                    fontSize = 14.sp,
                                    color = Error,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }

                // Scan button
                Button(
                    onClick = { viewModel.toggleScanning() },
                    modifier = Modifier.size(80.dp),
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (uiState.isScanning) Error else TransferColor
                    )
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = if (uiState.isScanning) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = if (uiState.isScanning) "Durdur" else "Baslat",
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

            // Scanned items list
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Taranan Etiketler",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                if (uiState.scannedTags.isNotEmpty()) {
                    Text(
                        text = "${uiState.scannedTags.size} etiket",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
            ) {
                items(
                    items = uiState.scannedTags,
                    key = { it.epc }
                ) { tag ->
                    val itemInfo = uiState.scannedItemsInfo[tag.epc]
                    val isAlreadyCorrect = uiState.selectedTargetTenantId != null &&
                            itemInfo?.currentTenantId == uiState.selectedTargetTenantId

                    TransferTagCard(
                        tag = tag,
                        itemInfo = itemInfo,
                        isAlreadyCorrect = isAlreadyCorrect,
                        onRemove = { viewModel.removeTag(tag.epc) }
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
                                    Icons.Default.SwapHoriz,
                                    contentDescription = null,
                                    modifier = Modifier.size(80.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    text = "Hedef oteli secin ve etiketleri tarayin",
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Yanlis otele atanan etiketler dogru otele transfer edilecek",
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                                )
                            }
                        }
                    }
                }
            }

            // Error/Success messages
            uiState.error?.let { error ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = Error.copy(alpha = 0.1f))
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Error, contentDescription = null, tint = Error)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = error, color = Error, fontSize = 14.sp)
                    }
                }
            }

            uiState.successMessage?.let { msg ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    colors = CardDefaults.cardColors(containerColor = SuccessColor.copy(alpha = 0.1f))
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = SuccessColor)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = msg, color = SuccessColor, fontSize = 14.sp)
                    }
                }
            }

            // Transfer button
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                val canTransfer = uiState.selectedTargetTenantId != null &&
                        uiState.scannedTags.isNotEmpty() &&
                        !uiState.isScanning &&
                        !uiState.isTransferring

                Button(
                    onClick = { showTransferDialog = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    enabled = canTransfer,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (canTransfer) TransferColor else MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    if (uiState.isTransferring) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = Color.White
                        )
                    } else {
                        Icon(Icons.Default.SwapHoriz, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Transfer Et (${uiState.scannedTags.size} etiket)",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }

    // Transfer confirmation dialog
    if (showTransferDialog) {
        val registered = uiState.scannedItemsInfo.values.count { it.isRegistered }
        val alreadyCorrect = uiState.selectedTargetTenantId?.let { targetId ->
            uiState.scannedItemsInfo.values.count { it.currentTenantId == targetId }
        } ?: 0

        AlertDialog(
            onDismissRequest = { showTransferDialog = false },
            title = { Text("Transfer Onayi") },
            text = {
                Column {
                    Text("${uiState.scannedTags.size} etiket taranmis.")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Hedef otel: ${uiState.selectedTargetTenantName}",
                        fontWeight = FontWeight.Medium
                    )
                    if (uiState.selectedItemTypeName != null) {
                        Text(
                            "Stok degisimi: ${uiState.selectedItemTypeName}",
                            fontWeight = FontWeight.Medium,
                            color = TransferColor
                        )
                    }
                    if (registered > 0) {
                        Text(
                            "$registered kayitli urun",
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (alreadyCorrect > 0) {
                        Text(
                            "$alreadyCorrect urun zaten bu otele ait",
                            fontSize = 14.sp,
                            color = SuccessColor
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Devam etmek istiyor musunuz?")
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showTransferDialog = false
                    viewModel.transferItems()
                }) {
                    Text("Transfer Et", color = TransferColor)
                }
            },
            dismissButton = {
                TextButton(onClick = { showTransferDialog = false }) {
                    Text("Iptal")
                }
            }
        )
    }

    // Transfer result dialog
    uiState.transferResult?.let { result ->
        AlertDialog(
            onDismissRequest = { viewModel.clearTransferResult() },
            title = { Text("Transfer Sonucu") },
            text = {
                Column {
                    Text(
                        "${result.transferred} urun basariyla transfer edildi",
                        fontWeight = FontWeight.Bold,
                        color = if (result.transferred > 0) SuccessColor else MaterialTheme.colorScheme.onSurface
                    )
                    if (result.alreadyCorrect > 0) {
                        Text("${result.alreadyCorrect} urun zaten dogru otelde")
                    }
                    if (result.notFound > 0) {
                        Text(
                            "${result.notFound} etiket sistemde bulunamadi",
                            color = WarningColor
                        )
                    }
                    if (result.transferredItems.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Detaylar:", fontWeight = FontWeight.Medium)
                        result.transferredItems.take(10).forEach { item ->
                            Text(
                                "${item.itemType}: ${item.fromTenant} -> ${item.toTenant}",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (result.transferredItems.size > 10) {
                            Text(
                                "... ve ${result.transferredItems.size - 10} daha",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.clearTransferResult() }) {
                    Text("Tamam")
                }
            }
        )
    }
}

@Composable
fun TransferTagCard(
    tag: com.laundry.rfid.rfid.RfidTag,
    itemInfo: TransferItemInfo?,
    isAlreadyCorrect: Boolean,
    onRemove: () -> Unit
) {
    val cardColor = when {
        isAlreadyCorrect -> SuccessColor.copy(alpha = 0.15f)
        itemInfo?.isRegistered == true -> TransferColor.copy(alpha = 0.1f)
        itemInfo?.isRegistered == false -> Error.copy(alpha = 0.1f)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    }

    val iconColor = when {
        isAlreadyCorrect -> SuccessColor
        itemInfo?.isRegistered == true -> TransferColor
        itemInfo?.isRegistered == false -> Error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = cardColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                when {
                    isAlreadyCorrect -> Icons.Default.CheckCircle
                    itemInfo?.isRegistered == true -> Icons.Default.SwapHoriz
                    itemInfo?.isRegistered == false -> Icons.Default.Help
                    else -> Icons.Default.HourglassEmpty
                },
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(28.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                if (itemInfo != null && itemInfo.isRegistered) {
                    Text(
                        text = itemInfo.itemTypeName ?: "Bilinmeyen Urun",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = iconColor
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = itemInfo.currentTenantName ?: "Bilinmeyen Otel",
                            fontSize = 13.sp,
                            color = if (isAlreadyCorrect) SuccessColor else WarningColor,
                            fontWeight = FontWeight.Medium
                        )
                        if (isAlreadyCorrect) {
                            Text(
                                text = "Zaten dogru",
                                fontSize = 12.sp,
                                color = SuccessColor
                            )
                        }
                    }
                    Text(
                        text = tag.epc,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                } else if (itemInfo != null && !itemInfo.isRegistered) {
                    Text(
                        text = tag.epc,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "Kayitsiz etiket",
                        fontSize = 12.sp,
                        color = Error
                    )
                } else {
                    Text(
                        text = tag.epc,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "Sorgulanıyor...",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Remove button
            IconButton(
                onClick = onRemove,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Kaldir",
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
fun TargetHotelBar(
    selectedTenantName: String?,
    tenants: List<com.laundry.rfid.data.remote.dto.TenantDto>,
    isLoading: Boolean,
    showSelector: Boolean,
    onShowSelector: () -> Unit,
    onHideSelector: () -> Unit,
    onSelectTenant: (String, String) -> Unit,
    onRefresh: () -> Unit
) {
    var searchText by remember { mutableStateOf("") }

    val filteredTenants = remember(tenants, searchText) {
        if (searchText.isBlank()) tenants
        else tenants.filter { it.name.contains(searchText, ignoreCase = true) }
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selectedTenantName != null) TransferColor.copy(alpha = 0.1f)
        else WarningColor.copy(alpha = 0.1f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.SwapHoriz,
                contentDescription = null,
                tint = if (selectedTenantName != null) TransferColor else WarningColor,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Hedef:",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = if (selectedTenantName != null) TransferColor else WarningColor
            )
            Spacer(modifier = Modifier.width(8.dp))

            Card(
                modifier = Modifier
                    .weight(1f)
                    .clickable(enabled = !isLoading) { onShowSelector() },
                colors = CardDefaults.cardColors(containerColor = Color.Transparent),
                border = CardDefaults.outlinedCardBorder()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = selectedTenantName ?: "Otel secin...",
                        fontWeight = if (selectedTenantName != null) FontWeight.Medium else FontWeight.Normal,
                        color = if (selectedTenantName != null) TransferColor else WarningColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                    }
                }
            }

            IconButton(onClick = onRefresh, enabled = !isLoading) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = "Yenile",
                    tint = if (isLoading) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.primary
                )
            }
        }
    }

    // Hotel selection dialog
    if (showSelector && !isLoading) {
        Dialog(
            onDismissRequest = {
                searchText = ""
                onHideSelector()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth(0.9f)
                    .fillMaxHeight(0.6f),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.fillMaxSize()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Hedef Otel Secin",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = {
                            searchText = ""
                            onHideSelector()
                        }) {
                            Icon(Icons.Default.Close, contentDescription = "Kapat")
                        }
                    }

                    OutlinedTextField(
                        value = searchText,
                        onValueChange = { searchText = it },
                        placeholder = { Text("Ara...") },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        trailingIcon = {
                            if (searchText.isNotEmpty()) {
                                IconButton(onClick = { searchText = "" }) {
                                    Icon(Icons.Default.Clear, contentDescription = "Temizle")
                                }
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp)
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        items(
                            count = filteredTenants.size,
                            key = { filteredTenants[it].id }
                        ) { index ->
                            val tenant = filteredTenants[index]
                            val isSelected = tenant.name == selectedTenantName

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onSelectTenant(tenant.id, tenant.name)
                                        searchText = ""
                                        onHideSelector()
                                    }
                                    .background(
                                        if (isSelected) TransferColor.copy(alpha = 0.1f)
                                        else Color.Transparent,
                                        RoundedCornerShape(8.dp)
                                    )
                                    .padding(horizontal = 12.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    if (isSelected) Icons.Default.CheckCircle else Icons.Default.Business,
                                    contentDescription = null,
                                    tint = if (isSelected) TransferColor
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(24.dp)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = tenant.name,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (isSelected) TransferColor
                                    else MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        if (filteredTenants.isEmpty()) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(32.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "Sonuc bulunamadi",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ItemTypeBar(
    selectedItemTypeName: String?,
    itemTypes: List<com.laundry.rfid.data.remote.dto.ItemTypeDto>,
    isLoading: Boolean,
    showSelector: Boolean,
    onShowSelector: () -> Unit,
    onHideSelector: () -> Unit,
    onSelectItemType: (String, String) -> Unit,
    onClear: () -> Unit
) {
    var searchText by remember { mutableStateOf("") }

    val filteredItemTypes = remember(itemTypes, searchText) {
        if (searchText.isBlank()) itemTypes
        else itemTypes.filter { it.name.contains(searchText, ignoreCase = true) }
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selectedItemTypeName != null) TransferColor.copy(alpha = 0.08f)
        else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.LocalOffer,
                contentDescription = null,
                tint = if (selectedItemTypeName != null) TransferColor
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Stok:",
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = if (selectedItemTypeName != null) TransferColor
                else MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.width(8.dp))

            Card(
                modifier = Modifier
                    .weight(1f)
                    .clickable(enabled = !isLoading) { onShowSelector() },
                colors = CardDefaults.cardColors(containerColor = Color.Transparent),
                border = CardDefaults.outlinedCardBorder()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = selectedItemTypeName ?: "Degistirme (opsiyonel)",
                        fontWeight = if (selectedItemTypeName != null) FontWeight.Medium else FontWeight.Normal,
                        fontSize = 13.sp,
                        color = if (selectedItemTypeName != null) TransferColor
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(20.dp))
                }
            }

            if (selectedItemTypeName != null) {
                IconButton(onClick = onClear, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Temizle",
                        tint = TransferColor,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }

    // Item type selection dialog
    if (showSelector && !isLoading) {
        Dialog(
            onDismissRequest = {
                searchText = ""
                onHideSelector()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth(0.9f)
                    .fillMaxHeight(0.5f),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.fillMaxSize()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Stok Kodu Secin",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = {
                            searchText = ""
                            onHideSelector()
                        }) {
                            Icon(Icons.Default.Close, contentDescription = "Kapat")
                        }
                    }

                    OutlinedTextField(
                        value = searchText,
                        onValueChange = { searchText = it },
                        placeholder = { Text("Ara...") },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        trailingIcon = {
                            if (searchText.isNotEmpty()) {
                                IconButton(onClick = { searchText = "" }) {
                                    Icon(Icons.Default.Clear, contentDescription = "Temizle")
                                }
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp)
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        items(
                            count = filteredItemTypes.size,
                            key = { filteredItemTypes[it].id }
                        ) { index ->
                            val itemType = filteredItemTypes[index]
                            val isSelected = itemType.name == selectedItemTypeName

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onSelectItemType(itemType.id, itemType.name)
                                        searchText = ""
                                        onHideSelector()
                                    }
                                    .background(
                                        if (isSelected) TransferColor.copy(alpha = 0.1f)
                                        else Color.Transparent,
                                        RoundedCornerShape(8.dp)
                                    )
                                    .padding(horizontal = 12.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    if (isSelected) Icons.Default.CheckCircle else Icons.Default.LocalOffer,
                                    contentDescription = null,
                                    tint = if (isSelected) TransferColor
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(24.dp)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = itemType.name,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (isSelected) TransferColor
                                    else MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        if (filteredItemTypes.isEmpty()) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(32.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "Sonuc bulunamadi",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
