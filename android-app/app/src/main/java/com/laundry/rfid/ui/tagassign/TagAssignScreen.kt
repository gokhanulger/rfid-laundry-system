package com.laundry.rfid.ui.tagassign

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.delay
import com.laundry.rfid.data.remote.dto.ItemTypeDto
import com.laundry.rfid.data.remote.dto.TenantDto
import com.laundry.rfid.rfid.RfidState
import com.laundry.rfid.rfid.RfidTag
import com.laundry.rfid.ui.components.FastHotelDropdown
import com.laundry.rfid.ui.components.FastItemTypeDropdown
import com.laundry.rfid.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TagAssignScreen(
    viewModel: TagAssignViewModel,
    onBack: () -> Unit,
    onScanQR: ((String) -> Unit) -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var showResultDialog by remember { mutableStateOf(false) }
    var showQRScanDialog by remember { mutableStateOf(false) }

    // Show result dialog when save completes
    LaunchedEffect(uiState.saveResult) {
        if (uiState.saveResult != null) {
            showResultDialog = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Ürün Tanımla", fontWeight = FontWeight.Bold)
                        Text(
                            "Tag'leri otel ve ürün tipiyle eşleştir",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Geri")
                    }
                },
                actions = {
                    // Refresh button
                    IconButton(
                        onClick = { viewModel.refreshData() },
                        enabled = !uiState.isLoading
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Yenile",
                            tint = if (uiState.isLoading)
                                MaterialTheme.colorScheme.onSurfaceVariant
                            else
                                MaterialTheme.colorScheme.primary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Ayarlar yükleniyor...")
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // Error Banner
                uiState.error?.let { error ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Error.copy(alpha = 0.1f)
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
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = error,
                                color = Error,
                                fontSize = 14.sp,
                                modifier = Modifier.weight(1f)
                            )
                            IconButton(onClick = { viewModel.clearError() }) {
                                Icon(Icons.Default.Close, contentDescription = "Kapat", tint = Error)
                            }
                        }
                    }
                }

                // Step 1: Hotel Selection with hardware QR scanner support
                SectionHeader(
                    number = 1,
                    title = "Otel Seçin",
                    isCompleted = uiState.selectedTenantId != null
                )

                // Fast hotel selector using Dialog + LazyColumn
                FastHotelDropdown(
                    tenants = uiState.tenants,
                    selectedTenantId = uiState.selectedTenantId,
                    onSelectTenant = { viewModel.selectTenant(it) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )

                // Step 2: Item Type Selection
                SectionHeader(
                    number = 2,
                    title = "Ürün Tipi Seçin",
                    isCompleted = uiState.selectedItemTypeId != null
                )

                // Fast item type selector using Dialog + LazyColumn
                FastItemTypeDropdown(
                    itemTypes = uiState.itemTypes,
                    selectedItemTypeId = uiState.selectedItemTypeId,
                    onSelectItemType = { viewModel.selectItemType(it) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )

                // Step 3: Scan Tags
                SectionHeader(
                    number = 3,
                    title = "Etiketleri Tarayın",
                    subtitle = "${uiState.scannedTags.size} etiket",
                    isCompleted = uiState.scannedTags.isNotEmpty()
                )

                // Scan Controls
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Scan button
                    Button(
                        onClick = { viewModel.toggleScanning() },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (uiState.isScanning) Error else SuccessColor
                        ),
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            if (uiState.isScanning) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            if (uiState.isScanning) "DURDUR" else "TARAMAYA BAŞLA",
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Spacer(modifier = Modifier.width(8.dp))

                    // Clear button
                    if (uiState.scannedTags.isNotEmpty()) {
                        OutlinedButton(
                            onClick = { viewModel.clearTags() }
                        ) {
                            Icon(Icons.Default.Clear, contentDescription = "Temizle")
                        }
                    }
                }

                // Status indicator
                if (uiState.isScanning) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = SuccessColor
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            "Taranıyor... Etiketleri cihaza yaklaştırın",
                            fontSize = 14.sp,
                            color = SuccessColor
                        )
                    }
                }

                // Scanned Tags List - optimized with keys
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    items(
                        items = uiState.scannedTags,
                        key = { it.epc }
                    ) { tag ->
                        ScannedTagCard(
                            tag = tag,
                            onRemove = { viewModel.removeTag(tag.epc) }
                        )
                    }

                    if (uiState.scannedTags.isEmpty()) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Icon(
                                        Icons.Default.QrCodeScanner,
                                        contentDescription = null,
                                        modifier = Modifier.size(64.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text(
                                        "Henüz etiket taranmadı",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }

                // Save Button
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp)
                ) {
                    Button(
                        onClick = { viewModel.saveItems() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        enabled = uiState.selectedTenantId != null &&
                                uiState.selectedItemTypeId != null &&
                                uiState.scannedTags.isNotEmpty() &&
                                !uiState.isSaving,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary
                        )
                    ) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = Color.White,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.Save, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                "KAYDET (${uiState.scannedTags.size} ürün)",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }

    // Result Dialog
    if (showResultDialog && uiState.saveResult != null) {
        val result = uiState.saveResult!!
        AlertDialog(
            onDismissRequest = {
                showResultDialog = false
                viewModel.clearSaveResult()
            },
            icon = {
                Icon(
                    if (result.failed == 0) Icons.Default.CheckCircle else Icons.Default.Warning,
                    contentDescription = null,
                    tint = if (result.failed == 0) SuccessColor else WarningColor,
                    modifier = Modifier.size(48.dp)
                )
            },
            title = { Text("Kayıt Sonucu") },
            text = {
                Column {
                    Text(
                        "${result.created} ürün başarıyla kaydedildi",
                        color = SuccessColor,
                        fontWeight = FontWeight.Medium
                    )
                    if (result.failed > 0) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "${result.failed} ürün kaydedilemedi",
                            color = Error,
                            fontWeight = FontWeight.Medium
                        )
                        if (result.errors.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            result.errors.take(5).forEach { error ->
                                Text(
                                    "• $error",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (result.errors.size > 5) {
                                Text(
                                    "... ve ${result.errors.size - 5} hata daha",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showResultDialog = false
                    viewModel.clearSaveResult()
                }) {
                    Text("Tamam")
                }
            }
        )
    }

    // Error Snackbar
    uiState.error?.let { error ->
        LaunchedEffect(error) {
            kotlinx.coroutines.delay(3000)
            viewModel.clearError()
        }
    }
}

@Composable
fun SectionHeader(
    number: Int,
    title: String,
    subtitle: String? = null,
    isCompleted: Boolean = false
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .background(
                    if (isCompleted) SuccessColor else MaterialTheme.colorScheme.primary,
                    CircleShape
                ),
            contentAlignment = Alignment.Center
        ) {
            if (isCompleted) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                )
            } else {
                Text(
                    "$number",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            title,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp
        )
        if (subtitle != null) {
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                subtitle,
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

// New: Hotel dropdown with hardware QR scanner support (like Toplama screen)
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun SearchableHotelDropdownWithScanner(
    tenants: List<TenantDto>,
    selectedTenantId: String?,
    onSelectTenant: (String) -> Unit,
    onQrScanned: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var qrInput by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val qrFocusRequester = remember { FocusRequester() }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current

    val selectedTenant = tenants.find { it.id == selectedTenantId }
    val filteredTenants = remember(tenants, searchQuery) {
        if (searchQuery.isBlank()) {
            tenants
        } else {
            tenants.filter { it.name.contains(searchQuery, ignoreCase = true) }
        }
    }

    // Auto-focus hidden QR input for hardware scanner
    LaunchedEffect(Unit) {
        qrFocusRequester.requestFocus()
        keyboardController?.hide()
    }

    // Auto-process QR code after input stops (debounce 300ms) - for hardware scanner
    LaunchedEffect(qrInput) {
        if (qrInput.isNotBlank()) {
            delay(300)
            // Find tenant by QR code
            val tenant = tenants.find { it.qrCode == qrInput.trim() }
            if (tenant != null) {
                onSelectTenant(tenant.id)
            } else {
                // Try partial name match or pass to callback
                onQrScanned(qrInput.trim())
            }
            qrInput = ""
            qrFocusRequester.requestFocus()
            keyboardController?.hide()
        }
    }

    // Auto-focus search field when dropdown opens
    LaunchedEffect(expanded) {
        if (expanded) {
            delay(100)
            try {
                focusRequester.requestFocus()
            } catch (e: Exception) {
                // Ignore focus errors
            }
        } else {
            // When dropdown closes, focus back to hidden QR input
            qrFocusRequester.requestFocus()
            keyboardController?.hide()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        // Hidden QR Scanner Input - for hardware scanner only (invisible)
        BasicTextField(
            value = qrInput,
            onValueChange = { qrInput = it },
            modifier = Modifier
                .size(1.dp)
                .focusRequester(qrFocusRequester),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done)
        )

        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = it }
        ) {
            OutlinedTextField(
                value = selectedTenant?.name ?: "",
                onValueChange = {},
                readOnly = true,
                placeholder = { Text("Otel seçin veya QR tarayın...") },
                leadingIcon = {
                    Icon(
                        Icons.Default.Business,
                        contentDescription = null,
                        tint = if (selectedTenant != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                trailingIcon = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.QrCodeScanner,
                            contentDescription = "QR ile tara",
                            tint = SuccessColor,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                    }
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = if (selectedTenant != null) MaterialTheme.colorScheme.primary.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline
                ),
                modifier = Modifier
                    .menuAnchor()
                    .fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = {
                    expanded = false
                    searchQuery = ""
                    focusManager.clearFocus()
                    keyboardController?.hide()
                }
            ) {
                // Search field inside dropdown
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Ara...", fontSize = 14.sp) },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(
                                onClick = { searchQuery = "" },
                                modifier = Modifier.size(20.dp)
                            ) {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "Temizle",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .focusRequester(focusRequester),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    shape = RoundedCornerShape(8.dp)
                )

                Divider(modifier = Modifier.padding(vertical = 4.dp))

                if (filteredTenants.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Sonuç bulunamadı",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    filteredTenants.forEach { tenant ->
                        val isSelected = tenant.id == selectedTenantId
                        DropdownMenuItem(
                            text = {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(
                                        Icons.Default.Business,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp),
                                        tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Text(
                                        tenant.name,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            },
                            onClick = {
                                onSelectTenant(tenant.id)
                                expanded = false
                                searchQuery = ""
                                focusManager.clearFocus()
                                keyboardController?.hide()
                            },
                            leadingIcon = if (isSelected) {
                                {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchableHotelDropdown(
    tenants: List<TenantDto>,
    selectedTenantId: String?,
    onSelectTenant: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    val selectedTenant = tenants.find { it.id == selectedTenantId }
    val filteredTenants = remember(tenants, searchQuery) {
        if (searchQuery.isBlank()) {
            tenants
        } else {
            tenants.filter { it.name.contains(searchQuery, ignoreCase = true) }
        }
    }

    // Auto-focus search field when dropdown opens
    LaunchedEffect(expanded) {
        if (expanded) {
            delay(100)
            try {
                focusRequester.requestFocus()
            } catch (e: Exception) {
                // Ignore focus errors
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
    ) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = it }
        ) {
            OutlinedTextField(
                value = selectedTenant?.name ?: "",
                onValueChange = {},
                readOnly = true,
                placeholder = { Text("Otel seçin...") },
                leadingIcon = {
                    Icon(
                        Icons.Default.Business,
                        contentDescription = null,
                        tint = if (selectedTenant != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                trailingIcon = {
                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = if (selectedTenant != null) MaterialTheme.colorScheme.primary.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline
                ),
                modifier = Modifier
                    .menuAnchor()
                    .fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = {
                    expanded = false
                    searchQuery = ""
                }
            ) {
                // Search field inside dropdown
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Ara...", fontSize = 14.sp) },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(
                                onClick = { searchQuery = "" },
                                modifier = Modifier.size(20.dp)
                            ) {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "Temizle",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .focusRequester(focusRequester),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    shape = RoundedCornerShape(8.dp)
                )

                Divider(modifier = Modifier.padding(vertical = 4.dp))

                if (filteredTenants.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Sonuç bulunamadı",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    filteredTenants.forEach { tenant ->
                        val isSelected = tenant.id == selectedTenantId
                        DropdownMenuItem(
                            text = {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(
                                        Icons.Default.Business,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp),
                                        tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Text(
                                        tenant.name,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            },
                            onClick = {
                                onSelectTenant(tenant.id)
                                expanded = false
                                searchQuery = ""
                            },
                            leadingIcon = if (isSelected) {
                                {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchableItemTypeDropdown(
    itemTypes: List<ItemTypeDto>,
    selectedItemTypeId: String?,
    onSelectItemType: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }

    val selectedItemType = itemTypes.find { it.id == selectedItemTypeId }
    val filteredItemTypes = remember(itemTypes, searchQuery) {
        if (searchQuery.isBlank()) {
            itemTypes
        } else {
            itemTypes.filter { it.name.contains(searchQuery, ignoreCase = true) }
        }
    }

    // Auto-focus search field when dropdown opens
    LaunchedEffect(expanded) {
        if (expanded) {
            delay(100)
            try {
                focusRequester.requestFocus()
            } catch (e: Exception) {
                // Ignore focus errors
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = it }
        ) {
            OutlinedTextField(
                value = selectedItemType?.name ?: "",
                onValueChange = {},
                readOnly = true,
                placeholder = { Text("Ürün tipi seçin...") },
                leadingIcon = {
                    Icon(
                        Icons.Default.LocalOffer,
                        contentDescription = null,
                        tint = if (selectedItemType != null) ProcessColor else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                trailingIcon = {
                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = ProcessColor,
                    unfocusedBorderColor = if (selectedItemType != null) ProcessColor.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline
                ),
                modifier = Modifier
                    .menuAnchor()
                    .fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(12.dp)
            )

            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = {
                    expanded = false
                    searchQuery = ""
                }
            ) {
                // Search field inside dropdown
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Ara...", fontSize = 14.sp) },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(
                                onClick = { searchQuery = "" },
                                modifier = Modifier.size(20.dp)
                            ) {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "Temizle",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .focusRequester(focusRequester),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    shape = RoundedCornerShape(8.dp)
                )

                Divider(modifier = Modifier.padding(vertical = 4.dp))

                if (filteredItemTypes.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Sonuç bulunamadı",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    filteredItemTypes.forEach { itemType ->
                        val isSelected = itemType.id == selectedItemTypeId
                        DropdownMenuItem(
                            text = {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(
                                        Icons.Default.LocalOffer,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp),
                                        tint = if (isSelected) ProcessColor else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Text(
                                        itemType.name,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                        color = if (isSelected) ProcessColor else MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            },
                            onClick = {
                                onSelectItemType(itemType.id)
                                expanded = false
                                searchQuery = ""
                            },
                            leadingIcon = if (isSelected) {
                                {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = null,
                                        tint = ProcessColor
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

@Composable
fun TenantChip(
    tenant: TenantDto,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
        border = if (!isSelected) androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline
        ) else null,
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Business,
                contentDescription = null,
                tint = if (isSelected) Color.White else MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                tenant.name,
                color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurface,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
            )
        }
    }
}

@Composable
fun ItemTypeChip(
    itemType: ItemTypeDto,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        color = if (isSelected) ProcessColor else MaterialTheme.colorScheme.surface,
        border = if (!isSelected) androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline
        ) else null,
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.LocalOffer,
                contentDescription = null,
                tint = if (isSelected) Color.White else ProcessColor,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                itemType.name,
                color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurface,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
            )
        }
    }
}

@Composable
fun ScannedTagCard(
    tag: RfidTag,
    onRemove: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = SuccessColor.copy(alpha = 0.1f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                tint = SuccessColor,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                tag.epc,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            // Signal badge
            Box(
                modifier = Modifier
                    .background(
                        when {
                            tag.rssi > -40 -> SuccessColor.copy(alpha = 0.2f)
                            tag.rssi > -60 -> WarningColor.copy(alpha = 0.2f)
                            else -> Error.copy(alpha = 0.2f)
                        },
                        RoundedCornerShape(6.dp)
                    )
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(
                    "${tag.rssi}dB",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    color = when {
                        tag.rssi > -40 -> SuccessColor
                        tag.rssi > -60 -> WarningColor
                        else -> Error
                    }
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            IconButton(
                onClick = onRemove,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Kaldır",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}
