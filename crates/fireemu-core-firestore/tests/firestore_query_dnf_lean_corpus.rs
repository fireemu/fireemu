//! Replays the ordered DNF and symbolic accounting reference from verification/lean.

use fireemu_core_firestore::{
    field_path::FieldPath,
    path::DocumentPath,
    query::{
        ComponentCount, Direction, FieldOp, FilterExpr, OrderClause, Query, QueryScope, UnaryOp,
    },
    value::Value,
};
use fireemu_core_types::{
    ids::{CollectionId, DatabaseId, ProjectId},
    json::{self, JsonValue},
};

fn operand(value: JsonValue) -> Value {
    match value {
        JsonValue::Int(value) => Value::Integer(value),
        JsonValue::Null => Value::Null,
        JsonValue::Array(values) => Value::Array(values.into_iter().map(operand).collect()),
        value => panic!("invalid fixture operand {value:?}"),
    }
}

fn atom(text: &str) -> FilterExpr {
    let mut fields = text.splitn(3, ':');
    let operation = fields.next().expect("fixture operator");
    let field = FieldPath::parse(fields.next().expect("fixture field")).expect("field path");
    let argument = fields.next();

    if operation == "u" {
        assert!(argument.is_none(), "unexpected fixture unary operand");
        return FilterExpr::Unary {
            field,
            op: UnaryOp::IsNull,
        };
    }

    let op = match operation {
        "e" => FieldOp::Equal,
        "i" => FieldOp::In,
        "a" => FieldOp::ArrayContainsAny,
        "n" => FieldOp::NotIn,
        operation => panic!("unknown fixture operator {operation}"),
    };
    let value = json::parse(argument.expect("fixture operand")).expect("fixture JSON operand");
    FilterExpr::Field {
        field,
        op,
        value: operand(value),
    }
}

fn filter(program: &str) -> FilterExpr {
    let mut stack = Vec::new();
    for command in program.split_ascii_whitespace() {
        if let Some((kind, count)) = command
            .strip_prefix('A')
            .map(|count| (true, count))
            .or_else(|| command.strip_prefix('O').map(|count| (false, count)))
        {
            let count: usize = count.parse().expect("fixture composite arity");
            let split = stack.len().checked_sub(count).expect("valid fixture stack");
            let children = stack.split_off(split);
            let composite = if kind {
                FilterExpr::And(children)
            } else {
                FilterExpr::Or(children)
            };
            stack.push(composite);
        } else {
            stack.push(atom(command));
        }
    }
    assert_eq!(stack.len(), 1, "valid fixture program result");
    stack.pop().expect("fixture filter")
}

fn disjunctions(text: &str) -> Vec<Vec<FilterExpr>> {
    if text == "zero" {
        return Vec::new();
    }
    text.split('|')
        .map(|term| {
            if term == "_" {
                Vec::new()
            } else {
                term.split_ascii_whitespace().map(atom).collect()
            }
        })
        .collect()
}

fn components(text: &str) -> ComponentCount {
    let parts: Vec<_> = text
        .split(':')
        .map(|value| value.parse::<u64>().expect("fixture component"))
        .collect();
    let [filters, orders, parent_path, total] = parts.as_slice() else {
        panic!("invalid component breakdown");
    };
    ComponentCount {
        filters: *filters,
        orders: *orders,
        parent_path: *parent_path,
        total: *total,
    }
}

#[test]
fn ordered_query_dnf_and_components_match_lean_corpus() {
    let mut lines = include_str!("fixtures/lean-firestore-query-dnf.corpus").lines();
    let count = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert!(count >= 170);
    assert_eq!(lines.clone().count(), count);

    let project = ProjectId::try_new("demo-lean").expect("project");
    let database = DatabaseId::default_database();
    let collection = CollectionId::try_new("target").expect("collection");

    for line in lines {
        let cells: Vec<_> = line.split('\t').collect();
        let [composition, leaf, order_label, scope, program, orders, count, accounting, dnf] =
            cells.as_slice()
        else {
            panic!("invalid DNF fixture row");
        };
        let label = format!("{composition}/{leaf}/{order_label}/{scope}");
        let parent = match *scope {
            "root" => None,
            "shallow" => Some("outer/anchor"),
            "deep" => Some("outer/anchor/inner/child"),
            scope => panic!("unknown parent scope {scope}"),
        }
        .map(|path| DocumentPath::parse(&project, &database, path).expect("parent path"));

        let mut query = Query::new(QueryScope::collection(parent, collection.clone()));
        if *program != "-" {
            query = query.with_filter(filter(program));
        }
        for position in 0..orders.parse::<usize>().expect("explicit order count") {
            query = query.with_order(OrderClause {
                field: FieldPath::parse(&format!("sort{position}")).expect("sort field"),
                direction: Direction::Descending,
            });
        }

        assert_eq!(
            query.dnf_disjunction_count(),
            count.parse::<u64>().expect("DNF disjunction count"),
            "{label}"
        );
        if *accounting != "-" {
            assert_eq!(query.component_count(), components(accounting), "{label}");
        }
        if *dnf != "-" {
            assert_eq!(query.dnf(), disjunctions(dnf), "{label}");
        }
    }
}
