import Std

namespace StorageEtag

/-- A field is a least-significant-first base-128 expansion. A nonfinal digit has its high bit set. -/
def varintDigits : Nat → Nat → List Nat
  | 0, _ => []
  | fuel + 1, n =>
    if n < 128 then [n] else (128 + n % 128) :: varintDigits fuel (n / 128)

def varint (n : Nat) : List Nat := varintDigits 10 n

/-- Reading uses the continuation bit to decide where a field ends, leaving the suffix untouched. -/
def readVarint : List Nat → Option (Nat × List Nat)
  | [] => none
  | b :: tail =>
    if b < 128 then some (b, tail)
    else (readVarint tail).map fun (n, rest) => (b % 128 + 128 * n, rest)

def objectBytes (generation metageneration : Nat) : List Nat :=
  [8] ++ varint generation ++ [16] ++ varint metageneration

def bucketBytes (metageneration : Nat) : List Nat := 8 :: varint metageneration

def alphabet : Array Char :=
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toList.toArray

def symbol (n : Nat) : Char := alphabet[n]?.getD '='

/-- Base64 groups three bytes into four sextets, padding the last incomplete group. -/
def base64Symbols : List Nat → List Char
  | a :: b :: c :: rest =>
    symbol (a / 4) :: symbol (a % 4 * 16 + b / 16) ::
      symbol (b % 16 * 4 + c / 64) :: symbol (c % 64) :: base64Symbols rest
  | [a, b] => [symbol (a / 4), symbol (a % 4 * 16 + b / 16), symbol (b % 16 * 4), '=']
  | [a] => [symbol (a / 4), symbol (a % 4 * 16), '=', '=']
  | [] => []

def base64 (bytes : List Nat) : String := String.ofList (base64Symbols bytes)

def objectEtag (generation metageneration : Nat) : String :=
  base64 (objectBytes generation metageneration)

def bucketEtag (metageneration : Nat) : String := base64 (bucketBytes metageneration)

end StorageEtag
