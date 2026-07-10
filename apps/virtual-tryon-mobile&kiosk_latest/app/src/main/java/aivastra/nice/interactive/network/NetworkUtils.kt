package aivastra.nice.interactive.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

object NetworkUtils {

    fun isInternetAvailable(context: Context): Boolean {

        val cm =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val network = cm.activeNetwork ?: return false

        val capabilities = cm.getNetworkCapabilities(network) ?: return false

        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun getInternetSpeedMbps(context: Context): Double {

        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return 0.0
        val capabilities = cm.getNetworkCapabilities(network) ?: return 0.0

        val downSpeedKbps = capabilities.linkDownstreamBandwidthKbps

        // Convert Kbps → Mbps
        return downSpeedKbps / 1000.0
    }

    fun isSlowInternet(context: Context): Boolean {

        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return true
        val capabilities = cm.getNetworkCapabilities(network) ?: return true

        val downSpeed = capabilities.linkDownstreamBandwidthKbps

        return downSpeed < 2000
    }
}