package aivastra.nice.interactive.viewmodel.Dress

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class DressesForDataModel(

    @JsonProperty("data")@JsonSetter(nulls = Nulls.AS_EMPTY) var data: ArrayList<Data> = arrayListOf(),
    @JsonProperty("status")@JsonSetter(nulls = Nulls.AS_EMPTY) var status: Boolean = false,
    @JsonProperty("message")@JsonSetter(nulls = Nulls.AS_EMPTY) var message: String = ""

) : Serializable {
    @JsonIgnoreProperties(ignoreUnknown = true)
    data class Data(

        @JsonProperty("title")@JsonSetter(nulls = Nulls.AS_EMPTY) var title: String= "",
        @JsonProperty("ctype")@JsonSetter(nulls = Nulls.AS_EMPTY) var ctype: String= "",
        @JsonProperty("image_url")@JsonSetter(nulls = Nulls.AS_EMPTY) var imageUrl: String= "",
        @JsonProperty("card_image")@JsonSetter(nulls = Nulls.AS_EMPTY) var card_image: String= ""

    ):Serializable
}