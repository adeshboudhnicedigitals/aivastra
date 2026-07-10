package aivastra.nice.interactive.viewmodel.Dress

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import com.google.gson.annotations.SerializedName
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class DressTryOnResultModel(
    @SerializedName("status") var status: Boolean = false,
    @SerializedName("message") @JsonSetter(nulls = Nulls.AS_EMPTY)  var message: String = "",
    @SerializedName("retryable") var retryable: Boolean = true,
    @SerializedName("retry_after_ms") var retry_after_ms: Long = 0L,
    @SerializedName("tryon_image") @JsonSetter(nulls = Nulls.AS_EMPTY)  var tryon_image: String = "",
    @SerializedName("result_id") @JsonSetter(nulls = Nulls.AS_EMPTY)  var result_id: String = "",
    @SerializedName("promt_data") @JsonSetter(nulls = Nulls.AS_EMPTY)  var promt_data: PromtData = PromtData()
) : Serializable {

    @JsonIgnoreProperties(ignoreUnknown = true)
    data class PromtData(

        @SerializedName("wixuser")  @JsonSetter(nulls = Nulls.AS_EMPTY) var wixuser: String = "",
        @SerializedName("garment_id")  @JsonSetter(nulls = Nulls.AS_EMPTY) var garment_id: String = "",
        @SerializedName("userimage_id")  @JsonSetter(nulls = Nulls.AS_EMPTY) var userimage_id: String = "",
        @SerializedName("upload_image_path")  @JsonSetter(nulls = Nulls.AS_EMPTY) var upload_image_path: String = "",
        @SerializedName("tryon_result_path")  @JsonSetter(nulls = Nulls.AS_EMPTY) var tryon_result_path: String = "",
        @SerializedName("promt_id")  @JsonSetter(nulls = Nulls.AS_EMPTY) var promt_id: String = "",
        @SerializedName("action_from")  @JsonSetter(nulls = Nulls.AS_EMPTY) var action_from: String = ""

    ):Serializable
}
