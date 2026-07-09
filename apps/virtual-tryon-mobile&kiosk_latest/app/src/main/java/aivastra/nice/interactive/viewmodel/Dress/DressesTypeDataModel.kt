package aivastra.nice.interactive.viewmodel.Dress

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class DressesTypeDataModel(

    @JsonProperty("status") var status: Boolean = false,
    @JsonProperty("message") @JsonSetter(nulls = Nulls.AS_EMPTY) var message: String = "",
    @JsonProperty("data") @JsonSetter(nulls = Nulls.AS_EMPTY) var data: ArrayList<Data> = arrayListOf()

) : Serializable {

    @JsonIgnoreProperties(ignoreUnknown = true)
    data class Data(

        @JsonProperty("id") @JsonSetter(nulls = Nulls.AS_EMPTY) var id: String = "",
        @JsonProperty("dress_for") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressFor: String = "",
        @JsonProperty("dress_name") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressName: String = "",
        @JsonProperty("categoryname") @JsonSetter(nulls = Nulls.AS_EMPTY) var categoryname: String = "",
        @JsonProperty("fullpath") @JsonSetter(nulls = Nulls.AS_EMPTY) var fullpath: String = "",
        @JsonProperty("subcategory") @JsonSetter(nulls = Nulls.AS_EMPTY) var subcategory: ArrayList<Subcategory> = arrayListOf()

    ) : Serializable {

        @JsonIgnoreProperties(ignoreUnknown = true)
        data class Subcategory(

            @JsonProperty("name") @JsonSetter(nulls = Nulls.AS_EMPTY) var name: String = "",
            @JsonProperty("items") @JsonSetter(nulls = Nulls.AS_EMPTY) var items: ArrayList<Item> = arrayListOf()

        ) : Serializable {

            @JsonIgnoreProperties(ignoreUnknown = true)
            data class Item(

                @JsonProperty("id") @JsonSetter(nulls = Nulls.AS_EMPTY) var id: String = "",
                @JsonProperty("garmentid") @JsonSetter(nulls = Nulls.AS_EMPTY) var garmentid: String = "",
                @JsonProperty("fullpath") @JsonSetter(nulls = Nulls.AS_EMPTY) var fullpath: String = "",
                @JsonProperty("category_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var category_id: String = "",
                @JsonProperty("story_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var story_id: String = "",
                @JsonProperty("name") @JsonSetter(nulls = Nulls.AS_EMPTY) var name: String = "",
                @JsonProperty("orginal_name") @JsonSetter(nulls = Nulls.AS_EMPTY) var orginalName: String = "",
                @JsonProperty("garment_type") @JsonSetter(nulls = Nulls.AS_EMPTY) var garmentType: String = "",
                @JsonProperty("created_at") @JsonSetter(nulls = Nulls.AS_EMPTY) var createdAt: String = "",
                @JsonProperty("dress_for") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressFor: String = "",
                @JsonProperty("dress_type") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressType: String = "",
                @JsonProperty("color") @JsonSetter(nulls = Nulls.AS_EMPTY) var color: String = "",
                @JsonProperty("dress_name") @JsonSetter(nulls = Nulls.AS_EMPTY) var dressName: String = "",
                @JsonProperty("categoryname") @JsonSetter(nulls = Nulls.AS_EMPTY) var categoryname: String = "",
                @JsonProperty("preview") @JsonSetter(nulls = Nulls.AS_EMPTY) var preview: String = "",
                @JsonProperty("price") @JsonSetter(nulls = Nulls.AS_EMPTY) var price: String = "",
                @JsonProperty("offerprice") @JsonSetter(nulls = Nulls.AS_EMPTY) var offerprice: String = "",
                @JsonProperty("sku_number") @JsonSetter(nulls = Nulls.AS_EMPTY) var sku_number: String = ""

            ) : Serializable
        }

    }
}