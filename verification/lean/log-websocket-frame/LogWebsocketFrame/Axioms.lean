import LogWebsocketFrame.Theorems

/-- info: 'LogWebsocketFrame.big_endian_width' depends on axioms: [propext] -/
#guard_msgs in #print axioms LogWebsocketFrame.big_endian_width

/-- info: 'LogWebsocketFrame.two_byte_length_network_order' depends on axioms: [propext] -/
#guard_msgs in #print axioms LogWebsocketFrame.two_byte_length_network_order

/-- info: 'LogWebsocketFrame.shortest_length_field' depends on axioms: [propext] -/
#guard_msgs in #print axioms LogWebsocketFrame.shortest_length_field

/-- info: 'LogWebsocketFrame.fin_plus_opcode' does not depend on any axioms -/
#guard_msgs in #print axioms LogWebsocketFrame.fin_plus_opcode

/-- info: 'LogWebsocketFrame.length_flag_never_masks' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms LogWebsocketFrame.length_flag_never_masks

/-- info: 'LogWebsocketFrame.payload_is_unchanged' depends on axioms: [propext] -/
#guard_msgs in #print axioms LogWebsocketFrame.payload_is_unchanged

/-- info: 'LogWebsocketFrame.mask_length' depends on axioms: [propext] -/
#guard_msgs in #print axioms LogWebsocketFrame.mask_length

/-- info: 'LogWebsocketFrame.mask_is_involution' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms LogWebsocketFrame.mask_is_involution

/-- info: 'LogWebsocketFrame.zero_mask_identity' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms LogWebsocketFrame.zero_mask_identity
