package com.laundry.rfid.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.laundry.rfid.domain.model.SessionType
import com.laundry.rfid.ui.delivery.DeliveryScreen
import com.laundry.rfid.ui.home.HomeScreen
import com.laundry.rfid.ui.home.HomeViewModel
import com.laundry.rfid.ui.login.LoginScreen
import com.laundry.rfid.ui.login.LoginViewModel
import com.laundry.rfid.ui.qrscan.QRScanScreen
import com.laundry.rfid.ui.scan.ScanScreen
import com.laundry.rfid.ui.scan.ScanViewModel
import com.laundry.rfid.ui.tagassign.TagAssignScreen
import com.laundry.rfid.ui.tagassign.TagAssignViewModel

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Home : Screen("home")
    object Scan : Screen("scan/{sessionType}") {
        fun createRoute(sessionType: String) = "scan/$sessionType"
    }
    object QRScan : Screen("qr-scan/{sessionType}") {
        fun createRoute(sessionType: String) = "qr-scan/$sessionType"
    }
    object Delivery : Screen("delivery")
    object TagAssign : Screen("tag-assign")
    object TagAssignQRScan : Screen("tag-assign-qr-scan")
    object History : Screen("history")
    object Settings : Screen("settings")
}

@Composable
fun LaundryRFIDApp() {
    val navController = rememberNavController()

    // Check login state
    val loginViewModel: LoginViewModel = hiltViewModel()
    val isLoggedIn by loginViewModel.isLoggedIn.collectAsState(initial = null)

    // Show loading while checking auth status
    if (isLoggedIn == null) {
        // Loading state - could show a splash screen
        return
    }

    val startDestination = if (isLoggedIn == true) Screen.Home.route else Screen.Login.route

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Login.route) {
            LoginScreen(
                viewModel = hiltViewModel(),
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            val homeViewModel: HomeViewModel = hiltViewModel()
            val homeState by homeViewModel.uiState.collectAsState()
            val isDriver = homeState.user?.role == "driver"

            HomeScreen(
                viewModel = homeViewModel,
                onWorkflowSelected = { sessionType ->
                    // For drivers, use DeliveryScreen for "Teslim Etme"
                    if (isDriver && sessionType == SessionType.DELIVER) {
                        navController.navigate(Screen.Delivery.route)
                    } else {
                        navController.navigate(Screen.Scan.createRoute(sessionType.value))
                    }
                },
                onTagAssign = {
                    navController.navigate(Screen.TagAssign.route)
                },
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Delivery.route) {
            DeliveryScreen(
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.TagAssign.route) { backStackEntry ->
            val tagAssignViewModel: TagAssignViewModel = hiltViewModel()

            // Get QR code from savedStateHandle if it was passed back from QR scan screen
            val qrCode = backStackEntry.savedStateHandle.get<String>("qrCode")
            if (qrCode != null) {
                tagAssignViewModel.selectTenantByQrCode(qrCode)
                backStackEntry.savedStateHandle.remove<String>("qrCode")
            }

            TagAssignScreen(
                viewModel = tagAssignViewModel,
                onBack = { navController.popBackStack() },
                onScanQR = { callback ->
                    navController.navigate(Screen.TagAssignQRScan.route)
                }
            )
        }

        composable(Screen.TagAssignQRScan.route) {
            QRScanScreen(
                onBack = { navController.popBackStack() },
                onQRScanned = { qrCode ->
                    // Navigate back to tag assign screen and pass the QR code
                    navController.previousBackStackEntry?.savedStateHandle?.set("qrCode", qrCode)
                    navController.popBackStack()
                },
                title = "Otel QR Kodu Tara"
            )
        }

        composable(
            route = Screen.Scan.route,
            arguments = listOf(
                navArgument("sessionType") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionType = backStackEntry.arguments?.getString("sessionType") ?: "pickup"
            val scanViewModel: ScanViewModel = hiltViewModel()

            // Get QR code from savedStateHandle if it was passed back from QR scan screen
            val qrCode = backStackEntry.savedStateHandle.get<String>("qrCode")
            if (qrCode != null) {
                scanViewModel.selectTenantByQR(qrCode)
                backStackEntry.savedStateHandle.remove<String>("qrCode")
            }

            ScanScreen(
                viewModel = scanViewModel,
                sessionType = sessionType,
                onBack = { navController.popBackStack() },
                onComplete = { navController.popBackStack() },
                onScanQR = {
                    navController.navigate(Screen.QRScan.createRoute(sessionType))
                }
            )
        }

        composable(
            route = Screen.QRScan.route,
            arguments = listOf(
                navArgument("sessionType") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionType = backStackEntry.arguments?.getString("sessionType") ?: "pickup"

            QRScanScreen(
                onBack = { navController.popBackStack() },
                onQRScanned = { qrCode ->
                    // Navigate back to scan screen and pass the QR code
                    navController.previousBackStackEntry?.savedStateHandle?.set("qrCode", qrCode)
                    navController.popBackStack()
                },
                title = "Otel QR Kodu Tara"
            )
        }
    }
}
