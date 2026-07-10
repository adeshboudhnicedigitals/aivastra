package aivastra.nice.interactive.viewmodel.Dress

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class DressesItemsDataModel(

    @JsonProperty("status") @JsonSetter(nulls = Nulls.AS_EMPTY) var status: Boolean = false,
    @JsonProperty("category") @JsonSetter(nulls = Nulls.AS_EMPTY) var category: String= "",
    @JsonProperty("title") @JsonSetter(nulls = Nulls.AS_EMPTY) var title: String= "",
    @JsonProperty("data") @JsonSetter(nulls = Nulls.AS_EMPTY) var data: ArrayList<Data> = arrayListOf()

) : Serializable {

    @JsonIgnoreProperties(ignoreUnknown = true)
    data class Data(

        @JsonProperty("id") @JsonSetter(nulls = Nulls.AS_EMPTY) var id: String= "",
        @JsonProperty("fullpath") @JsonSetter(nulls = Nulls.AS_EMPTY) var fullpath: String= "",
        @JsonProperty("category_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var category_id: String= "",
        @JsonProperty("name") @JsonSetter(nulls = Nulls.AS_EMPTY) var name: String= "",
        @JsonProperty("orginal_name") @JsonSetter(nulls = Nulls.AS_EMPTY) var orginalName: String= "",
        @JsonProperty("garment_type") @JsonSetter(nulls = Nulls.AS_EMPTY) var garmentType: String= "",
        @JsonProperty("created_at") @JsonSetter(nulls = Nulls.AS_EMPTY) var createdAt: String= "",
        @JsonProperty("dress_for") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressFor: String= "",
        @JsonProperty("dress_type") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressType: String= "",
        @JsonProperty("color") @JsonSetter(nulls = Nulls.AS_EMPTY) var color: String= "",
        @JsonProperty("dress_name") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressName: String= ""

    ) : Serializable
}