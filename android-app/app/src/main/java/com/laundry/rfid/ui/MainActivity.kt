package com.laundry.rfid.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.laundry.rfid.data.repository.DataCacheRepository
import com.laundry.rfid.sync.SyncWorker
import com.laundry.rfid.ui.theme.LaundryRFIDTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var dataCacheRepository: DataCacheRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Schedule periodic sync
        SyncWorker.enqueuePeriodicSync(this)

        // Preload cache in background for instant loading later
        lifecycleScope.launch(Dispatchers.IO) {
            dataCacheRepository.preloadCache()
        }

        setContent {
            LaundryRFIDTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    LaundryRFIDApp()
                }
            }
        }
    }
}
