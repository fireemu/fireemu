import LogWebsocketFrame.Spec

namespace LogWebsocketFrame

theorem big_endian_width (width value : Nat) :
    (bigEndian width value).length = width := by
  induction width with
  | zero => rfl
  | succ width ih => simp [bigEndian, ih]

theorem two_byte_length_network_order (value : Nat) :
    bigEndian 2 value = [value / 256 % 256, value % 256] := by
  simp [bigEndian]

theorem shortest_length_field (length : Nat) :
    (lengthField length).length = if length < 126 then 1 else if length < 65536 then 3 else 9 := by
  by_cases short : length < 126
  · simp [lengthField, short]
  by_cases medium : length < 65536 <;> simp [lengthField, short, medium, big_endian_width]

theorem fin_plus_opcode (opcode length : Nat) :
    (header opcode length).head? = some (128 + opcode % 16) := rfl

theorem length_flag_never_masks (length : Nat) :
    (lengthField length).head?.any (fun first => first < 128) = true := by
  by_cases short : length < 126
  · have fits : length < 128 := by omega
    simp [lengthField, short, fits]
  by_cases medium : length < 65536 <;> simp [lengthField, short, medium]

theorem payload_is_unchanged (opcode : Nat) (payload : List Nat) :
    (frame opcode payload).drop (header opcode payload.length).length = payload := by
  simp [frame]

theorem mask_length (key : Nat → Nat) (position : Nat) (payload : List Nat) :
    (applyMask key position payload).length = payload.length := by
  induction payload generalizing position with
  | nil => rfl
  | cons byte rest ih => simp [applyMask, ih]

theorem mask_is_involution (key : Nat → Nat) (position : Nat) (payload : List Nat) :
    applyMask key position (applyMask key position payload) = payload := by
  induction payload generalizing position with
  | nil => rfl
  | cons byte rest ih => simp [applyMask, Nat.xor_assoc, ih]

theorem zero_mask_identity (position : Nat) (payload : List Nat) :
    applyMask (fun _ => 0) position payload = payload := by
  induction payload generalizing position with
  | nil => rfl
  | cons byte rest ih => simp [applyMask, ih]

end LogWebsocketFrame
