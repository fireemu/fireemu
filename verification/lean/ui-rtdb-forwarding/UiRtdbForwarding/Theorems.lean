import UiRtdbForwarding.Spec

namespace UIR

theorem oversized_body_refused_before_parameter_parsing (ep : Endpoint) (sessions : Params)
    (request : Input) (oversize : request.bodyLength > maxBody) :
    (match prepare ep sessions request with
    | .error reason => reason.code = 413 ∧ reason.message = "PAYLOAD_TOO_LARGE"
    | .ok _ => False) := by
  simp [prepare, oversize]

theorem configured_ownership_overrides_name_inference (configured : Params)
    (daemon name owner : String) (found : lookup configured name = some owner) :
    projectOf configured daemon name = owner := by
  simp [projectOf, found]

theorem plus_is_literal (rest : List Char) :
    urlBytes ('+' :: rest) = (urlBytes rest).map (fun bytes => 43 :: bytes) := by
  have byte : "+".toByteArray.data.toList = [43] := by decide
  cases h : urlBytes rest <;> simp [urlBytes, h, byte]

theorem methods_for_rules (method : String) :
    allowedMethod "rules" method = true ↔ method = "GET" ∨ method = "PUT" := by
  simp [allowedMethod, eq_comm (a := method)]

theorem anonymous_action_has_no_owner_privilege (action : String) :
    ownerPrivilege action = false ↔ action = "request" := by
  simp [ownerPrivilege]

end UIR
