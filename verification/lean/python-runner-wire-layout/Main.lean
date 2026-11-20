import PythonRunnerWireLayout

open PyWire

def digits := "0123456789abcdef".toList

def asHex (text : String) : String :=
  String.ofList (text.toUTF8.data.toList.flatMap fun b =>
    [digits[b.toNat / 16]!, digits[b.toNat % 16]!])

def rearrange (order : String) (fields : List (String × Value)) : List (String × Value) :=
  if order == "forward" then fields
  else if order == "reverse" then fields.reverse
  else fields.drop 1 ++ fields.take 1

def sample (shape order token : String) : Value :=
  let n := Value.number token
  let fields := rearrange order [("size", n), ("kind", .text "storage#object"),
    ("é", .text "雪\"\\\n"), ("name", .text "café"), ("aa", .literal "false")]
  let nested := Value.object (rearrange order [("z", n), ("a", .text "𝄞"),
    ("p", .array [.literal "null", n])])
  match shape with
  | "flat" => .object fields
  | "nested" => .object (fields ++ [("metadata", nested)])
  | "array" => .array [.object fields, nested, .array [], .object []]
  | _ =>
    let otherKnown := ["updated", "crc32c", "bucket", "mediaLink", "id", "timeCreated", "selfLink",
      "metageneration", "contentType", "generation", "etag", "md5Hash", "timeStorageClassUpdated", "storageClass"]
    let additional := otherKnown.map fun key => (key, if key == "contentType" then nested else n)
    .object (fields ++ rearrange order additional ++
      [("metadata", .array [nested, .object [], .array [], n])])

def main : IO Unit := do
  IO.println "# id|layout|number|shape|order|input-hex|output-hex"
  for (label, layout) in [("compact", Layout.compact), ("pubsub", .pubsub), ("storage", .storage)] do
    for (number, token) in [("int", "27"), ("zero", "-0"), ("exponent", "1E+03"),
        ("decimal", "0.100"), ("tiny", "1e-7")] do
      for shape in ["flat", "nested", "array", "mixed"] do
        for order in ["forward", "reverse", "rotate"] do
          let value := sample shape order token
          let input := " \t" ++ render .compact 12 value ++ "\n"
          let output := render layout 12 value
          IO.println s!"{label}/{number}/{shape}/{order}|{label}|{number}|{shape}|{order}|{asHex input}|{asHex output}"
