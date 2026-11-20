import Std

namespace StorageHttpRange

inductive Profile where
  | strict | emulator
  deriving DecidableEq, Repr

inductive Range where
  | none
  | closed (first last : Nat)
  | openEnd (first : Nat)
  | suffix (count : Nat)
  | malformed (header : String)
  deriving Repr

inductive Selection where
  | full
  | rejected
  | emptySuffix
  | slice (first endExclusive : Nat)
  deriving DecidableEq, Repr

def clipClosed (length first last : Nat) : Option (Nat × Nat) :=
  if first < length ∧ first ≤ last then some (first, min length (last + 1)) else none

def select (length : Nat) : Range → Selection
  | .none | .malformed _ => .full
  | .closed first last =>
    if last < first then .full
    else match clipClosed length first last with
      | some (first, endExclusive) => .slice first endExclusive
      | none => .rejected
  | .openEnd first =>
    if first < length then .slice first length else .rejected
  | .suffix count =>
    if count = 0 then .rejected
    else if length = 0 then .emptySuffix
    else .slice (length - count) length

def Download := Nat × String × String

def download (profile : Profile) (data : String) (header : Range) : Download :=
  let bytes := data.toList
  let length := bytes.length
  match select length header with
  | .slice first endExclusive =>
    (206, s!"bytes {first}-{endExclusive - 1}/{length}",
      String.ofList ((bytes.drop first).take (endExclusive - first)))
  | .rejected =>
    if profile = .strict then (416, s!"bytes */{length}", "Request range not satisfiable")
    else (200, "-", data)
  | .emptySuffix =>
    if profile = .strict then (206, "bytes 0-0/0", "") else (200, "-", data)
  | .full => (200, "-", data)

inductive UploadRange where
  | absent
  | status (total : Option Nat)
  | closed (start last : Nat) (total : Option Nat)
  | openEnd (start : Nat) (total : Option Nat)
  | malformed (header : String)
  deriving Repr

def totalText : Option Nat → String
  | none => "*"
  | some n => toString n

def uploadHeader : UploadRange → String
  | .absent => "-"
  | .status total => s!"bytes */{totalText total}"
  | .closed start last total => s!"bytes {start}-{last}/{totalText total}"
  | .openEnd start total => s!"bytes {start}-*/{totalText total}"
  | .malformed header => header

inductive Operation where
  | inspect
  | span (start : Nat) (endExclusive total : Option Nat)
  deriving Repr

def parseModeled (header : UploadRange) (count : Nat) : Option Operation :=
  match header with
  | .absent => some (.span 0 (some count) (some count))
  | .status _ => some .inspect
  | .closed start last total =>
    if start ≤ last ∧ last < 2 ^ 64 - 1 then some (.span start (some (last + 1)) total) else none
  | .openEnd start total => some (.span start none total)
  | .malformed _ => none

inductive Phase where
  | receiving | committed | cancelled
  deriving DecidableEq, Repr

structure Session where
  bytes : List Char := []
  total : Option Nat := none
  phase : Phase := .receiving
  deriving Repr

inductive Reply where
  | incomplete (received : Nat)
  | finished (content : String)
  | invalid (message : String)
  | closed
  deriving Repr

def reconcile (prior : List Char) (offset : Nat) (chunk : List Char) : List Char :=
  prior ++ chunk.drop (prior.length - offset)

def status (session : Session) : Reply :=
  match session.phase with
  | .receiving => .incomplete session.bytes.length
  | .committed => .finished (String.ofList session.bytes)
  | .cancelled => .closed

def sizeMismatch : Reply := .invalid "upload size mismatch"

def ingest (session : Session) (header : UploadRange) (chunk : String) : Session × Reply :=
  let data := chunk.toList
  match parseModeled header data.length with
  | none => (session, .invalid s!"invalid Content-Range \"{uploadHeader header}\"")
  | some .inspect => (session, status session)
  | some (.span offset endpoint declared) =>
    if session.phase = .cancelled then (session, .closed)
    else if session.phase = .committed then (session, .invalid "-")
    else if endpoint.any (fun finish => finish - offset != data.length) then
      (session, .invalid s!"Content-Range spans {(endpoint.getD offset) - offset} bytes but the body has {data.length}")
    else if endpoint.any (fun finish => declared.any (· < finish)) then
      (session, .invalid "Content-Range exceeds the declared total")
    else if declared.any (fun total => session.total.any (· != total)) then (session, sizeMismatch)
    else
      let checked := { session with total := declared.or session.total }
      if offset > session.bytes.length then
        (checked, .invalid s!"upload offset mismatch, expected {session.bytes.length}")
      else
        let bytes := reconcile session.bytes offset data
        if checked.total.any (· < bytes.length) then ({ checked with bytes := [], phase := .cancelled }, sizeMismatch)
        else if endpoint.isNone || endpoint == declared then
          if checked.total.any (· != bytes.length) then
            ({ checked with bytes := [], phase := .cancelled }, sizeMismatch)
          else ({ checked with bytes, phase := .committed }, .finished (String.ofList bytes))
        else ({ checked with bytes }, .incomplete bytes.length)

end StorageHttpRange
