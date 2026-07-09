package aivastra.nice.interactive.viewmodel.Dress

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import com.google.gson.annotations.SerializedName
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommonResponseModel(
    @SerializedName("status") var status: Boolean = false,
    @SerializedName("message") @JsonSetter(nulls = Nulls.AS_EMPTY)  var message: String = "",
    @SerializedName("action") @JsonSetter(nulls = Nulls.AS_EMPTY)  var action: String = ""
) : Serializable