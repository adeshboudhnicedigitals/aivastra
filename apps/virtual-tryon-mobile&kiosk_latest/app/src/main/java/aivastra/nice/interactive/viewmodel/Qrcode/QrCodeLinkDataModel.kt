package aivastra.nice.interactive.viewmodel.Qrcode

import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

data class QrCodeLinkDataModel (

    @JsonProperty("status") @JsonSetter(nulls = Nulls.AS_EMPTY) var status: Boolean = false,
    @JsonProperty("message") @JsonSetter(nulls = Nulls.AS_EMPTY) var message: String= "",
    @JsonProperty("merchant_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var merchant_id: Int = 0,
    @JsonProperty("utc_date") @JsonSetter(nulls = Nulls.AS_EMPTY) var utc_date: String= "",
    @JsonProperty("url") @JsonSetter(nulls = Nulls.AS_EMPTY) var url: String= ""

):Serializable