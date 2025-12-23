package com.laundry.rfid.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.laundry.rfid.BuildConfig
import com.laundry.rfid.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val role: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isSuccess: Boolean = false
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    val isLoggedIn: Flow<Boolean> = authRepository.isLoggedIn

    // Şifre tanımları - BuildConfig'den okunur (local.properties'den konfigüre edilebilir)
    private val DRIVER_PIN = BuildConfig.DRIVER_PIN
    private val ADMIN_PIN = BuildConfig.ADMIN_PIN

    fun onEmailChange(email: String) {
        _uiState.update { it.copy(email = email, error = null) }
    }

    fun onPasswordChange(password: String) {
        _uiState.update { it.copy(password = password, error = null) }
    }

    fun onRoleChange(role: String) {
        _uiState.update { it.copy(role = role, error = null) }
    }

    fun login() {
        val state = _uiState.value

        if (state.role.isBlank()) {
            _uiState.update { it.copy(error = "Lütfen giriş türü seçin") }
            return
        }

        if (state.password.isBlank()) {
            _uiState.update { it.copy(error = "Şifre giriniz") }
            return
        }

        // Şifre doğrulama
        val isValid = when (state.role) {
            "DRIVER" -> state.password == DRIVER_PIN
            "ADMIN" -> state.password == ADMIN_PIN
            else -> false
        }

        if (!isValid) {
            _uiState.update { it.copy(error = "Yanlış şifre") }
            return
        }

        // Lokal giriş başarılı - backend'e de gönder
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            // Backend'e uygun credentials ile giriş yap - BuildConfig'den okunur
            val email = when (state.role) {
                "DRIVER" -> BuildConfig.DRIVER_EMAIL
                "ADMIN" -> BuildConfig.ADMIN_EMAIL
                else -> BuildConfig.DRIVER_EMAIL
            }
            val password = when (state.role) {
                "DRIVER" -> BuildConfig.DRIVER_PASSWORD
                "ADMIN" -> BuildConfig.ADMIN_PASSWORD
                else -> BuildConfig.DRIVER_PASSWORD
            }

            val result = authRepository.login(email, password)

            result.fold(
                onSuccess = { user ->
                    // Register device after successful login
                    authRepository.registerDevice()

                    _uiState.update {
                        it.copy(isLoading = false, isSuccess = true)
                    }
                },
                onFailure = { error ->
                    // Backend hatası olsa bile lokal şifre doğruysa giriş yap
                    // Offline mod desteği için
                    authRepository.setOfflineLogin(state.role)
                    _uiState.update {
                        it.copy(isLoading = false, isSuccess = true)
                    }
                }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
