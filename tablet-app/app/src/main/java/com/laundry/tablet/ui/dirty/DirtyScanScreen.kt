package com.laundry.tablet.ui.dirty

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.laundry.tablet.rfid.ReaderState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DirtyScanScreen(
    tenantId: String,
    tenantName: String,
    onBack: () -> Unit,
    viewModel: DirtyScanViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val readerState by viewModel.reader.state.collectAsState()
    val context = LocalContext.current

    // Launch WhatsApp when intent is ready
    LaunchedEffect(uiState.whatsappIntent) {
        uiState.whatsappIntent?.let { wa ->
            val url = "https://wa.me/${wa.phone}?text=${Uri.encode(wa.message)}"
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            context.startActivity(intent)
            viewModel.clearWhatsAppIntent()
        }
    }

    LaunchedEffect(tenantId) {
        viewModel.initialize(tenantId)
    }

    if (uiState.isCompleted) {
        AlertDialog(
            onDismissRequest = { },
            title = { Text("Teslim Alindi", fontSize = 24.sp) },
            text = { Text("${uiState.totalMatched} urun basariyla teslim alindi.", fontSize = 20.sp) },
            confirmButton = {
                Button(onClick = { viewModel.reset(); onBack() }, modifier = Modifier.height(56.dp)) {
                    Text("Tamam", fontSize = 20.sp)
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Kirli Urun Tarama", fontWeight = FontWeight.Bold, fontSize = 22.sp)
                        Text(tenantName, fontSize = 18.sp, color = Color.White.copy(alpha = 0.8f))
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Geri", tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFFC62828),
                    titleContentColor = Color.White
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)
        ) {
            // Items list - full width
            Card(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                elevation = CardDefaults.cardElevation(4.dp)
            ) {
                if (uiState.groupedItems.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                Icons.Default.Sensors, null,
                                modifier = Modifier.size(80.dp),
                                tint = Color.Gray.copy(alpha = 0.4f)
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                if (!uiState.hasStarted) "Taramaya baslamak icin asagidaki butona basin"
                                else if (uiState.isPaused) "Tarama duraklatildi"
                                else if (readerState is ReaderState.Scanning) "Urunleri antene yaklastirin..."
                                else "Anten baglantisi bekleniyor...",
                                color = Color.Gray, fontSize = 24.sp, textAlign = TextAlign.Center
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // Header with total count + antenna stats
                        item {
                            Text(
                                "${uiState.totalMatched} Urun Tarandi",
                                fontWeight = FontWeight.Bold,
                                fontSize = 26.sp,
                                color = Color(0xFFC62828)
                            )
                            // Per-antenna tag count badges
                            val antennaStats = viewModel.reader.antennaTagCounts.collectAsState()
                            val antMask = viewModel.reader.antennaMask.collectAsState()
                            val hasAnyAntenna = antennaStats.value.any { it > 0 }
                            if (hasAnyAntenna) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    for (i in 0..3) {
                                        if ((antMask.value shr i) and 1 == 1 && antennaStats.value[i] > 0) {
                                            Surface(
                                                color = Color(0xFFE3F2FD),
                                                shape = RoundedCornerShape(8.dp)
                                            ) {
                                                Text(
                                                    "Ant${i + 1}: ${antennaStats.value[i]}",
                                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                                    fontSize = 12.sp,
                                                    color = Color(0xFF1565C0),
                                                    fontWeight = FontWeight.Medium
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                        }

                        items(uiState.groupedItems.entries.toList(), key = { it.key }) { (typeName, items) ->
                            Surface(
                                color = Color(0xFFF5F5F5),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(24.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                                    ) {
                                        Icon(Icons.Default.Checkroom, null, tint = Color(0xFFC62828), modifier = Modifier.size(40.dp))
                                        Text(typeName, fontSize = 24.sp, fontWeight = FontWeight.Medium)
                                    }
                                    Surface(color = Color(0xFFC62828), shape = RoundedCornerShape(12.dp)) {
                                        Text(
                                            "${items.size} adet",
                                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                                            color = Color.White, fontWeight = FontWeight.Bold, fontSize = 24.sp
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Error
            if (uiState.error != null) {
                Text(uiState.error!!, color = MaterialTheme.colorScheme.error, fontSize = 18.sp)
                Spacer(modifier = Modifier.height(8.dp))
            }

            // Bottom buttons row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Pause/Resume
                Button(
                    onClick = { viewModel.togglePause() },
                    modifier = Modifier.weight(1f).height(64.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (uiState.isPaused) Color(0xFF2E7D32) else Color(0xFFFFA000)
                    ),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Icon(
                        if (uiState.isPaused) Icons.Default.PlayArrow else Icons.Default.Pause,
                        null, modifier = Modifier.size(32.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        if (!uiState.hasStarted) "Taramaya Basla"
                        else if (uiState.isPaused) "Devam Et"
                        else "Durdur",
                        fontSize = 20.sp, fontWeight = FontWeight.Bold
                    )
                }

                // WhatsApp
                Button(
                    onClick = { viewModel.prepareWhatsApp() },
                    enabled = uiState.totalMatched > 0,
                    modifier = Modifier.weight(1f).height(64.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF25D366)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Icon(Icons.Default.Send, null, modifier = Modifier.size(32.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("WhatsApp", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }

                // Submit
                Button(
                    onClick = { viewModel.submitPickup() },
                    enabled = uiState.totalMatched > 0 && !uiState.isSubmitting,
                    modifier = Modifier.weight(1.5f).height(64.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), color = Color.White)
                    } else {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(32.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Teslim Al (${uiState.totalMatched})", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
