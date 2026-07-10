package aivastra.nice.interactive.network

import aivastra.nice.interactive.R
import aivastra.nice.interactive.dialog.ShowAppAlertDialog
import aivastra.nice.interactive.dialog.ShowErrorAlertDialog
import android.app.Activity
import android.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

object NetworkDialogManager {

    private const val TAG_ERROR_DIALOG = "ShowErrorAlertDialog"

    fun showNoInternetDialog(activity: Activity) {
        try{
            val fragmentManager = (activity as AppCompatActivity).supportFragmentManager

            if (fragmentManager.isStateSaved) return
            if (fragmentManager.findFragmentByTag(TAG_ERROR_DIALOG) != null) return

            val showErrorAlertDialog = ShowErrorAlertDialog(ShowErrorAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.ic_internet),
                "No Internet Connection",
                "It looks like your device is not connected to the internet.Please check your Wi-Fi or mobile data connection and try again.")
            showErrorAlertDialog.show(fragmentManager,TAG_ERROR_DIALOG)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    fun showSlowInternetDialog(activity: Activity) {
        try{
            val fragmentManager = (activity as AppCompatActivity).supportFragmentManager

            if (fragmentManager.isStateSaved) return
            if (fragmentManager.findFragmentByTag(TAG_ERROR_DIALOG) != null) return

            val message = "Your internet connection appears to be slow (lower than 10 Mbps). This may cause delays while loading content. Please switch to a stronger Wi-Fi or mobile network for a better experience."
            val showErrorAlertDialog = ShowErrorAlertDialog(ShowErrorAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.ic_internet),
                "Slow Internet Connection", message)
            showErrorAlertDialog.show(fragmentManager,TAG_ERROR_DIALOG)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    fun showTimeoutDialog(activity: Activity) {
        try{
            val fragmentManager = (activity as AppCompatActivity).supportFragmentManager

            if (fragmentManager.isStateSaved) return
            if (fragmentManager.findFragmentByTag(TAG_ERROR_DIALOG) != null) return

            val showErrorAlertDialog = ShowErrorAlertDialog(ShowErrorAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.ic_internet),
                "Connection Timeout",
                "The request is taking longer than expected.This may happen if the internet connection is unstable.Please check your connection and try again.")
            showErrorAlertDialog.show(fragmentManager,TAG_ERROR_DIALOG)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }

    fun showServerErrorDialog(activity: Activity) {
        try{
            val fragmentManager = (activity as AppCompatActivity).supportFragmentManager

            if (fragmentManager.isStateSaved) return
            if (fragmentManager.findFragmentByTag(TAG_ERROR_DIALOG) != null) return

            val showErrorAlertDialog = ShowErrorAlertDialog(ShowErrorAlertDialog.ImageSourceType.FromDrawbleRes(R.drawable.ic_internet),
                activity.getString(R.string.server_connection),
                activity.getString(R.string.server_error_alert))
            showErrorAlertDialog.show(fragmentManager,TAG_ERROR_DIALOG)
        }catch (e:Exception){
            e.printStackTrace()
        }
    }
}