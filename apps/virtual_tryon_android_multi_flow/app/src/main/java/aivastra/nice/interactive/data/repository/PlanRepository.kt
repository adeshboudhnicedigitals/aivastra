package aivastra.nice.interactive.data.repository

import aivastra.nice.interactive.api.ApiClient
import aivastra.nice.interactive.data.models.PlanSummary
import kotlinx.coroutines.CancellationException

class PlanRepository {
    /**
     * Credit balance + Monthly plan from `/v1/credits`, plus the purchased plan name from
     * `/v1/me`. Returns null if the credits call fails — null is not "no plan", so the caller
     * hides the card rather than show a misleading state over a network error. A failed
     * `/v1/me` only drops the plan name; the rest still renders.
     */
    suspend fun getSummary(): PlanSummary? {
        val credits = try {
            val response = ApiClient.apiService.getPlan()
            if (response.isSuccessful) response.body() else null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return null

        val tier = try {
            val response = ApiClient.apiService.getMeTier()
            if (response.isSuccessful) response.body()?.tier else null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }

        return PlanSummary(tier = tier, balance = credits.balance, monthly = credits.unlimitedPlan)
    }
}
