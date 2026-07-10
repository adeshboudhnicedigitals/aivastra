package aivastra.nice.interactive.viewmodel.Dress

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class ProductSearchDataModel(

    @JsonProperty("status") @JsonSetter(nulls = Nulls.AS_EMPTY) var status: Boolean = false,
    @JsonProperty("data") @JsonSetter(nulls = Nulls.AS_EMPTY) var data: ArrayList<DressesTypeDataModel.Data.Subcategory.Item> = arrayListOf()

) : Serializable
