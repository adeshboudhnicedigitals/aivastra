package aivastra.nice.interactive.viewmodel.category

import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import com.google.gson.annotations.SerializedName
import java.io.Serializable

data class SareeCateDataModel(

    @SerializedName("status") var status: Boolean = false,
    @SerializedName("category")@JsonSetter(nulls = Nulls.AS_EMPTY) var category: String = "",
    @SerializedName("title")@JsonSetter(nulls = Nulls.AS_EMPTY) var title: String = "",
    @SerializedName("data")@JsonSetter(nulls = Nulls.AS_EMPTY) var data: ArrayList<Data> = arrayListOf()

) : Serializable {

    data class Data(

        @SerializedName("category_id")@JsonSetter(nulls = Nulls.AS_EMPTY) var category_id: String = "",
        @SerializedName("category_name")@JsonSetter(nulls = Nulls.AS_EMPTY) var category_name: String = "",
        @SerializedName("category_image")@JsonSetter(nulls = Nulls.AS_EMPTY) var category_image: String = "",
        @SerializedName("sarees")@JsonSetter(nulls = Nulls.AS_EMPTY) var sarees: ArrayList<Sarees> = arrayListOf()

    ) : Serializable {

        data class Sarees(

            @SerializedName("id")@JsonSetter(nulls = Nulls.AS_EMPTY) var id: String = "",
            @SerializedName("name")@JsonSetter(nulls = Nulls.AS_EMPTY) var name: String = "",
            @SerializedName("price")@JsonSetter(nulls = Nulls.AS_EMPTY) var price: String? = null,
            @SerializedName("image_url")@JsonSetter(nulls = Nulls.AS_EMPTY) var image_url: String = ""

        ) : Serializable
    }
}