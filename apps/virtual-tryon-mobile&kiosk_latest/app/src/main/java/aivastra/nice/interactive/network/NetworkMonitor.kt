package aivastra.nice.interactive.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

object NetworkMonitor {

    private val networkState = MutableStateFlow(NetworkState.AVAILABLE)

    fun observe(): StateFlow<NetworkState> = networkState

    fun start(context: Context) {

        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {

            override fun onAvailable(network: Network) {
                networkState.value = NetworkState.AVAILABLE
            }

            override fun onLost(network: Network) {
                networkState.value = NetworkState.NO_INTERNET
            }
        })
    }
    fun updateState(state: NetworkState) {
        Log.e("NetworkState","$state")
        if (networkState.value != state) {
            networkState.value = state
        }
    }
}