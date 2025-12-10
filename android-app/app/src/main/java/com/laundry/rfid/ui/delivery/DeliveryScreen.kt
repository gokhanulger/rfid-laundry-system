package com.laundry.rfid.ui.delivery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.material3.LocalTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.laundry.rfid.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeliveryScreen(
    viewModel: DeliveryViewModel = hiltViewModel(),
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadDeliveries()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Otellere Teslim Et", fontWeight = FontWeight.Bold)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Geri")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.loadDeliveries() }) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "Yenile")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DeliverColor.copy(alpha = 0.2f)
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Hotel Selection Bar with Scanner (handles both hotel QR and package barcode)
            HotelSelectionBar(
                hotels = uiState.hotels,
                selectedHotelId = uiState.selectedHotelId,
                onSelectHotel = { viewModel.selectHotel(it) },
                onScanned = { code -> viewModel.handleScannedCode(code) }
            )

            // Error message
            uiState.error?.let { error ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    colors = CardDefaults.cardColors(containerColor = Error.copy(alpha = 0.1f))
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Error, contentDescription = null, tint = Error, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(error, color = Error, fontSize = 14.sp)
                    }
                }
            }

            // Stats bar
            if (uiState.selectedHotelId != null) {
                val filteredDeliveries = uiState.filteredDeliveries
                val totalItems = filteredDeliveries.sumOf { it.itemCount }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(DeliverColor.copy(alpha = 0.1f))
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    StatItem(
                        value = filteredDeliveries.size.toString(),
                        label = "Paket",
                        color = DeliverColor
                    )
                    StatItem(
                        value = totalItems.toString(),
                        label = "Ürün",
                        color = DeliverColor
                    )
                }
            }

            if (uiState.isLoading && uiState.deliveries.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.selectedHotelId == null) {
                // No hotel selected
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.Business,
                            contentDescription = null,
                            modifier = Modifier.size(80.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "Otel seçin",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Yukarıdan teslim edilecek oteli seçin",
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        )
                    }
                }
            } else if (uiState.filteredDeliveries.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            modifier = Modifier.size(80.dp),
                            tint = SuccessColor.copy(alpha = 0.5f)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "Teslim edilecek paket yok",
                            fontSize = 18.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                // Package grid - compact view
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(uiState.filteredDeliveries, key = { it.id }) { delivery ->
                        CompactDeliveryCard(
                            delivery = delivery,
                            onDeliver = { viewModel.deliverPackage(delivery.id) },
                            isDelivering = uiState.deliveringIds.contains(delivery.id)
                        )
                    }
                }
            }
        }
    }

    // Success dialog
    if (uiState.showSuccessDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissSuccessDialog() },
            title = { Text("✓ Teslim Edildi") },
            text = { Text("Paket başarıyla teslim edildi.") },
            confirmButton = {
                TextButton(onClick = { viewModel.dismissSuccessDialog() }) {
                    Text("Tamam")
                }
            }
        )
    }
}

@Composable
fun StatItem(value: String, label: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun HotelSelectionBar(
    hotels: List<HotelInfo>,
    selectedHotelId: String?,
    onSelectHotel: (String?) -> Unit,
    onScanned: (String) -> Unit
) {
    var scanInput by remember { mutableStateOf("") }
    var dropdownExpanded by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current

    val selectedHotel = hotels.find { it.id == selectedHotelId }

    // Auto-focus for hardware scanner but hide keyboard
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
        keyboardController?.hide()
    }

    // Auto-process after input stops (debounce 300ms)
    LaunchedEffect(scanInput) {
        if (scanInput.isNotBlank()) {
            kotlinx.coroutines.delay(300)
            onScanned(scanInput.trim())
            scanInput = ""
            focusRequester.requestFocus()
            keyboardController?.hide()
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        // Hidden Scanner Input - for hardware scanner only (invisible)
        BasicTextField(
            value = scanInput,
            onValueChange = { scanInput = it },
            modifier = Modifier
                .size(1.dp)
                .focusRequester(focusRequester),
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done)
        )

        // Hotel dropdown
        if (hotels.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Business,
                    contentDescription = null,
                    tint = if (selectedHotel != null) DeliverColor else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))

                ExposedDropdownMenuBox(
                    expanded = dropdownExpanded,
                    onExpandedChange = { dropdownExpanded = it },
                    modifier = Modifier.weight(1f)
                ) {
                    OutlinedTextField(
                        value = selectedHotel?.let { "${it.name} (${it.packageCount} paket)" } ?: "",
                        onValueChange = {},
                        readOnly = true,
                        placeholder = {
                            Text(
                                "Otel seçin...",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded)
                        },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = if (selectedHotel != null) DeliverColor else MaterialTheme.colorScheme.outline,
                            unfocusedBorderColor = if (selectedHotel != null) DeliverColor.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline,
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent
                        ),
                        modifier = Modifier
                            .menuAnchor()
                            .fillMaxWidth(),
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontWeight = FontWeight.Medium,
                            color = if (selectedHotel != null) DeliverColor else MaterialTheme.colorScheme.onSurface
                        )
                    )

                    ExposedDropdownMenu(
                        expanded = dropdownExpanded,
                        onDismissRequest = { dropdownExpanded = false }
                    ) {
                        hotels.forEach { hotel ->
                            val isSelected = hotel.id == selectedHotelId
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(
                                                Icons.Default.Business,
                                                contentDescription = null,
                                                modifier = Modifier.size(20.dp),
                                                tint = if (isSelected) DeliverColor else MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                            Spacer(modifier = Modifier.width(12.dp))
                                            Text(
                                                hotel.name,
                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                            )
                                        }
                                        Badge(
                                            containerColor = if (isSelected) DeliverColor else MaterialTheme.colorScheme.surfaceVariant
                                        ) {
                                            Text(
                                                "${hotel.packageCount}",
                                                fontSize = 11.sp,
                                                color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                },
                                onClick = {
                                    onSelectHotel(hotel.id)
                                    dropdownExpanded = false
                                },
                                leadingIcon = if (isSelected) {
                                    {
                                        Icon(
                                            Icons.Default.Check,
                                            contentDescription = null,
                                            tint = DeliverColor
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
fun CompactDeliveryCard(
    delivery: DeliveryItem,
    onDeliver: () -> Unit,
    isDelivering: Boolean
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Package icon with count
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(DeliverColor.copy(alpha = 0.15f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.Inventory2,
                        contentDescription = null,
                        tint = DeliverColor,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        "${delivery.itemCount}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = DeliverColor
                    )
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Item contents - compact
            Column(modifier = Modifier.weight(1f)) {
                if (delivery.items.isNotEmpty()) {
                    // Show items inline
                    Text(
                        text = delivery.items.joinToString(" • ") { "${it.count} ${it.name}" },
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                } else {
                    Text(
                        text = "${delivery.itemCount} ürün",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            Spacer(modifier = Modifier.width(8.dp))

            // Deliver button - compact
            Button(
                onClick = onDeliver,
                enabled = !isDelivering,
                colors = ButtonDefaults.buttonColors(
                    containerColor = DeliverColor
                ),
                shape = RoundedCornerShape(8.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
            ) {
                if (isDelivering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Teslim", fontSize = 14.sp)
                }
            }
        }
    }
}

data class DeliveryItem(
    val id: String,
    val barcode: String,
    val tenantId: String,
    val tenantName: String?,
    val tenantQrCode: String? = null,
    val itemCount: Int,
    val items: List<ItemContent>
)

data class ItemContent(
    val name: String,
    val count: Int
)

data class HotelInfo(
    val id: String,
    val name: String,
    val packageCount: Int,
    val qrCode: String? = null
)
