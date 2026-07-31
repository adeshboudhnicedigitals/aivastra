package aivastra.nice.interactive.activity.auth

import aivastra.nice.interactive.R
import aivastra.nice.interactive.activity.Home.HomeDressesForActivity
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent

/** Routes the authoritative merchant status returned by login or the onboarding-state endpoint. */
object MerchantStatusNavigator {

    enum class RouteResult {
        NAVIGATED,
        SHOW_ONBOARDING_FORM,
        PENDING_ACTIVATION,
    }

    fun route(activity: Activity, merchantStatus: String): RouteResult {
        return when (merchantStatus) {
            "ACTIVE" -> {
                navigate(activity, HomeDressesForActivity::class.java)
                RouteResult.NAVIGATED
            }
            "ONBOARDING_REQUIRED" -> {
                if (activity is OnboardingActivity) {
                    RouteResult.SHOW_ONBOARDING_FORM
                } else {
                    navigate(activity, OnboardingActivity::class.java)
                    RouteResult.NAVIGATED
                }
            }
            "PENDING_ACTIVATION" -> {
                AlertDialog.Builder(activity)
                    .setTitle("Activation pending")
                    .setMessage("Your account is awaiting activation. Please contact support.")
                    .setPositiveButton("OK", null)
                    .show()
                RouteResult.PENDING_ACTIVATION
            }
            else -> throw IllegalStateException("Unknown merchant status: $merchantStatus")
        }
    }

    private fun navigate(activity: Activity, destination: Class<*>) {
        val intent = Intent(activity, destination)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        activity.startActivity(intent)
        activity.finish()
        activity.overridePendingTransition(R.anim.fade_and_scale_in, R.anim.fade_and_scale_out)
    }
}
