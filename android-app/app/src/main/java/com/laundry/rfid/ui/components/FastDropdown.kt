package com.laundry.rfid.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.laundry.rfid.data.remote.dto.ItemTypeDto
import com.laundry.rfid.data.remote.dto.TenantDto
import com.laundry.rfid.ui.theme.*

/**
 * Ultra-fast hotel selector using Dialog + LazyColumn
 * Renders only visible items for instant opening
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FastHotelDropdown(
    tenants: List<TenantDto>,
    selectedTenantId: String?,
    onSelectTenant: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var showDialog by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }

    val selectedTenant = remember(selectedTenantId, tenants) {
        tenants.find { it.id == selectedTenantId }
    }

    // Trigger button
    OutlinedCard(
        onClick = { showDialog = true },
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.outlinedCardColors(
            containerColor = if (selectedTenant != null)
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            else Color.Transparent
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Business,
                contentDescription = null,
                tint = if (selectedTenant != null) MaterialTheme.colorScheme.primary
                       else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = selectedTenant?.name ?: "Otel seçin...",
                fontWeight = if (selectedTenant != null) FontWeight.Medium else FontWeight.Normal,
                color = if (selectedTenant != null) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    // Fast dialog with LazyColumn
    if (showDialog) {
        FastSelectionDialog(
            title = "Otel Seçin",
            items = tenants,
            selectedId = selectedTenantId,
            onSelect = { id ->
                onSelectTenant(id)
                showDialog = false
                searchQuery = ""
            },
            onDismiss = {
                showDialog = false
                searchQuery = ""
            },
            searchQuery = searchQuery,
            onSearchChange = { searchQuery = it },
            itemId = { it.id },
            itemName = { it.name },
            itemFilter = { item, query ->
                item.name.contains(query, ignoreCase = true)
            },
            icon = Icons.Default.Business
        )
    }
}

/**
 * Ultra-fast item type selector using Dialog + LazyColumn
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FastItemTypeDropdown(
    itemTypes: List<ItemTypeDto>,
    selectedItemTypeId: String?,
    onSelectItemType: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var showDialog by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }

    val selectedItemType = remember(selectedItemTypeId, itemTypes) {
        itemTypes.find { it.id == selectedItemTypeId }
    }

    // Trigger button
    OutlinedCard(
        onClick = { showDialog = true },
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.outlinedCardColors(
            containerColor = if (selectedItemType != null)
                ProcessColor.copy(alpha = 0.1f)
            else Color.Transparent
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.LocalOffer,
                contentDescription = null,
                tint = if (selectedItemType != null) ProcessColor
                       else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = selectedItemType?.name ?: "Ürün tipi seçin...",
                fontWeight = if (selectedItemType != null) FontWeight.Medium else FontWeight.Normal,
                color = if (selectedItemType != null) ProcessColor
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    // Fast dialog with LazyColumn
    if (showDialog) {
        FastSelectionDialog(
            title = "Ürün Tipi Seçin",
            items = itemTypes,
            selectedId = selectedItemTypeId,
            onSelect = { id ->
                onSelectItemType(id)
                showDialog = false
                searchQuery = ""
            },
            onDismiss = {
                showDialog = false
                searchQuery = ""
            },
            searchQuery = searchQuery,
            onSearchChange = { searchQuery = it },
            itemId = { it.id },
            itemName = { it.name },
            itemFilter = { item, query ->
                item.name.contains(query, ignoreCase = true)
            },
            icon = Icons.Default.LocalOffer,
            accentColor = ProcessColor
        )
    }
}

/**
 * Generic fast selection dialog - renders only visible items
 */
@Composable
fun <T> FastSelectionDialog(
    title: String,
    items: List<T>,
    selectedId: String?,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    itemId: (T) -> String,
    itemName: (T) -> String,
    itemFilter: (T, String) -> Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    accentColor: Color = MaterialTheme.colorScheme.primary
) {
    // Filter items - memoized
    val filteredItems = remember(items, searchQuery) {
        if (searchQuery.isBlank()) items
        else items.filter { itemFilter(it, searchQuery) }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false
        )
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth(0.9f)
                .fillMaxHeight(0.7f),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = title,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Kapat")
                    }
                }

                // Search field
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = onSearchChange,
                    placeholder = { Text("Ara...") },
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null)
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { onSearchChange("") }) {
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

                // Fast LazyColumn - only renders visible items
                if (filteredItems.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Sonuç bulunamadı",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        items(
                            count = filteredItems.size,
                            key = { itemId(filteredItems[it]) }
                        ) { index ->
                            val item = filteredItems[index]
                            val id = itemId(item)
                            val name = itemName(item)
                            val isSelected = id == selectedId

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onSelect(id) }
                                    .background(
                                        if (isSelected) accentColor.copy(alpha = 0.1f)
                                        else Color.Transparent,
                                        RoundedCornerShape(8.dp)
                                    )
                                    .padding(horizontal = 12.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = if (isSelected) Icons.Default.CheckCircle else icon,
                                    contentDescription = null,
                                    tint = if (isSelected) accentColor
                                           else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(24.dp)
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = name,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (isSelected) accentColor
                                            else MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }

                // Footer
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Kapat")
                    }
                }
            }
        }
    }
}
