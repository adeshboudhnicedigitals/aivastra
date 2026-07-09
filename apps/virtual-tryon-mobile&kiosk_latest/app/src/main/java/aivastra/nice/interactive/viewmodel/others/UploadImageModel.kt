package aivastra.nice.interactive.viewmodel.others

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class UploadImageModel(

    @JsonProperty("status") @JsonSetter(nulls = Nulls.AS_EMPTY) var status: Boolean = false,
    @JsonProperty("open") @JsonSetter(nulls = Nulls.AS_EMPTY) var open: String = "",
    @JsonProperty("message") @JsonSetter(nulls = Nulls.AS_EMPTY) var message: String= "",
    @JsonProperty("id") @JsonSetter(nulls = Nulls.AS_EMPTY) var id: String = "",
    @JsonProperty("user_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var userId: String= "",
    @JsonProperty("garment_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var garment_id: String= "",
    @JsonProperty("is_session_expired")  var is_session_expired: Boolean= false,
    @JsonProperty("image_path") @JsonSetter(nulls = Nulls.AS_EMPTY) var imagePath: String= ""

):Serializable