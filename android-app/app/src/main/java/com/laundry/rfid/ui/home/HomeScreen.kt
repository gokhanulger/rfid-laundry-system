package com.laundry.rfid.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laundry.rfid.domain.model.SessionType
import com.laundry.rfid.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onWorkflowSelected: (SessionType) -> Unit,
    onTagAssign: () -> Unit,
    onLogout: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var showLogoutDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Çamaşırhane RFID",
                            fontWeight = FontWeight.Bold
                        )
                        uiState.user?.let { user ->
                            Text(
                                text = user.fullName,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                },
                actions = {
                    // Sync status
                    if (uiState.pendingSyncCount > 0) {
                        Badge(
                            containerColor = WarningColor
                        ) {
                            Text("${uiState.pendingSyncCount}")
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                    }

                    IconButton(onClick = { viewModel.syncNow() }) {
                        if (uiState.isSyncing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.Sync, contentDescription = "Sync")
                        }
                    }

                    IconButton(onClick = { showLogoutDialog = true }) {
                        Icon(Icons.Default.Logout, contentDescription = "Logout")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "İşlem Seçin",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            // Driver-specific workflow buttons
            if (uiState.user?.role == "driver") {
                // Toplama - Kırmızı
                WorkflowButton(
                    title = "Toplama",
                    subtitle = "Otellerden kirli çamaşırları topla",
                    icon = Icons.Default.KeyboardArrowUp,
                    color = Color(0xFFDC2626), // Red
                    onClick = { onWorkflowSelected(SessionType.PICKUP) }
                )

                // Teslim Etme - Yeşil
                WorkflowButton(
                    title = "Teslim Etme",
                    subtitle = "Temiz çamaşırları otellere teslim et",
                    icon = Icons.Default.LocalShipping,
                    color = Color(0xFF16A34A), // Green
                    onClick = { onWorkflowSelected(SessionType.DELIVER) }
                )
            } else {
                // Non-driver workflow buttons (admin, operator, etc.)
                WorkflowButton(
                    title = "Toplama",
                    subtitle = "Otelden kirli ürünleri topla",
                    icon = Icons.Default.LocalShipping,
                    color = PickupColor,
                    onClick = { onWorkflowSelected(SessionType.PICKUP) }
                )

                WorkflowButton(
                    title = "İşleme",
                    subtitle = "Yıkamaya giren ürünleri tara",
                    icon = Icons.Default.LocalLaundryService,
                    color = ProcessColor,
                    onClick = { onWorkflowSelected(SessionType.PROCESS) }
                )

                WorkflowButton(
                    title = "Paketleme",
                    subtitle = "Temiz ürünleri paketle",
                    icon = Icons.Default.Inventory2,
                    color = PackageColor,
                    onClick = { onWorkflowSelected(SessionType.PACKAGE) }
                )

                WorkflowButton(
                    title = "Teslimat",
                    subtitle = "Ürünleri otele teslim et",
                    icon = Icons.Default.CheckCircle,
                    color = DeliverColor,
                    onClick = { onWorkflowSelected(SessionType.DELIVER) }
                )

                // Admin/Operator: Tag Assignment
                WorkflowButton(
                    title = "Ürün Tanımla",
                    subtitle = "Yeni etiketleri otel ve ürünle eşleştir",
                    icon = Icons.Default.NewLabel,
                    color = InfoColor,
                    onClick = onTagAssign
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Sync status card
            if (uiState.pendingSyncCount > 0) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = WarningColor.copy(alpha = 0.1f)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.CloudOff,
                            contentDescription = null,
                            tint = WarningColor
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${uiState.pendingSyncCount} oturum senkronize bekliyor",
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                text = "Bağlantı kurulunca senkronize edilecek",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        TextButton(onClick = { viewModel.syncNow() }) {
                            Text("Senkronize Et")
                        }
                    }
                }
            }
        }
    }

    // Logout confirmation dialog
    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Çıkış Yap") },
            text = { Text("Çıkış yapmak istediğinize emin misiniz?") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout()
                    onLogout()
                }) {
                    Text("Çıkış Yap")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text("İptal")
                }
            }
        )
    }
}

@Composable
fun WorkflowButton(
    title: String,
    subtitle: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(100.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = color.copy(alpha = 0.2f)
        ),
        border = BorderStroke(2.dp, color)
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(60.dp)
                    .background(color.copy(alpha = 0.3f), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = color,
                    modifier = Modifier.size(32.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column {
                Text(
                    text = title,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = color
                )
                Text(
                    text = subtitle,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(32.dp)
            )
        }
    }
}
