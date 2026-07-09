package aivastra.nice.interactive.network

import android.content.Context
import okhttp3.Interceptor
import okhttp3.Response
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class NetworkInterceptor(private val context: Context) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {

        if (!NetworkUtils.isInternetAvailable(context)) {

            NetworkMonitor.updateState(NetworkState.NO_INTERNET)

            throw UnknownHostException("No Internet Connection")
        }
        try {
//            val start = System.currentTimeMillis()
            val response = chain.proceed(chain.request())
//            val end = System.currentTimeMillis()
//            val duration = end - start

            if (NetworkUtils.isSlowInternet(context)) {
                NetworkMonitor.updateState(NetworkState.SLOW)
            }

            if (response.code != 200) {
                NetworkMonitor.updateState(NetworkState.SERVER_ERROR)
            }

            return response

        } catch (e: SocketTimeoutException) {

            NetworkMonitor.updateState(NetworkState.TIMEOUT)
            throw e

        } catch (e: UnknownHostException) {
            NetworkMonitor.updateState(NetworkState.NO_INTERNET)
            throw e
        } catch (e: Exception) {
            NetworkMonitor.updateState(NetworkState.SERVER_ERROR)
            throw e
        }
    }
}