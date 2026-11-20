import Std

namespace EWS

/-- Base-128 unsigned protobuf length, including one byte for zero. -/
def varintLen (n : Nat) : Nat := n.log2 / 7 + 1

def fieldLen (payload : Nat) : Nat := 1 + varintLen payload + payload

def stringFieldLen (value : String) : Nat := fieldLen value.utf8ByteSize

def typeURL : String := "type.googleapis.com/io.cloudevents.v1.CloudEvent"

def channel : String := "projects/demo/locations/us-central1/channels/c"

def eventLimit : Nat := 524288

def countLimit : Nat := 100

def textAttribute (key value : String) : Nat :=
  fieldLen (stringFieldLen key + fieldLen (stringFieldLen value))

/-- The publish shape under test fixes valid metadata and varies decoded payload bytes. -/
def innerSize (payload : Nat) : Nat :=
  stringFieldLen "main" + stringFieldLen "s" + stringFieldLen "1.0" + stringFieldLen "t" +
    textAttribute "datacontenttype" "application/json" + fieldLen payload

def anySize (payload : Nat) : Nat := stringFieldLen typeURL + fieldLen (innerSize payload)

def requestSize (payload peers : Nat) : Nat :=
  stringFieldLen channel + fieldLen (anySize payload) + peers * fieldLen (anySize 2)

inductive Representation where
  | ascii | unicode | binary
  deriving DecidableEq

inductive Verdict where
  | deliver | eventCount | eventSize | binary
  deriving DecidableEq

/-- Peers are valid, small JSON events with equal-width, distinct IDs. -/
def verdict (kind : Representation) (payload peers : Nat) : Verdict :=
  if peers + 1 > countLimit then .eventCount
  else if anySize payload > eventLimit then .eventSize
  else if kind = .binary then .binary
  else .deliver

end EWS
