import FirestoreWatchBloom.Theorems

/-- info: 'FirestoreWatchBloom.positionWithinCapacity' does not depend on any axioms -/
#guard_msgs in #print axioms FirestoreWatchBloom.positionWithinCapacity

/-- info: 'FirestoreWatchBloom.paddingBeyondCapacity' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreWatchBloom.paddingBeyondCapacity

/-- info: 'FirestoreWatchBloom.bitmapWidth' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreWatchBloom.bitmapWidth

/-- info: 'FirestoreWatchBloom.insertionKeepsBit' depends on axioms: [propext] -/
#guard_msgs in #print axioms FirestoreWatchBloom.insertionKeepsBit

/-- info: 'FirestoreWatchBloom.duplicateInsertionKeepsBits' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms FirestoreWatchBloom.duplicateInsertionKeepsBits

/-- info: 'FirestoreWatchBloom.outOfRecordedRange' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms FirestoreWatchBloom.outOfRecordedRange
