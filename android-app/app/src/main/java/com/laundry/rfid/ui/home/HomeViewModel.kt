package com.laundry.rfid.ui.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.data.repository.AuthRepository
import com.laundry.rfid.data.repository.ScanRepository
import com.laundry.rfid.domain.model.User
import com.laundry.rfid.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val user: User? = null,
    val pendingSyncCount: Int = 0,
    val isLoading: Boolean = false,
    val isSyncing: Boolean = false
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val scanRepository: ScanRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        loadUser()
        observePendingSyncCount()
    }

    private fun loadUser() {
        viewModelScope.launch {
            authRepository.currentUser.collect { user ->
                _uiState.update { it.copy(user = user) }
            }
        }
    }

    private fun observePendingSyncCount() {
        viewModelScope.launch {
            scanRepository.getPendingSyncCount().collect { count ->
                _uiState.update { it.copy(pendingSyncCount = count) }
            }
        }
    }

    fun syncNow() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSyncing = true) }
            SyncWorker.enqueueImmediateSync(context)
            // Give it a moment to start
            kotlinx.coroutines.delay(1000)
            _uiState.update { it.copy(isSyncing = false) }
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }
}
