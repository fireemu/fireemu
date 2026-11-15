//! Queries: the order of children, range bounds and limits.
//!
//! A query orders the children of a location by priority (the default), by key, by value or
//! by the value of a descendant path, breaking ties by key. Values order as absent < `false`
//! < `true` < numbers < strings < objects; keys as [`crate::key::name_compare`]. Bounds
//! compare `(value, key)` pairs: a bound without a key name starts before every key of its
//! value (`startAt`, `endBefore`) or ends after all of them (`endAt`, `startAfter`).
//! `limitToFirst` keeps the first children of the range, `limitToLast` the last ones.

#[cfg(test)]
use std::cell::Cell;
use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

use crate::error::{DatabaseError, ErrorKind, Result};
use crate::json::Json;
use crate::key::name_compare;
use crate::node::{Content, Leaf, Node};
use crate::path::Path;

#[cfg(test)]
thread_local! {
    static MAX_RETAINED_QUERY_CANDIDATES: Cell<usize> = const { Cell::new(0) };
    static MAX_QUERY_HEAP_CAPACITY: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
fn record_retained_candidates(count: usize) {
    MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| maximum.set(maximum.get().max(count)));
}

#[cfg(test)]
fn record_heap_capacity(capacity: usize) {
    MAX_QUERY_HEAP_CAPACITY.with(|maximum| maximum.set(maximum.get().max(capacity)));
}

#[cfg(not(test))]
#[inline]
fn record_retained_candidates(_: usize) {}

#[cfg(not(test))]
#[inline]
fn record_heap_capacity(_: usize) {}

/// What children are ordered by.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum OrderBy {
    /// Priority (`$priority`), the SDK default.
    #[default]
    Priority,
    /// Key (`$key`).
    Key,
    /// Value (`$value`).
    Value,
    /// The value at a descendant path.
    Child(Path),
}

/// The key half of a bound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoundKey {
    /// Before every key.
    Min,
    /// After every key.
    Max,
    /// A key name.
    Name(String),
}

/// One end of a range.
#[derive(Debug, Clone, PartialEq)]
pub struct Bound {
    /// The index value (`null`, a boolean, a number or a string).
    pub value: Json,
    /// The key half.
    pub key: BoundKey,
    /// Whether children equal to the bound are inside the range.
    pub inclusive: bool,
}

/// How many children a query keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limit {
    /// The first `n` children of the range.
    First(u32),
    /// The last `n` children of the range.
    Last(u32),
}

/// A query on the children of one location.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct QueryParams {
    /// The order.
    pub order_by: OrderBy,
    /// The start of the range.
    pub start: Option<Bound>,
    /// The end of the range.
    pub end: Option<Bound>,
    /// The limit.
    pub limit: Option<Limit>,
}

impl QueryParams {
    /// A query in `order_by` order without bounds or limit.
    pub fn ordered_by(order_by: OrderBy) -> Self {
        Self {
            order_by,
            ..Self::default()
        }
    }

    /// `startAt(value, key)`.
    #[must_use]
    pub fn start_at(mut self, value: Json, key: Option<&str>) -> Self {
        self.start = Some(Bound {
            value,
            key: key.map_or(BoundKey::Min, |k| BoundKey::Name(k.to_owned())),
            inclusive: true,
        });
        self
    }

    /// `startAfter(value, key)`.
    #[must_use]
    pub fn start_after(mut self, value: Json, key: Option<&str>) -> Self {
        self.start = Some(Bound {
            value,
            key: key.map_or(BoundKey::Max, |k| BoundKey::Name(k.to_owned())),
            inclusive: false,
        });
        self
    }

    /// `endAt(value, key)`.
    #[must_use]
    pub fn end_at(mut self, value: Json, key: Option<&str>) -> Self {
        self.end = Some(Bound {
            value,
            key: key.map_or(BoundKey::Max, |k| BoundKey::Name(k.to_owned())),
            inclusive: true,
        });
        self
    }

    /// `endBefore(value, key)`.
    #[must_use]
    pub fn end_before(mut self, value: Json, key: Option<&str>) -> Self {
        self.end = Some(Bound {
            value,
            key: key.map_or(BoundKey::Min, |k| BoundKey::Name(k.to_owned())),
            inclusive: false,
        });
        self
    }

    /// `equalTo(value, key)`.
    #[must_use]
    pub fn equal_to(self, value: Json, key: Option<&str>) -> Self {
        self.start_at(value.clone(), key).end_at(value, key)
    }

    /// `limitToFirst(n)`.
    #[must_use]
    pub fn limit_to_first(mut self, n: u32) -> Self {
        self.limit = Some(Limit::First(n));
        self
    }

    /// `limitToLast(n)`.
    #[must_use]
    pub fn limit_to_last(mut self, n: u32) -> Self {
        self.limit = Some(Limit::Last(n));
        self
    }

    /// Checks the bounds against the order: a bound value is `null`, a boolean, a number or
    /// a string; `orderByKey` bounds are strings without a key name; `orderByPriority` bounds
    /// are `null`, numbers or strings.
    pub fn validate(&self) -> Result<()> {
        for bound in self.start.iter().chain(self.end.iter()) {
            let fits = match (&self.order_by, &bound.value) {
                (OrderBy::Key, Json::String(_)) => !matches!(bound.key, BoundKey::Name(_)),
                (_, Json::Array(_) | Json::Object(_))
                | (OrderBy::Key, _)
                | (OrderBy::Priority, Json::Bool(_)) => false,
                _ => true,
            };
            if !fits {
                return Err(DatabaseError::new(
                    ErrorKind::InvalidQuery,
                    format!("bound {bound:?} does not fit order {:?}", self.order_by),
                ));
            }
        }
        Ok(())
    }

    /// The children of `node` the query selects, in query order. The query must be valid.
    pub fn run<'a>(&self, node: Option<&'a Node>) -> Vec<(&'a str, &'a Node)> {
        let Some(Content::Children(children)) = node.map(|n| &n.content) else {
            return Vec::new();
        };
        let Some(limit) = self.limit else {
            let mut selected: Vec<(&'a str, &'a Node)> = children
                .iter()
                .map(|(key, child)| (key.as_str(), child))
                .filter(|(key, child)| self.in_range(key, child))
                .collect();
            record_retained_candidates(selected.len());
            selected.sort_by(|(ka, a), (kb, b)| self.compare_children(ka, a, kb, b));
            return selected;
        };
        let requested = match limit {
            Limit::First(n) | Limit::Last(n) => n as usize,
        };
        if requested == 0 {
            return Vec::new();
        }
        if requested >= children.len() {
            let mut selected: Vec<(&'a str, &'a Node)> = children
                .iter()
                .map(|(key, child)| (key.as_str(), child))
                .filter(|(key, child)| self.in_range(key, child))
                .collect();
            record_retained_candidates(selected.len());
            selected.sort_by(|(ka, a), (kb, b)| self.compare_children(ka, a, kb, b));
            return selected;
        }
        let capacity = requested.min(children.len());
        match limit {
            Limit::First(_) => {
                let mut heap = BinaryHeap::new();
                for (key, child) in children.iter().map(|(key, child)| (key.as_str(), child)) {
                    if !self.in_range(key, child) {
                        continue;
                    }
                    let candidate = Candidate::new(self, key, child);
                    if heap.len() < capacity {
                        heap.push(candidate);
                    } else if heap.peek().is_some_and(|worst| candidate < *worst) {
                        heap.pop();
                        heap.push(candidate);
                    }
                    record_retained_candidates(heap.len());
                    record_heap_capacity(heap.capacity());
                }
                let mut selected: Vec<_> = heap
                    .into_iter()
                    .map(|candidate| (candidate.key, candidate.node))
                    .collect();
                selected.sort_by(|(ka, a), (kb, b)| self.compare_children(ka, a, kb, b));
                selected
            }
            Limit::Last(_) => {
                let mut heap = BinaryHeap::new();
                for (key, child) in children.iter().map(|(key, child)| (key.as_str(), child)) {
                    if !self.in_range(key, child) {
                        continue;
                    }
                    let candidate = Reverse(Candidate::new(self, key, child));
                    if heap.len() < capacity {
                        heap.push(candidate);
                    } else if heap.peek().is_some_and(|worst| candidate < *worst) {
                        heap.pop();
                        heap.push(candidate);
                    }
                    record_retained_candidates(heap.len());
                    record_heap_capacity(heap.capacity());
                }
                let mut selected: Vec<_> = heap
                    .into_iter()
                    .map(|Reverse(candidate)| (candidate.key, candidate.node))
                    .collect();
                selected.sort_by(|(ka, a), (kb, b)| self.compare_children(ka, a, kb, b));
                selected
            }
        }
    }

    /// The query order of two children.
    pub fn compare_children(&self, key_a: &str, a: &Node, key_b: &str, b: &Node) -> Ordering {
        match &self.order_by {
            OrderBy::Key => name_compare(key_a, key_b),
            order => index_value(order, a)
                .cmp_with(&index_value(order, b))
                .then_with(|| name_compare(key_a, key_b)),
        }
    }

    fn in_range(&self, key: &str, child: &Node) -> bool {
        let after_start = self.start.as_ref().is_none_or(|bound| {
            let ord = self.compare_to_bound(key, child, bound);
            ord == Ordering::Greater || (ord == Ordering::Equal && bound.inclusive)
        });
        let before_end = self.end.as_ref().is_none_or(|bound| {
            let ord = self.compare_to_bound(key, child, bound);
            ord == Ordering::Less || (ord == Ordering::Equal && bound.inclusive)
        });
        after_start && before_end
    }

    /// The order of a child against a bound.
    fn compare_to_bound(&self, key: &str, child: &Node, bound: &Bound) -> Ordering {
        let primary = match (&self.order_by, &bound.value) {
            (OrderBy::Key, Json::String(name)) => name_compare(key, name),
            (order, value) => index_value(order, child).cmp_with(&IndexValue::of_bound(value)),
        };
        primary.then_with(|| match &bound.key {
            BoundKey::Min => Ordering::Greater,
            BoundKey::Max => Ordering::Less,
            BoundKey::Name(name) => name_compare(key, name),
        })
    }
}

/// The value a child is ordered by.
enum IndexValue<'a> {
    Absent,
    Bool(bool),
    Number(crate::number::Number),
    String(&'a str),
    Children,
}

impl<'a> IndexValue<'a> {
    fn of_node(node: Option<&'a Node>) -> Self {
        match node.map(|n| &n.content) {
            None => Self::Absent,
            Some(Content::Leaf(Leaf::Bool(value))) => Self::Bool(*value),
            Some(Content::Leaf(Leaf::Number(value))) => Self::Number(*value),
            Some(Content::Leaf(Leaf::String(value))) => Self::String(value),
            Some(Content::Children(_)) => Self::Children,
        }
    }

    fn of_bound(value: &Json) -> IndexValue<'_> {
        match value {
            Json::Bool(b) => IndexValue::Bool(*b),
            Json::Number(n) => IndexValue::Number(*n),
            Json::String(s) => IndexValue::String(s),
            // `validate` refuses arrays and objects; `null` is the absent value.
            Json::Null | Json::Array(_) | Json::Object(_) => IndexValue::Absent,
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Self::Absent => 0,
            Self::Bool(_) => 1,
            Self::Number(_) => 2,
            Self::String(_) => 3,
            Self::Children => 4,
        }
    }

    /// Absent < leaves (in value order) < children (all equal).
    fn cmp_with(&self, other: &IndexValue<'_>) -> Ordering {
        match (self, other) {
            (IndexValue::Bool(a), IndexValue::Bool(b)) => a.cmp(b),
            (IndexValue::Number(a), IndexValue::Number(b)) => a.total_cmp(*b),
            (IndexValue::String(a), IndexValue::String(b)) => crate::key::utf16_cmp(a, b),
            _ => self.rank().cmp(&other.rank()),
        }
    }
}

/// A borrowed child plus the scalar index used to keep it in a bounded top-k heap.
struct Candidate<'a> {
    key: &'a str,
    node: &'a Node,
    index: IndexValue<'a>,
}

impl<'a> Candidate<'a> {
    fn new(query: &QueryParams, key: &'a str, node: &'a Node) -> Self {
        let index = match &query.order_by {
            OrderBy::Key => IndexValue::Absent,
            order => index_value(order, node),
        };
        Self { key, node, index }
    }
}

impl PartialEq for Candidate<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Candidate<'_> {}

impl PartialOrd for Candidate<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Candidate<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        self.index
            .cmp_with(&other.index)
            .then_with(|| name_compare(self.key, other.key))
    }
}

fn index_value<'a>(order: &OrderBy, child: &'a Node) -> IndexValue<'a> {
    match order {
        OrderBy::Priority => match child.priority.as_deref() {
            None => IndexValue::Absent,
            Some(crate::node::Priority::Number(number)) => IndexValue::Number(*number),
            Some(crate::node::Priority::String(string)) => IndexValue::String(string),
        },
        OrderBy::Value => IndexValue::of_node(Some(child)),
        OrderBy::Child(path) => IndexValue::of_node(child.descendant(path)),
        // Key order never asks for an index value.
        OrderBy::Key => IndexValue::Absent,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Limit, OrderBy, QueryParams, MAX_QUERY_HEAP_CAPACITY, MAX_RETAINED_QUERY_CANDIDATES,
    };
    use crate::node::{Content, Leaf, Node};
    use crate::number::Number;

    #[test]
    fn limited_selection_retains_only_the_requested_top_k_candidates() {
        let children = (0..1_024)
            .map(|index| {
                (
                    format!("k{index}"),
                    Node::leaf(Leaf::Number(Number::Int(index))),
                )
            })
            .collect();
        let parent = Node {
            content: Content::Children(children),
            priority: None,
        };
        for limit in [Limit::First(7), Limit::Last(7)] {
            MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| maximum.set(0));
            let query = QueryParams {
                limit: Some(limit),
                order_by: OrderBy::Value,
                ..QueryParams::default()
            };
            let selected = query.run(Some(&parent));
            let mut old_full_sort: Vec<_> = match &parent.content {
                Content::Children(children) => children
                    .iter()
                    .map(|(key, child)| (key.as_str(), child))
                    .filter(|(key, child)| query.in_range(key, child))
                    .collect(),
                Content::Leaf(_) => unreachable!(),
            };
            old_full_sort.sort_by(|(ka, a), (kb, b)| query.compare_children(ka, a, kb, b));
            let old_peak = old_full_sort.len();
            match limit {
                Limit::First(n) => old_full_sort.truncate(n as usize),
                Limit::Last(n) => {
                    let skip = old_full_sort.len().saturating_sub(n as usize);
                    old_full_sort.drain(..skip);
                }
            }
            assert_eq!(selected, old_full_sort);
            assert_eq!(old_peak, 1_024, "full-sort reference scratch");
            MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| assert_eq!(maximum.get(), 7));
        }
        MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| maximum.set(0));
        let query = QueryParams {
            limit: Some(Limit::First(u32::MAX)),
            order_by: OrderBy::Value,
            ..QueryParams::default()
        };
        let selected = query.run(Some(&parent));
        let mut old_full_sort: Vec<_> = match &parent.content {
            Content::Children(children) => children
                .iter()
                .map(|(key, child)| (key.as_str(), child))
                .collect(),
            Content::Leaf(_) => unreachable!(),
        };
        old_full_sort.sort_by(|(ka, a), (kb, b)| query.compare_children(ka, a, kb, b));
        assert_eq!(selected, old_full_sort);
        assert_eq!(
            old_full_sort.len(),
            1_024,
            "u32::MAX is capped by child count"
        );
        MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| assert_eq!(maximum.get(), 1_024));
    }

    #[test]
    fn oversized_limit_with_a_sparse_bound_does_not_reserve_for_all_siblings() {
        let children = (0..1_024)
            .map(|index| {
                (
                    format!("k{index}"),
                    Node::leaf(Leaf::Number(Number::Int(index))),
                )
            })
            .collect();
        let parent = Node {
            content: Content::Children(children),
            priority: None,
        };
        let query = QueryParams::ordered_by(OrderBy::Value)
            .start_at(crate::json::Json::int(500), None)
            .end_at(crate::json::Json::int(500), None)
            .limit_to_first(u32::MAX);
        let mut old_filtered_full_sort: Vec<_> = match &parent.content {
            Content::Children(children) => children
                .iter()
                .map(|(key, child)| (key.as_str(), child))
                .filter(|(key, child)| query.in_range(key, child))
                .collect(),
            Content::Leaf(_) => unreachable!(),
        };
        let old_peak = old_filtered_full_sort.len();
        old_filtered_full_sort.sort_by(|(ka, a), (kb, b)| query.compare_children(ka, a, kb, b));

        MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| maximum.set(0));
        MAX_QUERY_HEAP_CAPACITY.with(|maximum| maximum.set(0));
        let selected = query.run(Some(&parent));
        assert_eq!(selected, old_filtered_full_sort);
        assert_eq!(old_peak, 1, "old filter-first vector retains one match");
        MAX_RETAINED_QUERY_CANDIDATES.with(|maximum| assert_eq!(maximum.get(), 1));
        MAX_QUERY_HEAP_CAPACITY.with(|maximum| {
            assert!(
                maximum.get() < 64,
                "unexpected eager reservation: {}",
                maximum.get()
            );
        });
    }
}
