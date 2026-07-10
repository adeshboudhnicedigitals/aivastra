package aivastra.nice.interactive.viewmodel.Login

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import java.io.Serializable

@JsonIgnoreProperties(ignoreUnknown = true)
data class UserLoginDataModel(

    @JsonProperty("status") @JsonSetter(nulls = Nulls.AS_EMPTY) var status: Boolean = false,
    @JsonProperty("message") @JsonSetter(nulls = Nulls.AS_EMPTY) var message: String = "",
    @JsonProperty("user") @JsonSetter(nulls = Nulls.AS_EMPTY) var user: User = User()

):Serializable {

    @JsonIgnoreProperties(ignoreUnknown = true)
    data class User(

        @JsonProperty("id") @JsonSetter(nulls = Nulls.AS_EMPTY) var id: String = "",
        @JsonProperty("username") @JsonSetter(nulls = Nulls.AS_EMPTY) var username: String = "",
        @JsonProperty("role_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var roleId: String = "",
        @JsonProperty("role_type") @JsonSetter(nulls = Nulls.AS_EMPTY) var roleType: String = "",
        @JsonProperty("nominee_name") @JsonSetter(nulls = Nulls.AS_EMPTY) var nomineeName: String = "",
        @JsonProperty("nominee_number") @JsonSetter(nulls = Nulls.AS_EMPTY) var nomineeNumber: String = "",
        @JsonProperty("business_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var businessId: String = "",
        @JsonProperty("merchant_photo") @JsonSetter(nulls = Nulls.AS_EMPTY) var merchantPhoto: String = "",
        @JsonProperty("company_logo") @JsonSetter(nulls = Nulls.AS_EMPTY) var companyLogo: String = "",
        @JsonProperty("id_proof") @JsonSetter(nulls = Nulls.AS_EMPTY) var idProof: String = "",
        @JsonProperty("business_proof") @JsonSetter(nulls = Nulls.AS_EMPTY) var businessProof: String = "",
        @JsonProperty("name") @JsonSetter(nulls = Nulls.AS_EMPTY) var name: String = "",
        @JsonProperty("email") @JsonSetter(nulls = Nulls.AS_EMPTY) var email: String = "",
        @JsonProperty("phone") @JsonSetter(nulls = Nulls.AS_EMPTY) var phone: String = "",
        @JsonProperty("added_on") @JsonSetter(nulls = Nulls.AS_EMPTY) var addedOn: String = "",
        @JsonProperty("password_text") @JsonSetter(nulls = Nulls.AS_EMPTY) var passwordText: String = "",
        @JsonProperty("merchantBname") @JsonSetter(nulls = Nulls.AS_EMPTY) var merchantBname: String = "",
        @JsonProperty("api_key") @JsonSetter(nulls = Nulls.AS_EMPTY) var apiKey: String = "",
        @JsonProperty("device_id") @JsonSetter(nulls = Nulls.AS_EMPTY) var deviceId: String = "",
        @JsonProperty("login_time") @JsonSetter(nulls = Nulls.AS_EMPTY) var loginTime: String = "",
        @JsonProperty("last_login") @JsonSetter(nulls = Nulls.AS_EMPTY) var lastLogin: String = ""

    ):Serializable
}